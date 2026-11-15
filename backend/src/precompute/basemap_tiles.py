"""Tile pyramid for the polar map basemap (#149): LOLA shaded relief and the LROC WAC mosaic.

Run from backend/ (data: see data/README.md):

    uv run python -m precompute.basemap_tiles --data <repo>/data --out ../web/public/data \
        --hd-out <dir> [--layers relief,photo] [--tiers git,hd] [--jobs N]

Map frame (D-005): MapLibre lng/lat = south polar stereographic metres / 1e6, Web Mercator tiles
(XYZ, 256 px, row 0 of a tile = north = +y = 0 deg E side). Tile zoom Z has
360e6 / (256 * 2^Z) m per pixel: Z12 343 m, Z14 86 m, Z16 21 m, Z17 11 m, Z18 5.4 m.

Two tiers (TIERS):
- git: small low-zoom pyramid in web/public/data/basemap/tiles/<layer>/ for `make demo` and e2e.
  Its sets go to basemap/meta.json, key "tiles".
- hd: deep zooms at full resolution for the VPS path /hd/basemap/ (outside git). Its sets go to
  <hd-out>/basemap/manifest.json; the map adds them when the manifest loads.

Relief: every tile blends all LOLA DEMs that cover it, coarse to fine (240 m, 80 m, 20 m, 10 m,
5 m PGDA 78 sites), each read at about the tile pixel size; a finer DEM fades in over FEATHER_PX
pixels from its edge, so zoom levels and coverage borders have no seams. Shading: the
multi-directional hillshade of the site insets (inset.py) with one fixed grey scale for all tiles.
Photo: LROC WAC south polar mosaic 100 m, fixed grey stretch.
"""

import argparse
import json
import math
import os
import time
import warnings
from multiprocessing import Pool
from pathlib import Path

import numpy as np

from .inset import VERTICAL_EXAGGERATION, hillshade

TILE = 256
MAP_SCALE = 1e6  # metres per map degree (D-005)
FEATHER_PX = 24  # a finer DEM fades in over this many tile pixels from its edge
FINEST_READ = 8  # a source finer than pixel / FINEST_READ adds nothing to the tile: not read
WEBP_QUALITY = 78
# Fixed grey scale (no per-tile stretch: tiles must match at the seams). A flat floor shades
# sin(40 deg) = 0.64; crater walls spread around it.
SHADE_LO, SHADE_HI = 0.15, 0.85
# Vertical exaggeration: x2 at coarse pixels (as the previous relief images), x1 at <= 40 m, where
# x2 turns every steep polar crater wall black.
VE_COARSE, VE_FINE, VE_FINE_PX, VE_COARSE_PX = 2.0, 1.0, 40.0, 300.0
# Height tint range, m. LOLA 60S 240 m spans -6935..3932 m at 1..99 % (rasterio, 4x average);
# the floors of the deepest craters saturate dark.
HEIGHT_LO, HEIGHT_HI = -5000.0, 4000.0
TINT = np.array([0.80, 0.87, 1.0])  # cool grey-blue, as the previous relief images (#94)
# WAC I/F -> grey 0..255. A Z9 tile near the pole: 95 % at 0.081, 99 % at 0.113.
PHOTO_LO, PHOTO_HI = 0.0, 0.09

LOLA = "https://pgda.gsfc.nasa.gov/products/90"
PGDA78 = "https://pgda.gsfc.nasa.gov/products/78"
WAC = "https://wms.lroc.asu.edu/lroc/view_rdr_product/WAC_GLOBAL_P900S0000_100M"

