"""Distance and rise of each horizon-defining terrain point, using geo.horizon_mask rays."""

import argparse
import json
from pathlib import Path

import numpy as np

from .geo import FINE_DEM, Dem, R, distances, frame, to_xy


def horizon_peaks(terrain, lon_e, lat, h_obs=2.0, az_step=0.5, max_m=300e3):
    """Peak elevation (deg), arc distance (m) and ground height (m) per azimuth, plus the site height.

    Same ray loop as geo.horizon_mask; test_blocker.py checks that the peak elevations match.
    """
    up, east, north = frame(lon_e, lat)
    h0 = float(terrain.sample(*to_xy(up)))
    if np.isnan(h0):
        raise ValueError(f"no DEM under the site {lon_e}E {lat}")
    ro = R + h0 + h_obs
    az = np.arange(0.0, 360.0, az_step)
    d = distances(terrain.step / 2, max_m)
    psi = d / R
    a = np.radians(az)[:, None, None]
    direction = np.cos(a) * north + np.sin(a) * east
    p = np.cos(psi)[None, :, None] * up + np.sin(psi)[None, :, None] * direction
    height = terrain.sample(*to_xy(p))
    rq = R + height
    vert = rq * np.cos(psi) - ro
    dist = np.sqrt(rq**2 + ro**2 - 2 * rq * ro * np.cos(psi))
    el = np.degrees(np.arcsin(vert / dist))
    el = np.where(np.isnan(el), -90.0, el)
    peak = el.argmax(axis=1)
    rows = np.arange(len(az))
    return el[rows, peak], d[peak], height[rows, peak], h0


def horizon_blocker(terrain, lon_e, lat, h_obs=2.0, az_step=0.5, max_m=300e3):
    """Surface arc distance and ground rise above the site at each horizon maximum (metres)."""
    _, dist, height, h0 = horizon_peaks(terrain, lon_e, lat, h_obs, az_step, max_m)
    return {
        "azStepDeg": az_step,
        "distM": np.rint(dist).astype(int).tolist(),
        "riseM": np.rint(height - h0).astype(int).tolist(),
    }


def run(data: Path, out: Path, fine=FINE_DEM, only=""):
    from .__main__ import site_terrain

    sites = json.loads((out / "sites.json").read_text())["sites"]
    ids = set(filter(None, only.split(",")))
    sites = [
        s
        for s in sites
        if s["terrain"] != "none" and s["lat"] is not None and (not ids or s["id"] in ids)
    ]
    dems = {"fine": fine}
    need = {s["terrain"] for s in sites}
    if "polar80" in need:
        dems["polar80"] = Dem(data / "lola" / "LDEM_80S_80MPP_ADJ.TIF")
    if need & {"polar80", "polar240"}:
        dems["polar240"] = Dem(data / "lola" / "LDEM_60S_240MPP_ADJ.TIF")
    (out / "blocker").mkdir(parents=True, exist_ok=True)
    for site in sites:
        result = {
            "siteId": site["id"],
            **horizon_blocker(site_terrain(site, dems), site["lonE"], site["lat"]),
        }
        (out / "blocker" / f"{site['id']}.json").write_text(
            json.dumps(result, separators=(",", ":"))
        )
        print(f"{site['id']}: {len(result['distM'])} horizon points", flush=True)


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--fine", default=FINE_DEM)
    a = p.parse_args(argv)
    run(a.data, a.out, a.fine)


if __name__ == "__main__":
    main()
