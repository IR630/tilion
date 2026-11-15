"""Static assets for a custom point computed in the browser (#31, #100), and the Python reference for it.

Run from backend/:

    uv run python -m precompute.custom --data <nasa data dir> --out ../web/public/data \
        [--fixtures ../tests/fixtures/custom_reference.json]

Writes <out>/custom/ (format: CustomMeta in web/src/custom/assets.ts):
- meta.json   time grid, body radii, DEM tile grid;
- ephem.bin   float32 LE, n x [Sun x, y, z, Earth x, y, z] km: selenocentric apparent vectors,
              MOON_ME, LT+S, the hourly grid of the timelines (validation.body_vectors);
              topocentric = vector minus the observer position;
- dem240/<row>-<col>.bin  the whole LOLA 240 m DEM (7760 x 7760 px, +-931 km: 60-90 S and the
              corners to ~55 S) in square tiles of TILE_PX px, row 0 at the top (+y), col 0 at -x:
              int16 LE in 0.5 m, 2D differences inside the tile (value - left - up + up-left), gzip.
              The browser fetches only the tiles its 300 km rays reach (web/src/custom/assets.ts).
--fixtures writes the reference mask and timeline events of REFERENCE_SITES, computed on the same
DEM (decoded from all the tiles). web/src/custom/horizon.test.ts compares the browser with it.
"""

import argparse
import gzip
import json
import shutil
from pathlib import Path

import numpy as np
import spiceypy as sp

from .__main__ import AZ_STEP, OBSERVER_M, START_UTC, STEP_MIN, epochs, site_timeline
from .ephem import load_kernels, topo
from .geo import Dem, Terrain, horizon_mask, to_xy, unit
from .validation import body_vectors
from .variants import flips

DEM_SOURCE = "LDEM_60S_240MPP_ADJ.TIF"
# int16 step; LOLA heights here are -9.1 .. +7.0 km. Against the float DEM, 0.5 m keeps the sunset
# count of 5 polar sites and the lit share within 0.2 pp; 1 m adds 5 false sunsets at the CR-1 ridge.
SCALE_M = 0.5
TILE_PX = 388  # 93 km; 7760 = 20 x 388
TILE_DIR = "dem240"
MIN_LAT = -60.0  # a custom point takes terrain south of it (the DEM coverage, 60-90 S)
# A ridge and a plain near the pole, a site at ~70 S, a point at 62 S whose rays leave the DEM
# (lon 0: the square edge is at 60 S), a site off the DEM (bare sphere).
REFERENCE_SITES = ("cr1_connecting_ridge", "a_slater_plain", "chandrayaan3", "edge_62s", "apollo16")
EXTRA_SITES = {"edge_62s": {"id": "edge_62s", "lat": -62.0, "lonE": 0.0}}
SAMPLE_EVERY = 97  # hours between the az/el samples in the fixture


def read_dem(path: Path) -> tuple[np.ndarray, float, float, float]:
    """The whole DEM: (heights in SCALE_M units, x0, y0 of the top-left corner, step m)."""
    import rasterio

    with rasterio.open(path) as ds:
        t = ds.transform
        a = ds.read(1).astype(np.float32) * (ds.scales[0] or 1.0) + (ds.offsets[0] or 0.0)
    if np.isnan(a).any():
        raise ValueError("holes in the DEM")
    q = np.round(a / SCALE_M)
    if np.abs(q).max() > np.iinfo(np.int16).max:
        raise ValueError("heights do not fit int16")
    return q.astype(np.int16), float(t.c), float(t.f), float(t.a)


def encode_dem(q: np.ndarray) -> bytes:
    # int16 wraps; the cumulative sums in decode_dem wrap back
    d = np.diff(np.diff(q, axis=1, prepend=np.int16(0)), axis=0, prepend=np.int16(0))
    return gzip.compress(d.astype("<i2").tobytes(), compresslevel=9, mtime=0)


def decode_dem(b: bytes, width: int) -> np.ndarray:
    d = np.frombuffer(gzip.decompress(b), "<i2").reshape(-1, width)
    return np.cumsum(np.cumsum(d, axis=0, dtype=np.int16), axis=1, dtype=np.int16)


def tile_name(row: int, col: int) -> str:
    return f"{TILE_DIR}/{row}-{col}.bin"


def encode_tiles(q: np.ndarray, px: int = TILE_PX) -> dict[str, bytes]:
    if q.shape[0] != q.shape[1] or q.shape[0] % px:
        raise ValueError(f"DEM {q.shape} is not a square of whole {px} px tiles")
    n = q.shape[0] // px
    return {
        tile_name(r, c): encode_dem(q[r * px : (r + 1) * px, c * px : (c + 1) * px])
        for r in range(n)
        for c in range(n)
    }


def decode_tiles(read, n: int, px: int = TILE_PX) -> np.ndarray:
    """The n x n tile mosaic; read(name) -> bytes of the tile."""
    q = np.empty((n * px, n * px), np.int16)
    for r in range(n):
        for c in range(n):
            q[r * px : (r + 1) * px, c * px : (c + 1) * px] = decode_dem(read(tile_name(r, c)), px)
    return q


class ArrayDem(Dem):
    """geo.Dem over the browser's DEM grid instead of a GeoTIFF (same bilinear sample)."""

    def __init__(self, q: np.ndarray, x0: float, y0: float, step: float):
        self.a = q.astype(np.float32) * np.float32(SCALE_M)
        self.x0, self.y0, self.dx, self.dy = x0, y0, step, -step


