"""Close-up hillshade tiles for the map insets (issue #125, contract web/src/contracts.ts SiteInset).

For every site with terrain: a 5 x 5 km greyscale hillshade centred on the site, 512 px WebP, plus a
meta JSON. Output: <out>/inset/<id>.webp and <out>/inset/<id>.json.

Source: LOLA 20 m window over HTTP (D-008), 80 m, 240 m beyond its coverage (nested grid as the
horizon mask). The meta names the coarsest DEM that fills more than 1 % of the tile (`source`),
so a tile from the 80 m DEM never claims 20 m. If the 20 m server is down, the tile falls back to
80 m and says so.

Frame: south polar stereographic metres (D-005, geo.to_xy). Image row 0 = ymax (0 deg E side),
col 0 = xmin: the same layout as the basemap layers. Shading: multi-directional hillshade, no
Sun position (the tile is the same for every date).
"""

import json
from pathlib import Path

import numpy as np
from rasterio.errors import RasterioIOError

from .geo import FINE_DEM, FINE_HALF_M, Dem, fine_dem, to_xy, unit

TILE_M = 5000.0
SIZE_PX = 512
VERTICAL_EXAGGERATION = 2.0
SHADE_AZ_DEG = (225.0, 270.0, 315.0, 360.0)  # light directions, clockwise from the image top
SHADE_ALT_DEG = 40.0
WEBP_QUALITY = 82
MIN_SHARE = 0.01  # a DEM that fills less of the tile does not set the label


def tile_bounds(x: float, y: float, size_m: float = TILE_M) -> list[float]:
    """[xmin, ymin, xmax, ymax] in metres, tile centred on (x, y)."""
    h = size_m / 2
    return [x - h, y - h, x + h, y + h]


def resample(dem: Dem, bounds: list[float], size: int = SIZE_PX) -> np.ndarray:
    """DEM heights on the tile grid (size x size, row 0 = ymax), cubic spline, NaN without data."""
    from rasterio.crs import CRS
    from rasterio.transform import Affine
    from rasterio.warp import Resampling, reproject

    x0, y0, x1, y1 = bounds
    px = (x1 - x0) / size
    dst_t = Affine(px, 0.0, x0, 0.0, -px, y1)
    # Crop the source to the tile plus a margin: the big 80 m and 240 m rasters stay cheap.
    m = 4
    c0 = max(int(np.floor((x0 - dem.x0) / dem.dx)) - m, 0)
    c1 = min(int(np.ceil((x1 - dem.x0) / dem.dx)) + m, dem.a.shape[1])
    r0 = max(int(np.floor((y1 - dem.y0) / dem.dy)) - m, 0)
    r1 = min(int(np.ceil((y0 - dem.y0) / dem.dy)) + m, dem.a.shape[0])
    out = np.full((size, size), np.nan, np.float32)
    if c1 <= c0 or r1 <= r0:
        return out
    src = np.ascontiguousarray(dem.a[r0:r1, c0:c1])
    src_t = Affine(dem.dx, 0.0, dem.x0 + c0 * dem.dx, 0.0, dem.dy, dem.y0 + r0 * dem.dy)
    crs = CRS.from_epsg(3031)  # any CRS: source and target share it, nothing is reprojected
    reproject(
        src,
        out,
        src_transform=src_t,
        src_crs=crs,
        dst_transform=dst_t,
        dst_crs=crs,
        src_nodata=np.nan,
        dst_nodata=np.nan,
        resampling=Resampling.cubic_spline,
    )
    return out


def hillshade(z: np.ndarray, px_m: float) -> np.ndarray:
    """Multi-directional hillshade 0..1. Axes: columns = +x, rows = -y (north up in the image)."""
    gy, gx = np.gradient(z.astype(np.float64) * VERTICAL_EXAGGERATION, px_m)
    nx, ny, nz = gx, gy, np.ones_like(gx)  # surface normal (-dz/dx, -dz/dy_up, 1) = (-gx, gy, 1)
    norm = np.sqrt(nx**2 + ny**2 + nz**2)
    alt = np.radians(SHADE_ALT_DEG)
    shade = np.zeros_like(z, dtype=np.float64)
    for az in np.radians(SHADE_AZ_DEG):
        lx, ly, lz = np.sin(az) * np.cos(alt), np.cos(az) * np.cos(alt), np.sin(alt)
        shade += np.clip((-nx * lx + ny * ly + nz * lz) / norm, 0, 1)
    return shade / len(SHADE_AZ_DEG)


