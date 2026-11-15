"""Web assets for the navigator map (#34): NASA illumination overlays, hours index.
The relief is a tile pyramid since #149: backend/src/precompute/basemap_tiles.py (meta.json "tiles",
kept here).

Usage (from backend/):
    uv run --frozen --with pillow python ../scripts/basemap_assets.py --data <repo>/data

Sources (NASA, public domain; see data/README.md):
- AVGVISIB_65S_240M_201608[_EARTH].TIF and AVGVISIB_85S_060M_201608[_EARTH].TIF, PGDA product 69
  (Mazarico et al. 2011): mean visible fraction of the solar disc / share of time Earth is visible,
  over 18.6 years; value = int16 x 4e-5.
All rasters: south polar stereographic on R = 1737.4 km, row 0 = +y (lon 0E side), col 0 = -x.

Output:
    web/public/data/basemap/{sun65,sun85,earth65,earth85}.webp + meta.json (D-005)
    web/public/data/hours.json (D-006) — one char per hour per site from web/public/data/timeline/*.json
Each output pixel is an area average of the source (rasterio Resampling.average).
"""

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "public" / "data"
PGDA69 = "https://pgda.gsfc.nasa.gov/products/69"

# (id, kind, source file, output size px)
OVERLAY = [
    ("sun65", "sun", "illum/AVGVISIB_65S_240M_201608.TIF", 3210),
    ("sun85", "sun", "illum/AVGVISIB_85S_060M_201608.TIF", 2529),
    ("earth65", "earth", "illum/AVGVISIB_65S_240M_201608_EARTH.TIF", 3210),
    ("earth85", "earth", "illum/AVGVISIB_85S_060M_201608_EARTH.TIF", 2529),
]
# Colour ramps: value 0..1 -> RGB. Sun: dark -> amber -> pale yellow. Earth: dark -> blue -> cyan-white.
RAMP = {
    "sun": [
        (0.0, (20, 16, 10)),
        (0.3, (120, 70, 10)),
        (0.6, (242, 182, 50)),
        (1.0, (255, 245, 200)),
    ],
    "earth": [
        (0.0, (8, 14, 30)),
        (0.3, (20, 60, 140)),
        (0.6, (78, 161, 255)),
        (1.0, (215, 240, 255)),
    ],
}


def read(
    path: Path, size: int
) -> tuple[np.ndarray, rasterio.coords.BoundingBox, float, float | None]:
    with rasterio.open(path) as ds:
        a = ds.read(1, out_shape=(size, size), resampling=Resampling.average, masked=True)
        return a, ds.bounds, ds.scales[0] or 1.0, ds.nodata


def ramp_rgba(v: np.ndarray, mask: np.ndarray, kind: str) -> np.ndarray:
    stops = RAMP[kind]
    xs = [s[0] for s in stops]
    rgb = np.stack([np.interp(v, xs, [s[1][c] for s in stops]) for c in range(3)], axis=-1)
    alpha = np.where(mask, 0, 210)
    return np.dstack([rgb, alpha]).astype(np.uint8)


def save_webp(arr: np.ndarray, path: Path) -> None:
    Image.fromarray(arr).save(path, "WEBP", quality=82, method=6)


def hours_index(timeline_dir: Path) -> dict:
    sites, start, step, n = {}, None, None, None
    for f in sorted(timeline_dir.glob("*.json")):
        t = json.loads(f.read_text())
        if start is None:
            start, step, n = t["startUtc"], t["stepMin"], len(t["sunVisible"])
        assert (t["startUtc"], t["stepMin"], len(t["sunVisible"])) == (start, step, n), f.name
        s = np.asarray(t["sunVisible"]) > 0
        e = np.asarray(t["earthVisible"]) > 0
        sites[t["siteId"]] = "".join("0123"[k] for k in (s.astype(int) + 2 * e.astype(int)))
    return {"startUtc": start, "stepMin": step, "n": n, "sites": sites}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    ap.add_argument("--out", type=Path, default=WEB_DATA)
    a = ap.parse_args()
    out = a.out / "basemap"
    out.mkdir(parents=True, exist_ok=True)
    layers = []
    for lid, kind, src, size in OVERLAY:
        v, b, scale, _ = read(a.data / src, size)
        frac = np.clip(v.filled(0).astype(np.float64) * scale, 0, 1)
        save_webp(ramp_rgba(frac, np.ma.getmaskarray(v), kind), out / f"{lid}.webp")
        layers.append({"id": lid, "kind": kind, "file": f"{lid}.webp", "bounds": [b.left, b.bottom, b.right, b.top],
                       "source": f"{Path(src).name}, {PGDA69}"})  # fmt: skip
        print(lid, size, "px")
    old = json.loads((out / "meta.json").read_text()) if (out / "meta.json").exists() else {}
    meta = {
        "projection": "south polar stereographic, R = 1737.4 km, lon 0E = +y; map lng/lat = metres / 1e6 (D-005)",
        "layers": layers,
        "legend": {
            "sun": "mean visible fraction of the solar disc over 18.6 years (Mazarico et al. 2011, PGDA 69)",
            "earth": "share of time any part of Earth is visible over 18.6 years (Mazarico et al. 2011, PGDA 69)",
            "ramp": RAMP,
        },
    }
    if "tiles" in old:  # the relief pyramid (#149) is written by precompute.basemap_tiles
        meta["tiles"] = old["tiles"]
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    (a.out / "hours.json").write_text(
        json.dumps(hours_index(a.out / "timeline"), separators=(",", ":"))
    )
    print("hours.json", (a.out / "hours.json").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
