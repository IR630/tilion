"""Custom point assets (#31, #100): DEM tiles without data; the committed tiles vs LOLA when data/ is present.

The browser port itself is checked against tests/fixtures/custom_reference.json by
web/src/custom/horizon.test.ts.
"""

import json

import numpy as np
import pytest
from test_precompute import DATA, REPO, need

from precompute import custom
from precompute.geo import to_xy, unit

OUT = REPO / "web" / "public" / "data"


def test_dem_2d_differences_round_trip_through_int16_wrap():
    q = np.array([[30000, -30000, 5, -7], [-1, 0, 32767, -32768]], dtype=np.int16)
    assert np.array_equal(custom.decode_dem(custom.encode_dem(q), 4), q)


def test_tiles_round_trip_in_place_and_reject_a_partial_tile():
    q = np.random.default_rng(1).integers(-18000, 18000, (6, 6)).astype(np.int16)
    files = custom.encode_tiles(q, px=2)
    assert sorted(files)[:2] == ["dem240/0-0.bin", "dem240/0-1.bin"] and len(files) == 9
    # Row 1, col 2 is the block q[2:4, 4:6]: a swapped row/col or a shared difference fails.
    assert np.array_equal(custom.decode_dem(files["dem240/1-2.bin"], 2), q[2:4, 4:6])
    assert np.array_equal(custom.decode_tiles(files.__getitem__, 3, px=2), q)
    with pytest.raises(ValueError):
        custom.encode_tiles(q[:5, :5], px=2)


@need("lola/" + custom.DEM_SOURCE)
def test_committed_tiles_are_the_lola_240m_dem_in_place():
    import rasterio

    g = json.loads((OUT / "custom" / "meta.json").read_text())["dem"]
    q, x0, y0, step = custom.read_dem(DATA / "lola" / custom.DEM_SOURCE)
    assert (g["x0"], g["y0"], g["dx"], g["scaleM"]) == (x0, y0, step, custom.SCALE_M)
    assert g["tiles"] * g["tilePx"] == q.shape[0] == g["width"]
    read = lambda f: (OUT / "custom" / f).read_bytes()
    tiles = custom.decode_tiles(read, g["tiles"], g["tilePx"])
    assert np.array_equal(tiles, q)
    del q  # int16 grids of 120 MB; the float32 DEM is built only around each pixel below
    # Georeferencing: the source pixel under a site, read by its own transform, is the tile value
    # at that pixel centre on the grid of meta.json (a half-pixel or one-pixel shift fails).
    with rasterio.open(DATA / "lola" / custom.DEM_SOURCE) as ds:
        for lon, lat in (
            (222.83, -89.4398),
            (127.857, -87.1306),
            (1.44, -80.13),
            (32.3, -69.37),
            (300.0, -60.5),
        ):
            x, y = (float(v) for v in to_xy(unit(lon, lat)))
            r, c = ds.index(x, y)
            src = float(ds.read(1, window=((r, r + 1), (c, c + 1)))[0, 0])
            cx, cy = ds.xy(r, c)
            win = tiles[r - 2 : r + 3, c - 2 : c + 3]
            x0w, y0w = g["x0"] + (c - 2) * g["dx"], g["y0"] + (r - 2) * g["dy"]
            dem = custom.ArrayDem(win, x0w, y0w, g["dx"])
            assert float(dem.sample(cx, cy)) == pytest.approx(src, abs=custom.SCALE_M / 2)
