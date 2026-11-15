"""Map inset tiles (#125): the tile layout matches the map (D-005), the label names the real DEM."""

import json
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from precompute import inset
from precompute.geo import Dem, to_xy, unit

SITE = {"id": "t", "lat": -89.0, "lonE": 90.0, "terrain": "polar80"}
DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


def centre(site=SITE):
    return tuple(float(v) for v in to_xy(unit(site["lonE"], site["lat"])))


def make_dem(tmp_path, name, res, half, fn, around=None):
    """GeoTIFF over the square (cx +- half, cy +- half) with height fn(x, y) metres."""
    cx, cy = around or centre()
    n = int(2 * half / res)
    xs = cx - half + (np.arange(n) + 0.5) * res
    ys = cy + half - (np.arange(n) + 0.5) * res  # row 0 = +y
    z = fn(xs[None, :], ys[:, None]).astype(np.float32)
    path = tmp_path / f"{name}.tif"
    with rasterio.open(
        path, "w", driver="GTiff", width=n, height=n, count=1, dtype="float32",
        transform=from_origin(cx - half, cy + half, res, res), crs="EPSG:3031",
    ) as ds:  # fmt: skip
        ds.write(z, 1)
    return Dem(path)


def test_tile_rows_run_north_to_south_and_cols_west_to_east(tmp_path):
    """Row 0 = +y (0 deg E side), col 0 = -x: as boundsToCoords() draws the basemap layers."""
    cx, cy = centre()
    up = make_dem(tmp_path, "up", 20, 6000, lambda x, y: (y - cy) * 0.1)  # rises toward +y
    east = make_dem(tmp_path, "east", 20, 6000, lambda x, y: (x - cx) * 0.1)  # rises toward +x
    b = inset.tile_bounds(cx, cy)
    a = inset.resample(up, b)
    assert a[0, 256] > a[-1, 256] + 400  # 5 km * 0.1 = 500 m across the tile
    assert a[0, 256] == pytest.approx(0.1 * 2500, abs=1)
    c = inset.resample(east, b)
    assert c[256, -1] > c[256, 0] + 400
    assert c[256, 0] == pytest.approx(-0.1 * 2500, abs=1)


def test_meta_bounds_are_centred_on_the_site_in_stereographic_metres(tmp_path):
    dem = make_dem(tmp_path, "flat", 20, 6000, lambda x, y: 0 * x + 0 * y)
    _, meta = inset.build_tile(SITE, [(20, dem)])
    x0, y0, x1, y1 = meta["bounds"]
    cx, cy = centre()
    assert (x1 - x0, y1 - y0) == pytest.approx((5000.0, 5000.0))
    assert ((x0 + x1) / 2, (y0 + y1) / 2) == pytest.approx((cx, cy))
    assert cx > 0 and abs(cy) < abs(cx)  # 90 deg E is +x; 0 deg E is +y (D-005)
    assert meta["pixelM"] * meta["sizePx"] == meta["sizeM"]
    north = {**SITE, "lonE": 0.0}
    nx, ny = centre(north)
    assert ny > 0 and abs(nx) < 1e-6  # 0 deg E = up


def test_hillshade_lights_slopes_that_face_the_light():
    n = 64
    col, row = np.meshgrid(np.arange(n), np.arange(n))
    x, y = col * 10.0, -row * 10.0  # image axes: +x right, +y up
    west_facing = inset.hillshade(0.3 * x, 10.0)  # high on the east: faces west
    east_facing = inset.hillshade(-0.3 * x, 10.0)
    north_facing = inset.hillshade(-0.3 * y, 10.0)  # high on the south: faces north
    south_facing = inset.hillshade(0.3 * y, 10.0)
    mid = (slice(8, -8), slice(8, -8))
    assert west_facing[mid].mean() > east_facing[mid].mean() + 0.1
    assert north_facing[mid].mean() > south_facing[mid].mean() + 0.1
    flat = inset.hillshade(np.zeros((n, n)), 10.0)
    assert np.allclose(flat, np.sin(np.radians(inset.SHADE_ALT_DEG)))


def test_label_names_the_coarsest_dem_that_fills_the_tile(tmp_path):
    cx, cy = centre()
    f = lambda x, y: 50 * np.sin(x / 700) * np.cos(y / 900)
    fine = make_dem(tmp_path, "fine", 20, 3000, f)
    mid = make_dem(tmp_path, "mid", 80, 6000, f)
    coarse = make_dem(tmp_path, "coarse", 240, 7000, f)
    assert (
        inset.build_tile(SITE, [(20, fine), (80, mid), (240, coarse)])[1]["source"] == "LOLA 20 M"
    )
    assert inset.build_tile(SITE, [(80, mid), (240, coarse)])[1]["source"] == "LOLA 80 M"
    assert inset.build_tile(SITE, [(240, coarse)])[1]["source"] == "LOLA 240 M"
    # A 20 m window that covers the left half only: the tile is mixed, the label stays honest.
    half = make_dem(tmp_path, "half", 20, 1500, f, around=(cx - 1500, cy))
    meta = inset.build_tile(SITE, [(20, half), (80, mid), (240, coarse)])[1]
    assert (meta["resolutionM"], meta["source"]) == (80, "LOLA 80 M")
    # 240 m used for a sliver (< 1 %) does not set the label.
    sliver = make_dem(tmp_path, "sliver", 80, 2490, f)
    assert inset.build_tile(SITE, [(80, sliver), (240, coarse)])[1]["source"] == "LOLA 240 M"


def test_tile_without_terrain_is_an_error_not_a_blank_picture(tmp_path):
    cx, cy = centre()
    away = make_dem(tmp_path, "away", 80, 1000, lambda x, y: 0 * x, around=(cx + 50e3, cy))
    with pytest.raises(ValueError, match="does not cover"):
        inset.build_tile(SITE, [(80, away)])


@pytest.mark.filterwarnings("ignore::rasterio.errors.NotGeoreferencedWarning")
def test_webp_roundtrip_keeps_size_and_orientation(tmp_path):
    grey = np.tile(np.linspace(0, 255, 512).astype(np.uint8)[:, None], (1, 512))  # dark top
    path = tmp_path / "t.webp"
    inset.write_webp(grey, path)
    with rasterio.open(path) as ds:
        assert (ds.driver, ds.count, ds.height, ds.width) == ("WEBP", 3, 512, 512)
        back = ds.read(1)
    assert back[-1, 0] > back[0, 0] + 200


def test_published_tiles_match_sites_and_stay_small():
    sites = json.loads((DATA / "sites.json").read_text())["sites"]
    want = {s["id"] for s in sites if s["lat"] is not None and s["terrain"] != "none"}
    metas = {p.stem: json.loads(p.read_text()) for p in (DATA / "inset").glob("*.json")}
    assert set(metas) == want
    total = 0
    for s in sites:
        if s["id"] not in want:
            continue
        m = metas[s["id"]]
        img = DATA / "inset" / m["file"]
        total += img.stat().st_size + (DATA / "inset" / f"{s['id']}.json").stat().st_size
        x, y = to_xy(unit(s["lonE"], s["lat"]))
        b = m["bounds"]
        assert ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2) == pytest.approx((x, y), abs=1e-6)
        assert m["source"] == f"LOLA {m['resolutionM']} M"
        assert (m["sizePx"], m["sizeM"]) == (512, 5000.0)
        if s["terrain"] == "polar240":
            assert m["resolutionM"] == 240  # 5 km at 240 m is 21 samples: the label says it
    assert total < 1_000_000
