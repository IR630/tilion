"""BETA dsnStations (#259): which DSN complex sees the Moon above 10 deg, hour by hour.

Run from backend/:

    uv run python -m precompute.beta_dsn_stations --data <nasa data dir> --out ../web/public/data

Writes beta/dsn_stations.json. Removable: the UI lives in web/src/beta/dsnStations/.

Method: the Earth-side geometry of dsn.py. Apparent Moon centre
elevation above the geodetic horizon of DSS-14 (Goldstone), DSS-63 (Madrid), DSS-43 (Canberra),
LT+S, no refraction; complex "in view" = elevation > 10 deg, the uplink limit (10.1 deg) of DSN
810-005 module 301P. Same hourly grid as the timelines (2026-12-01T00:00Z, 60 min).
The 26 GHz lunar K-band uses the 34 m antennas of the same complexes (DSS-24/26, DSS-34/36,
DSS-53/56; module 104Q). They stand within 10 km of the 70 m antennas: same geometry.
The Moon centre, not the site: the whole south polar region lies within ~0.5 deg of it from Earth.

Output (the beta UI is the only reader):
  {startUtc, stepMin, n, thresholdDeg, complexes: [{id, name, dss, dss34}], codes}
  codes: one char per step, a bit mask '0'..'7': bit 0 Goldstone, bit 1 Madrid, bit 2 Canberra.
  dsnVisible also requires the same station to clear the site's lunar terrain mask.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import spiceypy as sp

from .__main__ import END_UTC, START_UTC, STEP_MIN, epochs
from .dsn import STATIONS, station_elevation
from .ephem import load_kernels

OUT_REL = "beta/dsn_stations.json"
THRESHOLD_DEG = 10
COMPLEXES = (
    # id, name, 70 m antenna (geometry), 34 m K-band antennas (DSN 810-005 module 104Q)
    ("G", "Goldstone", "DSS-14", "DSS-24, DSS-26"),
    ("M", "Madrid", "DSS-63", "DSS-53, DSS-56"),
    ("C", "Canberra", "DSS-43", "DSS-34, DSS-36"),
)


def station_codes(ets, stations=STATIONS, threshold=THRESHOLD_DEG) -> str:
    """Bit mask per epoch: bit k set when station k sees the Moon centre above the threshold."""
    bits = np.zeros(len(ets), dtype=int)
    for k, s in enumerate(stations):
        bits |= (station_elevation(ets, s) > threshold).astype(int) << k
    return "".join(str(int(b)) for b in bits)


def build(ets) -> dict:
    return {
        "startUtc": START_UTC,
        "stepMin": STEP_MIN,
        "n": len(ets),
        "thresholdDeg": THRESHOLD_DEG,
        "complexes": [{"id": i, "name": n, "dss": d, "dss34": d34} for i, n, d, d34 in COMPLEXES],
        "codes": station_codes(ets),
    }


def main(argv=None) -> None:
    p = argparse.ArgumentParser(
        prog="precompute.beta_dsn_stations", description=__doc__.splitlines()[0]
    )
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    a = p.parse_args(argv)
    load_kernels(a.data / "spice")
    ets = epochs(START_UTC, END_UTC, STEP_MIN)
    doc = build(ets)
    sp.kclear()
    out = a.out / OUT_REL
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, separators=(",", ":")))
    codes = np.array([int(c) for c in doc["codes"]])
    for k, (_, name, *_r) in enumerate(COMPLEXES):
        print(f"{name:10s} {np.mean(codes >> k & 1):6.1%} of hours")
    print(
        f"any complex {np.mean(codes > 0):6.1%}, exactly one {np.mean(np.isin(codes, (1, 2, 4))):6.1%}"
    )


if __name__ == "__main__":
    main()
