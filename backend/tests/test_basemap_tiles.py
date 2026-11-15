"""Basemap tile pyramid (#149): tile geometry matches MapLibre and D-005, pixels are georeferenced,
the committed git tier lists exactly the tiles on disk."""

import json
import warnings
from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.errors import NotGeoreferencedWarning
from rasterio.transform import from_origin

from precompute import basemap_tiles as bt
from precompute.geo import from_xy, to_xy, unit

DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


@pytest.fixture(autouse=True)
def _close():
    yield
    bt.close_all()  # temp files go away with tmp_path


def make_src(tmp_path, name, res, bounds, fn):
    """GeoTIFF source over bounds (m) with value fn(x, y) at pixel centres; row 0 = +y."""
    x0, y0, x1, y1 = bounds
    nx, ny = int((x1 - x0) / res), int((y1 - y0) / res)
    xs = x0 + (np.arange(nx) + 0.5) * res
    ys = y1 - (np.arange(ny) + 0.5) * res
    path = tmp_path / f"{name}.tif"
    with rasterio.open(
        path, "w", driver="GTiff", width=nx, height=ny, count=1, dtype="float32",
        transform=from_origin(x0, y1, res, res), crs="EPSG:3031", nodata=np.nan,
    ) as ds:  # fmt: skip
        ds.write(fn(xs[None, :], ys[:, None]).astype(np.float32), 1)
    return {"path": str(path), "res": res, "bounds": list(bounds)}


def test_pixel_size_and_pole_corner():
    # 256 px tiles: Z16 = 21.5 m, Z18 = 5.4 m per pixel (the LOLA 20 m and 5 m levels).
    assert bt.pixel_m(16) == pytest.approx(21.46, abs=0.01)
    assert bt.pixel_m(18) == pytest.approx(5.36, abs=0.01)
    # The pole (map 0, 0) is the corner of four tiles; pixel (0, 0) of the SE one sits half a
    # pixel east and south of it.
    xs, ys = bt.pixel_xy(13, 4096, 4096)
    p = bt.pixel_m(13)
    assert xs[0] == pytest.approx(p / 2, rel=1e-9)
    assert ys[0] == pytest.approx(-p / 2, rel=1e-3)  # Mercator at 1e-4 deg: scale 1
    assert np.all(np.diff(ys) < 0) and np.all(np.diff(xs) > 0)  # rows north to south


def test_longitude_0_360_east_on_the_tile_grid():
    """+x is 90 deg E, +y is 0 deg E (D-005), longitudes 0..360 east."""
    lat = -85.0
    for lon_e in (0.5, 90.0, 180.0, 270.0, 359.5):
        x, y = (float(v) for v in to_xy(unit(lon_e, lat)))
        cols, rows = bt.tile_range([x, y, x + 1, y + 1], 15)
        xs, ys = bt.pixel_xy(15, cols[0], rows[0])
        i, j = np.argmin(abs(xs - x)), np.argmin(abs(ys - y))
        lon, la = from_xy(xs[i], ys[j])
        assert la == pytest.approx(lat, abs=0.01)
        assert (lon - lon_e + 180) % 360 - 180 == pytest.approx(0, abs=0.05)


def test_tile_range_is_the_maplibre_rule():
    b = [-304000.0, -304000.0, 304000.0, 304000.0]  # LOLA 80S square
    cols, rows = bt.tile_range(b, 13)
    assert len(cols) == len(rows) == 14  # 608 km / 43.9 km tiles = 13.8, both edges cut a tile
    for z in (13, 15):
        cols, rows = bt.tile_range(b, z)
        xs0, _ = bt.pixel_xy(z, cols[0], rows[0])
        xs1, ys1 = bt.pixel_xy(z, cols[-1], rows[-1])
        p = bt.pixel_m(z)
        assert xs0[0] - p / 2 <= b[0] < xs0[-1] + p / 2  # first column holds the west edge
        assert xs1[0] - p / 2 < b[2] <= xs1[-1] + p / 2  # last column holds the east edge
        assert ys1[-1] - p < b[1] < ys1[0] + p  # last row holds the south edge


