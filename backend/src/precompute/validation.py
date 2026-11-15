"""Validation against NASA references: every number on the "NASA check" screen comes from here.

Run from backend/:

    uv run python -m precompute.validation --data <nasa data dir> --out ../web/public/data

Writes <out>/validation.json. Groups:
1. ephemeris: our SPICE Sun/Earth az/el vs JPL Horizons tables (task/_arch/00b-probe/hz).
2. apollo: Sun elevation/azimuth at Apollo 11/12/16 touchdown vs ALSJ and Mission Reports.
3. illumination: 18.6-year share of time any part of the Sun or Earth is visible at each polar
   site vs the PGDA 69 maps (Mazarico et al. 2011), observer at the surface (0 m).
3b. barker: Sun fraction on the connecting ridge vs Barker et al. 2021 Table 2 (same LOLA DEM family).
4. sphere: sunset-time error of a bare sphere vs our terrain horizon, 2027 (the trivial answer).
5. eclipse: Earth hides the Sun - contact times of three lunar eclipses vs the NASA GSFC catalogue,
   for the whole Moon and for single sites (Blue Ghost M1, the polar sites).
"""

import argparse
import json
import re
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import spiceypy as sp

from . import thermal as th
from .__main__ import site_terrain
from .ephem import ABCORR, FRAME, load_kernels, topo, utc_to_et
from .geo import (
    FINE_DEM,
    SUN_LIMB,
    Dem,
    R,
    Terrain,
    eclipsed_fraction,
    fine_dem,
    frame,
    horizon_mask,
    sep_deg,
    shadow_radius,
    sun_visible_fraction,
    to_xy,
    unit,
    visible_fraction,
)

REPO = Path(__file__).resolve().parents[3]
HZ_DIR = REPO / "task" / "_arch" / "00b-probe" / "hz"

URL = {
    "horizons": "https://ssd.jpl.nasa.gov/horizons/",
    "alsj": "https://www.apollojournals.org/alsj/alsj-EarthSun_AltAz.html",
    "a12mr": "https://www.apollojournals.org/alsj/a12/A12_MissionReport.pdf",
    "orloff16": "https://www.nasa.gov/wp-content/uploads/static/history/SP-4029/Apollo_16a_Summary.htm",
    "pgda69": "https://pgda.gsfc.nasa.gov/products/69",
    "lola": "https://pgda.gsfc.nasa.gov/products/90",
    "barker": "https://doi.org/10.1016/j.pss.2020.105119",
    "gsfc": "https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html",
    "shadow": "https://eclipse.gsfc.nasa.gov/LEcat5/shadow.html",
    "bg1": "https://lroc.im-ldi.com/images/1407",
    "hayne": "https://doi.org/10.1002/2017JE005387",
    "prp": "https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp/",
    "hayne21": "https://arxiv.org/abs/2005.05369",
}
EPHEM_TOL_DEG = 0.002  # same as test_precompute; the MOON_PA trap gives ~0.03 deg
APOLLO_TOL_DEG = 0.3
ILLUM_TOL_PP = 5.0
ILLUM_START_UTC = "2020-01-01T00:00:00"
NUTATION_YEARS = 18.6
SUNSET_START_UTC = "2027-01-01T00:00:00"
SUNSET_STEP_MIN = 10
APP_OBSERVER_M = 2.0
PATCH_PX = 7  # paired PGDA checks on the 7 x 7 map pixels around every site
PATCH_EVERY = 6  # ... every 6th time step (6 h at the default 1 h)

# Barker et al. 2021 (PSS 196, 105119), Table 2: Site 1 (Shackleton - de Gerlache connecting ridge),
# RoI centroids in the paper's stereographic X, Y (km); 2024-01-01..2026-01-01 hourly, 5 m above the
# surface, "Avg Ill-1" in %: case B = 1st percentile over 100 DEM clones taken per pixel, then averaged
# over the RoI; case C = per clone the most illuminated RoI pixel at each hour, then the 1st percentile
# over clones (the paper: "same as (A) but ..."). We check that our
# point value lies in the band B..C: below B means too dark, above C means too bright.
# The paper's X, Y point the other way from ours: our (x, y) = (-X, -Y) puts RoI 1 at 222.9E -89.44,
# on the ridge (test_validation).
BARKER_START_UTC, BARKER_END_UTC, BARKER_DZ_M = "2024-01-01T00:00:00", "2026-01-01T00:00:00", 5.0
BARKER_ROI = [
    (11.5825, 12.4625, 88.21, 91.83),
    (11.4875, 12.5575, 87.82, 91.24),
    (11.3525, 12.5025, 83.64, 89.78),
    (11.2875, 12.1675, 87.43, 91.11),
    (11.1025, 11.9425, 84.94, 88.38),
    (10.8025, 11.7375, 86.97, 89.05),
    (10.2275, 11.5525, 82.47, 84.98),
]

# Touchdown UTC (Mission Reports), LROC 2016 coordinates come from sites.json.
APOLLO = [
    {
        "id": "apollo11",
        "utc": "1969-07-20T20:17:39.9",
        "alsj": (10.65, 88.81),
        "official": (
            10.8,
            "Apollo 12 Mission Report, sec. 6.1.3 (10.8° for Apollo 11)",
            URL["a12mr"],
        ),
        "note": "10.8° matches the planned launch-window value (Orloff SP-4029); stated to 0.1°.",
    },
    {
        "id": "apollo12",
        "utc": "1969-11-19T06:54:36",
        "alsj": (5.19, 91.16),
        "official": (5.1, "Apollo 12 Mission Report, sec. 6.1.3", URL["a12mr"]),
        "note": "Lowest Sun of all Apollo landings: a frame or time error shows at once.",
    },
    {
        "id": "apollo16",
        "utc": "1972-04-21T02:23:35",
        "alsj": (14.76, 86.01),
        "official": None,
        "planned": (11.9, "Orloff, NASA SP-2000-4029 (planned)", URL["orloff16"]),
        "note": "Landing came ~6 h late, so the planned 11.9° does not apply at touchdown.",
    },
]


def _num(x, digits=3):
    return None if x is None or not np.isfinite(x) else round(float(x), digits)


def row(
    check,
    site,
    source,
    url,
    ours,
    reference,
    unit_,
    tolerance,
    pass_,
    note="",
    site_id=None,
    digits=3,
):
    diff = None if ours is None or reference is None else ours - reference
    return {
        "check": check,
        "site": site,
        "siteId": site_id,
        "source": source,
        "url": url,
        "ours": _num(ours, digits),
        "reference": _num(reference, digits),
        "diff": _num(diff, digits),
        "unit": unit_,
        "tolerance": tolerance,
        "pass": pass_,
        "note": note,
    }


# --- 1. Ephemeris vs JPL Horizons -------------------------------------------------------

MON = {
    m: i + 1
    for i, m in enumerate(
        ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    )
}


def parse_horizons(path: Path) -> dict:
    """One Horizons observer table: target, site (lonE, lat, alt km) and (utc, az, el) rows."""
    t = path.read_text()
    target = re.search(r"Target body name:\s*(\w+)", t).group(1).upper()
    lon, lat, alt = (
        float(v) for v in re.search(r"Center geodetic\s*:\s*([^{]+)", t).group(1).split(",")
    )
    rows = []
    for line in t[t.index("$$SOE") + 5 : t.index("$$EOE")].strip().splitlines():
        p = [x.strip() for x in line.split(",")]
        day, hms = p[0].split()
        y, m, d = day.split("-")
        rows.append((f"{y}-{MON[m]:02d}-{d}T{hms}", float(p[3]), float(p[4])))
    return {
        "target": target,
        "lonE": lon,
        "lat": lat,
        "altKm": alt,
        "rows": rows,
        "file": path.name,
    }


def horizons_errors(hz_dir: Path, **kw) -> dict[str, np.ndarray]:
    """Angular error (deg) of our az/el vs every Horizons row, per target."""
    out: dict[str, list] = {}
    for f in sorted(hz_dir.glob("*.txt")):
        h = parse_horizons(f)
        ets = [utc_to_et(u) for u, _, _ in h["rows"]]
        az, el, _ = topo(h["target"], ets, h["lonE"], h["lat"], h["altKm"] * 1000, **kw)
        ref = np.array([(a, e) for _, a, e in h["rows"]])
        out.setdefault(h["target"], []).extend(sep_deg(az, el, ref[:, 0], ref[:, 1]))
    return {k: np.array(v) for k, v in out.items()}


def group_ephemeris(hz_dir: Path) -> dict:
    errs = horizons_errors(hz_dir)
    pa = np.concatenate(list(horizons_errors(hz_dir, frame_name="MOON_PA").values()))
    nfiles = len(list(hz_dir.glob("*.txt")))
    rows = []
    for target, name in (("SUN", "Sun"), ("EARTH", "Earth")):
        e = errs[target]
        rows.append(
            row(
                f"{name} az/el, max angular error",
                f"{nfiles} Horizons tables, 5 sites",
                "JPL Horizons (DE441, MEAN_ME, airless, apparent)",
                URL["horizons"],
                float(e.max()),
                0.0,
                "deg",
                EPHEM_TOL_DEG,
                bool(e.max() <= EPHEM_TOL_DEG),
                f"n = {len(e)} epochs, median {np.median(e):.6f}°.",
                digits=6,
            )
        )
    rows.append(
        row(
            "Trap check: MOON_PA frame instead of MOON_ME is caught",
            "same epochs",
            "JPL Horizons",
            URL["horizons"],
            float(pa.max()),
            0.0,
            "deg",
            EPHEM_TOL_DEG,
            bool(pa.max() > EPHEM_TOL_DEG),
            "Pass means the wrong frame breaks the tolerance, so the check above can catch it "
            f"(median {np.median(pa):.4f}°).",
            digits=6,
        )
    )
    return {
        "id": "ephemeris",
        "title": "Sun and Earth position vs JPL Horizons",
        "explanation": (
            "We compute where the Sun and the Earth stand in the lunar sky with NASA SPICE kernels "
            f"(DE440, frame {FRAME}, light time + aberration). JPL Horizons computes the same thing "
            "independently. We compare azimuth and elevation at 2025–2029 epochs for five sites."
        ),
        "rows": rows,
    }


