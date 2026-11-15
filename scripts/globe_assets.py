"""Web-ready assets for the Globe screen (#21): colour mosaic, global heights, south-polar patch.

Usage (from backend/):
    uv run --frozen --with pillow python ../scripts/globe_assets.py --data <repo>/data [--out DIR]

Sources (NASA, public domain):
- NASA SVS 4720 "CGI Moon Kit", https://svs.gsfc.nasa.gov/4720
    lroc_color_poles_4k.tif  LROC WAC colour mosaic with polar fill, 4096x2048, 8-bit sRGB
    ldem_16.tif              LOLA displacement, 16 px/deg (5760x2880), float32 km over R = 1737.4 km
  Both are simple cylindrical, centred on 0 deg longitude: column 0 = 180 W, row 0 = 90 N.
  The script downloads them to <data>/svs/ when they are missing (curl -C - resumes).
- LOLA polar DEM LDEM_80S_80MPP_ADJ.TIF (PGDA product 90, see data/README.md), south polar
  stereographic, metres over the 1737.4 km sphere, extent +-304 km (80-90 S).

Output in <out> (default web/public/data/globe):
    moon_color.jpg     4096x2048 JPEG
    moon_height.bin    2048x1024 Int16 LE, row 0 = north, column 0 = 180 W; h_m = v * scaleM + offsetM
    south_patch.bin    1024x1024 Int16 LE, polar stereographic, row 0 = +y (lon 0 E side), col 0 = -x
    meta.json          sizes, scales, extents, source URLs
Each pixel is an area average of the source (rasterio Resampling.average).
"""

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling

ROOT = Path(__file__).resolve().parent.parent
SVS = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/"
COLOR_SRC, HEIGHT_SRC = "lroc_color_poles_4k.tif", "ldem_16.tif"
POLAR_SRC = "LDEM_80S_80MPP_ADJ.TIF"
POLAR_URL = "https://pgda.gsfc.nasa.gov/products/90"
SCALE_M = 0.5  # LOLA native unit: half-metres; the range +-10.9 km fits Int16


def fetch(svs_dir: Path, name: str) -> Path:
    p = svs_dir / name
    if not p.exists():
        svs_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(["curl", "-sfL", "-C", "-", "-o", str(p), SVS + name], check=True)
    return p


def read_avg(path: Path, shape: tuple[int, int], bands=1) -> np.ndarray:
    with rasterio.open(path) as ds:
        a = ds.read(
            list(range(1, bands + 1)) if bands > 1 else 1,
            out_shape=((bands,) if bands > 1 else ()) + shape,
            resampling=Resampling.average,
            masked=False,
        )
    return a


def to_int16(h_m: np.ndarray) -> np.ndarray:
    if np.isnan(h_m).any():
        raise ValueError(f"{int(np.isnan(h_m).sum())} NaN heights")
    q = np.round(h_m / SCALE_M)
    assert q.min() >= -32768 and q.max() <= 32767
    return q.astype("<i2")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "data" / "globe")
    ap.add_argument("--width", type=int, default=2048, help="global height map width")
    ap.add_argument("--patch", type=int, default=1024, help="polar patch size")
    args = ap.parse_args()
    out = args.out
    out.mkdir(parents=True, exist_ok=True)
    svs = args.data / "svs"

    # Colour: the 4k mosaic is already 4096x2048 8-bit; re-encode as JPEG.
    rgb = read_avg(fetch(svs, COLOR_SRC), (2048, 4096), bands=3)
    Image.fromarray(np.moveaxis(rgb, 0, -1)).save(out / "moon_color.jpg", quality=86, optimize=True)

    # Global heights: km -> m, area average to width x width/2.
    w = args.width
    h = read_avg(fetch(svs, HEIGHT_SRC), (w // 2, w)).astype(np.float64) * 1000.0
    to_int16(h).tofile(out / "moon_height.bin")

    # South-polar patch from the 80 m DEM.
    polar = args.data / "lola" / POLAR_SRC
    with rasterio.open(polar) as ds:
        b = ds.bounds
        extent = float(b.right)
        assert b.left == -b.right and b.bottom == -b.top == b.left
    n = args.patch
    p = read_avg(polar, (n, n)).astype(np.float64)
    to_int16(p).tofile(out / "south_patch.bin")

    meta = {
        "refRadiusKm": 1737.4,
        "color": {"file": "moon_color.jpg", "width": 4096, "height": 2048},
        "height": {
            "file": "moon_height.bin",
            "width": w,
            "height": w // 2,
            "scaleM": SCALE_M,
            "offsetM": 0.0,
            "minM": round(float(h.min()), 1),
            "maxM": round(float(h.max()), 1),
            "layout": "Int16 LE, row 0 = 90N, column 0 = 180W, pixel centres",
        },
        "southPatch": {
            "file": "south_patch.bin",
            "size": n,
            "extentM": extent,
            "latEdgeDeg": -80.0,
            "scaleM": SCALE_M,
            "offsetM": 0.0,
            "minM": round(float(p.min()), 1),
            "maxM": round(float(p.max()), 1),
            "layout": "Int16 LE, south polar stereographic on R = 1737.4 km, "
            "x = r sin(lonE), y = r cos(lonE); row 0 = +y, column 0 = -x, pixel centres",
        },
        "sources": {
            "color": SVS + COLOR_SRC,
            "height": SVS + HEIGHT_SRC,
            "kit": "https://svs.gsfc.nasa.gov/4720",
            "southPatch": f"{POLAR_SRC}, {POLAR_URL}",
            "license": "NASA, public domain",
        },
    }
    (out / "meta.json").write_text(json.dumps(meta, indent=1) + "\n")
    for f in sorted(out.iterdir()):
        print(f"{f.name}: {f.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