# Relief sources, coarse first: (file under data/, resolution m, label, product page).
RELIEF = [
    ("lola/LDEM_60S_240MPP_ADJ.TIF", 240, "LOLA 240 m", LOLA),
    ("lola/LDEM_80S_80MPP_ADJ.TIF", 80, "LOLA 80 m", LOLA),
    ("lola/LDEM_80S_20MPP_ADJ.TIF", 20, "LOLA 20 m", LOLA),
    ("lola/LDEM_83S_10MPP_ADJ.TIF", 10, "LOLA 10 m", LOLA),
]
SITES5 = ["Site01", "Site04", "Site06", "Site07", "Site11", "Site20", "Site23", "DM2"]
SITES5 += ["Haworth", "Shoemaker"]
RELIEF += [(f"lola5/{s}_final_adj_5mpp_surf.tif", 5, "LOLA 5 m", PGDA78) for s in SITES5]
PHOTO = [("lroc/WAC_GLOBAL_P900S0000_100M.IMG", 100, "LROC WAC 100 m", WAC)]
LAYERS = {"relief": RELIEF, "photo": PHOTO}

# Which tiles exist: (layer, tier, source resolution m that sets the bounds, zmin, zmax).
# A set covers the bounds of every source of that resolution (one set per source file).
TIERS = [
    ("relief", "git", 240, 7, 12),
    ("relief", "git", 80, 13, 14),
    ("relief", "git", 20, 15, 16),
    ("relief", "hd", 10, 17, 17),
    ("relief", "hd", 5, 17, 18),
    ("photo", "git", 100, 7, 13),
    ("photo", "hd", 100, 14, 14),
]


# --- tile geometry (pure) ---------------------------------------------------------------------


def pixel_xy(z: int, tx: int, ty: int, pad: int = 0) -> tuple[np.ndarray, np.ndarray]:
    """Stereographic x (columns) and y (rows) in metres of the pixel centres of tile z/tx/ty.

    pad adds pixels on every side (for gradients). Rows use the exact inverse Mercator.
    """
    world = TILE * 2**z
    i = np.arange(-pad, TILE + pad) + 0.5
    lng = (tx * TILE + i) / world * 360.0 - 180.0
    merc = math.pi * (1 - 2 * (ty * TILE + i) / world)
    lat = np.degrees(np.arctan(np.sinh(merc)))
    return lng * MAP_SCALE, lat * MAP_SCALE


def pixel_m(z: int) -> float:
    """Tile pixel size in metres at zoom z (map degrees are 1e6 m; Mercator scale ~1 here)."""
    return 360.0 * MAP_SCALE / (TILE * 2**z)


def _merc_y(lat_deg: float) -> float:
    s = math.sin(math.radians(lat_deg))
    return 0.5 - 0.25 * math.log((1 + s) / (1 - s)) / math.pi


def tile_range(bounds: list[float], z: int) -> tuple[range, range]:
    """Tile columns and rows that MapLibre requests for a source with these bounds (metres).

    The same rule as MapLibre TileBounds.contains: floor of the west/north edge, ceil (exclusive)
    of the east/south edge.
    """
    x0, y0, x1, y1 = (v / MAP_SCALE for v in bounds)
    n = 2**z
    cols = range(math.floor((x0 + 180) / 360 * n), math.ceil((x1 + 180) / 360 * n))
    rows = range(math.floor(_merc_y(y1) * n), math.ceil(_merc_y(y0) * n))
    return cols, rows


# --- sampling and compositing ---------------------------------------------------------------


_open: dict = {}


def _ds(path: str):
    import rasterio

    if path not in _open:
        _open[path] = rasterio.open(path)
    return _open[path]


def close_all() -> None:
    for ds in _open.values():
        ds.close()
    _open.clear()


