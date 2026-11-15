"""Validation screen numbers: pure helpers without data; SPICE checks when data/ is present."""

import json
from pathlib import Path

import numpy as np
import pytest
import test_precompute as tp
from test_precompute import HZ, SPICE, need

from precompute import validation as v

REPO = Path(__file__).resolve().parents[2]
spice = tp.spice  # module-scoped SPICE kernels fixture


def test_sep_deg_is_great_circle_angle():
    assert v.sep_deg(10.0, 20.0, 10.0, 20.0) == pytest.approx(0.0, abs=1e-9)
    assert v.sep_deg(0.0, 0.0, 90.0, 0.0) == pytest.approx(90.0)
    # Near the zenith azimuth hardly matters.
    assert v.sep_deg(0.0, 89.0, 180.0, 89.0) == pytest.approx(2.0)


def test_row_diff_and_missing_values():
    r = v.row("c", "s", "src", "u", 10.25, 10.0, "deg", 0.3, True)
    assert r["diff"] == pytest.approx(0.25)
    r = v.row("c", "s", "src", "u", None, 1.0, "h", None, None)
    assert r["ours"] is None and r["diff"] is None
    assert v.row("c", "s", "src", "u", float("nan"), 0.0, "h", None, None)["ours"] is None


def test_sunsets_interpolate_the_crossing():
    ets = np.array([0.0, 10.0, 20.0, 30.0, 40.0])
    vis = np.array([1.0, 0.5, 0.0, 0.0, 1.0])  # set between 10 and 20, rises again at 40
    assert v.sunsets(ets, vis) == pytest.approx([20.0])
    assert v.sunsets(ets, np.array([1.0, 1.0, 0.25, 0.0, 0.0])) == pytest.approx([30.0])
    assert len(v.sunsets(ets, np.ones(5))) == 0


def test_sunset_errors_take_the_nearest_terrain_sunset():
    h = 3600.0
    err = v.sunset_errors_h(np.array([0.0, 100 * h]), np.array([2 * h, 90 * h]))
    assert err == pytest.approx([2.0, 10.0])
    assert len(v.sunset_errors_h(np.array([]), np.array([1.0]))) == 0


def test_summary_counts_only_pass_fail_rows():
    groups = [{"rows": [{"pass": True}, {"pass": False}, {"pass": None}, {"pass": True}]}]
    assert v.summarize(groups) == {"checks": 3, "pass": 2, "fail": 1, "info": 1}


@pytest.mark.skipif(not HZ.exists(), reason="Horizons reference tables missing")
def test_parse_horizons_reads_site_and_rows():
    h = v.parse_horizons(HZ / "apollo11_10.txt")
    assert h["target"] == "SUN"
    assert len(h["rows"]) > 0
    utc, az, el = h["rows"][0]
    assert utc[4] == "-" and "T" in utc
    assert 0 <= az < 360 and -90 <= el <= 90


@need(*SPICE)
def test_topo_fast_matches_topo(spice):
    """Moving the observer off the centre changes LT+S by < 0.001 deg (docstring of body_vectors)."""
    import spiceypy as sp

    ets = spice.utc_to_et("2027-03-01T00:00:00") + np.arange(0, 30 * 86400, 6 * 3600.0)
    lon, lat, h = 222.69, -89.45, 1500.0
    az, el, _ = spice.topo("SUN", list(ets), lon, lat, h)
    r = sp.bodvrd("SUN", "RADII", 3)[1][0]
    faz, fel, _ = v.topo_fast(v.body_vectors("SUN", ets), r, lon, lat, h)
    assert v.sep_deg(az, el, faz, fel).max() < 0.001


@need(*SPICE)
@pytest.mark.skipif(not HZ.exists(), reason="Horizons reference tables missing")
def test_ephemeris_group_passes_and_catches_moon_pa(spice):
    g = v.group_ephemeris(HZ)
    assert [r["pass"] for r in g["rows"]] == [True, True, True]
    assert g["rows"][2]["ours"] > v.EPHEM_TOL_DEG


