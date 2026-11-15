"""Slope inside a notional landing ellipse: share of area at or under a slope threshold.

Run from backend/:

    uv run python -m precompute.ellipse --data <nasa data dir>

Slope: central difference over 2 pixels on each axis (baseline 2 x pixel, 10 m on the 5 m DEM),
slope = atan(hypot(dz/dx, dz/dy)) in degrees. This reproduces the PGDA 78 slope map
(Site01_final_adj_5mpp_slp.tif) exactly on the same grid. The grid is south polar stereographic;
its scale factor near the pole differs from 1 by < 1e-4 and is ignored.

Each point of the ellipse falls in exactly one class:
- unknown: outside the DEM tile, or in its edge band where the baseline does not fit;
- nodata:  inside the tile, but a DEM pixel on the baseline is NoData (never treated as flat);
- meets / fails: slope <= threshold / slope > threshold.

The result is a share of area by the chosen slope criterion. It is not a probability of
success and not a safety certification: boulders, guidance and landing dynamics are not assessed.
"""

import json
from pathlib import Path

import numpy as np

from . import geo

LOCAL_FILE = "lola5/Site01_final_adj_5mpp_surf.tif"  # PGDA 78 Site01 LDEM, under the data dir
SLOPE_FILE = "lola5/Site01_final_adj_5mpp_slp.tif"  # PGDA 78 Site01 slope map (degrees)
SLOPE_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_slp.tif"
SITE_ID = "cr1_connecting_ridge"
SITES_JSON = Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "sites.json"
NOTE = (
    "Share of area meeting the chosen slope criterion - not a probability of success or a safety "
    "certification; boulders, guidance and landing dynamics not assessed."
)


def slope_deg(z: np.ndarray, step_m: float, k: int = 1) -> np.ndarray:
    """Slope (deg) by central difference over 2k pixels (baseline 2k * step_m). NaN at the edge band and next to NoData."""
    if k < 1 or step_m <= 0:
        raise ValueError(f"need k >= 1 and step_m > 0, got k={k}, step_m={step_m}")
    z = np.asarray(z, dtype=np.float64)
    gx = np.full(z.shape, np.nan)
    gy = np.full(z.shape, np.nan)
    gx[:, k:-k] = (z[:, 2 * k :] - z[:, : -2 * k]) / (2 * k * step_m)
    gy[k:-k, :] = (z[2 * k :, :] - z[: -2 * k, :]) / (2 * k * step_m)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def ellipse_points(cx, cy, a_m, b_m, azimuth_deg, spacing_m):
    """Regular grid of points (x, y) inside the ellipse; each point stands for an equal area.

    a_m is the semi-axis along azimuth_deg, b_m across it. Azimuth is clockwise from local north
    at the centre (north = towards higher latitude = away from the south pole).
    """
    r = float(np.hypot(cx, cy))
    if r == 0:
        raise ValueError("azimuth is undefined at the pole")
    north = np.array([-cx, -cy]) / r
    east = np.array([cy, -cx]) / r
    t = np.radians(azimuth_deg)
    along = np.cos(t) * north + np.sin(t) * east
    across = np.array([-along[1], along[0]])
    u = np.arange(-a_m + spacing_m / 2, a_m, spacing_m)
    v = np.arange(-b_m + spacing_m / 2, b_m, spacing_m)
    uu, vv = np.meshgrid(u, v)
    keep = (uu / a_m) ** 2 + (vv / b_m) ** 2 <= 1.0
    uu, vv = uu[keep], vv[keep]
    return cx + uu * along[0] + vv * across[0], cy + uu * along[1] + vv * across[1]


def area_shares(dem, cx, cy, a_m, b_m, azimuth_deg, thresholds, k: int = 1) -> dict:
    """Shares of the ellipse area: unknown, nodata, and meets/fails for each slope threshold (deg).

    dem: geo.Dem (or any object with a, x0, y0, dx, dy). Centre cx, cy and semi-axes in metres.
    """
    thresholds = [float(t) for t in np.atleast_1d(thresholds)]
    vals = (cx, cy, a_m, b_m, azimuth_deg, *thresholds)
    if not thresholds or not all(np.isfinite(v) for v in vals):
        raise ValueError(
            "centre, axes, azimuth and thresholds must be finite; at least one threshold"
        )
    if a_m <= 0 or b_m <= 0:
        raise ValueError(f"semi-axes must be > 0 m, got {a_m}, {b_m}")
    if any(not 0.0 <= t < 90.0 for t in thresholds):
        raise ValueError(f"slope thresholds must be in [0, 90) deg, got {thresholds}")
    step = abs(dem.dx)
    baseline = 2 * k * step
    if min(a_m, b_m) < baseline:
        raise ValueError(
            f"ellipse semi-axis below the slope baseline {baseline:g} m: DEM too coarse"
        )
    x, y = ellipse_points(cx, cy, a_m, b_m, azimuth_deg, step / 2)
    ny, nx = dem.a.shape
    c = np.floor((x - dem.x0) / dem.dx).astype(int)
    r = np.floor((y - dem.y0) / dem.dy).astype(int)
    known = (c >= k) & (c < nx - k) & (r >= k) & (r < ny - k)
    s = np.full(x.shape, np.nan)
    if known.any():  # slope only on the window the ellipse touches
        r0, r1 = r[known].min() - k, r[known].max() + k + 1
        c0, c1 = c[known].min() - k, c[known].max() + k + 1
        win = slope_deg(dem.a[r0:r1, c0:c1], step, k)
        s[known] = win[r[known] - r0, c[known] - c0]
    n = x.size
    nodata = known & np.isnan(s)
    ok = known & ~nodata
    out = {
        "baselineM": baseline,
        "pixelM": step,
        "samples": int(n),
        "unknown": float((~known).sum() / n),
        "nodata": float(nodata.sum() / n),
        "thresholds": [],
    }
    for t in thresholds:
        meets = int((s[ok] <= t).sum())
        out["thresholds"].append(
            {"deg": t, "meets": meets / n, "fails": (int(ok.sum()) - meets) / n}
        )
    return out


