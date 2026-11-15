"""BETA (#187): Sun and Earth light across a landing ellipse, not only at the aim point.

Run from backend/:

    uv run python -m precompute.beta_ellipse --data <nasa data dir> --out ../web/public/data/beta/ellipse.json

Source: PGDA 69 AVGVISIB 85S 60 m maps (18.6-year mean visible Sun disc and Earth visibility,
share 0..1). Not for a date. Per site and radius (100 m, 500 m, 1 km) the disc around the aim
point is sampled on a 30 m grid (nearest 60 m pixel). Output per quantity: value at the aim
pixel, 10th percentile of the area (the worst 10 % of the area gets this much or less), and the
share of area with >= 40 % (Sun) / >= 40 % (Earth). Sites whose disc leaves the map or touches
NoData get no entry for that radius. Removable: delete web/src/beta/ellipse and this file.
"""

import argparse
import json
from pathlib import Path

import numpy as np

R = 1737400.0
RADII_M = (100, 500, 1000)
STEP_M = 30.0
THRESHOLD_PCT = 40.0
SUN_FILE = "illum/AVGVISIB_85S_060M_201608.TIF"
EARTH_FILE = "illum/AVGVISIB_85S_060M_201608_EARTH.TIF"


def polar_xy(lat: float, lon_e: float) -> tuple[float, float]:
    """South polar stereographic, metres (the PGDA 69 grid)."""
    k = 2 * R * np.tan(np.pi / 4 + np.radians(lat) / 2)
    return float(k * np.sin(np.radians(lon_e))), float(k * np.cos(np.radians(lon_e)))


def disc_offsets(radius_m: float) -> tuple[np.ndarray, np.ndarray]:
    g = np.arange(-radius_m, radius_m + 1, STEP_M)
    x, y = np.meshgrid(g, g)
    inside = x**2 + y**2 <= radius_m**2
    return x[inside], y[inside]


def stats(values: np.ndarray, aim: float) -> dict:
    return {
        "aim": round(float(aim), 1),
        "p10": round(float(np.percentile(values, 10)), 1),
        "shareGe40": round(float(np.mean(values >= THRESHOLD_PCT) * 100), 1),
    }


def site_stats(
    sun_ds, earth_ds, sun, earth, x: float, y: float, scale: tuple[float, float], nodata
) -> dict:
    out = {}
    for radius in RADII_M:
        dx, dy = disc_offsets(radius)
        col, row = (~sun_ds.transform) * (x + dx, y + dy)
        col, row = col.astype(int), row.astype(int)
        if not ((row >= 0) & (row < sun.shape[0]) & (col >= 0) & (col < sun.shape[1])).all():
            continue
        raw_s, raw_e = sun[row, col], earth[row, col]
        if nodata is not None and ((raw_s == nodata) | (raw_e == nodata)).any():
            continue
        s_vals, e_vals = raw_s * scale[0] * 100, raw_e * scale[1] * 100
        c0, r0 = (~sun_ds.transform) * (x, y)
        aim_s, aim_e = (
            sun[int(r0), int(c0)] * scale[0] * 100,
            earth[int(r0), int(c0)] * scale[1] * 100,
        )
        out[str(radius)] = {
            "n": len(dx),
            "sun": stats(s_vals, aim_s),
            "earth": stats(e_vals, aim_e),
        }
    return out


def build(data: Path, sites: list[dict]) -> dict:
    import rasterio

    with rasterio.open(data / SUN_FILE) as sd, rasterio.open(data / EARTH_FILE) as ed:
        sun, earth = sd.read(1), ed.read(1)
        scale = (sd.scales[0] or 1.0, ed.scales[0] or 1.0)
        result = {}
        for s in sites:
            if s.get("lat") is None or s.get("lonE") is None:
                continue
            x, y = polar_xy(s["lat"], s["lonE"])
            radii = site_stats(sd, ed, sun, earth, x, y, scale, sd.nodata)
            if radii:
                result[s["id"]] = radii
    return {
        "source": "PGDA 69 AVGVISIB 85S 60 m (18.6-year means)",
        "pixelM": 60,
        "sampleM": STEP_M,
        "thresholdPct": THRESHOLD_PCT,
        "radiiM": list(RADII_M),
        "sites": result,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=Path("../web/public/data/beta/ellipse.json"))
    ap.add_argument("--sites", type=Path, default=Path("../web/public/data/sites.json"))
    a = ap.parse_args()
    sites = json.loads(a.sites.read_text())["sites"]
    doc = build(a.data, sites)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    a.out.write_text(json.dumps(doc, separators=(",", ":")) + "\n")
    print(f"wrote {a.out}: {len(doc['sites'])} sites")


if __name__ == "__main__":
    main()
