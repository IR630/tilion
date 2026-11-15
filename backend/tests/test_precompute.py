"""Precompute: geometry without data; SPICE traps and NASA references when data/ is present.

Data dir: env NASA_DATA, else the first parent of this file that holds data/spice/,
else data/ of the main checkout (git common dir), for a worktree outside the repository.
"""

import hashlib
import json
import math
import os
import subprocess
from functools import cache
from pathlib import Path

import numpy as np
import pytest

from precompute import geo
from precompute.geo import centre_visible, from_xy, horizon_mask, to_xy, unit, visible_fraction

HERE = Path(__file__).resolve()
REPO = HERE.parents[2]
HZ = REPO / "task" / "_arch" / "00b-probe" / "hz"


def _git_common_dir(cwd: Path) -> Path | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--git-common-dir"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None
    return (cwd / out).resolve() if out else None


def resolve_data_dir(here: Path = HERE, env=os.environ, common_dir=_git_common_dir) -> Path | None:
    if env.get("NASA_DATA"):
        return Path(env["NASA_DATA"])
    for p in here.parents:
        if (p / "data" / "spice" / "naif0012.tls").exists():
            return p / "data"
    common = common_dir(here.parent)  # a worktree keeps no data/: use the main checkout's
    if common is not None and (common.parent / "data" / "spice" / "naif0012.tls").exists():
        return common.parent / "data"
    return None


DATA = resolve_data_dir()
DATA_SKIP_TAG = "NASA DATA MISSING:"  # tests/conftest.py prints a warning for it


@cache
def _complete(rel: str) -> bool:
    """File present and its sha256 matches scripts/data.sha256 (downloads resume)."""
    if DATA is None or not (DATA / rel).exists():
        return False
    want = {
        line.split()[1]: line.split()[0]
        for line in (REPO / "scripts" / "data.sha256").read_text().splitlines()
        if line.strip()
    }
    h = hashlib.sha256()
    with open(DATA / rel, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 22), b""):
            h.update(chunk)
    return h.hexdigest() == want.get(rel)


def _why_missing(rels) -> str:
    if DATA is None:
        return "no data/spice/ found above the tests; set NASA_DATA or fill data/ (data/README.md)"
    bad = [r for r in rels if not _complete(r)]
    return f"under {DATA}: missing or sha256 mismatch: {', '.join(bad)}"


def need(*rels):
    return pytest.mark.skipif(
        not all(_complete(r) for r in rels),
        reason=f"{DATA_SKIP_TAG} {_why_missing(rels)}; rerun bash scripts/fetch-data.sh with your data directory",
    )


SPICE = [f"spice/{k}" for k in ("naif0012.tls", "pck00011.tpc", "moon_pa_de440_200625.bpc")]
DSN_SPICE = "spice/earth_2026_260806_2126_predict.bpc"
SPICE += ["spice/moon_de440_250416.tf", "spice/de440s.bsp", DSN_SPICE]


def test_missing_earth_kernel_skip_explains_how_to_fetch_data(monkeypatch, tmp_path):
    monkeypatch.setitem(need.__globals__, "DATA", tmp_path)
    monkeypatch.setitem(need.__globals__, "_complete", lambda rel: rel != DSN_SPICE)
    mark = need(*SPICE)
    assert mark.args == (True,)
    assert DSN_SPICE in mark.kwargs["reason"]
    assert "rerun bash scripts/fetch-data.sh" in mark.kwargs["reason"]


@pytest.fixture(scope="module")
def spice():
    from precompute import ephem

    ephem.load_kernels(DATA / "spice")
    yield ephem
    import spiceypy

    spiceypy.kclear()


# --- DSN, need SPICE kernels ------------------------------------------------------------