# --- 2. Sun at Apollo touchdowns --------------------------------------------------------


def group_apollo(sites: dict) -> dict:
    rows = []
    for a in APOLLO:
        s = sites[a["id"]]
        h = s["elevM"] or 0.0
        az, el, _ = topo("SUN", [utc_to_et(a["utc"])], s["lonE"], s["lat"], h)
        az, el = float(az[0]), float(el[0])
        name = s["name"]
        ok = lambda d: bool(abs(d) <= APOLLO_TOL_DEG)
        rows.append(
            row(
                "Sun elevation at touchdown",
                name,
                "ALSJ Sun/Earth table (Scotti & Fjeld) — a computation",
                URL["alsj"],
                el,
                a["alsj"][0],
                "deg",
                APOLLO_TOL_DEG,
                ok(el - a["alsj"][0]),
                f"Touchdown {a['utc']}Z. ALSJ used older site coordinates; we use LROC 2016.",
                s["id"],
            )
        )
        rows.append(
            row(
                "Sun azimuth at touchdown",
                name,
                "ALSJ Sun/Earth table (Scotti & Fjeld) — a computation",
                URL["alsj"],
                az,
                a["alsj"][1],
                "deg",
                APOLLO_TOL_DEG,
                ok(az - a["alsj"][1]),
                "",
                s["id"],
            )
        )
        if a["official"]:
            v, src, url = a["official"]
            rows.append(
                row(
                    "Sun elevation at touchdown",
                    name,
                    f"{src} — official value",
                    url,
                    el,
                    v,
                    "deg",
                    APOLLO_TOL_DEG,
                    ok(el - v),
                    a["note"],
                    s["id"],
                )
            )
        if a.get("planned"):
            v, src, url = a["planned"]
            rows.append(
                row(
                    "Planned Sun elevation (not touchdown)",
                    name,
                    src,
                    url,
                    el,
                    v,
                    "deg",
                    None,
                    None,
                    a["note"] + " Shown to prove we use the actual touchdown time.",
                    s["id"],
                )
            )
    return {
        "id": "apollo",
        "title": "Sun at historic Apollo landings",
        "explanation": (
            "Apollo crews landed with the Sun low behind them. We take the actual touchdown time and "
            "the LROC landing coordinates and compute the Sun position. ALSJ numbers are an independent "
            "computation; the Mission Report numbers are official NASA values."
        ),
        "rows": rows,
    }


# --- 3. Terrain vs PGDA 69 illumination maps --------------------------------------------


def body_vectors(target: str, ets: np.ndarray) -> np.ndarray:
    """Selenocentric apparent vectors (km, MOON_ME, LT+S) for many epochs.

    Topocentric = this minus the observer position. The observer offset (< 1740 km) changes light
    time by < 6 ms and aberration by < 5 m/s of surface speed: < 0.001 deg (test_validation).
    """
    v, _ = sp.spkpos(target, list(ets), FRAME, ABCORR, "MOON")
    return np.asarray(v)


def topo_fast(vecs: np.ndarray, radius_km: float, lon_e: float, lat: float, h: float):
    """az, el, angular radius (deg) from precomputed selenocentric vectors."""
    up, east, north = frame(lon_e, lat)
    v = vecs - up * (R + h) / 1000.0
    dist = np.linalg.norm(v, axis=1)
    az = np.degrees(np.arctan2(v @ east, v @ north)) % 360
    el = np.degrees(np.arcsin((v @ up) / dist))
    return az, el, np.degrees(np.arcsin(radius_km / dist))


class IllumMap:
    """PGDA 69 AVGVISIB GeoTIFF: value = int16 x file scale tag (4e-5)."""

    def __init__(self, path: Path):
        import rasterio

        with rasterio.open(path) as ds:
            self.a = ds.read(1)
            self.nodata = ds.nodata
            self.scale = ds.scales[0] or 1.0
            self.t = ds.transform
            self.res = abs(ds.res[0])
            self.name = path.stem

    def pixel(self, lon_e, lat):
        """(row, col, centre x, centre y) of the pixel under a site, or None outside."""
        x, y = to_xy(unit(lon_e, lat))
        col, r = ~self.t * (float(x), float(y))
        col, r = int(np.floor(col)), int(np.floor(r))
        if not (0 <= r < self.a.shape[0] and 0 <= col < self.a.shape[1]):
            return None
        if self.a[r, col] == self.nodata:
            return None
        cx, cy = self.t * (col + 0.5, r + 0.5)
        return r, col, cx, cy

    def value(self, r, c) -> float:
        return float(self.a[r, c]) * self.scale

    def box(self, r, c) -> tuple[float, float]:
        w = self.a[max(r - 1, 0) : r + 2, max(c - 1, 0) : c + 2].astype(float)
        w = w[w != self.nodata] * self.scale
        return float(w.min()), float(w.max())

    def footprint(self, r, c, model, samples=3):
        """Midpoint quadrature of a model over one AREA pixel (diagnostic, not a DEM post)."""
        offsets = (np.arange(samples) + 0.5) / samples
        return np.mean(
            [model(*(self.t * (c + dx, r + dy))) for dy in offsets for dx in offsets],
            axis=0,
        )


def from_xy_pt(x, y):
    lon = float(np.degrees(np.arctan2(x, y)) % 360)
    lat = float(-90 + np.degrees(2 * np.arctan(np.hypot(x, y) / (2 * R))))
    return lon, lat


def map_terrain(map_res_m: float, site, dems) -> Terrain:
    """LOLA grid closest to the PGDA 69 map grid: 80 m + 240 m for the 60 m map, 240 m for the 240 m map.

    A map pixel is the horizon model at a post of the map's own grid. The 240 m map and LOLA 240 m
    share their posts; LOLA 80 m there resolves crests that the map smooths out (#194). A coarser
    grid smooths the close-range relief and gives more light (Glaser et al. 2017, Icarus, with
    Mazarico; https://ntrs.nasa.gov/citations/20170007365).
    """
    order = (
        ["polar80", "polar240"]
        if site["terrain"] == "polar80" and map_res_m < 240
        else ["polar240"]
    )
    return Terrain(*(dems[k] for k in order))


CASES = REPO / "eval" / "cases.json"


def random_case() -> dict:
    """The pre-registered S4_random case (#331): n, seed, lat_edge, tolerance live in eval/cases.json."""
    return next(c for c in json.loads(CASES.read_text(encoding="utf-8")) if c["id"] == "S4_random")


def random_points(smap, n: int, seed: int, lat_edge: float = -85.0) -> list[dict]:
    """n points uniform in area over lat_edge..-90, snapped to smap pixel centres (rule in eval/cases.json).

    Each candidate takes rng.random(2) = (u, v): sin(lat) = -(sin|edge| + u (1 - sin|edge|)), lonE = 360 v.
    A candidate is skipped when its pixel is outside the map, NoData or already taken.
    """
    rng = np.random.default_rng(seed)
    s0 = np.sin(np.radians(abs(lat_edge)))
    out, seen, drawn = [], set(), 0
    while len(out) < n:
        u, v = rng.random(2)
        drawn += 1
        lat = float(np.degrees(np.arcsin(-(s0 + u * (1.0 - s0)))))
        lon = float(360.0 * v)
        hit = smap.pixel(lon, lat)
        if hit is None or hit[:2] in seen:
            continue
        r, c, cx, cy = hit
        seen.add((r, c))
        plon, plat = from_xy_pt(cx, cy)
        out.append(
            {
                "draw": drawn,
                "lonE": lon,
                "lat": lat,
                "row": r,
                "col": c,
                "pxLonE": plon,
                "pxLat": plat,
            }
        )
    return out


def patch_stats(smap, emap, r0, c0, terrain, sun, earth, sun_r, earth_r) -> dict:
    """Paired 0 m model-minus-map errors: bias, RMS and median absolute error, pp."""
    sun, earth = sun[::PATCH_EVERY], earth[::PATCH_EVERY]
    d = {"sun": [], "earth": []}
    k = PATCH_PX // 2
    for r in range(r0 - k, r0 + k + 1):
        for c in range(c0 - k, c0 + k + 1):
            lon, lat = from_xy_pt(*(smap.t * (c + 0.5, r + 0.5)))
            s, e = site_means(terrain, lon, lat, 0.0, sun, earth, sun_r, earth_r)
            d["sun"].append(s * 100 - smap.value(r, c) * 100)
            d["earth"].append(e * 100 - emap.value(r, c) * 100)
    return {
        key: (float(np.mean(v)), float(np.sqrt(np.mean(np.square(v)))), float(np.median(np.abs(v))))
        for key, v in d.items()
    }


def site_means(terrain, lon, lat, h_obs, sun, earth, sun_r, earth_r):
    """Share of samples with any visible part of the Sun or Earth, as in AVGVISIB."""
    maz, mel, h0 = horizon_mask(terrain, lon, lat, h_obs)
    saz, sel, srad = topo_fast(sun, sun_r, lon, lat, h0 + h_obs)
    eaz, eel, erad = topo_fast(earth, earth_r, lon, lat, h0 + h_obs)
    # Product label: "indicate the percentage of timesteps where each pixel was sunlit
    # (by any fraction of the solar disc)." This is time visibility, not mean disc flux.
    # https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG/AVGVISIB_85S_060M_201608.LBL
    # The label names LDEM_85S_060M (60 m), not our adjusted 2021 LOLA DEM.
    s = float(np.mean(visible_fraction(saz, sel, srad, maz, mel, limb=SUN_LIMB) > 0))
    e = float(np.mean(visible_fraction(eaz, eel, erad, maz, mel) > 0))
    return s, e


