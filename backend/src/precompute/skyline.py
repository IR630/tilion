"""Near / mid / full skyline per site (#334): horizon from terrain within 3 km, 30 km and 300 km.

Same rays, observer height and azimuth grid as mask/<id>.json (geo.ray_elevations), so full equals
the mask. Output: <out>/skyline/<id>.json for every site with terrain. Run from backend/:

    uv run python -m precompute.skyline --data <nasa data dir> --out ../web/public/data [--sites id,id]
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np

from .geo import FINE_DEM, Dem, ray_elevations

NEAR_M = 3000.0
MID_M = 30000.0


def skyline_layers(terrain, lon_e, lat, h_obs=2.0, az_step=0.5, max_m=300e3):
    """Horizon elevation (deg) per azimuth from samples within NEAR_M, MID_M and max_m of the site."""
    _, d, el, _ = ray_elevations(terrain, lon_e, lat, h_obs, az_step, max_m)
    return el[:, d <= NEAR_M].max(axis=1), el[:, d <= MID_M].max(axis=1), el.max(axis=1)


def run(data: Path, out: Path, fine=FINE_DEM, only=""):
    from .__main__ import AZ_STEP, OBSERVER_M, site_terrain

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
    (out / "skyline").mkdir(parents=True, exist_ok=True)
    for site in sites:
        t = time.time()
        terrain = site_terrain(site, dems)
        near, mid, full = skyline_layers(terrain, site["lonE"], site["lat"], OBSERVER_M, AZ_STEP)

        def r2(a):
            return [round(float(v), 2) for v in a]

        result = {
            "siteId": site["id"],
            "observerHeightM": OBSERVER_M,
            "azStepDeg": AZ_STEP,
            "nearM": NEAR_M,
            "midM": MID_M,
            "nearDeg": r2(near),
            "midDeg": r2(mid),
            "fullDeg": r2(full),
        }
        (out / "skyline" / f"{site['id']}.json").write_text(
            json.dumps(result, separators=(",", ":"))
        )
        far = np.mean(full > mid + 0.05)
        print(
            f"{site['id']:24s} far terrain sets {far:5.1%} of azimuths | {time.time() - t:4.1f} s",
            flush=True,
        )


def main(argv=None):
    p = argparse.ArgumentParser(prog="precompute.skyline", description=__doc__.splitlines()[0])
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--fine", default=FINE_DEM, help="LOLA 20 m DEM (local path or /vsicurl/ URL)")
    p.add_argument("--sites", default="", help="comma-separated site ids (default: all)")
    a = p.parse_args(argv)
    run(a.data, a.out, a.fine, a.sites)


if __name__ == "__main__":
    main()