@pytest.mark.parametrize(
    "earth_el, station_el, ground_el, expected",
    [
        (1.2, [0.8, 0.8, 0.8], [20, 20, 20], 0),
        (0.8, [1.2, 0.8, 0.8], [20, 20, 20], 1),
        (1.2, [1.2, 0.8, 0.8], [10, 20, 20], 0),
    ],
)
def test_dsn_checks_mask_and_ground_limit_for_the_same_station(
    monkeypatch, earth_el, station_el, ground_el, expected
):
    from precompute import __main__ as pc
    from precompute import dsn

    monkeypatch.setattr(pc, "topo", lambda *a: (np.array([0]), np.array([earth_el]), 0.25))
    monkeypatch.setattr(
        dsn, "station_elevation", lambda ets, s: np.array([ground_el[dsn.STATIONS.index(s)]])
    )
    monkeypatch.setattr(
        dsn,
        "station_topo",
        lambda ets, s, *a: (np.array([0]), np.array([station_el[dsn.STATIONS.index(s)]])),
        raising=False,
    )
    site = {"id": "test", "lonE": 0, "lat": 0}
    mask = {"elevDeg": [1] * 360, "azStepDeg": 1, "observerHeightM": 2}
    tl = pc.site_timeline(site, mask, 0, [0])
    assert tl["earthVisible"] == [int(earth_el > 1)]
    assert tl["dsnVisible"] == [expected]


@need(*SPICE)
def test_dsn_station_at_night_with_moon_below_horizon_gives_zero(spice):
    from precompute.dsn import STATIONS, station_elevation, visible

    ets = [spice.utc_to_et("2026-12-01T03:00:00")]
    goldstone = STATIONS[0]
    assert station_elevation(ets, goldstone, "SUN")[0] < -18
    # JPL Horizons https://ssd.jpl.nasa.gov/api/horizons.api: COMMAND=301, CENTER=coord@399,
    # COORD_TYPE=GEODETIC, SITE_COORD=DSS-14 (goldstone above), 2026-12-01 03:00 UTC,
    # QUANTITIES=4, APPARENT=AIRLESS: Moon centre elevation -43.752523 deg.
    assert station_elevation(ets, goldstone)[0] == pytest.approx(-43.75, abs=0.02)
    assert visible(ets, 0, 0, 2, np.arange(360), np.zeros(360), stations=[goldstone]) == [0]


@need(*SPICE)
def test_dsn_station_directions_stay_inside_earth_disc(spice):
    from precompute.__main__ import epochs
    from precompute.dsn import STATIONS, station_topo

    ets = epochs()[::97]
    eaz, eel, radius = spice.topo("EARTH", ets, 222.83, -89.4398, 2002)
    for station in STATIONS:
        az, el = station_topo(ets, station, 222.83, -89.4398, 2002)
        separation = geo.sep_deg(az, el, eaz, eel)
        assert np.all(separation <= radius + 0.001)  # ~0.95 deg; station height < 1.1 km
        assert separation.max() > 0.5  # station directions must not collapse to Earth centre


@need(*SPICE)
def test_dsn_zero_station_offset_matches_earth_topocentric_lt_s(spice, monkeypatch):
    from precompute import dsn

    ets = [spice.utc_to_et("2027-03-13T02:00:00")]
    monkeypatch.setattr(dsn.sp, "georec", lambda *a: np.zeros(3))
    az, el = dsn.station_topo(ets, dsn.STATIONS[0], 222.83, -89.4398, 2002)
    eaz, eel, _ = spice.topo("EARTH", ets, 222.83, -89.4398, 2002)
    assert az == pytest.approx(eaz, abs=1e-8)
    assert el == pytest.approx(eel, abs=1e-8)


@need(*SPICE)
def test_dsn_only_rebuild_matches_full_timeline_without_changing_earth_or_sun(spice, tmp_path):
    from precompute.__main__ import main, site_timeline

    site = {"id": "test", "lonE": 0, "lat": 0, "terrain": "none"}
    mask = {"elevDeg": [0] * 360, "azStepDeg": 1, "observerHeightM": 2}
    ets = spice.utc_to_et("2026-12-01") + np.arange(3) * 3600
    expected = site_timeline(site, mask, 0, ets)
    stale = {**expected, "dsnVisible": [1 - v for v in expected["dsnVisible"]]}
    for subdir in ("mask", "timeline"):
        (tmp_path / subdir).mkdir()
    (tmp_path / "sites.json").write_text(json.dumps({"sites": [site]}))
    (tmp_path / "mask/test.json").write_text(json.dumps(mask))
    path = tmp_path / "timeline/test.json"
    path.write_text(json.dumps(stale))
    main(["--data", str(DATA), "--out", str(tmp_path), "--dsn-only"])
    spice.load_kernels(DATA / "spice")  # main clears kernels; restore the module fixture
    assert json.loads(path.read_text()) == expected