def read_at(path: str, xs: np.ndarray, ys: np.ndarray, px: float) -> np.ndarray:
    """Source values at the grid xs (columns) x ys (rows), metres; area average to ~px, then
    bilinear. NaN outside the source or at its no-data value."""
    from rasterio.enums import Resampling
    from rasterio.windows import Window

    ds = _ds(path)
    t = ds.transform
    res = t.a
    step = max(1.0, px / res)  # source pixels per read pixel
    c = (xs - t.c) / res  # fractional source column of every grid column
    r = (t.f - ys) / res
    c0 = max(math.floor(c.min() - 2 * step), 0)
    c1 = min(math.ceil(c.max() + 2 * step), ds.width)
    r0 = max(math.floor(r.min() - 2 * step), 0)
    r1 = min(math.ceil(r.max() + 2 * step), ds.height)
    out = np.full((len(ys), len(xs)), np.nan, np.float32)
    if c1 - c0 < 2 or r1 - r0 < 2:
        return out
    w, h = c1 - c0, r1 - r0
    ow, oh = max(2, round(w / step)), max(2, round(h / step))
    a = ds.read(
        1,
        window=Window(c0, r0, w, h),
        out_shape=(oh, ow),
        resampling=Resampling.average,
        masked=True,
    )
    a = a.astype(np.float32).filled(np.nan) * (ds.scales[0] or 1.0) + (ds.offsets[0] or 0.0)
    a[a < -1e30] = np.nan  # PDS null values (WAC CORE_NULL) that GDAL does not mask
    # Read-grid coordinates of the tile pixels: read pixel k spans source [k*sx, (k+1)*sx).
    gc = (c - c0) / (w / ow) - 0.5
    gr = (r - r0) / (h / oh) - 0.5
    ci = np.clip(np.floor(gc).astype(int), 0, ow - 2)
    ri = np.clip(np.floor(gr).astype(int), 0, oh - 2)
    fc = np.clip(gc - ci, 0, 1)[None, :]
    fr = np.clip(gr - ri, 0, 1)[:, None]
    ci, ri = ci[None, :], ri[:, None]
    v = (
        a[ri, ci] * (1 - fc) * (1 - fr)
        + a[ri, ci + 1] * fc * (1 - fr)
        + a[ri + 1, ci] * (1 - fc) * fr
        + a[ri + 1, ci + 1] * fc * fr
    )
    inside = ((gc >= -0.5) & (gc <= ow - 0.5))[None, :] & ((gr >= -0.5) & (gr <= oh - 0.5))[:, None]
    out[inside] = v[inside]
    return out


def feather(xs: np.ndarray, ys: np.ndarray, bounds: list[float], width_m: float) -> np.ndarray:
    """Weight 0 at the source edge, 1 at width_m inside (smoothstep)."""
    x0, y0, x1, y1 = bounds
    dx = np.minimum(xs - x0, x1 - xs)[None, :]
    dy = np.minimum(ys - y0, y1 - ys)[:, None]
    t = np.clip(np.minimum(dx, dy) / width_m, 0, 1)
    return t * t * (3 - 2 * t)


def composite(srcs: list[dict], xs: np.ndarray, ys: np.ndarray, px: float) -> np.ndarray:
    """Blend the sources that cover the grid, finest on top; NaN where none has data."""
    z = np.zeros((len(ys), len(xs)), np.float64)
    rest = np.ones_like(z)  # weight still free for coarser sources
    gx0, gx1, gy0, gy1 = xs.min(), xs.max(), ys.min(), ys.max()
    coarsest = max(s["res"] for s in srcs)
    for s in sorted(srcs, key=lambda s: s["res"]):
        if s["res"] < px / FINEST_READ and s["res"] < coarsest:
            continue
        x0, y0, x1, y1 = s["bounds"]
        if x1 <= gx0 or x0 >= gx1 or y1 <= gy0 or y0 >= gy1:
            continue
        v = read_at(s["path"], xs, ys, px)
        w = feather(xs, ys, s["bounds"], FEATHER_PX * px) * np.isfinite(v)
        z += np.nan_to_num(v) * w * rest
        rest *= 1 - w
        if rest.max() < 1e-6:
            break
    filled = 1 - rest
    return np.where(filled > 1e-6, z / np.maximum(filled, 1e-6), np.nan)


