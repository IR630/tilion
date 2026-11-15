"""Numeric PGDA 69 grids for mission waypoints (#148): mean Sun and Earth visibility at any point.

Usage (from backend/):
    uv run --frozen python ../scripts/illum_grid_assets.py --data <repo>/data

The basemap WebP overlays are colour images for display only. Waypoints need numbers, so this
script writes small numeric grids from the original GeoTIFFs (PGDA product 69, Mazarico et al.
2011; value = int16 x 4e-5, mean over 18.6 years):
    AVGVISIB_85S_060M_201608[_EARTH].TIF (60 m)  -> 4x4 area mean, ~240 m cells, 85-90S
    AVGVISIB_65S_240M_201608[_EARTH].TIF (240 m) -> 4x4 area mean,  960 m cells, 65-90S
Cell value: uint8 percent 0..100 (rounded), 255 = no data. Rows: row 0 = +y (lon 0E side),
col 0 = -x, like the source. Each grid is gzip-compressed raw bytes.

Output: web/public/data/illum/{sun85,earth85,sun65,earth65}.u8.gz + meta.json
"""

import argparse
import gzip
import json
from pathlib import Path

import numpy as np
import rasterio
import rasterio.windows
from rasterio.enums import Resampling
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "public" / "data"
PGDA69 = "https://pgda.gsfc.nasa.gov/products/69"
NODATA = 255
FACTOR = 4  # source pixels per output cell, each axis

GRIDS = [
    ("sun85", "sun", "illum/AVGVISIB_85S_060M_201608.TIF"),
    ("earth85", "earth", "illum/AVGVISIB_85S_060M_201608_EARTH.TIF"),
    ("sun65", "sun", "illum/AVGVISIB_65S_240M_201608.TIF"),
    ("earth65", "earth", "illum/AVGVISIB_65S_240M_201608_EARTH.TIF"),
]


def percent_grid(path: Path, factor: int = FACTOR) -> tuple[np.ndarray, list[float]]:
    """Area-mean resample to 1/factor size; uint8 percent, NODATA where the source has no value."""
    with rasterio.open(path) as ds:
        # Crop to a whole number of blocks (centred), so every cell is exactly factor x factor pixels.
        n = ds.width // factor * factor
        off = (ds.width - n) // 2
        win = Window(off, off, n, n)
        v = ds.read(1, window=win, out_shape=(n // factor, n // factor), resampling=Resampling.average, masked=True)
        scale = ds.scales[0] or 1.0
        b = rasterio.windows.bounds(win, ds.transform)
    pct_bounds = [b[0], b[1], b[2], b[3]]
    pct = np.clip(np.rint(v.filled(0).astype(np.float64) * scale * 100), 0, 100).astype(np.uint8)
    pct[np.ma.getmaskarray(v)] = NODATA
    return pct, pct_bounds


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    ap.add_argument("--out", type=Path, default=WEB_DATA)
    a = ap.parse_args()
    out = a.out / "illum"
    out.mkdir(parents=True, exist_ok=True)
    grids = []
    for gid, kind, src in GRIDS:
        pct, bounds = percent_grid(a.data / src)
        f = out / f"{gid}.u8.gz"
        f.write_bytes(gzip.compress(pct.tobytes(), compresslevel=9, mtime=0))
        cell = (bounds[2] - bounds[0]) / pct.shape[1]
        grids.append({"id": gid, "kind": kind, "file": f.name, "size": pct.shape[1], "bounds": bounds,
                      "cellM": cell, "source": f"{Path(src).name}, {PGDA69}"})  # fmt: skip
        print(gid, pct.shape, f"{cell:.1f} m", f"{f.stat().st_size // 1024} KB")
    meta = {
        "what": "mean over 18.6 years (Mazarico et al. 2011, PGDA 69): sun = visible fraction of the solar disc, "
        "earth = share of time any part of Earth is visible; uint8 percent, 255 = no data",
        "projection": "south polar stereographic, R = 1737.4 km, row 0 = +y (lon 0E), col 0 = -x",
        "nodata": NODATA,
        "grids": grids,
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")


if __name__ == "__main__":
    main()
