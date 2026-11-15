"""Refine Earth-centre visibility windows from SPICE and a verified terrain mask.

All timestamps are UTC; numerical crossing tolerance does not express model accuracy.
"""

import math

import numpy as np


def windows(clearance, start, end, step=900, tolerance=1):
    """Find positive-clearance intervals in [start, end]. None means unknown coverage.

    Crossings are bracketed by the fixed sampling grid and bisected. A gap shorter than
    the step may be missed; no gaps are merged intentionally. Intervals are clipped at
    boundaries; an unknown sample invalidates the entire result.
    """
    if not (
        math.isfinite(start)
        and math.isfinite(end)
        and math.isfinite(step)
        and math.isfinite(tolerance)
        and end > start
        and step > 0
        and tolerance > 0
    ):
        raise ValueError("invalid range or resolution")
    grid = list(np.arange(start, end, step)) + [end]
    values = [clearance(t) for t in grid]
    if any(v is None or not math.isfinite(v) for v in values):
        return None
    out = []
    begin = start if values[0] > 0 else None
    for i in range(len(grid) - 1):
        left_on, right_on = values[i] > 0, values[i + 1] > 0
        if left_on == right_on:
            continue
        a, b = grid[i], grid[i + 1]
        while b - a > tolerance:
            mid = (a + b) / 2
            val = clearance(mid)
            if val is None or not math.isfinite(val):
                return None
            if (val > 0) == left_on:
                a = mid
            else:
                b = mid
        crossing = (a + b) / 2
        if right_on:
            begin = crossing
        else:
            out.append((begin, crossing))
            begin = None
    if begin is not None:
        out.append((begin, end))
    return out


def clearance_function(lon, lat, height, mask_az, mask_el):
    """SPICE apparent Earth elevation minus an interpolated horizon, degrees."""
    from .ephem import topo

    if not (np.all(np.isfinite(mask_az)) and np.all(np.isfinite(mask_el))):
        return lambda _et: None

    def clearance(et):
        az, el, _ = topo("EARTH", [et], lon, lat, height)
        return float(el[0] - np.interp(az[0], mask_az, mask_el, period=360))

    return clearance


def example(data, start_utc="2026-12-01T00:00:00", end_utc="2026-12-31T00:00:00", step=900):
    """Reproducible example: Shackleton ridge, 240 m LOLA, SPICE MOON_ME/LT+S."""
    from pathlib import Path

    import spiceypy as sp

    from .ephem import load_kernels, utc_to_et
    from .geo import Dem, Terrain, horizon_mask

    class CheckedTerrain(Terrain):
        missing = False

        def sample(self, x, y):
            result = super().sample(x, y)
            if not np.isfinite(result).all():
                self.missing = True
            return result

    load_kernels(Path(data) / "spice")
    try:
        terrain = CheckedTerrain(Dem(Path(data) / "lola/LDEM_60S_240MPP_ADJ.TIF"))
        az, el, ground = horizon_mask(terrain, 222.69, -89.45, h_obs=2.0, az_step=1.0)
        if terrain.missing:
            return None
        f = clearance_function(222.69, -89.45, ground + 2, az, el)
        start, end = utc_to_et(start_utc), utc_to_et(end_utc)
        result = windows(f, start, end, step=step)
        if result is None:
            return None
        return [(sp.et2utc(a, "ISOC", 0) + "Z", sp.et2utc(b, "ISOC", 0) + "Z") for a, b in result]
    finally:
        sp.kclear()


if __name__ == "__main__":
    import argparse
    import json

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, help="NASA data directory")
    parser.add_argument("--step", type=int, default=900, help="SPICE sampling step, seconds")
    args = parser.parse_args()
    print(json.dumps(example(args.data, step=args.step)))