def test_published_validation_json_has_source_for_every_row():
    p = REPO / "web" / "public" / "data" / "validation.json"
    d = json.loads(p.read_text())
    rows = [r for g in d["groups"] for r in g["rows"]]
    assert rows and all(r["source"] and r["url"].startswith("https://") for r in rows)
    assert d["summary"] == v.summarize(d["groups"])


def test_barker_xy_axes_point_the_other_way():
    # Barker et al. 2021 Table 2 X, Y read as ours land at 42.9E, the far side of the pole;
    # (-X, -Y) puts RoI 1 on the connecting ridge next to our cr1 site (222.85E -89.44).
    x, y, _, _ = v.BARKER_ROI[0]
    lon, lat = v.from_xy_pt(-x * 1000, -y * 1000)
    assert lon == pytest.approx(222.9, abs=0.1) and lat == pytest.approx(-89.439, abs=0.001)
    assert v.from_xy_pt(x * 1000, y * 1000)[0] == pytest.approx(42.9, abs=0.1)


@need("lola/LDEM_80S_80MPP_ADJ.TIF")
def test_dem_window_matches_the_full_file_and_is_nan_outside():
    from precompute.geo import Dem

    full = Dem(tp.DATA / "lola" / "LDEM_80S_80MPP_ADJ.TIF")
    win = Dem(tp.DATA / "lola" / "LDEM_80S_80MPP_ADJ.TIF", (-11000.0, -12000.0, 2000.0))
    xs, ys = np.array([-11000.0, -12345.6]), np.array([-12000.0, -10987.6])
    assert win.sample(xs, ys) == pytest.approx(full.sample(xs, ys), abs=1e-3)
    assert np.isnan(win.sample(-11000.0, -9000.0))  # 3 km away: outside the 2 km window


@need("lola/LDEM_80S_80MPP_ADJ.TIF", "lola/LDEM_60S_240MPP_ADJ.TIF")
def test_app_terrain_puts_the_fine_window_first():
    from precompute.__main__ import site_terrain
    from precompute.geo import Dem

    # The local 80 m file stands in for the 20 m one: the window must come first, 80 m and 240 m after.
    dems = {
        "fine": tp.DATA / "lola" / "LDEM_80S_80MPP_ADJ.TIF",
        "polar80": Dem(tp.DATA / "lola" / "LDEM_80S_80MPP_ADJ.TIF"),
        "polar240": Dem(tp.DATA / "lola" / "LDEM_60S_240MPP_ADJ.TIF"),
    }
    t = site_terrain({"terrain": "polar80", "lonE": 222.85, "lat": -89.44}, dems)
    assert len(t.dems) == 3 and t.dems[0].a.shape[0] <= 126  # 10 km window at 80 m
    assert t.dems[1] is dems["polar80"] and t.dems[2] is dems["polar240"]


def test_map_terrain_uses_the_grid_of_the_pgda_map():
    # #194: the 240 m map was checked on LOLA 80 m near the site, a finer grid than the map.
    # A map pixel is the horizon model at a post of its own grid, so the 240 m map needs 240 m.
    from types import SimpleNamespace

    dems = {"polar80": SimpleNamespace(dx=80.0), "polar240": SimpleNamespace(dx=240.0)}
    assert v.map_terrain(240.0, {"terrain": "polar80"}, dems).dems == [dems["polar240"]]
    assert v.map_terrain(60.0, {"terrain": "polar80"}, dems).dems == [
        dems["polar80"],
        dems["polar240"],
    ]
    assert v.map_terrain(60.0, {"terrain": "polar240"}, dems).dems == [dems["polar240"]]