def group_illumination(polar, dems, illum_dir: Path, step_h: float) -> dict:
    maps = {
        "85S": (
            IllumMap(illum_dir / "AVGVISIB_85S_060M_201608.TIF"),
            IllumMap(illum_dir / "AVGVISIB_85S_060M_201608_EARTH.TIF"),
        ),
        "65S": (
            IllumMap(illum_dir / "AVGVISIB_65S_240M_201608.TIF"),
            IllumMap(illum_dir / "AVGVISIB_65S_240M_201608_EARTH.TIF"),
        ),
    }
    # Like-for-like: the 120 m map was computed on LDEM_75S_120M, which PDS still serves (#270).
    same_map = IllumMap(illum_dir / "AVGVISIB_75S_120M_201608.LBL")
    same_dem = Dem(dems["same120"])
    same_dem.a -= R  # GDAL reads the PDS label OFFSET (reference radius) as the band offset
    # The 60 m map label names LDEM_85S_060M, which PDS no longer serves; LDEM_75S_60M V2.0 is the same
    # 60 m grid, same version as LDEM_75S_120M above (#321).
    same60 = Dem(dems["same60"])
    same60.a -= R
    e0 = utc_to_et(ILLUM_START_UTC)
    ets = e0 + np.arange(0, NUTATION_YEARS * 365.25 * 86400, step_h * 3600.0)
    sun, earth = body_vectors("SUN", ets), body_vectors("EARTH", ets)
    sun_r, earth_r = sp.bodvrd("SUN", "RADII", 3)[1][0], sp.bodvrd("EARTH", "RADII", 3)[1][0]
    rows = []
    for s in polar:
        key = "85S" if s["lat"] <= -85 and maps["85S"][0].pixel(s["lonE"], s["lat"]) else "65S"
        smap, emap = maps[key]
        # D-023: on the 60 m map the Sun is scored on the map's own 60 m grid (rows below); the rows on our
        # 80 m DEM stay as a reference, they measure the DEM difference. The 240 m map is scored on LOLA 240 m.
        # Earth rows stay scored on our DEM: there is no Earth map on another grid to replace them.
        ref_only = key == "85S"
        r, c, cx, cy = smap.pixel(s["lonE"], s["lat"])
        lon, lat = from_xy_pt(cx, cy)
        terrain = map_terrain(smap.res, s, dems)
        t = time.time()
        sun0, earth0 = site_means(terrain, lon, lat, 0.0, sun, earth, sun_r, earth_r)
        sun2, earth2 = site_means(terrain, lon, lat, APP_OBSERVER_M, sun, earth, sun_r, earth_r)
        ref_s, ref_e = smap.value(r, c) * 100, emap.value(r, c) * 100
        bs, be = smap.box(r, c), emap.box(r, c)
        dem_m = "80 m + 240 m" if len(terrain.dems) == 2 else "240 m"
        patch = patch_stats(smap, emap, r, c, terrain, sun, earth, sun_r, earth_r)
        where = (
            f"map {smap.name} pixel ({r}, {c}) centre {lon:.4f}E {lat:.4f}; our DEM LOLA {dem_m}"
        )
        for key, label, ours, ours2, ref, b in (
            (
                "sun",
                "Mean visible solar disc time (any part), 18.6 y",
                sun0 * 100,
                sun2 * 100,
                ref_s,
                bs,
            ),
            (
                "earth",
                "Earth visible (any part of disc), 18.6 y",
                earth0 * 100,
                earth2 * 100,
                ref_e,
                be,
            ),
        ):
            d = ours - ref
            info = ref_only and key == "sun"
            ok = None if info else bool(abs(d) <= ILLUM_TOL_PP)
            note = (
                f"{where}. At 2 m (app height): {ours2:.1f} %. "
                f"Map 3×3 neighbourhood: {b[0] * 100:.1f}–{b[1] * 100:.1f} %."
            )
            if info:
                note = (
                    "Reference (DEM comparison): scored on the 60 m grid DEM, row 'Same 60 m DEM'. "
                    + note
                )
            elif not ok:
                why = "the model and map disagree; the contribution of the different DEMs is not isolated"
                note += f" Fail: {why}."
                bias, rms, _ = patch[key]
                note += (
                    f" Our model on the {PATCH_PX}×{PATCH_PX} map pixels around it "
                    f"(every {PATCH_EVERY * step_h:g} h): bias {bias:+.1f} pp, RMS {rms:.1f} pp."
                )
            rows.append(
                row(
                    label,
                    s["name"],
                    "PGDA 69 (Mazarico et al. 2011)",
                    URL["pgda69"],
                    ours,
                    ref,
                    "%",
                    None if info else ILLUM_TOL_PP,
                    ok,
                    note,
                    s["id"],
                )
            )
        bias, rms, med = patch["sun"]
        rows.append(
            row(
                "Sun patch median absolute difference, 7×7",
                s["name"],
                "PGDA 69 (Mazarico et al. 2011)",
                URL["pgda69"],
                med,
                0.0,
                "pp",
                None if ref_only else ILLUM_TOL_PP,
                None if ref_only else bool(med <= ILLUM_TOL_PP),
                (
                    "Reference (DEM comparison): scored on the 60 m grid DEM, row 'Same 60 m DEM'. "
                    if ref_only
                    else ""
                )
                + f"{where}. Matched pixel pairs, every {PATCH_EVERY * step_h:g} h; "
                f"bias {bias:+.3f} pp, RMS {rms:.3f} pp. Threshold committed in e80dd2b8 before computation.",
                s["id"],
            )
        )
        print(
            f"  illum {s['id']:24s} Sun {sun0 * 100:5.1f}/{ref_s:5.1f}  Earth {earth0 * 100:5.1f}/{ref_e:5.1f}  {time.time() - t:4.1f} s"
        )
        hit = same_map.pixel(s["lonE"], s["lat"]) if s["lat"] <= -75 else None
        if hit:
            r, c, cx, cy = hit
            lon, lat = from_xy_pt(cx, cy)
            ours, _ = site_means(
                Terrain(same_dem, dems["polar240"]), lon, lat, 0.0, sun, earth, sun_r, earth_r
            )
            ours, ref = ours * 100, same_map.value(r, c) * 100
            b = same_map.box(r, c)
            rows.append(
                row(
                    "Same DEM: visible solar disc time (any part), 18.6 y",
                    s["name"],
                    "PGDA 69 (Mazarico et al. 2011)",
                    URL["pgda69"],
                    ours,
                    ref,
                    "%",
                    ILLUM_TOL_PP,
                    bool(abs(ours - ref) <= ILLUM_TOL_PP),
                    f"map {same_map.name} pixel ({r}, {c}) centre {lon:.4f}E {lat:.4f}; our DEM LOLA "
                    f"LDEM_75S_120M V2.0 (the grid the map label names; LOLA 240 m beyond its 75°S edge). Map 3×3 neighbourhood: "
                    f"{b[0] * 100:.1f}–{b[1] * 100:.1f} %. Threshold committed in fd6ab622 before computation.",
                    s["id"],
                )
            )
        hit60 = maps["85S"][0].pixel(s["lonE"], s["lat"]) if s["lat"] <= -85 else None
        if hit60:
            smap, emap = maps["85S"]
            r, c, cx, cy = hit60
            lon, lat = from_xy_pt(cx, cy)
            t60 = Terrain(same60, dems["polar240"])
            ours, _ = site_means(t60, lon, lat, 0.0, sun, earth, sun_r, earth_r)
            ours, ref = ours * 100, smap.value(r, c) * 100
            b = smap.box(r, c)
            bias, rms, med = patch_stats(smap, emap, r, c, t60, sun, earth, sun_r, earth_r)["sun"]
            where = (
                f"map {smap.name} pixel ({r}, {c}) centre {lon:.4f}E {lat:.4f}; our DEM LOLA LDEM_75S_60M V2.0 "
                "(the 60 m grid of LDEM_85S_060M named by the map label; LOLA 240 m beyond its 75°S edge)"
            )
            pre = "Threshold committed in 35099ba8 before computation."
            rows.append(
                row(
                    "Same 60 m DEM: visible solar disc time (any part), 18.6 y",
                    s["name"],
                    "PGDA 69 (Mazarico et al. 2011)",
                    URL["pgda69"],
                    ours,
                    ref,
                    "%",
                    ILLUM_TOL_PP,
                    bool(abs(ours - ref) <= ILLUM_TOL_PP),
                    f"{where}. Map 3×3 neighbourhood: {b[0] * 100:.1f}–{b[1] * 100:.1f} %. {pre}"
                    + (
                        f" Fail in this one pixel: our value is inside the map's own 3×3 range, and the {PATCH_PX}×{PATCH_PX} "
                        f"patch median {med:.2f} pp is within the tolerance."
                        if abs(ours - ref) > ILLUM_TOL_PP
                        and b[0] * 100 <= ours <= b[1] * 100
                        and med <= ILLUM_TOL_PP
                        else ""
                    ),
                    s["id"],
                )
            )
            rows.append(
                row(
                    "Same 60 m DEM: Sun patch median absolute difference, 7×7",
                    s["name"],
                    "PGDA 69 (Mazarico et al. 2011)",
                    URL["pgda69"],
                    med,
                    0.0,
                    "pp",
                    ILLUM_TOL_PP,
                    bool(med <= ILLUM_TOL_PP),
                    f"{where}. Matched pixel pairs, every {PATCH_EVERY * step_h:g} h; "
                    f"bias {bias:+.3f} pp, RMS {rms:.3f} pp. {pre}",
                    s["id"],
                )
            )
            print(f"  same60 {s['id']:24s} Sun {ours:5.1f}/{ref:5.1f}  patch median {med:.2f} pp")
    return {
        "id": "illumination",
        "title": "Terrain illumination vs NASA polar illumination maps",
        "explanation": (
            "NASA Goddard (Mazarico et al. 2011, PGDA product 69) published the share of time any part of the "
            "solar disc is visible over a full 18.6-year lunar nutation cycle, and the share of time "
            "the Earth is visible (any part of its disc). The maps are computed as seen from the surface, "
            "so this check uses observer height 0 m; our app uses 2 m (shown in the notes). We run our "
            "own horizon model on LOLA terrain at the centre of the same map pixel "
            f"(85°S map at 60 m where it covers the site, else the 65°S map at 240 m), "
            f"{ILLUM_START_UTC[:10]} + 18.6 years, every {step_h:g} h. "
            "Here we use the available LOLA grid closest to the map: 80 m + 240 m for the 60 m map, 240 m for the "
            "240 m map (its pixel centres are the 240 m DEM points); the app adds 20 m within 5 km. "
            "The 60 m product label names LDEM_85S_060M; we have the 2021 adjusted DEM instead. "
            "To isolate that difference, the 'Same DEM' rows run the same model on LDEM_75S_120M, the DEM "
            "named by the 120 m map AVGVISIB_75S_120M_201608, at that map's pixel centres (sites at 75–90°S). "
            "PDS serves that DEM as version 2.0 of 2017-06-15; the map label is dated 2016-09-15, so the map "
            "used an earlier version of the same grid. Beyond the 75°S edge of that grid the rays use LOLA 240 m. "
            "The 60 m map is also run on LDEM_75S_60M V2.0, the same 60 m grid as the LDEM_85S_060M its label "
            "names ('Same 60 m DEM' rows, pixel and 7×7 patch). For that map these rows are the scored Sun checks; "
            "the Sun rows on our 80 m DEM are kept as a reference, because they measure the DEM difference (D-023). "
            "Every site also has a matched 7×7-pixel median absolute difference check. "
            "AREA registration describes pixel cells; the illumination model is evaluated at their centres, "
            "not averaged over each cell. No registration offset is fitted to the reference values."
        ),
        "rows": rows,
    }