def load_assets(out: Path) -> tuple[dict, ArrayDem]:
    meta = json.loads((out / "custom" / "meta.json").read_text())
    g = meta["dem"]
    q = decode_tiles(lambda f: (out / "custom" / f).read_bytes(), g["tiles"], g["tilePx"])
    return meta, ArrayDem(q, g["x0"], g["y0"], g["dx"])


def write_assets(data: Path, out: Path, ets: np.ndarray) -> None:
    d = out / "custom"
    d.mkdir(parents=True, exist_ok=True)
    vecs = np.stack([body_vectors("SUN", ets), body_vectors("EARTH", ets)], axis=1)
    (d / "ephem.bin").write_bytes(vecs.astype("<f4").tobytes())
    q, x0, y0, step = read_dem(data / "lola" / DEM_SOURCE)
    for f in d.glob("dem240-*.bin"):  # D-009 row bands
        f.unlink()
    shutil.rmtree(d / TILE_DIR, ignore_errors=True)
    (d / TILE_DIR).mkdir()
    for name, b in encode_tiles(q).items():
        (d / name).write_bytes(b)
    meta = {
        "startUtc": START_UTC,
        "stepMin": STEP_MIN,
        "n": len(ets),
        "frame": "MOON_ME",
        "abcorr": "LT+S",
        "ephemFile": "ephem.bin",
        "sunRadiusKm": float(sp.bodvrd("SUN", "RADII", 3)[1][0]),
        "earthRadiusKm": float(sp.bodvrd("EARTH", "RADII", 3)[1][0]),
        "dem": {
            "dir": TILE_DIR + "/",
            "tilePx": TILE_PX,
            "tiles": q.shape[0] // TILE_PX,
            "minLat": MIN_LAT,
            "source": DEM_SOURCE,
            "width": q.shape[1],
            "height": q.shape[0],
            "x0": x0,
            "y0": y0,
            "dx": step,
            "dy": -step,
            "scaleM": SCALE_M,
        },
    }
    (d / "meta.json").write_text(json.dumps(meta, indent=1) + "\n", newline="\n")


def reference(site: dict, dem: ArrayDem, ets: np.ndarray) -> dict:
    """App mask and timeline of a site on the browser DEM, reduced to what the web test compares."""
    lon, lat = site["lonE"], site["lat"]
    inside = lat <= MIN_LAT and not np.isnan(dem.sample(*to_xy(unit(lon, lat))))
    if inside:
        _, el, h0 = horizon_mask(Terrain(dem), lon, lat, OBSERVER_M, AZ_STEP)
    else:
        el, h0 = np.zeros(int(360 / AZ_STEP)), 0.0
    mask = {
        "siteId": site["id"],
        "observerHeightM": OBSERVER_M,
        "terrain": "polar240" if inside else "none",
        "azStepDeg": AZ_STEP,
        "elevDeg": [round(float(v), 2) for v in el],
    }
    tl = site_timeline(site, mask, h0, ets)
    k = ets[::SAMPLE_EVERY]
    saz, sel, _ = topo("SUN", k, lon, lat, h0 + OBSERVER_M)
    eaz, eel, _ = topo("EARTH", k, lon, lat, h0 + OBSERVER_M)
    sun = np.array(tl["sunVisible"])

    def r4(a):
        return [round(float(v), 4) for v in a]

    return {
        "id": site["id"],
        "lat": lat,
        "lonE": lon,
        "terrain": mask["terrain"],
        "h0": round(float(h0), 3),
        "elevDeg": r4(el),
        "sunLitFlips": flips(sun > 0),
        "earthFlips": flips(np.array(tl["earthVisible"]) > 0),
        "sunVisibleMean": round(float(sun.mean()), 6),
        "sampleEvery": SAMPLE_EVERY,
        "sunAz": r4(saz),
        "sunEl": r4(sel),
        "earthAz": r4(eaz),
        "earthEl": r4(eel),
    }


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="precompute.custom", description=__doc__.splitlines()[0])
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--fixtures", type=Path, help="write the Python reference for the web test")
    a = p.parse_args(argv)

    load_kernels(a.data / "spice")
    ets = epochs()
    write_assets(a.data, a.out, ets)
    d = a.out / "custom"
    for f in sorted(d.iterdir()):
        if f.is_file():
            print(f"{f.name:12s} {f.stat().st_size / 1e6:6.2f} MB")
    sizes = np.array([f.stat().st_size for f in (d / TILE_DIR).iterdir()]) / 1e6
    print(f"{TILE_DIR}/ {len(sizes)} tiles {sizes.sum():6.2f} MB, max {sizes.max():.3f} MB")
    if a.fixtures:
        _, dem = load_assets(a.out)
        sites = {s["id"]: s for s in json.loads((a.out / "sites.json").read_text())["sites"]}
        sites.update(EXTRA_SITES)
        refs = [reference(sites[i], dem, ets) for i in REFERENCE_SITES]
        a.fixtures.parent.mkdir(parents=True, exist_ok=True)
        a.fixtures.write_text(json.dumps({"sites": refs}, separators=(",", ":")))
        for r in refs:
            print(f"{r['id']:24s} {r['terrain']:8s} h0={r['h0']:8.1f} m")
    sp.kclear()


if __name__ == "__main__":
    main()