@need(
    *SPICE,
    "lola/LDEM_80S_80MPP_ADJ.TIF",
    "lola/LDEM_60S_240MPP_ADJ.TIF",
    "illum/AVGVISIB_65S_240M_201608_EARTH.TIF",
)
def test_athena_earth_matches_the_240_m_map_on_its_own_grid(spice):
    # IM-2 Athena lies on the 65S map (240 m). On the map grid our Earth share is within 5 pp of
    # the map; on LOLA 80 m it is 7.7 pp low (S3 FAIL before #194).
    import spiceypy as sp

    from precompute.geo import Dem

    d80 = Dem(tp.DATA / "lola" / "LDEM_80S_80MPP_ADJ.TIF")
    d240 = Dem(tp.DATA / "lola" / "LDEM_60S_240MPP_ADJ.TIF")
    emap = v.IllumMap(tp.DATA / "illum" / "AVGVISIB_65S_240M_201608_EARTH.TIF")
    r, c, cx, cy = emap.pixel(29.1957, -84.7906)
    # The map pixel centre is a post of the 240 m DEM: no interpolation at the observer.
    assert ((cx - d240.x0) / d240.dx - 0.5) % 1 == pytest.approx(0.0, abs=1e-9)
    lon, lat = v.from_xy_pt(cx, cy)
    e0 = spice.utc_to_et(v.ILLUM_START_UTC)
    ets = e0 + np.arange(0, v.NUTATION_YEARS * 365.25 * 86400, 6 * 3600.0)
    sun, earth = v.body_vectors("SUN", ets), v.body_vectors("EARTH", ets)
    sr, er = sp.bodvrd("SUN", "RADII", 3)[1][0], sp.bodvrd("EARTH", "RADII", 3)[1][0]
    ref = emap.value(r, c) * 100
    dems = {"polar80": d80, "polar240": d240}
    terrain = v.map_terrain(emap.res, {"terrain": "polar80"}, dems)
    _, ours = v.site_means(terrain, lon, lat, 0.0, sun, earth, sr, er)
    _, fine = v.site_means(v.Terrain(d80, d240), lon, lat, 0.0, sun, earth, sr, er)
    assert abs(ours * 100 - ref) <= v.ILLUM_TOL_PP
    assert abs(fine * 100 - ref) > v.ILLUM_TOL_PP


@need(
    *SPICE,
    "lola/LDEM_75S_120M.IMG",
    "lola/LDEM_75S_120M.LBL",
    "lola/LDEM_80S_80MPP_ADJ.TIF",
    "lola/LDEM_60S_240MPP_ADJ.TIF",
    "illum/AVGVISIB_75S_120M_201608.IMG",
    "illum/AVGVISIB_75S_120M_201608.LBL",
)
def test_ridge_c1_sun_matches_the_120_m_map_on_its_own_dem(spice):
    # S4 misses C1 by 37 pp on the 2021 DEM. On the DEM the 120 m map names (LDEM_75S_120M) the
    # same model is within 5 pp; on the 2021 DEM at the same pixel it is 17 pp low (#270).
    import spiceypy as sp

    from precompute.geo import Dem

    same = Dem(tp.DATA / "lola" / "LDEM_75S_120M.LBL")
    same.a -= v.R
    d80 = Dem(tp.DATA / "lola" / "LDEM_80S_80MPP_ADJ.TIF")
    d240 = Dem(tp.DATA / "lola" / "LDEM_60S_240MPP_ADJ.TIF")
    smap = v.IllumMap(tp.DATA / "illum" / "AVGVISIB_75S_120M_201608.LBL")
    r, c, cx, cy = smap.pixel(222.83, -89.4398)
    lon, lat = v.from_xy_pt(cx, cy)
    e0 = spice.utc_to_et(v.ILLUM_START_UTC)
    ets = e0 + np.arange(0, v.NUTATION_YEARS * 365.25 * 86400, 6 * 3600.0)
    sun, earth = v.body_vectors("SUN", ets), v.body_vectors("EARTH", ets)
    sr, er = sp.bodvrd("SUN", "RADII", 3)[1][0], sp.bodvrd("EARTH", "RADII", 3)[1][0]
    ref = smap.value(r, c) * 100
    ours, _ = v.site_means(v.Terrain(same, d240), lon, lat, 0.0, sun, earth, sr, er)
    adj, _ = v.site_means(v.Terrain(d80, d240), lon, lat, 0.0, sun, earth, sr, er)
    assert abs(ours * 100 - ref) <= v.ILLUM_TOL_PP
    assert ref - adj * 100 > v.ILLUM_TOL_PP