# --- geometry, no data ------------------------------------------------------------------


def test_longitude_is_0_360_east_and_stereographic_round_trips():
    # Trap: product longitude 0-360 E, x = r sin(lon), y = r cos(lon).
    x, y = to_xy(unit(-137.17, -89.4398))
    lon, lat = from_xy(x, y)
    assert lon == pytest.approx(222.83, abs=1e-6)
    assert lat == pytest.approx(-89.4398, abs=1e-6)
    x, y = to_xy(unit(90.0, -89.0))
    assert x > 0 and abs(y) < 1e-6


class _Flat:
    step = 80.0

    def __init__(self, wall_az=None):
        self.wall_az = wall_az

    def sample(self, x, y):
        return np.zeros_like(np.asarray(x, dtype=float))


def test_bare_sphere_horizon_dips_below_level_with_height():
    az, el, h0 = horizon_mask(_Flat(), 222.83, -89.44, h_obs=2.0)
    assert len(az) == 720 and h0 == 0.0
    dip = math.degrees(math.acos(geo.R / (geo.R + 2.0)))  # 0.0274 deg for 2 m
    assert np.all(el < 0) and np.all(el > -dip - 0.01)


def test_sun_disc_fraction_and_earth_centre_rule():
    maz = np.arange(0, 360, 0.5)
    mel = np.ones_like(maz)  # mask 1 deg everywhere
    f = visible_fraction(np.array([0.0, 0.0, 0.0]), np.array([0.0, 1.0, 2.0]), 0.265, maz, mel)
    assert f[0] == 0 and f[1] == pytest.approx(0.5, abs=0.01) and f[2] == 1
    # any limb above the mask counts as light
    assert visible_fraction(np.array([0.0]), np.array([0.8]), 0.265, maz, mel)[0] > 0
    assert list(centre_visible([10, 10], [0.9, 1.1], maz, mel)) == [0, 1]


@pytest.mark.parametrize(("earth_el", "expected"), [(-1.0, 0.5), (1.0, 0.0)])
def test_timeline_combines_terrain_and_earth_occlusion(monkeypatch, earth_el, expected):
    from precompute import __main__ as precompute

    earth_radius = np.degrees(np.arcsin(np.sin(np.radians(1.0)) / geo.EARTH_SHADOW_SCALE))

    def topo(body, *args):
        return (
            np.array([0.0]),
            np.array([0.0 if body == "SUN" else earth_el]),
            0.01 if body == "SUN" else earth_radius,
        )

    monkeypatch.setattr(precompute, "topo", topo)
    monkeypatch.setattr(precompute, "dsn_visible", lambda ets, *a: [1] * len(ets))
    mask = {"elevDeg": [0.0] * 720, "azStepDeg": 0.5, "observerHeightM": 2.0}
    site = {"id": "test", "lonE": 0.0, "lat": 0.0}
    timeline = precompute.site_timeline(site, mask, 0.0, np.array([0.0]))
    assert timeline["sunVisible"][0] == pytest.approx(expected, abs=0.01)


def test_joint_occlusion_with_azimuth_varying_horizon():
    x = (np.arange(1000) + 0.5) / 500 - 1
    xx, yy = np.meshgrid(x, x)
    r2 = xx**2 + yy**2
    disc = r2 < 1
    mu = np.sqrt(np.maximum(1 - r2, 0))
    flux = (0.3 + 0.93 * mu - 0.23 * mu**2) * disc
    visible = (yy > 0.6 * xx) & (xx**2 + (yy + 100) ** 2 > 100**2)
    expected = flux[visible].sum() / flux.sum()
    actual = geo.sun_visible_fraction(
        np.array([10.0]),
        np.array([0.0]),
        0.01,
        [0, 9.99, 10.01, 359],
        [-0.006, -0.006, 0.006, 0.006],
        np.array([10.0]),
        np.array([-1.0]),
        1.0,
    )
    assert actual[0] == pytest.approx(expected, abs=0.003)


