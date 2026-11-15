"""BETA nearest cold-trap candidate (#175): precompute/beta_psr.py and its static output.

Source checks need data/illum (PGDA 69). Synthetic-raster and output-file checks always run.
"""

import json
import math
from pathlib import Path

import numpy as np
import pytest
from test_precompute import DATA, DATA_SKIP_TAG

from precompute.beta_psr import Grid, bearing, douglas_peucker, scale, site_entry
from precompute.geo import from_xy, to_xy, unit

REPO = Path(__file__).resolve().parents[2]
BETA = REPO / "web" / "public" / "data" / "beta"
SHACKLETON = (-89.67, 129.78)  # crater centre, IAU Gazetteer (lat, lonE)


def _grid(name: str, min_km2: float, tol: float) -> Grid:
    f = {"60m": "AVGVISIB_85S_060M_201608.TIF", "240m": "AVGVISIB_65S_240M_201608.TIF"}[name]
    path = None if DATA is None else DATA / "illum" / f
    if path is None or not path.exists():
        pytest.skip(f"{DATA_SKIP_TAG} data/illum/{f}")
    return Grid(name, path, min_km2, tol)


def _patch_at(g: Grid, lat: float, lon_e: float) -> int:
    x, y = (float(v) for v in to_xy(unit(lon_e, lat)))
    r, c = g.rc(x, y)
    return int(g.lab[r, c])


def test_shackleton_floor_psr_area_and_place():
    """Shackleton floor patch: 234 km2 +- 5 %, centred on the crater, smaller than the crater.

    Mazarico et al. 2011 (Icarus 211, 1066-1081) does not give a per-crater area that we could
    verify (the paper is paywalled; the NTRS abstract gives only pole totals). So the reference is
    the scout prototype on the same PGDA 69 60 m map: 234 km2 (#175), tolerance 5 %. The physical
    bound is the crater: diameter 21 km (Zuber et al. 2012, Nature 486) -> 346 km2.
    The pole total against Mazarico 2011 is the next test.
    """
    g = _grid("60m", 0.1, 60.0)
    p = _patch_at(g, *SHACKLETON)
    assert p > 0, "the Shackleton centre is not in a PSR patch"
    area = g.area[p]
    assert abs(area - 234.0) / 234.0 < 0.05, area
    assert area < math.pi * 10.5**2
    lon, lat = from_xy(g.cx[p], g.cy[p])
    cx, cy = to_xy(unit(SHACKLETON[1], SHACKLETON[0]))
    assert math.hypot(g.cx[p] - cx, g.cy[p] - cy) < 1500, (lat, lon)


def test_south_pole_psr_total_near_mazarico_2011():
    """South PSR area poleward of 80 deg S: 16,055 km2 in Mazarico et al. 2011 (Icarus 211,
    1066-1081; abstract, NTRS 20120010094; 240 m LOLA, illumination modelled to 80 deg).

    PGDA 69 (2016) uses a later, denser LOLA grid: we get 18,629 km2 (+16 %). Tolerance 20 %. A
    wrong pixel rule (value < 1 % lit instead of == 0: 23,557 km2, +47 %) leaves this band. The
    area scale is checked by test_stereographic_scale_gives_true_distance_and_area.
    """
    g = _grid("240m", 0.0, 240.0)
    _, lat = from_xy(g.cx[1:], g.cy[1:])
    total = g.area[1:][lat <= -80].sum()
    assert abs(total - 16055) / 16055 < 0.20, total


def test_site_values_match_the_published_file():
    """psr.json is the precompute output for the current sites (rerun beta_psr after a change)."""
    doc = json.loads((BETA / "psr.json").read_text())
    grids = [_grid("60m", 0.1, 60.0), _grid("240m", 1.0, 240.0)]
    s = {"id": "shackleton_rim", "lat": -89.7849, "lonE": 203.97}
    assert site_entry(s, grids) == doc["sites"]["shackleton_rim"]


def _tif(tmp_path: Path, a: np.ndarray, res: float) -> Path:
    rasterio = pytest.importorskip("rasterio")
    from rasterio.transform import from_origin

    n = a.shape[0]
    p = tmp_path / "t.tif"
    crs = "+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +R=1737400 +units=m"
    with rasterio.open(
        p, "w", driver="GTiff", height=n, width=n, count=1, dtype="int16", nodata=-32768,
        crs=crs, transform=from_origin(-n / 2 * res, n / 2 * res, res, res),
    ) as ds:  # fmt: skip
        ds.write(a, 1)
    return p