@need(*SPICE)
def test_eclipse_contacts_match_gsfc_and_catch_earth_without_air(spice, monkeypatch):
    # Trap: Earth disc without the opaque air layer (Danjon x 1.01) moves contacts by 71-115 s.
    import spiceypy as sp

    from precompute import geo

    g, cat = v.gsfc_et(v.ECLIPSES[0])  # total lunar eclipse 2025-03-14
    sun_r, earth_r = sp.bodvrd("SUN", "RADII", 3)[1][0], sp.bodvrd("EARTH", "RADII", 3)[1][0]
    ours = v.moon_contacts(g, sun_r, earth_r)
    assert all(abs(ours[k] - cat[k]) <= v.ECLIPSE_TOL_S for k in cat)  # measured <= 4.7 s
    monkeypatch.setattr(geo, "EARTH_SHADOW_SCALE", 1.0)
    bare = v.moon_contacts(g, sun_r, earth_r)
    assert all(abs(bare[k] - cat[k]) > v.ECLIPSE_TOL_S for k in cat)


@need(*SPICE)
def test_gsfc_contacts_are_ut_with_their_own_delta_t(spice):
    # The catalogue prints UT = TD - 75 s (Delta T predicted in 2009); real TDB - UTC is 69.2 s.
    g, cat = v.gsfc_et(v.ECLIPSES[0])
    assert g - cat["P1"] == pytest.approx(3 * 3600 + 2 * 60 + 32.2 - 75, abs=0.01)
    naive = spice.utc_to_et("2025-03-14T03:57:24")
    assert cat["P1"] - naive == pytest.approx(75 - 69.18, abs=0.01)
    # P4 of 2027-02-20 is after midnight: it stays within 12 h of greatest eclipse.
    g, cat = v.gsfc_et(v.ECLIPSES[1])
    assert 0 < cat["P4"] - g < 3 * 3600


@need(*SPICE)
def test_timeline_dims_the_sun_in_the_2027_08_17_eclipse(spice):
    from precompute.__main__ import site_timeline

    site = {"id": "a_peak_cabeus_b", "lat": -83.563, "lonE": 291.7991}
    mask = {"elevDeg": [-1.0] * 720, "azStepDeg": 0.5, "observerHeightM": 2.0}
    ets = spice.utc_to_et("2027-08-17T07:14:00") + np.array([-6 * 3600.0, 0.0])
    tl = site_timeline(site, mask, 0.0, ets)
    assert tl["sunVisible"][0] == 1.0  # 6 h before: no eclipse, Sun above a low mask
    assert 0.45 <= tl["sunVisible"][1] <= 0.6  # measured max 48 % of the flux hidden


def test_illum_map_area_centres_round_trip(tmp_path):
    import rasterio
    from rasterio.transform import from_origin
    from rasterio.warp import transform

    path = tmp_path / "area.tif"
    crs = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m"
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=3,
        height=3,
        count=1,
        dtype="int16",
        crs=crs,
        transform=from_origin(-120, 120, 60, 60),
    ) as ds:
        ds.write(np.ones((3, 3), dtype=np.int16), 1)
        ds.update_tags(AREA_OR_POINT="Area")
    smap = v.IllumMap(path)
    for r, c in [(0, 0), (1, 2), (2, 1)]:
        x, y = smap.t * (c + 0.5, r + 0.5)
        lon, lat = v.from_xy_pt(x, y)
        assert smap.pixel(lon, lat) == pytest.approx((r, c, x, y))
        xx, yy = transform("+proj=longlat +R=1737400", crs, [lon], [lat])
        assert (x, y) == pytest.approx((xx[0], yy[0]), abs=1e-8)
        assert v.to_xy(v.unit(lon, lat)) == pytest.approx((x, y), abs=1e-8)


def test_illum_map_footprint_averages_inside_area_pixel():
    from rasterio.transform import from_origin

    smap = v.IllumMap.__new__(v.IllumMap)
    smap.t = from_origin(0, 60, 60, 60)
    points = []

    def model(x, y):
        points.append((x, y))
        return np.array([x * x, y * y])

    # Midpoint quadrature: x,y = 10,30,50 m. Mean squares differ from centre squared.
    assert smap.footprint(0, 0, model) == pytest.approx([3500 / 3, 3500 / 3])
    assert len(points) == 9 and all(0 < x < 60 and 0 < y < 60 for x, y in points)