def test_limb_darkened_flux_matches_brute_force_integral():
    from precompute.geo import SUN_LIMB

    maz = np.arange(0, 360, 0.5)
    mel = np.ones_like(maz)
    rad = 0.265
    # Brute force on a 2000 x 2000 grid of the unit disc: I = a0 + a1 mu + a2 mu^2.
    g = (np.arange(2000) + 0.5) / 1000 - 1
    x, y = np.meshgrid(g, g)
    inside = x * x + y * y < 1
    mu = np.sqrt(np.where(inside, 1 - x * x - y * y, 0))
    i = (SUN_LIMB[0] + SUN_LIMB[1] * mu + SUN_LIMB[2] * mu * mu) * inside
    for el in (0.8, 1.0, 1.15):  # top cap, half disc, most of the disc above a 1 deg horizon
        want = i[y > (1.0 - el) / rad].sum() / i.sum()
        got = visible_fraction(np.array([0.0]), np.array([el]), rad, maz, mel, limb=SUN_LIMB)[0]
        assert got == pytest.approx(want, abs=2e-3), el
    # Limb darkening: a thin top cap carries less flux than its share of the disc area.
    cap = visible_fraction(np.array([0.0]), np.array([0.8]), rad, maz, mel)[0]
    assert visible_fraction(np.array([0.0]), np.array([0.8]), rad, maz, mel, limb=SUN_LIMB)[0] < cap


def test_uniform_limb_reproduces_the_old_area_share():
    # Old algorithm (before D-010): clipped chord length per strip, flat disc.
    rng = np.random.default_rng(7)
    maz = np.arange(0, 360, 0.5)
    mel = np.cumsum(rng.normal(0, 0.05, maz.size)) % 3 - 1.5
    az, el, rad = rng.uniform(0, 360, 200), rng.uniform(-2, 4, 200), 0.265
    num = den = 0.0
    for x in (np.arange(15) + 0.5) / 15 * 2 - 1:
        chord = rad * np.sqrt(1 - x * x)
        a = (az + x * rad / np.cos(np.radians(np.clip(el, -89, 89)))) % 360
        hz = np.interp(a, maz, mel, period=360)
        num = num + np.clip(el + chord - hz, 0, 2 * chord)
        den += 2 * chord
    got = visible_fraction(az, el, rad, maz, mel, limb=(1.0, 0.0, 0.0))
    assert np.allclose(got, num / den, atol=1e-12)


# --- SPICE traps, need kernels ----------------------------------------------------------

MON = {
    m: i + 1
    for i, m in enumerate(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    )
}
HZ_SITES = {
    "apollo11": (23.47297, 0.67408),
    "shackleton_ridge": (222.69, -89.45),
    "malapert_a": (1.44, -80.13),
    "chandrayaan3": (32.319, -69.373),
    "blue_ghost": (61.81, 18.56),
}


def _horizons_rows():
    for name, (lon, lat) in HZ_SITES.items():
        for code, target in (("10", "SUN"), ("399", "EARTH")):
            t = (HZ / f"{name}_{code}.txt").read_text()
            body = t[t.index("$$SOE") + 5 : t.index("$$EOE")]
            for line in body.strip().splitlines():
                p = [x.strip() for x in line.split(",")]
                y, m, d = p[0].split()[0].split("-")
                utc = f"{y}-{MON[m]:02d}-{d}T{p[0].split()[1]}"
                yield lon, lat, target, utc, float(p[3]), float(p[4])


def _sep(a1, e1, a2, e2):
    a1, e1, a2, e2 = map(np.radians, (a1, e1, a2, e2))
    c = np.sin(e1) * np.sin(e2) + np.cos(e1) * np.cos(e2) * np.cos(a1 - a2)
    return float(np.degrees(np.arccos(np.clip(c, -1, 1))))


def _max_error(ephem, **kw):
    errs = []
    for lon, lat, target, utc, haz, hel in _horizons_rows():
        az, el, _ = ephem.topo(target, [ephem.utc_to_et(utc)], lon, lat, 0.0, **kw)
        errs.append(_sep(az[0], el[0], haz, hel))
    return max(errs)


@need(*SPICE)
def test_matches_horizons_and_catches_pa_and_missing_aberration(spice):
    assert _max_error(spice) < 0.002  # MOON_ME, LT+S: probe measured 0.0000 deg
    assert _max_error(spice, frame_name="MOON_PA") > 0.02  # ME vs PA trap
    assert _max_error(spice, abcorr="NONE") > 0.004  # LT+S trap


