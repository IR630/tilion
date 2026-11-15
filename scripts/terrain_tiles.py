"""Cut ~20x20 km LOLA terrain tiles around each polar site for the 3D screen (#10).

Usage (from backend/):
    uv run --with rasterio --with numpy python ../scripts/terrain_tiles.py --data <repo>/data/lola [--out DIR] [--size N] [--spacing M]

For every site in web/public/data/sites.json with terrain polar80 / polar240 it resamples the DEM on a
grid aligned with the local east/north frame (no grid rotation needed in the UI): row 0 is the north
edge, column 0 the west edge. Values are heights in metres above the local tangent plane at the site
(Moon curvature applied, R = 1737.4 km), so a flat-plane renderer casts correct shadows for a Sun given
by local azimuth/elevation. Output per site:
    <out>/<siteId>.bin   Int16 little-endian, size*size, value = round((h - offsetM) / scaleM)
    <out>/<siteId>.json  metadata (see TerrainTileMeta in web/src/screens/Terrain3D.tsx)
Holes in the 80 m DEM are filled from the 240 m DEM. Reads only the windows it needs.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import rasterio
from rasterio.windows import Window

R = 1737400.0  # m, LOLA reference sphere
ROOT = Path(__file__).resolve().parent.parent
DEMS = {"polar80": "LDEM_80S_80MPP_ADJ.TIF", "polar240": "LDEM_60S_240MPP_ADJ.TIF"}


def unit(lon_e, lat):
    lo, la = np.radians(lon_e), np.radians(lat)
    return np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def to_xy(p):  # unit vectors (..., 3) -> south polar stereographic x, y (m)
    k = 2 * R / (1 - p[..., 2])
    return k * p[..., 1], k * p[..., 0]


def frame(lon_e, lat):
    up = unit(lon_e, lat)
    east = np.cross([0.0, 0.0, 1.0], up)
    east /= np.linalg.norm(east)
    return up, east, np.cross(up, east)


def sample(path, x, y):
    """Bilinear sample of a DEM at stereographic x, y (m); reads only the covering window. NaN outside."""
    with rasterio.open(path) as ds:
        t = ds.transform
        c = (x - t.c) / t.a - 0.5
        r = (y - t.f) / t.e - 0.5
        c_lo, c_hi = int(np.floor(np.nanmin(c))), int(np.floor(np.nanmax(c))) + 2
        r_lo, r_hi = int(np.floor(np.nanmin(r))), int(np.floor(np.nanmax(r))) + 2
        c_lo, r_lo = max(c_lo, 0), max(r_lo, 0)
        c_hi, r_hi = min(c_hi, ds.width), min(r_hi, ds.height)
        if c_hi - c_lo < 2 or r_hi - r_lo < 2:
            return np.full(x.shape, np.nan)
        a = ds.read(1, window=Window(c_lo, r_lo, c_hi - c_lo, r_hi - r_lo)).astype(np.float64)
        if ds.nodata is not None and not np.isnan(ds.nodata):
            a[a == ds.nodata] = np.nan
        a = a * (ds.scales[0] or 1.0) + (ds.offsets[0] or 0.0)
    c, r = c - c_lo, r - r_lo
    c0, r0 = np.floor(c).astype(int), np.floor(r).astype(int)
    ok = (c0 >= 0) & (r0 >= 0) & (c0 < a.shape[1] - 1) & (r0 < a.shape[0] - 1)
    c0, r0 = np.where(ok, c0, 0), np.where(ok, r0, 0)
    fc, fr = c - c0, r - r0
    v = (a[r0, c0] * (1 - fc) * (1 - fr) + a[r0, c0 + 1] * fc * (1 - fr)
         + a[r0 + 1, c0] * (1 - fc) * fr + a[r0 + 1, c0 + 1] * fc * fr)
    return np.where(ok, v, np.nan)


def tile(data, site, size, spacing):
    lon, lat = site["lonE"], site["lat"]
    up, east, north = frame(lon, lat)
    half = (size - 1) / 2 * spacing
    e = np.linspace(-half, half, size)  # columns: west -> east
    n = np.linspace(half, -half, size)  # rows: north -> south
    E, N = np.meshgrid(e, n)
    d = np.hypot(E, N)
    psi = d / R
    with np.errstate(invalid="ignore", divide="ignore"):
        dirv = (E[..., None] * east + N[..., None] * north) / np.where(d > 0, d, 1)[..., None]
    p = np.cos(psi)[..., None] * up + np.sin(psi)[..., None] * dirv
    x, y = to_xy(p)
    order = ["polar80", "polar240"] if site["terrain"] == "polar80" else ["polar240"]
    h = np.full(E.shape, np.nan)
    used = []
    for key in order:
        f = data / DEMS[key]
        if not f.exists() or not np.isnan(h).any():
            continue
        v = sample(f, x, y)
        fill = np.isnan(h) & ~np.isnan(v)
        if fill.any():
            used.append(key)
        h = np.where(fill, v, h)
    if np.isnan(h).all():
        return None
    h = np.where(np.isnan(h), np.nanmin(h), h)
    # height above the tangent plane at the site (curvature drop included)
    vert = (R + h) * np.cos(psi) - R
    centre = float(vert[size // 2, size // 2]) if size % 2 else float(vert[size // 2 - 1 : size // 2 + 1, size // 2 - 1 : size // 2 + 1].mean())
    return vert, used, centre


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "data" / "lola")
    ap.add_argument("--out", type=Path, default=ROOT / "web" / "public" / "data" / "terrain")
    ap.add_argument("--sites", type=Path, default=ROOT / "web" / "public" / "data" / "sites.json")
    ap.add_argument("--size", type=int, default=256)
    ap.add_argument("--spacing", type=float, default=80.0)
    args = ap.parse_args()
    if not args.data.exists():
        raise SystemExit(f"no DEM dir {args.data}")
    args.out.mkdir(parents=True, exist_ok=True)
    sites = json.loads(args.sites.read_text())["sites"]
    for s in sites:
        if s["terrain"] not in DEMS or s["lat"] is None or s["lonE"] is None:
            continue
        res = tile(args.data, s, args.size, args.spacing)
        if res is None:
            print(f"{s['id']}: no DEM coverage, skipped")
            continue
        vert, used, centre = res
        lo, hi = float(vert.min()), float(vert.max())
        scale = max((hi - lo) / 65000.0, 0.01)
        offset = (hi + lo) / 2
        q = np.round((vert - offset) / scale).astype("<i2")
        (args.out / f"{s['id']}.bin").write_bytes(q.tobytes())
        meta = {
            "siteId": s["id"],
            "size": args.size,
            "spacingM": args.spacing,
            "scaleM": scale,
            "offsetM": offset,
            "minM": lo,
            "maxM": hi,
            "siteHeightM": centre,
            "layout": "row-major Int16 LE; row 0 = north edge, col 0 = west edge; site at the centre",
            "heights": "metres above the local tangent plane at the site (curvature applied)",
            "dem": used,
            "source": "LOLA LDEM_80S_80MPP_ADJ / LDEM_60S_240MPP_ADJ (PGDA)",
        }
        (args.out / f"{s['id']}.json").write_text(json.dumps(meta, indent=1) + "\n")
        print(f"{s['id']}: {'+'.join(used)} relief {hi - lo:.0f} m, scale {scale:.3f} m")


if __name__ == "__main__":
    main()