def test_pgda_sun_counts_samples_with_any_visible_disc(monkeypatch):
    monkeypatch.setattr(v, "horizon_mask", lambda *args: (None, None, 0))
    monkeypatch.setattr(v, "topo_fast", lambda *args: (None, None, None))
    monkeypatch.setattr(v, "visible_fraction", lambda *args, **kw: np.array([0.0, 0.5, 1.0]))
    sun, earth = v.site_means(None, 0, -89, 0, None, None, 1, 1)
    assert sun == pytest.approx(2 / 3)
    assert earth == pytest.approx(2 / 3)


def test_patch_uses_median_of_absolute_paired_errors(monkeypatch):
    from rasterio.transform import from_origin

    smap = v.IllumMap.__new__(v.IllumMap)
    smap.t = from_origin(0, 420, 60, 60)
    smap.a = np.zeros((7, 7))
    smap.scale = 1.0
    errors = iter([-3.0] * 24 + [1.0] * 24 + [5.0])
    monkeypatch.setattr(v, "site_means", lambda *args: (next(errors) / 100, 0.0))
    stats = v.patch_stats(smap, smap, 3, 3, None, np.zeros(12), np.zeros(12), 1, 1)
    assert stats["sun"] == pytest.approx((-43 / 49, np.sqrt(265 / 49), 3.0))


def _coarse_85s_map(px_m=2000.0, half_m=152000.0):
    from rasterio.transform import from_origin

    smap = v.IllumMap.__new__(v.IllumMap)
    n = round(2 * half_m / px_m)
    smap.t = from_origin(-half_m, half_m, px_m, px_m)
    smap.a = np.ones((n, n), dtype=np.int16)
    smap.nodata = -32768
    smap.scale = 1.0
    smap.res = px_m
    return smap


def test_random_case_is_preregistered_in_eval_cases():
    c = v.random_case()
    assert (c["n"], c["seed"], c["lat_edge"], c["tolerance"]) == (150, 20261115, -85.0, 5.0)


def test_random_points_are_deterministic_uniform_in_area_and_snapped():
    smap = _coarse_85s_map()
    a = v.random_points(smap, 2000, 20261115)
    assert a == v.random_points(smap, 2000, 20261115)
    assert a[:5] != v.random_points(smap, 5, 1)
    lat = np.array([p["lat"] for p in a])
    assert lat.max() <= -85.0 and lat.min() >= -90.0
    # Uniform in area: the 87.5-90 cap holds (1 - cos 2.5°) / (1 - cos 5°) = 25.0 % of the 85-90 cap.
    assert np.mean(lat < -87.5) == pytest.approx(0.25, abs=0.03)
    # Uniform in sin(lat): mean of sin|lat| is the middle of [sin 85°, 1].
    assert np.mean(np.sin(np.radians(-lat))) == pytest.approx(
        (np.sin(np.radians(85)) + 1) / 2, abs=2e-4
    )
    lon = np.array([p["lonE"] for p in a])
    assert lon.min() >= 0 and lon.max() < 360 and np.mean(lon < 180) == pytest.approx(0.5, abs=0.04)
    for p in a[:50]:
        x, y = smap.t * (p["col"] + 0.5, p["row"] + 0.5)
        assert (p["pxLonE"], p["pxLat"]) == pytest.approx(v.from_xy_pt(x, y))
        assert smap.pixel(p["lonE"], p["lat"])[:2] == (p["row"], p["col"])
    assert len({(p["row"], p["col"]) for p in a}) == len(a)  # no pixel taken twice


def test_random_points_skip_nodata_pixels():
    smap = _coarse_85s_map()
    first = v.random_points(smap, 20, 7)
    r, c = first[0]["row"], first[0]["col"]
    smap.a[r, c] = smap.nodata
    again = v.random_points(smap, 20, 7)
    assert all((p["row"], p["col"]) != (r, c) for p in again)
    assert again[:19] == first[1:20]  # the NoData candidate is skipped, the stream goes on