def _stats(d, ours, ref) -> dict:
    """RMSE, bias, MAE, max |error| (pp) and Pearson r of ours vs map over the random points."""
    d, ours, ref = np.asarray(d), np.asarray(ours), np.asarray(ref)
    return {
        "rmse": float(np.sqrt(np.mean(d**2))),
        "bias": float(np.mean(d)),
        "mae": float(np.mean(np.abs(d))),
        "max": float(np.max(np.abs(d))),
        "r": float(np.corrcoef(ours, ref)[0, 1]),
    }


def group_random(dems, illum_dir: Path, step_h: float, limit: int = 0) -> dict:
    """S4 at pre-registered random points (#331, #367): our Sun and Earth time shares vs AVGVISIB_85S_060M."""
    case = random_case()
    cases = json.loads(CASES.read_text(encoding="utf-8"))
    ecase = next(c for c in cases if c["id"] == "S4_random_earth")
    n, seed, tol = case["n"], case["seed"], case["tolerance"]
    smap = IllumMap(illum_dir / "AVGVISIB_85S_060M_201608.TIF")
    emap = IllumMap(illum_dir / f"{ecase['map']}.TIF")
    if emap.t != smap.t or emap.a.shape != smap.a.shape:
        raise ValueError("Earth map grid differs from the Sun map grid")
    pts = random_points(smap, n, seed, case["lat_edge"])
    if limit:  # timing runs only; the published group needs all n points
        pts = pts[:limit]
    e0 = utc_to_et(ILLUM_START_UTC)
    ets = e0 + np.arange(0, NUTATION_YEARS * 365.25 * 86400, step_h * 3600.0)
    sun, earth = body_vectors("SUN", ets), body_vectors("EARTH", ets)
    sun_r, earth_r = sp.bodvrd("SUN", "RADII", 3)[1][0], sp.bodvrd("EARTH", "RADII", 3)[1][0]
    terrain = map_terrain(smap.res, {"terrain": "polar80"}, dems)
    h2 = APP_OBSERVER_M
    t0 = time.time()
    for i, p in enumerate(pts):
        t = time.time()
        s, e = site_means(terrain, p["pxLonE"], p["pxLat"], 0.0, sun, earth, sun_r, earth_r)
        s2, e2 = site_means(terrain, p["pxLonE"], p["pxLat"], h2, sun, earth, sun_r, earth_r)
        p["ours"] = round(s * 100, 3)
        p["reference"] = round(smap.value(p["row"], p["col"]) * 100, 3)
        p["diff"] = round(p["ours"] - p["reference"], 3)
        ok_e = bool(emap.a[p["row"], p["col"]] != emap.nodata)
        p["earthOurs"] = round(e * 100, 3)
        p["earthReference"] = round(emap.value(p["row"], p["col"]) * 100, 3) if ok_e else None
        p["earthDiff"] = round(p["earthOurs"] - p["earthReference"], 3) if ok_e else None
        p["ours2m"] = round(s2 * 100, 3)
        p["diff2m"] = round(p["ours2m"] - p["reference"], 3)
        p["earthOurs2m"] = round(e2 * 100, 3)
        p["earthDiff2m"] = round(p["earthOurs2m"] - p["earthReference"], 3) if ok_e else None
        eref = p["earthReference"] if ok_e else float("nan")
        print(
            f"  random {i + 1:3d}/{len(pts)} {p['pxLonE']:8.3f}E {p['pxLat']:8.4f}  "
            f"Sun {p['ours']:5.1f}/{p['reference']:5.1f}  Earth {p['earthOurs']:5.1f}/{eref:5.1f}  "
            f"{time.time() - t:4.1f} s"
        )
    d = np.array([p["diff"] for p in pts])
    rmse = float(np.sqrt(np.mean(d**2)))
    bias, worst = float(np.mean(d)), float(np.max(np.abs(d)))
    share = float(100.0 * np.mean(np.abs(d) <= ILLUM_TOL_PP))
    ref_s = [p["reference"] for p in pts]
    sun0 = _stats(d, [p["ours"] for p in pts], ref_s)
    sun2 = _stats([p["diff2m"] for p in pts], [p["ours2m"] for p in pts], ref_s)
    e_ok = [p for p in pts if p["earthDiff"] is not None]
    ref_e = [p["earthReference"] for p in e_ok]
    earth0 = _stats([p["earthDiff"] for p in e_ok], [p["earthOurs"] for p in e_ok], ref_e)
    earth2 = _stats([p["earthDiff2m"] for p in e_ok], [p["earthOurs2m"] for p in e_ok], ref_e)
    where = f"{len(pts)} random points 85–90°S, seed {seed}, map {smap.name}"
    ewhere = f"{len(pts)} random points 85–90°S, seed {seed}, map {emap.name}"
    src, url = "PGDA 69 (Mazarico et al. 2011)", URL["pgda69"]
    etol = ecase["tolerance"]
    rows = [
        row(
            "Random points: Sun time share RMSE, 18.6 y",
            where,
            src,
            url,
            rmse,
            0.0,
            "pp",
            tol,
            bool(len(pts) == n and rmse <= tol),
            "Pass rule RMSE ≤ 5 pp, committed with N and seed in 21bc6a73 before computation.",
        ),
        row("Random points: mean error (ours − map)", where, src, url, bias, 0.0, "pp", None, None),
        row("Random points: largest |error|", where, src, url, worst, 0.0, "pp", None, None),
        row(
            "Random points: share within 5 pp",
            where,
            src,
            url,
            share,
            None,
            "%",
            None,
            None,
            f"{int(np.sum(np.abs(d) <= ILLUM_TOL_PP))} of {len(pts)} points.",
        ),
        row(
            "Random points: Sun mean absolute error",
            where,
            src,
            url,
            sun0["mae"],
            0.0,
            "pp",
            None,
            None,
        ),
        row(
            "Random points: Sun Pearson r (ours vs map)",
            where,
            src,
            url,
            sun0["r"],
            None,
            "",
            None,
            None,
        ),
        row(
            "Random points: Earth time share RMSE, 18.6 y",
            ewhere,
            src,
            url,
            earth0["rmse"],
            0.0,
            "pp",
            etol,
            bool(len(e_ok) == n and earth0["rmse"] <= etol),
            "Same points as the Sun rows. Pass rule RMSE ≤ 5 pp, committed before computation (#367). "
            f"{len(e_ok)} of {len(pts)} points have an Earth map value.",
        ),
        row(
            "Random points: Earth mean error (ours − map)",
            ewhere,
            src,
            url,
            earth0["bias"],
            0.0,
            "pp",
            None,
            None,
        ),
        row(
            "Random points: Earth mean absolute error",
            ewhere,
            src,
            url,
            earth0["mae"],
            0.0,
            "pp",
            None,
            None,
        ),
        row(
            "Random points: Earth largest |error|",
            ewhere,
            src,
            url,
            earth0["max"],
            0.0,
            "pp",
            None,
            None,
        ),
        row(
            "Random points: Earth Pearson r (ours vs map)",
            ewhere,
            src,
            url,
            earth0["r"],
            None,
            "",
            None,
            None,
        ),
    ]
    note2 = (
        f"Observer {h2:g} m, the height the app uses. The NASA maps are computed at the surface, "
        "so these rows are for information only."
    )
    for body, st, w in (("Sun", sun2, where), ("Earth", earth2, ewhere)):
        head = f"Random points, {h2:g} m: {body}"
        rows += [
            row(f"{head} RMSE", w, src, url, st["rmse"], 0.0, "pp", None, None, note2),
            row(f"{head} mean error", w, src, url, st["bias"], 0.0, "pp", None, None, note2),
            row(
                f"{head} mean absolute error", w, src, url, st["mae"], 0.0, "pp", None, None, note2
            ),
            row(f"{head} largest |error|", w, src, url, st["max"], 0.0, "pp", None, None, note2),
            row(f"{head} Pearson r", w, src, url, st["r"], None, "", None, None, note2),
        ]
    for k, st in (
        ("Sun 0 m", sun0),
        ("Earth 0 m", earth0),
        ("Sun 2 m", sun2),
        ("Earth 2 m", earth2),
    ):
        print(
            f"  random {k}: RMSE {st['rmse']:.2f} bias {st['bias']:+.2f} MAE {st['mae']:.2f} "
            f"max {st['max']:.2f} r {st['r']:.3f}"
        )
    print(
        f"  random: Sun within5 {share:.0f}%, Earth points {len(e_ok)}/{len(pts)}  {time.time() - t0:.0f} s"
    )
    return {
        "id": "random",
        "title": "Sun and Earth visibility at random polar points vs NASA maps",
        "explanation": (
            f"Did we pick easy sites? Here the points are random: {n} points uniform in area over "
            f"85–90°S (seed {seed}, drawn by a rule committed before the run), each moved to the centre "
            "of its pixel of the 60 m PGDA 69 maps AVGVISIB_85S_060M (Sun) and AVGVISIB_85S_060M_EARTH. "
            "Same model as the site check: observer at the surface (0 m), share of time any part of the "
            f"solar or Earth disc is visible, {ILLUM_START_UTC[:10]} + 18.6 years, every {step_h:g} h, "
            "LOLA 80 m + 240 m terrain. Each check passes when the root-mean-square error over all points "
            f"is at most 5 pp. Rows at {h2:g} m use the app observer height and are for information only."
        ),
        "seed": seed,
        "rows": rows,
        "points": pts,
    }