def test_composite_puts_a_known_pixel_in_place_and_blends_finer_data(tmp_path):
    """A linear surface comes back exact at the pixel centres; a finer source wins inside its
    bounds and fades in over FEATHER_PX pixels from its edge."""
    plane = lambda x, y: 0.01 * x - 0.02 * y
    coarse = make_src(tmp_path, "c", 240, [-60000, -60000, 60000, 60000], plane)
    fine = make_src(tmp_path, "f", 20, [-5000, -5000, 5000, 5000], lambda x, y: plane(x, y) + 100)
    z = 14  # 86 m pixels: both sources are read
    xs, ys = bt.pixel_xy(z, 8191, 8191)  # the tile NW of the pole: x, y in -22..0 km
    v = bt.composite([coarse], xs, ys, bt.pixel_m(z))
    want = plane(xs[None, :], ys[:, None])
    assert np.nanmax(abs(v - want)) < 0.5  # 0.5 m of 400 m relief: georeferenced to < 50 m
    i = int(np.argmin(abs(xs + 12345)))  # a known pixel: x = -12345 m, y = -6789 m
    j = int(np.argmin(abs(ys + 6789)))
    assert v[j, i] == pytest.approx(plane(xs[i], ys[j]), abs=0.5)
    v2 = bt.composite([coarse, fine], xs, ys, bt.pixel_m(z))
    d = v2 - want
    inner = (abs(xs) < 5000 - 30 * bt.pixel_m(z))[None, :] & (abs(ys) < 5000 - 30 * bt.pixel_m(z))[
        :, None
    ]
    outer = (abs(xs) > 5000)[None, :] | (abs(ys) > 5000)[:, None]
    assert np.all(abs(d[inner] - 100) < 1)
    assert np.all(abs(d[outer]) < 1)
    band = ~inner & ~outer
    assert band.any() and np.all((d[band] > -1) & (d[band] < 101))


def test_render_skips_relief_tiles_without_data_and_writes_webp(tmp_path):
    src = make_src(tmp_path, "c", 240, [-60000, -60000, 60000, 60000], lambda x, y: 0 * x + 0 * y)
    assert bt.render("relief", [src], 14, 0, 0) is None  # far from the pole
    rgb = bt.render("relief", [src], 14, 8191, 8191)
    assert rgb.shape == (256, 256, 3) and rgb.dtype == np.uint8
    assert np.ptp(rgb[..., 0]) == 0  # flat ground: one fixed grey, no per-tile stretch
    bt.write_webp(rgb, tmp_path / "t" / "1.webp")
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        ds = rasterio.open(tmp_path / "t" / "1.webp")
    with ds:
        assert (ds.width, ds.height, ds.count) == (256, 256, 3)


def test_git_tier_lists_exactly_the_tiles_on_disk():
    meta = json.loads((DATA / "basemap" / "meta.json").read_text())
    sets = meta["tiles"]["sets"]
    assert {s["layer"] for s in sets} == {"relief", "photo"}
    root = DATA / "basemap"
    for layer in ("relief", "photo"):
        mine = [s for s in sets if s["layer"] == layer]
        want = {f"{z}/{x}/{y}.webp" for z, x, y in bt.tiles_of(mine)}
        d = root / "tiles" / layer
        have = {p.relative_to(d).as_posix() for p in d.rglob("*.webp")}
        assert want == have, layer
        assert all(s["url"] == f"tiles/{layer}/{{z}}/{{x}}/{{y}}.webp" for s in mine)
    # Relief reaches LOLA 20 m in git; deeper zooms are the /hd/ tier.
    assert max(s["maxzoom"] for s in sets if s["layer"] == "relief") == 16