def test_thermal_model_matches_diviner_equator():
    # Hayne et al. 2017 Table A2 (Vasavada 2012): 385 K noon, 101 K midnight, 95 K before sunrise.
    from precompute import thermal as th

    lt, t = th.equator_day()
    assert t[0] == pytest.approx(385.0, abs=v.THERMAL_TOL_K)
    assert t[np.argmin(np.abs(lt - 12))] == pytest.approx(101.0, abs=v.THERMAL_TOL_K)
    assert t[(lt > 12) & (lt < 18)].min() == pytest.approx(95.0, abs=v.THERMAL_TOL_K)


def test_ground_normal_gives_the_slope_of_a_tilted_plane():
    class Plane:
        step = 20.0

        def sample(self, x, y):
            return 0.2 * np.asarray(x)  # 11.3 deg rise along stereographic x

    _, slope = v.ground_normal(Plane(), 0.0, -89.0)
    assert slope == pytest.approx(np.degrees(np.arctan(0.2)), abs=0.1)


def test_prp_triangle_normal_points_out_and_gives_its_slope(tmp_path):
    # Triangle at the south pole, tilted 10 deg about x, vertices ordered so the raw cross product points in.
    t = np.radians(10.0)
    c = np.array([0.0, 0.0, -1737.4])
    e1, e2 = np.array([0.5, 0.0, 0.0]), np.array([0.0, 0.5 * np.cos(t), 0.5 * np.sin(t)])
    tri = [c - e1 - e2, c + e1 - e2, c + e2]
    if np.cross(tri[1] - tri[0], tri[2] - tri[0]) @ c > 0:
        tri[1], tri[2] = tri[2], tri[1]
    vals = [*np.concatenate(tri), 0.0, -90.0, 0.0, 110.0, 250.0, -999.0]
    f = tmp_path / "prp.tab"
    f.write_text("header\n" + ",".join(f"{x:.6f}" for x in vals) + "\n")
    p, n, avg, mx = v.prp_south(f)
    assert n[0] @ p[0] > 0
    assert np.degrees(np.arccos(n[0] @ p[0])) == pytest.approx(10.0, abs=0.01)
    assert (avg[0], mx[0]) == (110.0, 250.0)


def test_polar_albedo_is_0_12_at_every_incidence():
    th = v.th
    for deg in (0.0, 60.0, 88.5):
        assert th.albedo(np.radians(deg), th.POLAR) == pytest.approx(0.12)
    assert th.albedo(np.radians(88.5)) > 0.7  # Eq. A8 at a grazing Sun


def test_terrain_flux_is_view_factor_times_slope_light_and_zero_at_night():
    th, h = v.th, np.radians(10.0)
    az = np.arange(0.0, 360.0, 0.5)
    # Sun at the zenith over a uniform 10 deg horizon: every slope gets cos h, view factor sin^2 h.
    q = v.terrain_flux(
        az, np.full(az.size, 10.0), np.array([0.0, 0.0]), np.array([90.0, -5.0]), 1000.0
    )
    share = th.A0 * (1 - th.A0) + (1 - th.A0) * th.EMIS
    assert q[0] == pytest.approx(1000.0 * np.sin(h) ** 2 * np.cos(h) * share)
    assert q[1] == 0.0
    # Low Sun in the north: a hill in the south faces it and shines, a hill in the north does not.
    for hill_az, lit in ((180.0, True), (0.0, False)):
        el = np.where(az == hill_az, 10.0, 0.0)
        q = v.terrain_flux(az, el, np.array([0.0]), np.array([0.5]), 1000.0)
        assert (q[0] > 0.0) == lit


def test_mare_day_scales_the_eq_a8_terms_with_the_mare_albedo(monkeypatch):
    seen = {}
    monkeypatch.setattr(v.th, "equator_day", lambda **k: seen.update(k))
    v._mare_day(20.0)
    a0, a, b = seen["law"]
    assert (a0, a / v.th.A_A, b / v.th.A_B) == pytest.approx((0.06, 0.5, 0.5))