def group_barker(dems) -> dict:
    e0, e1 = utc_to_et(BARKER_START_UTC), utc_to_et(BARKER_END_UTC)
    sun = body_vectors("SUN", e0 + np.arange(0, e1 - e0, 3600.0))
    sun_r = sp.bodvrd("SUN", "RADII", 3)[1][0]
    rows = []
    for i, (x, y, p1, p1c) in enumerate(BARKER_ROI, 1):
        lon, lat = from_xy_pt(-x * 1000, -y * 1000)
        terrain = Terrain(fine_dem(lon, lat, dems["fine"]), dems["polar80"], dems["polar240"])
        maz, mel, h0 = horizon_mask(terrain, lon, lat, BARKER_DZ_M)
        az, el, rad = topo_fast(sun, sun_r, lon, lat, h0 + BARKER_DZ_M)
        ours = float(np.mean(visible_fraction(az, el, rad, maz, mel, limb=SUN_LIMB))) * 100
        ok = bool(p1 <= ours <= p1c)
        note = (
            f"RoI {i} centroid {lon:.3f}E {lat:.4f}. Reference = case B of the table ({p1:.2f} %); "
            f"case C (best pixel of the area) = {p1c:.2f} %. Pass when B <= ours <= C. "
            "NASA uses a 5 m DEM near the site; we use 20 m. Both use a limb-darkened Sun."
        )
        rows.append(
            row(
                "Mean visible solar disc, 2024–2025, 5 m",
                f"Connecting ridge, RoI {i}",
                "Barker et al. 2021, Table 2",
                URL["barker"],
                ours,
                p1,
                "%",
                None,
                ok,
                note,
                "cr1_connecting_ridge",
            )
        )
        print(f"  barker RoI {i} {p1:5.1f} <= {ours:5.1f} <= {p1c:5.1f} {ok}")
    return {
        "id": "barker",
        "title": "Terrain illumination vs NASA on the same LOLA DEM",
        "explanation": (
            "Barker, Mazarico et al. (2021) rebuilt the LOLA south-pole DEM that we use and computed the "
            "illumination on the Shackleton–de Gerlache connecting ridge for 2024–2025, every hour, 5 m above "
            "the surface, with 100 random DEM clones for the height error. We run our own horizon model "
            "(LOLA 20 m within 5 km, 80 m, 240 m beyond) at the same seven points and the same dates."
        ),
        "rows": rows,
    }


# --- 4. Sphere vs terrain (trivial answer) ----------------------------------------------


def sunsets(ets: np.ndarray, vis: np.ndarray) -> np.ndarray:
    """Times (et) where the last part of the disc goes below the horizon (linear interpolation)."""
    lit = vis > 0
    i = np.where(lit[:-1] & ~lit[1:])[0]
    return ets[i] + (ets[i + 1] - ets[i]) * vis[i] / np.maximum(vis[i] - vis[i + 1], 1e-12)


def sunset_errors_h(terrain_sets: np.ndarray, sphere_sets: np.ndarray) -> np.ndarray:
    """For each sphere sunset, hours to the nearest terrain sunset."""
    if len(terrain_sets) == 0 or len(sphere_sets) == 0:
        return np.array([])
    return np.array([np.abs(terrain_sets - c).min() for c in sphere_sets]) / 3600.0


def group_sphere(polar, dems) -> dict:
    e0 = utc_to_et(SUNSET_START_UTC)
    ets = e0 + np.arange(0, 365 * 86400, SUNSET_STEP_MIN * 60.0)
    sun = body_vectors("SUN", ets)
    sun_r = sp.bodvrd("SUN", "RADII", 3)[1][0]
    rows = []
    for s in polar:
        maz, mel, h0 = horizon_mask(site_terrain(s, dems), s["lonE"], s["lat"], APP_OBSERVER_M)
        az, el, rad = topo_fast(sun, sun_r, s["lonE"], s["lat"], h0 + APP_OBSERVER_M)
        terr = visible_fraction(az, el, rad, maz, mel)
        sph = visible_fraction(az, el, rad, maz, np.zeros_like(mel))
        ct, cs = sunsets(ets, terr), sunsets(ets, sph)
        err = sunset_errors_h(ct, cs)
        lit_t, lit_s = float(np.mean(terr > 0) * 100), float(np.mean(sph > 0) * 100)
        med = float(np.median(err)) if len(err) else None
        note = (
            f"Sunsets in 2027: terrain {len(ct)}, sphere {len(cs)}. "
            f"Sun up: terrain {lit_t:.1f} %, sphere {lit_s:.1f} %."
        )
        if len(err):
            note += f" Max error {err.max():.1f} h."
        elif len(ct) == 0:
            note += " Terrain gives no sunset at all in 2027 (never lit or never set): the sphere is wrong by whole days."
        rows.append(
            row(
                "Bare-sphere sunset error (median)",
                s["name"],
                "Our terrain model (validated above)",
                URL["lola"],
                med,
                0.0 if med is not None else None,
                "h",
                None,
                None,
                note,
                s["id"],
            )
        )
    return {
        "id": "sphere",
        "title": "Why terrain matters: a bare sphere vs our horizon",
        "explanation": (
            "The trivial answer treats the Moon as a smooth ball with a flat 0° horizon. Near the pole "
            "the Sun skims the horizon, so mountains and crater rims move sunset by hours or days. For each "
            "polar site we list every 2027 sunset the sphere predicts and its distance to the nearest "
            f"sunset over real LOLA terrain (observer {APP_OBSERVER_M:g} m, every {SUNSET_STEP_MIN} min). "
            "These rows are a baseline, not a pass/fail check."
        ),
        "rows": rows,
    }


# --- 5. Earth eclipses the Sun vs NASA GSFC ---------------------------------------------

ECLIPSE_TOL_S = 30.0  # eval/cases.json S7, written before the first comparison
MOON_POINTS = 20000  # Fibonacci points: ~1.4 deg apart, a limb point is < 0.2 km off the limb
# NASA GSFC eclipse plots (Espenak; rule CdT (Danjon), VSOP87/ELP2000-85). Contacts are printed in UT
# with the Delta T predicted in 2009 (dt); TD = UT + dt. Greatest eclipse is in TD.
ECLIPSES = [
    {
        "date": "2025-03-14",
        "name": "Total lunar eclipse 2025-03-14",
        "dt": 75.0,
        "greatest": "06:59:56.2",
        "contacts": {
            "P1": "03:57:24",
            "U1": "05:09:33",
            "U2": "06:25:59",
            "U3": "07:31:23",
            "U4": "08:47:48",
            "P4": "10:00:01",
        },
        "plot": "https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2025Mar14T.pdf",
    },
    {
        "date": "2027-02-20",
        "name": "Penumbral lunar eclipse 2027-02-20",
        "dt": 76.0,
        "greatest": "23:14:06.2",
        "contacts": {"P1": "21:12:20", "P4": "01:13:19"},
        "plot": "https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2027Feb20N.pdf",
    },
    {
        "date": "2027-08-17",
        "name": "Penumbral lunar eclipse 2027-08-17",
        "dt": 76.0,
        "greatest": "07:14:59.3",
        "contacts": {"P1": "05:24:29", "P4": "09:03:03"},
        "plot": "https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2027Aug17N.pdf",
    },
]
CONTACT_NAME = {
    "P1": "penumbra first touches the Moon",
    "U1": "umbra first touches the Moon",
    "U2": "Moon fully in the umbra",
    "U3": "Moon starts to leave the umbra",
    "U4": "Moon leaves the umbra",
    "P4": "Moon leaves the penumbra",
}


def gsfc_et(e: dict) -> tuple[float, dict[str, float]]:
    """Greatest eclipse and contacts of a catalogue entry as ET (TD), contacts within 12 h of greatest."""
    g = sp.str2et(f"{e['date']} {e['greatest']} TDT")
    out = {}
    for k, hms in e["contacts"].items():
        t = sp.str2et(f"{e['date']} {hms} TDT") + e["dt"]
        out[k] = t + 86400.0 * np.round((g - t) / 86400.0)
    return g, out


def moon_points(n: int = MOON_POINTS, r_km: float = R / 1000.0) -> np.ndarray:
    """n points spread evenly over the lunar sphere (km, MOON_ME)."""
    i = np.arange(n) + 0.5
    z = 1 - 2 * i / n
    phi = np.pi * (1 + 5**0.5) * i
    rr = np.sqrt(1 - z * z)
    return np.stack([rr * np.cos(phi), rr * np.sin(phi), z], axis=1) * r_km


def shadow_gaps(et: float, pts: np.ndarray, sun_r: float, earth_r: float):
    """Per point (km, MOON_ME): angle by which the Earth disc misses the Sun disc (penumbra gap) and
    by which it misses covering the Sun fully (umbra gap), deg. Negative = inside that shadow."""
    vs = body_vectors("SUN", [et])[0] - pts
    ve = body_vectors("EARTH", [et])[0] - pts
    ds, de = np.linalg.norm(vs, axis=1), np.linalg.norm(ve, axis=1)
    sep = np.degrees(np.arccos(np.clip((vs * ve).sum(axis=1) / (ds * de), -1.0, 1.0)))
    s = np.degrees(np.arcsin(sun_r / ds))
    e = shadow_radius(np.degrees(np.arcsin(earth_r / de)))
    return sep - s - e, sep - e + s


def crossings(f, t0: float, t1: float, step: float = 60.0) -> list[tuple[float, bool]]:
    """Times where f(t) changes sign in [t0, t1] (scan + bisection to 1 ms); True = goes negative."""
    ts = np.arange(t0, t1 + step, step)
    v = np.array([f(t) for t in ts])
    out = []
    for i in np.flatnonzero(np.sign(v[:-1]) != np.sign(v[1:])):
        a, b, fa = ts[i], ts[i + 1], v[i]
        while b - a > 1e-3:
            m = (a + b) / 2
            fm = f(m)
            a, b, fa = (m, b, fm) if np.sign(fm) == np.sign(fa) else (a, m, fa)
        out.append(((a + b) / 2, bool(v[i] > 0)))
    return out