def to_grey(shade: np.ndarray) -> np.ndarray:
    """Stretch the 1..99 percentiles of a tile to 8 bit."""
    lo, hi = np.percentile(shade, [1, 99])
    return (np.clip((shade - lo) / max(hi - lo, 1e-6), 0, 1) * 255).round().astype(np.uint8)


def write_webp(grey: np.ndarray, path: Path) -> None:
    """Grey tile as WebP (GDAL writes RGB only: three equal bands)."""
    import warnings

    import rasterio
    from rasterio.errors import NotGeoreferencedWarning

    h, w = grey.shape
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)  # a picture, not a GeoTIFF
        with rasterio.open(
            path,
            "w",
            driver="WEBP",
            width=w,
            height=h,
            count=3,
            dtype="uint8",
            QUALITY=WEBP_QUALITY,
        ) as ds:
            for b in (1, 2, 3):
                ds.write(grey, b)


def build_tile(site: dict, dems: list[tuple[int, Dem]]) -> tuple[np.ndarray, dict]:
    """Greyscale tile and contract meta for one site. dems: (native resolution m, DEM), fine first."""
    x, y = (float(v) for v in to_xy(unit(site["lonE"], site["lat"])))
    bounds = tile_bounds(x, y)
    z = np.full((SIZE_PX, SIZE_PX), np.nan, np.float32)
    used = []
    for res, dem in dems:
        part = resample(dem, bounds)
        fill = np.isnan(z) & ~np.isnan(part)
        z[fill] = part[fill]
        if fill.mean() >= MIN_SHARE:
            used.append(res)
    if np.isnan(z).any():
        raise ValueError(
            f"{site['id']}: DEM does not cover the tile ({np.isnan(z).mean():.1%} empty)"
        )
    res = max(used)
    px = TILE_M / SIZE_PX
    meta = {
        "siteId": site["id"],
        "file": f"{site['id']}.webp",
        "bounds": bounds,
        "sizePx": SIZE_PX,
        "sizeM": TILE_M,
        "pixelM": px,
        "resolutionM": res,
        "source": f"LOLA {res} M",
        "shading": (
            f"multi-directional hillshade, Sun-independent, vertical x{VERTICAL_EXAGGERATION:g}"
        ),
        "layout": "row 0 = ymax (0 deg E side), col 0 = xmin; bounds in polar stereographic metres",
    }
    return to_grey(hillshade(z, px)), meta


def run(sites: list[dict], data: Path, out: Path, fine: Path | str = FINE_DEM) -> None:
    """Write inset/<id>.webp and inset/<id>.json for every site with terrain."""
    sites = [s for s in sites if s["lat"] is not None and s["terrain"] != "none"]
    dem80 = dem240 = None
    if any(s["terrain"] == "polar80" for s in sites):
        dem80 = Dem(data / "lola" / "LDEM_80S_80MPP_ADJ.TIF")
    if sites:
        dem240 = Dem(data / "lola" / "LDEM_60S_240MPP_ADJ.TIF")
    (out / "inset").mkdir(parents=True, exist_ok=True)
    for s in sites:
        dems = []
        if s["terrain"] == "polar80":
            try:
                dems.append((20, fine_dem(s["lonE"], s["lat"], fine, FINE_HALF_M)))
            except RasterioIOError as e:  # server down or file missing
                print(f"{s['id']}: LOLA 20 m window not read ({e}); 80 m tile")
            dems.append((80, dem80))
        dems.append((240, dem240))
        grey, meta = build_tile(s, dems)
        write_webp(grey, out / "inset" / meta["file"])
        (out / "inset" / f"{s['id']}.json").write_text(json.dumps(meta, indent=1))
        size = (out / "inset" / meta["file"]).stat().st_size
        print(f"{s['id']:24s} {meta['source']:12s} {size / 1024:5.1f} KB")
