"""Sub-solar and sub-Earth points on the Moon for the Globe screen (#21).

Run from backend/:

    uv run python -m precompute.subpoints --data <nasa data dir> --out ../web/public/data

Hourly 2026-12-01T00:00Z .. 2028-01-01T00:00Z. Vector Moon centre -> body in MOON_ME, LT+S
(same kernels and corrections as ephem.py), as planetocentric latitude and longitude 0-360 E,
rounded to 0.01 deg. Earth distance (centre to centre) in km, rounded to 1 km.
Output: <out>/globe/subpoints.json.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import spiceypy as sp

from .ephem import ABCORR, FRAME, load_kernels, utc_to_et

START_UTC = "2026-12-01T00:00:00Z"
END_UTC = "2028-01-01T00:00:00Z"
STEP_MIN = 60


def subpoint(target: str, et: float) -> tuple[float, float, float]:
    """Latitude, longitude 0-360 E (deg) and distance (km) of a body over the Moon centre."""
    v = sp.spkpos(target, et, FRAME, ABCORR, "MOON")[0]
    dist, lon, lat = sp.reclat(v)
    return float(np.degrees(lat)), float(np.degrees(lon) % 360), float(dist)


def build(start_utc=START_UTC, end_utc=END_UTC, step_min=STEP_MIN) -> dict:
    e0, e1 = utc_to_et(start_utc.rstrip("Z")), utc_to_et(end_utc.rstrip("Z"))
    n = round((e1 - e0) / (step_min * 60.0)) + 1  # both ends, like the timelines
    ets = e0 + np.arange(n) * step_min * 60.0
    sun = np.array([subpoint("SUN", et) for et in ets])
    earth = np.array([subpoint("EARTH", et) for et in ets])

    def r2(a):
        return [round(float(v), 2) for v in a]

    return {
        "startUtc": start_utc,
        "stepMin": step_min,
        "n": len(ets),
        "frame": FRAME,
        "abcorr": ABCORR,
        "sunLat": r2(sun[:, 0]),
        "sunLonE": r2(sun[:, 1] % 360),
        "earthLat": r2(earth[:, 0]),
        "earthLonE": r2(earth[:, 1] % 360),
        "earthDistKm": [round(float(v)) for v in earth[:, 2]],
    }


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="precompute.subpoints", description=__doc__.splitlines()[0])
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args(argv)
    load_kernels(a.data / "spice")
    out = a.out / "globe"
    out.mkdir(parents=True, exist_ok=True)
    res = build()
    (out / "subpoints.json").write_text(json.dumps(res, separators=(",", ":")))
    print(f"subpoints: {res['n']} epochs -> {out / 'subpoints.json'}")


if __name__ == "__main__":
    main()