def moon_contacts(g_ref: float, sun_r: float, earth_r: float, half_h: float = 5.0) -> dict:
    """Our P1..P4 and greatest eclipse for the whole Moon: the first/last point of the sphere whose
    Sun the Earth disc touches (P) or covers (U). Greatest = Moon centre closest to the Sun-Earth axis."""
    pts = moon_points()
    t0, t1 = g_ref - half_h * 3600, g_ref + half_h * 3600
    out = {}
    pen = crossings(lambda t: shadow_gaps(t, pts, sun_r, earth_r)[0].min(), t0, t1)
    if pen:
        out["P1"], out["P4"] = pen[0][0], pen[-1][0]
    umin = crossings(lambda t: shadow_gaps(t, pts, sun_r, earth_r)[1].min(), t0, t1)
    umax = crossings(lambda t: shadow_gaps(t, pts, sun_r, earth_r)[1].max(), t0, t1)
    if umin:
        out["U1"], out["U4"] = umin[0][0], umin[-1][0]
    if umax:
        out["U2"], out["U3"] = umax[0][0], umax[-1][0]

    def axis_km(t):
        sv, ev = body_vectors("SUN", [t])[0], body_vectors("EARTH", [t])[0]
        return np.linalg.norm(np.cross(ev, sv)) / np.linalg.norm(sv - ev)

    a, b = t0, t1  # golden section: the distance has one minimum in the window
    k = (5**0.5 - 1) / 2
    while b - a > 1e-2:
        c, d = b - k * (b - a), a + k * (b - a)
        a, b = (a, d) if axis_km(c) < axis_km(d) else (c, b)
    out["greatest"] = (a + b) / 2
    return out


def site_contacts(site: dict, g_ref: float, sun_r: float, earth_r: float, h_m: float = 2.0):
    """First/last time the Earth disc touches the site's Sun, and start/end of total cover (ET)."""
    p = unit(site["lonE"], site["lat"])[None, :] * (R + h_m) / 1000.0
    t0, t1 = g_ref - 5 * 3600, g_ref + 5 * 3600
    pen = crossings(lambda t: shadow_gaps(t, p, sun_r, earth_r)[0][0], t0, t1)
    umb = crossings(lambda t: shadow_gaps(t, p, sun_r, earth_r)[1][0], t0, t1)
    return [t for t, _ in pen], [t for t, _ in umb]


def max_eclipse(site: dict, g_ref: float, sun_r: float, earth_r: float, h_m: float = 2.0):
    """(ET, eclipsed flux share) at the site's deepest eclipse, 10 s grid within +-5 h."""
    ets = g_ref + np.arange(-5 * 3600, 5 * 3600, 10.0)
    saz, sel, srad = topo_fast(body_vectors("SUN", ets), sun_r, site["lonE"], site["lat"], h_m)
    eaz, eel, erad = topo_fast(body_vectors("EARTH", ets), earth_r, site["lonE"], site["lat"], h_m)
    f = eclipsed_fraction(sep_deg(saz, sel, eaz, eel), srad, shadow_radius(erad))
    i = int(np.argmax(f))
    return float(ets[i]), float(f[i]), float(sel[i]), float(eel[i])


def td(et: float) -> str:
    return sp.timout(et, "YYYY-MM-DD HR:MN:SC ::TDT") + " TD"


def utc(et: float) -> str:
    return sp.et2utc(et, "ISOC", 0).replace("T", " ") + " UTC"


def outside_s(t: float, lo: float, hi: float) -> float:
    """Seconds outside [lo, hi]: negative before lo, positive after hi, 0 inside."""
    return min(t - lo, 0.0) + max(t - hi, 0.0)


def eclipse_loss_pct(site: dict, step_min: int = SUNSET_STEP_MIN) -> float:
    """Share (%) of the Sun disc flux the Earth hides at a site over 18.6 years, flat 0 deg horizon.

    Lost flux over the lit flux of the same epochs, on a step_min grid.
    """
    sun_r, earth_r = sp.bodvrd("SUN", "RADII", 3)[1][0], sp.bodvrd("EARTH", "RADII", 3)[1][0]
    n = int(NUTATION_YEARS * 365.25 * 1440 / step_min)
    ets = utc_to_et(ILLUM_START_UTC) + np.arange(n) * step_min * 60.0
    h = (site["elevM"] or 0.0) + APP_OBSERVER_M
    saz, sel, srad = topo_fast(body_vectors("SUN", ets), sun_r, site["lonE"], site["lat"], h)
    eaz, eel, erad = topo_fast(body_vectors("EARTH", ets), earth_r, site["lonE"], site["lat"], h)
    az = np.arange(0.0, 360.0, 1.0)
    lit = visible_fraction(saz, sel, srad, az, np.zeros_like(az), limb=SUN_LIMB)
    visible = sun_visible_fraction(
        saz, sel, srad, az, np.zeros_like(az), eaz, eel, shadow_radius(erad)
    )
    return float(100.0 * (lit - visible).sum() / lit.sum())


def group_eclipse(sites: dict, polar: list) -> dict:
    sun_r, earth_r = sp.bodvrd("SUN", "RADII", 3)[1][0], sp.bodvrd("EARTH", "RADII", 3)[1][0]
    tol = ECLIPSE_TOL_S
    rows = []
    for e in ECLIPSES:
        g, cat = gsfc_et(e)
        ours = moon_contacts(g, sun_r, earth_r)
        src = f"NASA GSFC eclipse catalogue (Espenak), {e['date']}"
        for k in [*cat, "greatest"]:
            ref = cat.get(k, g)
            o = ours.get(k)
            what = CONTACT_NAME.get(k, "Moon centre closest to the shadow axis")
            d = None if o is None else o - ref
            rows.append(
                row(
                    f"{e['name']}: {'Greatest eclipse' if k == 'greatest' else k}, {what}",
                    "Whole Moon",
                    src,
                    e["plot"],
                    None if o is None else o - g,
                    ref - g,
                    "s",
                    tol,
                    d is not None and bool(abs(d) <= tol),
                    f"Seconds from the catalogue greatest eclipse ({td(g)}). Ours {td(o) if o else '—'}; "
                    f"catalogue {td(ref)} (printed {e['contacts'].get(k, e['greatest'] + ' TD')}"
                    f"{' UT with ΔT ' + format(e['dt'], 'g') + ' s' if k != 'greatest' else ''}). "
                    f"Real UTC of our time: {utc(o) if o else '—'}.",
                    digits=1,
                )
            )
        print(
            f"  eclipse {e['date']}: "
            + ", ".join(
                f"{k} {ours.get(k, np.nan) - cat.get(k, g):+.1f} s" for k in [*cat, "greatest"]
            )
        )
        if e["date"] == "2025-03-14":
            rows += blue_ghost_rows(sites["bg1_blue_ghost"], e, g, cat, sun_r, earth_r)
        else:
            rows += polar_rows(polar, e, g, cat, sun_r, earth_r)
    return {
        "id": "eclipse",
        "title": "Earth eclipses the Sun vs the NASA GSFC eclipse catalogue",
        "explanation": (
            "During a lunar eclipse the Earth disc passes over the Sun disc as seen from the Moon. The app "
            "counts the limb-darkened Sun disc flux that is above the terrain and outside the Earth disc. "
            "The Earth disc includes an opaque air layer by the Danjon rule (radius × 1.01), the rule "
            "of the NASA GSFC catalogue. We check the geometry against the catalogue contact times. The "
            "catalogue gives contacts for the whole Moon (P1 = the penumbra first touches the lunar disc, "
            "U1..U4 the umbra, P4 = the Moon leaves the penumbra). We find the same instants as the first "
            f"and last of {MOON_POINTS} points on the lunar sphere whose Sun the Earth disc touches (P) or "
            "covers fully (U). A single site enters the shadow later than P1 and leaves it before P4, so for "
            "a site we check that its times fall inside the catalogue window. We compare in Dynamical Time: "
            "the catalogue printed UT with a Delta T predicted in 2009 (75–76 s); the real TDB − UTC is "
            f"69.2 s. Tolerance {tol:g} s. The terrain checks above (PGDA 69, Barker) do not apply eclipses."
        ),
        "rows": rows,
    }


def blue_ghost_rows(site, e, g, cat, sun_r, earth_r) -> list[dict]:
    pen, umb = site_contacts(site, g, sun_r, earth_r, (site["elevM"] or 0.0) + APP_OBSERVER_M)
    rows = []
    checks = [
        ("Sun loss starts (Earth touches the Sun disc)", pen[0], "P1", "U2"),
        ("Sun fully hidden from", umb[0], "U1", "U2"),
        ("Sun fully hidden until", umb[-1], "U3", "U4"),
        ("Sun fully back (Earth leaves the Sun disc)", pen[-1], "U3", "P4"),
    ]
    for label, t, lo, hi in checks:
        out = outside_s(t, cat[lo], cat[hi])
        rows.append(
            row(
                f"{e['name']}: {label} — seconds outside catalogue {lo}..{hi}",
                site["name"],
                "NASA GSFC catalogue contacts; site LROC (NASA/GSFC/ASU)",
                URL["gsfc"],
                out,
                0.0,
                "s",
                ECLIPSE_TOL_S,
                bool(abs(out) <= ECLIPSE_TOL_S),
                f"Ours {utc(t)} ({td(t)}) at {site['lat']}°N {site['lonE']}°E (LROC image 1407). Window "
                f"{lo} {td(cat[lo])} .. {hi} {td(cat[hi])}: every point of the Moon passes this stage between "
                f"{lo} and {hi}. 0 = inside. Totality at the site lasts {(umb[-1] - umb[0]) / 60:.1f} min; the Sun "
                f"is partly hidden for {(pen[-1] - pen[0]) / 3600:.2f} h.",
                site["id"],
                digits=1,
            )
        )
    print(f"  Blue Ghost: {utc(pen[0])} .. {utc(umb[0])} .. {utc(umb[-1])} .. {utc(pen[-1])}")
    return rows