def compare_slope(mine: np.ndarray, ref: np.ndarray) -> dict:
    """mine - ref (deg) where both are finite."""
    d = (np.asarray(mine, dtype=np.float64) - np.asarray(ref, dtype=np.float64)).ravel()
    d = d[np.isfinite(d)]
    return {
        "n": int(d.size),
        "medianDeg": float(np.median(d)),
        "rmsDeg": float(np.sqrt(np.mean(d**2))),
        "maxAbsDeg": float(np.abs(d).max()),
    }


def run(data: Path, a_m=1000.0, b_m=500.0, azimuth_deg=0.0, thresholds=(5.0, 10.0, 15.0)) -> dict:
    """Real check on PGDA 78 Site01: our slope vs the published slope map, and an example ellipse at cr1."""
    site = next(s for s in json.loads(SITES_JSON.read_text())["sites"] if s["id"] == SITE_ID)
    dem = geo.Dem(data / LOCAL_FILE)
    ref = geo.Dem(data / SLOPE_FILE)
    if (dem.a.shape, dem.x0, dem.y0, dem.dx, dem.dy) != (
        ref.a.shape,
        ref.x0,
        ref.y0,
        ref.dx,
        ref.dy,
    ):
        raise ValueError("slope map and LDEM are on different grids")
    mine = slope_deg(dem.a, abs(dem.dx))
    cx, cy = (float(v) for v in geo.to_xy(geo.unit(site["lonE"], site["lat"])))
    return {
        "site": site,
        "centre": (cx, cy),
        "ellipse": {"aM": a_m, "bM": b_m, "azimuthDeg": azimuth_deg},
        "slope": compare_slope(mine, ref.a),
        "slopeHorn": compare_slope(_horn(dem.a, abs(dem.dx)), ref.a),
        "shares": area_shares(dem, cx, cy, a_m, b_m, azimuth_deg, thresholds),
    }


def _horn(z, step):
    """Horn (1981) 3x3 slope (deg), only to show which method the PGDA map does not use."""
    p = np.pad(np.asarray(z, dtype=np.float64), 1, constant_values=np.nan)
    gx = (
        (p[:-2, 2:] + 2 * p[1:-1, 2:] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[1:-1, :-2] + p[2:, :-2])
    ) / (8 * step)
    gy = (
        (p[2:, :-2] + 2 * p[2:, 1:-1] + p[2:, 2:]) - (p[:-2, :-2] + 2 * p[:-2, 1:-1] + p[:-2, 2:])
    ) / (8 * step)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def main(argv=None) -> None:
    import argparse

    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--a", type=float, default=1000.0, help="semi-axis along azimuth, m")
    p.add_argument("--b", type=float, default=500.0, help="semi-axis across, m")
    p.add_argument("--azimuth", type=float, default=0.0, help="deg clockwise from local north")
    p.add_argument("--thresholds", type=float, nargs="+", default=[5.0, 10.0, 15.0])
    a = p.parse_args(argv)
    r = run(a.data, a.a, a.b, a.azimuth, a.thresholds)
    s, sh = r["site"], r["shares"]
    for k, label in (("slope", "central diff, 10 m"), ("slopeHorn", "Horn 3x3")):
        v = r[k]
        print(
            f"slope {label} vs PGDA 78 {SLOPE_URL.rsplit('/', 1)[1]} (n={v['n']}): median "
            f"{v['medianDeg']:+.4f} deg, RMS {v['rmsDeg']:.4f}, max |d| {v['maxAbsDeg']:.4f}"
        )
    e = r["ellipse"]
    print(
        f"ellipse at {s['id']} ({s['lat']}, {s['lonE']}E): a {e['aM']:g} m, b {e['bM']:g} m, "
        f"az {e['azimuthDeg']:g} deg; baseline {sh['baselineM']:g} m, {sh['samples']} samples"
    )
    print(f"  unknown {sh['unknown'] * 100:.2f} %, NoData {sh['nodata'] * 100:.2f} %")
    for t in sh["thresholds"]:
        print(
            f"  slope <= {t['deg']:g} deg: {t['meets'] * 100:.2f} % of area (above: {t['fails'] * 100:.2f} %)"
        )
    print(NOTE)


if __name__ == "__main__":
    main()
