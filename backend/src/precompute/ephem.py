"""Sun and Earth seen from a lunar site: SPICE, frame MOON_ME, correction LT+S, time in UTC.

Traps (task/_arch/00b-probe.md): MOON_PA instead of MOON_ME costs 0.029 deg; no LT+S costs
0.006 deg; TDB - UTC = 69.18 s, so UTC goes in and out only through str2et/et2utc.
"""

from pathlib import Path

import numpy as np
import spiceypy as sp

from .geo import R, frame

KERNELS = [
    "naif0012.tls",
    "pck00011.tpc",
    "moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf",
    "de440s.bsp",
    "earth_2026_260806_2126_predict.bpc",
]
FRAME = "MOON_ME"
ABCORR = "LT+S"


def load_kernels(spice_dir: Path) -> None:
    for k in KERNELS:
        sp.furnsh(str(Path(spice_dir) / k))


def utc_to_et(utc: str) -> float:
    return sp.str2et(utc)


def topo(target, ets, lon_e, lat, h=0.0, frame_name=FRAME, abcorr=ABCORR):
    """Azimuth (from north to east), elevation and angular radius (deg) of a body.

    h is the observer height above the sphere R in metres.
    """
    up, east, north = frame(lon_e, lat)
    obs = up * (R + h) / 1000.0
    rad = sp.bodvrd(target, "RADII", 3)[1][0]
    v = np.array(
        [
            sp.spkcpo(target, et, frame_name, "OBSERVER", abcorr, obs, "MOON", frame_name)[0][:3]
            for et in np.atleast_1d(ets)
        ]
    )
    dist = np.linalg.norm(v, axis=1)
    az = np.degrees(np.arctan2(v @ east, v @ north)) % 360
    el = np.degrees(np.arcsin((v @ up) / dist))
    return az, el, np.degrees(np.arcsin(rad / dist))