def polar_rows(polar, e, g, cat, sun_r, earth_r) -> list[dict]:
    worst, hit = 0.0, []
    for s in polar:
        pen, _ = site_contacts(s, g, sun_r, earth_r)
        if pen:
            worst = max(
                worst,
                abs(outside_s(pen[0], cat["P1"], cat["P4"])),
                abs(outside_s(pen[-1], cat["P1"], cat["P4"])),
            )
            hit.append(s)
    peak = [(s, *max_eclipse(s, g, sun_r, earth_r)) for s in polar]
    s, t, f, sel, eel = max(peak, key=lambda x: x[2])
    rows = []
    if hit:
        rows.append(
            row(
                f"{e['name']}: polar sites, eclipse start and end — seconds outside catalogue P1..P4",
                f"{len(hit)} of {len(polar)} polar sites",
                "NASA GSFC eclipse catalogue (Espenak)",
                URL["gsfc"],
                worst,
                0.0,
                "s",
                ECLIPSE_TOL_S,
                bool(worst <= ECLIPSE_TOL_S),
                f"Worst of the sites whose Sun the Earth disc touches. Window {td(cat['P1'])} .. {td(cat['P4'])}.",
                digits=1,
            )
        )
    rows.append(
        row(
            f"{e['name']}: deepest eclipse at a polar site, share of the Sun hidden",
            s["name"] if f > 0 else f"All {len(polar)} polar sites",
            "Our model (no catalogue value for a single site)",
            e["plot"],
            f * 100,
            None,
            "%",
            None,
            None,
            (
                f"At {utc(t)}, {(t - g) / 60:+.1f} min from the catalogue greatest eclipse ({td(g)}): a site "
                "reaches its own maximum when the shadow axis passes closest to it, not to the Moon centre. "
                f"Sun elevation {sel:+.2f}°, Earth {eel:+.2f}° (terrain not applied here; the timeline applies it)."
                if f > 0
                else "The Earth disc never touches the Sun from the south polar sites: the Moon passes south of "
                "the shadow axis (catalogue gamma < 0, penumbral magnitude < 1), so its southern part stays "
                "outside the penumbra. Northern and near-side sites see up to half the Sun covered."
            ),
            s["id"] if f > 0 else None,
            digits=1,
        )
    )
    return rows


# --- CLI --------------------------------------------------------------------------------


# --- Regolith surface temperature (Hayne et al. 2017) ------------------------------------

THERMAL_TOL_K = 5.0
PRP_TOL_K = 10.0


def terrain_flux(mask_az, mask_el, az, el, flux):
    """Sunlight and infrared (W m-2) a level site absorbs from the sunlit slopes of its horizon.

    Each azimuth bin of the mask is a slope facing the site, tilted by its horizon angle h, with view
    factor sin^2 h / bins. A sunlit slope sends back what it gets: albedo 0.12 as scattered light,
    the rest as infrared (Hayne et al. 2021, Methods). The site absorbs 1 - 0.12 of the light and
    the emissivity share of the infrared. az, el in deg (north to east), flux in W m-2 per step.
    """
    h = np.radians(np.clip(mask_el, 0.0, None))
    back = np.radians(np.asarray(mask_az) + 180.0)  # the slope faces the site
    nt = np.stack([np.sin(h) * np.sin(back), np.sin(h) * np.cos(back), np.cos(h)], 1)  # E, N, up
    view = np.sin(h) ** 2 / len(h)
    a, e = np.radians(az), np.radians(el)
    sun = np.stack([np.cos(e) * np.sin(a), np.cos(e) * np.cos(a), np.sin(e)], 1)
    got = np.concatenate(
        [np.clip(sun[i : i + 4096] @ nt.T, 0.0, None) @ view for i in range(0, len(sun), 4096)]
    )
    back_share = th.A0 * (1.0 - th.A0) + (1.0 - th.A0) * th.EMIS
    return np.where(np.asarray(el) > 0.0, flux * got * back_share, 0.0)


THERMAL_SPINUP_UTC = "2024-01-01T00:00:00"  # 3 years of spin-up before the reported year 2027
THERMAL_YEAR_UTC = "2027-01-01T00:00:00"
AU_KM = 149597870.7
# Apollo 15/17 are mare: A0 0.06 with the incidence terms scaled by A0 / 0.12, as in the author's
# reference code (heat1d validation.py, MIT, https://github.com/phayne/heat1d). With the highland
# A0 0.12 the diurnal means are 10 K (20N) and 8 K (26N) low.
MARE_A0 = 0.06


def _mare_day(lat):
    law = (MARE_A0, th.A_A * MARE_A0 / th.A0, th.A_B * MARE_A0 / th.A0)
    return th.equator_day(lat_deg=lat, r_au=1.017, cycles=25, law=law)


def ground_normal(terrain, lon_e, lat):
    """Unit normal of the ground (MOON_ME) from DEM points one grid step around the site; slope, deg."""
    x, y = to_xy(unit(lon_e, lat))
    d = terrain.step

    def p(dx, dy):
        h = float(terrain.sample(x + dx, y + dy))
        return unit(*from_xy_pt(x + dx, y + dy)) * (R + h)

    n = np.cross(p(d, 0) - p(-d, 0), p(0, d) - p(0, -d))
    n /= np.linalg.norm(n)
    up = unit(lon_e, lat)
    n = n if n @ up > 0 else -n
    return n, float(np.degrees(np.arccos(n @ up)))


def prp_south(path: Path):
    """Diviner South Polar Resource Product: unit vectors of triangle centres, triangle normals (MOON_ME),
    2 cm mean T, surface max T."""
    a = np.loadtxt(path, delimiter=",", skiprows=1, usecols=(*range(11), 12, 13), ndmin=2)
    lo, la = np.radians(a[:, 9]), np.radians(a[:, 10])
    p = np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], axis=1)
    n = np.cross(a[:, 3:6] - a[:, 0:3], a[:, 6:9] - a[:, 0:3])
    n /= np.linalg.norm(n, axis=1)[:, None]
    n *= np.sign(np.sum(n * p, axis=1))[:, None]  # outward
    return p, n, a[:, 11], a[:, 12]