def exaggeration(px: float) -> float:
    t = np.clip(np.log(px / VE_FINE_PX) / np.log(VE_COARSE_PX / VE_FINE_PX), 0, 1)
    return float(VE_FINE + (VE_COARSE - VE_FINE) * t)


def relief_rgb(z: np.ndarray, px: float) -> np.ndarray:
    """Tinted hillshade, fixed scale. z: heights m (NaN filled with the mean before shading)."""
    z = np.where(np.isfinite(z), z, np.nanmean(z))
    k = exaggeration(px) / VERTICAL_EXAGGERATION  # inset.hillshade applies its own x2
    s = np.clip((hillshade(z * k, px) - SHADE_LO) / (SHADE_HI - SHADE_LO), 0, 1)
    h = np.clip((z - HEIGHT_LO) / (HEIGHT_HI - HEIGHT_LO), 0, 1)
    v = 0.05 + 0.62 * s**1.4 * (0.75 + 0.25 * h)
    return (np.clip(v[..., None] * TINT, 0, 1) * 255).round().astype(np.uint8)


def photo_rgb(v: np.ndarray) -> np.ndarray:
    g = np.clip((np.nan_to_num(v) - PHOTO_LO) / (PHOTO_HI - PHOTO_LO), 0, 1) ** (1 / 1.6)
    return np.repeat((g * 255).round().astype(np.uint8)[..., None], 3, axis=2)


def render(layer: str, srcs: list[dict], z: int, tx: int, ty: int) -> np.ndarray | None:
    """RGB tile (256 x 256 x 3), or None when no relief source has data there. A photo tile
    outside the WAC circle is black: MapLibre requests every tile in the set bounds."""
    px = pixel_m(z)
    pad = 1 if layer == "relief" else 0
    xs, ys = pixel_xy(z, tx, ty, pad)
    v = composite(srcs, xs, ys, px)
    if layer == "relief" and not np.isfinite(v).any():
        return None
    rgb = relief_rgb(v, px) if layer == "relief" else photo_rgb(v)
    return rgb[pad : pad + TILE, pad : pad + TILE]


def write_webp(rgb: np.ndarray, path: Path) -> None:
    import rasterio
    from rasterio.errors import NotGeoreferencedWarning

    path.parent.mkdir(parents=True, exist_ok=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)
        with rasterio.open(
            path, "w", driver="WEBP", width=TILE, height=TILE, count=3, dtype="uint8",
            QUALITY=WEBP_QUALITY,
        ) as ds:  # fmt: skip
            for b in range(3):
                ds.write(rgb[..., b], b + 1)


# --- plan and run -----------------------------------------------------------------------------


def sources(data: Path, layer: str) -> list[dict]:
    """Sources of a layer that exist under data/, with bounds read from the files."""
    import rasterio

    out = []
    for rel, res, label, page in LAYERS[layer]:
        p = data / rel
        if not p.exists():
            print(f"skip {rel}: not in {data} (bash scripts/fetch-data.sh)")
            continue
        with rasterio.open(p) as ds:
            b = ds.bounds
        out.append(
            {"path": str(p), "res": res, "label": label, "page": page, "file": Path(rel).name,
             "bounds": [b.left, b.bottom, b.right, b.top]}
        )  # fmt: skip
    return out


def plan(layer: str, tier: str, srcs: list[dict]) -> list[dict]:
    """Tile sets of one layer and tier: one per source file of the tier's resolution."""
    sets = []
    for lay, t, res, zmin, zmax in TIERS:
        if lay != layer or t != tier:
            continue
        for s in srcs:
            if s["res"] != res:
                continue
            name = s["file"].split("_final")[0] if res == 5 else f"{res}m"
            sets.append(
                {"id": f"{layer}-{name}-z{zmin}", "layer": layer, "minzoom": zmin, "maxzoom": zmax,
                 "bounds": [round(v, 1) for v in s["bounds"]], "resolutionM": res,
                 "source": f"{s['label']}, {s['file']}, {s['page']}"}
            )  # fmt: skip
    return sets