@need(*SPICE)
def test_utc_input_is_not_tdb(spice):
    import spiceypy as sp

    d = spice.utc_to_et("2025-01-01T00:00:00") - sp.str2et("2025-01-01 00:00:00 TDB")
    assert d == pytest.approx(69.18, abs=0.01)


@need(*SPICE)
def test_apollo12_sun_elevation_at_landing(spice):
    # Apollo 12 LM 3.0128 S 336.5781 E, landing 1969-11-19T06:54:36Z: Sun about 5.1 deg.
    _, el, _ = spice.topo("SUN", [spice.utc_to_et("1969-11-19T06:54:36")], 336.5781, -3.0128)
    assert el[0] == pytest.approx(5.1, abs=0.3)


@need(*SPICE, "lola/LDEM_80S_80MPP_ADJ.TIF", "lola/LDEM_60S_240MPP_ADJ.TIF")
def test_ridge_c1_illumination_matches_published(spice):
    # Mazarico 2011 / PGDA 69: best ridge pixel 88.4 % over 18.6 y; Glaser 2018 C1 at 2 m: 88 %.
    terrain = geo.Terrain(
        geo.Dem(DATA / "lola" / "LDEM_80S_80MPP_ADJ.TIF"),
        geo.Dem(DATA / "lola" / "LDEM_60S_240MPP_ADJ.TIF"),
    )
    lon, lat = 222.83, -89.4398
    maz, mel, h0 = horizon_mask(terrain, lon, lat, h_obs=2.0)
    ets = spice.utc_to_et("2020-01-01T00:00:00") + np.arange(0, int(18.6 * 365.25 * 8)) * 10800.0
    az, el, rad = spice.topo("SUN", ets, lon, lat, h0 + 2.0)
    lit = float(np.mean(visible_fraction(az, el, rad, maz, mel)))
    assert 0.85 <= lit <= 0.90, lit  # measured 87.6 %


def test_variant_flips_roundtrip():
    from precompute.variants import flips, on_share

    f = np.array([0, 1, 1, 0, 0, 1])
    assert flips(f) == [1, 3, 5]
    assert on_share(flips(f), len(f)) == pytest.approx(3 / 6)
    assert flips(np.array([1, 1])) == [0]


def test_thin_crescent_flux_is_not_rounded_to_dark():
    from precompute.__main__ import round_flux

    # 0.003 would round to 0.00 = "dark" (D-010: lit means flux > 0); 75 hours of 218 615 did.
    assert round_flux([0.003, 1e-9, 0.0, 0.014, 0.5, 1.0]) == [0.01, 0.01, 0.0, 0.01, 0.5, 1.0]
    # A real thin crescent: the top 0.01 deg of the limb-darkened disc carries ~1e-4 of the flux.
    maz, mel = np.arange(0, 360, 0.5), np.ones(720)
    flux = visible_fraction(np.array([0.0]), np.array([0.75]), 0.265, maz, mel, limb=geo.SUN_LIMB)
    assert 0 < flux[0] < 0.005 and round(float(flux[0]), 2) == 0.0
    assert round_flux(flux) == [0.01]


def test_eclipse_fraction_full_none_and_partial():
    # Sun 0.26 deg, Earth 0.95 deg (as seen from the Moon): Earth over the Sun hides all, apart none.
    assert geo.eclipsed_fraction(0.1, 0.26, 0.95) == pytest.approx(1.0)
    assert geo.eclipsed_fraction(1.3, 0.26, 0.95) == 0.0
    # Two equal flat discs one radius apart: lens area (2 pi / 3 - sqrt(3) / 2) / pi = 0.3910.
    lens = (2 * math.pi / 3 - math.sqrt(3) / 2) / math.pi
    assert geo.eclipsed_fraction(1.0, 1.0, 1.0, limb=geo.UNIFORM) == pytest.approx(lens, abs=1e-4)
    # A straight Earth limb through the Sun centre hides half the flux for any limb law.
    assert geo.eclipsed_fraction(1000.0, 1.0, 1000.0) == pytest.approx(0.5, abs=1e-3)