def group_thermal(polar, dems, prp_path: Path) -> dict:
    src = "Hayne et al. 2017, Table A2"
    rows = []
    lt, t = th.equator_day()
    night = (lt > 12) & (lt < 18)  # second half of the night: the pre-dawn minimum
    for label, ours, ref, ref_src in (
        (
            "Regolith surface temperature, equator, noon",
            t[0],
            385.0,
            "Vasavada et al. 2012 (Diviner)",
        ),
        (
            "Regolith surface temperature, equator, midnight",
            t[np.argmin(np.abs(lt - 12))],
            101.0,
            "Vasavada et al. 2012 (Diviner)",
        ),
        (
            "Regolith surface temperature, equator, before sunrise",
            float(t[night].min()),
            95.0,
            "Vasavada et al. 2012 (Diviner)",
        ),
    ):
        ours = float(ours)
        rows.append(
            row(
                label,
                "Equator, flat",
                src,
                URL["hayne"],
                ours,
                ref,
                "K",
                THERMAL_TOL_K,
                bool(abs(ours - ref) <= THERMAL_TOL_K),
                f"Reference: {ref_src}. Flat ground, Sun on the equator, 1 AU, highland albedo A0 0.12, "
                "40 synodic days to equilibrium. Threshold committed in 87761816 before computation.",
                None,
                1,
            )
        )
    for site, lat, ref in (("Apollo 17 (20°N)", 20.0, 216.0), ("Apollo 15 (26°N)", 26.0, 211.0)):
        _, tm = _mare_day(lat)
        ours = float(np.mean(tm))
        rows.append(
            row(
                "Regolith surface temperature, diurnal mean",
                site,
                src,
                URL["hayne"],
                ours,
                ref,
                "K",
                THERMAL_TOL_K,
                bool(abs(ours - ref) <= THERMAL_TOL_K),
                "Reference: Keihm et al. 1973 (Apollo heat flow probe, ±5 K). Flat ground, Moon at 1.017 AU "
                f"(paper Fig. A1). Mare albedo A0 {MARE_A0} with scaled incidence terms, as the author's reference "
                "code heat1d; chosen after the first run. With the highland A0 0.12 the means are 205.7 / 203.0 K "
                "(Apollo 17 / 15) and both rows fail. Threshold committed in 87761816.",
                None,
                1,
            )
        )
    e0, e1 = utc_to_et(THERMAL_SPINUP_UTC), utc_to_et("2028-01-01T00:00:00")
    ets = e0 + np.arange(0, e1 - e0, 3600.0)
    year = ets >= utc_to_et(THERMAL_YEAR_UTC)
    sun = body_vectors("SUN", ets)
    sun_r = sp.bodvrd("SUN", "RADII", 3)[1][0]
    r_au = np.linalg.norm(sun, axis=1) / AU_KM
    col = th.Column()
    prp, prp_n, prp_avg, prp_max = prp_south(prp_path)
    for s in polar:
        t0 = time.time()
        terrain = site_terrain(s, dems)
        maz, mel, h0 = horizon_mask(terrain, s["lonE"], s["lat"], 0.0)
        az, el, rad = topo_fast(sun, sun_r, s["lonE"], s["lat"], h0)
        vis = visible_fraction(az, el, rad, maz, mel, limb=SUN_LIMB)
        up = unit(s["lonE"], s["lat"])
        sun_dir = sun - up * (R + h0) / 1000.0
        sun_dir /= np.linalg.norm(sun_dir, axis=1)[:, None]

        def year_profile(n, sun_dir=sun_dir, vis=vis, mask=(maz, mel), az=az, el=el):
            mu = np.clip(sun_dir @ n, 0.0, None)
            inc = np.arccos(mu)
            qs = np.array(
                [th.absorbed(f, i, th.POLAR) for f, i in zip(th.S0 / r_au**2 * mu * vis, inc)]
            )
            q_terrain = terrain_flux(*mask, az, el, th.S0 / r_au**2)
            return th.run(col, qs + q_terrain, 3600.0)[0][year]

        n, slope = ground_normal(terrain, s["lonE"], s["lat"])
        prof = year_profile(n)
        q_slopes = terrain_flux(maz, mel, az, el, th.S0 / r_au**2)[year]
        ty = prof[:, 0]
        note = (
            f"Model forecast for 2027, no measured reference here. Ground slope {slope:.1f}° from the DEM "
            f"({terrain.step:g} m step), horizon from "
            f"the app terrain at 0 m, limb-darkened Sun, Sun distance from SPICE, albedo 0.12 at every incidence "
            f"angle (polar terrain model of Hayne et al. 2021); 3 years of spin-up. Mean {ty.mean():.0f} K. Sunlit "
            f"slopes of the horizon add {q_slopes.mean():.2f} W/m² on average, {q_slopes.max():.1f} W/m² at most "
            "(scattered light and infrared). Not modelled: sub-pixel roughness, the lander itself."
        )
        for label, v in (
            ("Surface temperature 2027, minimum", ty.min()),
            ("Surface temperature 2027, maximum", ty.max()),
        ):
            rows.append(
                row(
                    label,
                    s["name"],
                    "Our model (Hayne et al. 2017)",
                    URL["hayne"],
                    float(v),
                    None,
                    "K",
                    None,
                    None,
                    note,
                    s["id"],
                    1,
                )
            )
        k = int(np.argmax(prp @ up))
        gap_m = float(np.arccos(min(1.0, prp[k] @ up)) * R)
        if gap_m < 1000.0:  # the product covers 75.9-90 S
            # Same scale as the product: the slope of its own ~0.5 km triangle and the horizon of the LOLA
            # grid closest to that mesh (240 m), as map_terrain does for the PGDA 69 maps (#339).
            cmaz, cmel, _ = horizon_mask(Terrain(dems["polar240"]), s["lonE"], s["lat"], 0.0)
            cvis = visible_fraction(az, el, rad, cmaz, cmel, limb=SUN_LIMB)
            fp = year_profile(prp_n[k], vis=cvis, mask=(cmaz, cmel))
            f_slope = float(np.degrees(np.arccos(prp_n[k] @ up)))
            pt = (float(ty.max()), float(np.mean(th.at_depth(col, prof, 0.02))))
            for label, ours, ref, ours_pt in (
                (
                    "Surface temperature vs Diviner PRP, annual maximum",
                    float(fp[:, 0].max()),
                    float(prp_max[k]),
                    pt[0],
                ),
                (
                    "Surface temperature vs Diviner PRP, annual mean at 2 cm",
                    float(np.mean(th.at_depth(col, fp, 0.02))),
                    float(prp_avg[k]),
                    pt[1],
                ),
            ):
                where = (
                    f"Our model on the slope of the nearest product triangle ({f_slope:.1f}°, centre {gap_m:.0f} m "
                    f"from the site) under the LOLA 240 m horizon: Sun seen {np.mean(cvis > 0) * 100:.0f} % of "
                    f"hours, {np.mean(vis > 0) * 100:.0f} % on the {terrain.step:g} m site terrain. On the "
                    f"{terrain.step:g} m DEM slope and horizon at the site ours is {ours_pt:.1f} K. The "
                    "product is the Diviner team's model on a ~0.5 km mesh with sunlight and infrared from the "
                    "surrounding terrain; ours adds light and infrared from the sunlit slopes of the horizon. Threshold committed in 1bb006a7 before "
                    "download."
                )
                if abs(ours - ref) > PRP_TOL_K:
                    where += (
                        f" Fail kept: the miss is {ours - ref:+.1f} K. Here the Sun time depends on the "
                        f"horizon scale ({np.mean(cvis > 0) * 100:.0f} % on 240 m, {np.mean(vis > 0) * 100:.0f} % "
                        f"on {terrain.step:g} m). The product's horizon comes from the Diviner team's own mesh. "
                        "A horizon from that mesh is a method change; we keep the frozen method."
                    )
                rows.append(
                    row(
                        label,
                        s["name"],
                        "Diviner Polar Resource Product (Paige et al. 2010)",
                        URL["prp"],
                        ours,
                        ref,
                        "K",
                        PRP_TOL_K,
                        bool(abs(ours - ref) <= PRP_TOL_K),
                        where,
                        s["id"],
                        1,
                    )
                )
        print(
            f"  thermal {s['id']:24s} {ty.min():5.0f}..{ty.max():5.0f} K  {time.time() - t0:4.1f} s"
        )
    return {
        "id": "thermal",
        "title": "Regolith surface temperature vs Diviner and Apollo",
        "explanation": (
            "The task names thermal conditions for equipment. We compute the regolith surface temperature with "
            "the 1D heat conduction model of Hayne et al. (2017, JGR Planets): density and conductivity grow "
            "with depth, conductivity and heat capacity depend on temperature. We check the model against the "
            "reference values in Table A2 of the paper (albedo rising with the incidence angle, Eq. A8): Diviner "
            "equatorial temperatures and the Apollo 15/17 heat flow probes. At the polar sites the model takes "
            "our hourly solar flux behind the terrain horizon (2024–2027, SPICE) on the tilted ground and gives "
            "the 2027 minimum and maximum. There the albedo is 0.12 at every incidence angle, as in the polar "
            "terrain model of Hayne et al. (2021, Nature Astronomy, Methods). We chose it after the first run: "
            "with Eq. A8 the Sun at 1–2° gives albedo 0.7–0.8, and the sites came out 20–71 K colder than the "
            "Diviner polar product. We compare with that product (Paige et al. 2010) at its own scale: the slope "
            "of its ~0.5 km triangle and the horizon of LOLA 240 m, the LOLA grid closest to that mesh. We chose "
            "the 240 m horizon after a run on the 20 m site terrain: there a 20 m crest hides the Sun at some "
            "sites (de Gerlache rim GR1: Sun seen 25 % of hours on 20 m, 54 % on 240 m), which a 0.5 km mesh "
            "cannot resolve. On Shackleton rim the 240 m grid flattens the crest and hides the Sun instead. Both "
            "models add light and infrared from the sunlit slopes around the site. In ours each azimuth of the "
            "horizon is a slope that faces the site, with view factor sin² of its horizon angle. It adds 0–2.2 "
            "W/m² on average (IM-1 the most): up to 3 K in the annual mean at 2 cm, about 1 K in the maximum. It is the ground, not the lander."
        ),
        "rows": rows,
    }


def summarize(groups) -> dict:
    rows = [r for g in groups for r in g["rows"]]
    checks = [r for r in rows if r["pass"] is not None]
    return {
        "checks": len(checks),
        "pass": sum(r["pass"] for r in checks),
        "fail": sum(not r["pass"] for r in checks),
        "info": len(rows) - len(checks),
    }


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="precompute.validation", description=__doc__.splitlines()[0])
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--hz", type=Path, default=HZ_DIR, help="Horizons reference tables")
    p.add_argument("--step-h", type=float, default=1.0, help="time step for the 18.6-year means")
    p.add_argument("--sites", default="", help="comma-separated polar site ids (default: all)")
    p.add_argument("--fine", default=FINE_DEM, help="LOLA 20 m DEM (local path or /vsicurl/ URL)")
    p.add_argument(
        "--groups",
        default="",
        help="group ids to rebuild (default: all); the rest stay as in <out>",
    )
    p.add_argument(
        "--eclipse-loss",
        default="",
        help="site ids: print the 18.6-year share of the Sun the Earth hides there and exit",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=0,
        help="random group: first N points only, print, do not write",
    )
    a = p.parse_args(argv)

    t0 = time.time()
    load_kernels(a.data / "spice")
    sites = {
        s["id"]: s for s in json.loads((a.out / "sites.json").read_text(encoding="utf-8"))["sites"]
    }
    if a.eclipse_loss:
        for i in filter(None, a.eclipse_loss.split(",")):
            print(f"{i}: Earth hides {eclipse_loss_pct(sites[i]):.3f} % of the Sun flux in 18.6 y")
        return
    only = set(filter(None, a.sites.split(",")))
    polar = [
        s
        for s in sites.values()
        if s["lat"] is not None and s["terrain"] != "none" and (not only or s["id"] in only)
    ]
    dems = {
        "fine": a.fine,
        "polar80": Dem(a.data / "lola" / "LDEM_80S_80MPP_ADJ.TIF"),
        "polar240": Dem(a.data / "lola" / "LDEM_60S_240MPP_ADJ.TIF"),
        "same120": a.data / "lola" / "LDEM_75S_120M.LBL",
        "same60": a.data / "lola" / "LDEM_75S_60M.LBL",
    }
    build = {
        "ephemeris": lambda: group_ephemeris(a.hz),
        "apollo": lambda: group_apollo(sites),
        "illumination": lambda: group_illumination(polar, dems, a.data / "illum", a.step_h),
        "barker": lambda: group_barker(dems),
        "sphere": lambda: group_sphere(polar, dems),
        "eclipse": lambda: group_eclipse(sites, polar),
        "random": lambda: group_random(dems, a.data / "illum", a.step_h, a.limit),
        "thermal": lambda: group_thermal(polar, dems, a.data / "diviner" / "dlre_prp_south.tab"),
    }
    want = set(filter(None, a.groups.split(","))) or set(build)
    if a.limit:
        build["random"]()
        sp.kclear()
        return
    old = {}
    if want != set(build):
        old = {
            g["id"]: g
            for g in json.loads((a.out / "validation.json").read_text(encoding="utf-8"))["groups"]
        }
    groups = []
    for k, f in build.items():
        if k not in want and k not in old:
            print(f"{k} missing, skipped")
            continue
        groups.append(f() if k in want else old[k])
        print(f"{k} {'done' if k in want else 'kept'}")
    out = {
        "generatedUtc": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "command": "cd backend && uv run python -m precompute.validation --data <data> --out ../web/public/data",
        "summary": summarize(groups),
        "groups": groups,
    }
    (a.out / "validation.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(out["summary"]), f"{time.time() - t0:.0f} s")
    sp.kclear()


if __name__ == "__main__":
    main()