def tiles_of(sets: list[dict]) -> list[tuple[int, int, int]]:
    out = set()
    for s in sets:
        for z in range(s["minzoom"], s["maxzoom"] + 1):
            cols, rows = tile_range(s["bounds"], z)
            out.update((z, x, y) for x in cols for y in rows)
    return sorted(out)


_job: dict = {}


def _init(job: dict) -> None:
    os.environ.setdefault("GDAL_CACHEMAX", "256")
    _job.update(job)


def _one(t: tuple[int, int, int]) -> int:
    z, x, y = t
    path = Path(_job["dir"]) / f"{z}/{x}/{y}.webp"
    if path.exists() and not _job["force"]:
        return path.stat().st_size
    rgb = render(_job["layer"], _job["srcs"], z, x, y)
    if rgb is None:
        return 0
    write_webp(rgb, path)
    return path.stat().st_size


def run_tier(layer: str, tier: str, srcs: list[dict], tile_dir: Path, jobs: int, force: bool):
    sets = plan(layer, tier, srcs)
    tiles = tiles_of(sets)
    t0 = time.time()
    job = {"layer": layer, "srcs": srcs, "dir": str(tile_dir), "force": force}
    with Pool(jobs, initializer=_init, initargs=(job,)) as pool:
        sizes = list(pool.imap(_one, tiles, chunksize=8))
    empty = {t for t, n in zip(tiles, sizes, strict=True) if n == 0}
    mb = sum(sizes) / 1e6
    print(f"{layer}/{tier}: {len(tiles) - len(empty)} tiles, {mb:.1f} MB, {time.time() - t0:.0f} s")
    if empty:  # MapLibre would get 404: the set must not list them; report and keep going
        print(f"  {len(empty)} tiles without data (not written)")
    return sets


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True, help="web/public/data")
    ap.add_argument("--hd-out", type=Path, help="root of the /hd/ tier (outside git)")
    ap.add_argument("--layers", default="relief,photo")
    ap.add_argument("--tiers", default="git,hd")
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2) * 3 // 4))
    ap.add_argument("--force", action="store_true", help="rewrite existing tiles")
    a = ap.parse_args()
    tiers = a.tiers.split(",")
    git_sets, hd_sets = [], []
    for layer in a.layers.split(","):
        srcs = sources(a.data, layer)
        if "git" in tiers:
            d = a.out / "basemap" / "tiles" / layer
            for s in run_tier(layer, "git", srcs, d, a.jobs, a.force):
                git_sets.append({**s, "url": f"tiles/{layer}/{{z}}/{{x}}/{{y}}.webp"})
        if "hd" in tiers and a.hd_out:
            d = a.hd_out / "basemap" / layer
            for s in run_tier(layer, "hd", srcs, d, a.jobs, a.force):
                hd_sets.append({**s, "url": f"{layer}/{{z}}/{{x}}/{{y}}.webp"})
    note = "XYZ WebP 256 px; map lng/lat = polar stereographic metres / 1e6 (D-005); bounds in m"
    if git_sets:
        meta_path = a.out / "basemap" / "meta.json"
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {"layers": []}
        old = [s for s in meta.get("tiles", {}).get("sets", []) if s["layer"] not in a.layers]
        meta["tiles"] = {"tileSize": TILE, "note": note, "sets": old + git_sets}
        meta_path.write_text(json.dumps(meta, indent=1))
    if hd_sets:
        man_path = a.hd_out / "basemap" / "manifest.json"
        man = json.loads(man_path.read_text()) if man_path.exists() else {"sets": []}
        old = [s for s in man["sets"] if s["layer"] not in a.layers]
        man = {"tileSize": TILE, "note": note, "sets": old + hd_sets}
        man_path.write_text(json.dumps(man, indent=1))


if __name__ == "__main__":
    main()