def test_patches_are_4_connected_and_small_ones_dropped(tmp_path):
    a = np.full((40, 40), 500, np.int16)
    a[5:15, 5:15] = 0  # 100 px = 0.36 km2 at 60 m
    a[20, 20] = a[21, 21] = 0  # diagonal pair: two 1 px patches, both under 0.1 km2
    a[30:35, 30:36] = 0  # 30 px = 0.108 km2
    a[0, 0] = -32768  # no data is never shadow
    g = Grid("60m", _tif(tmp_path, a, 60.0), 0.1, 60.0)
    assert len(g.geoms) == 2
    assert sorted(np.round(g.area[1:], 3)) == [0.108, 0.36]
    assert g.lab[20, 20] == 0
    # From a pixel centre 3 px right of the big patch edge: 3 x 60 m to the nearest pixel centre.
    x = g.t.c + (14 + 3 + 0.5) * g.t.a
    y = g.t.f + (10 + 0.5) * g.t.e
    d, p, *_ = g.nearest(x, y)
    assert d == pytest.approx(180.0)
    assert g.area[p] == pytest.approx(0.36, abs=1e-3)


def test_bearing_matches_the_spherical_initial_bearing():
    def sph(lat1, lon1, lat2, lon2):
        p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
        y = math.sin(dl) * math.cos(p2)
        x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
        return math.degrees(math.atan2(y, x)) % 360

    for a, b in [((-89.78, 203.97), (-89.80, 182.0)), ((-86.8, 338.3), (-86.9, 340.0))]:
        x, y = (float(v) for v in to_xy(unit(a[1], a[0])))
        tx, ty = (float(v) for v in to_xy(unit(b[1], b[0])))
        assert bearing(x, y, tx, ty) == pytest.approx(sph(*a, *b), abs=0.5)


def test_stereographic_scale_gives_true_distance_and_area():
    """Chord / k(mid-point) = great-circle distance; at 69 deg S k = 1.03 (3 % on distances)."""
    rad = 1737.4e3
    for (la1, lo1), (la2, lo2) in [
        ((-69.4, 32.3), (-69.9, 33.5)),
        ((-89.78, 203.97), (-89.8, 182.0)),
    ]:
        x1, y1 = (float(v) for v in to_xy(unit(lo1, la1)))
        x2, y2 = (float(v) for v in to_xy(unit(lo2, la2)))
        true = rad * math.acos(float(np.clip(unit(lo1, la1) @ unit(lo2, la2), -1, 1)))
        chord = math.hypot(x2 - x1, y2 - y1)
        assert chord / scale((x1 + x2) / 2, (y1 + y2) / 2) == pytest.approx(true, rel=2e-3)
    x, _ = (float(v) for v in to_xy(unit(90.0, -69.4)))  # lon 90 E: on the +x axis
    assert scale(x, 0.0) == pytest.approx(1.03, abs=0.005)


def test_douglas_peucker_drops_the_pixel_staircase():
    stairs = [(i // 2 * 60.0, (i + 1) // 2 * 60.0) for i in range(40)]
    ring = np.array([*stairs, (stairs[-1][0], 0.0), (0.0, 0.0)])
    out = douglas_peucker(ring, 60.0)
    assert len(out) < 8
    assert (out[0] == out[-1]).all()


def test_output_is_compact_and_labelled_honestly():
    doc = json.loads((BETA / "psr.json").read_text())
    assert "never lit in 18.6 yr" in doc["label"] and "ice" not in doc["label"]
    assert (BETA / "psr_polygons.json").stat().st_size < 5_000_000
    geo = json.loads((BETA / "psr_polygons.json").read_text())
    ids = {f["properties"]["id"] for f in geo["features"]}
    for sid, e in doc["sites"].items():
        assert e["patch"] in ids, sid
        assert e["distanceKm"] >= 0 and e["areaKm2"] > 0
    assert doc["sites"]["shackleton_rim"]["areaKm2"] == pytest.approx(234, rel=0.05)
