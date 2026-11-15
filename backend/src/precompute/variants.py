"""Measured spread (decision Q8): visibility under observer height 0/2/10 m x DEM variants.

Run from backend/ after the main precompute (needs <out>/sites.json):

    uv run python -m precompute.variants --data <nasa data dir> --out ../web/public/data [--sites id,id]

Output <out>/variants/<id>.json (contract VisibilityVariants): per variant the hour indexes where
"Sun lit" (any limb above the mask) and "Earth centre above the mask" flip, starting from off.
DEM variants: polar80 sites get "20+80+240" (the app terrain, see __main__), "80+240" and "240";
polar240 sites get "240"; terrain "none" gets "none". Sun/Earth positions use the 2 m observer
(10 m changes elevation by < 0.001 deg); only the mask changes.
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
import spiceypy as sp

from .__main__ import AZ_STEP, EARTH_MARGIN_DEG, END_UTC, START_UTC, STEP_MIN, epochs, site_terrain
from .ephem import load_kernels, topo
from .geo import FINE_DEM, Dem, Terrain, centre_visible, horizon_mask, visible_fraction

HEIGHTS_M = (0.0, 2.0, 10.0)


def flips(flags: np.ndarray) -> list[int]:
    """Indexes where a 0/1 series changes state, starting from 0 (off)."""
    f = np.concatenate([[0], flags.astype(np.int8)])
    return [int(i) for i in np.flatnonzero(np.diff(f))]


def on_share(fl: list[int], n: int) -> float:
    """Share of steps that are on, from flip indexes."""
    return sum((fl + [n])[i + 1] - fl[i] for i in range(0, len(fl), 2)) / n


def dem_variants(site, dems) -> list[tuple[str, Terrain | None]]:
    if site["terrain"] == "polar80":
        return [
            ("20+80+240", site_terrain(site, dems)),
            ("80+240", Terrain(dems["polar80"], dems["polar240"])),
            ("240", Terrain(dems["polar240"])),
        ]
    if site["terrain"] == "polar240":
        return [("240", Terrain(dems["polar240"]))]
    return [("none", None)]


def site_variants(site, dems, ets) -> dict:
    h_ref = 2.0
    out = []
    sun = earth = None
    for dem_name, terrain in dem_variants(site, dems):
        for h in HEIGHTS_M:
            if terrain is None:
                az = np.arange(0.0, 360.0, AZ_STEP)
                el, h0 = np.zeros_like(az), 0.0
            else:
                az, el, h0 = horizon_mask(terrain, site["lonE"], site["lat"], h, AZ_STEP)
            if sun is None:
                sun = topo("SUN", ets, site["lonE"], site["lat"], h0 + h_ref)
                earth = topo("EARTH", ets, site["lonE"], site["lat"], h0 + h_ref)
            el = np.round(el, 2)
            lit = visible_fraction(*sun, az, el) > 0
            com = centre_visible(earth[0], earth[1], az, el, EARTH_MARGIN_DEG)
            out.append({"heightM": h, "dem": dem_name, "sun": flips(lit), "earth": flips(com)})
    return {
        "siteId": site["id"],
        "startUtc": START_UTC,
        "stepMin": STEP_MIN,
        "n": len(ets),
        "ref": {"heightM": h_ref, "dem": out[0]["dem"]},
        "variants": out,
    }


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="precompute.variants", description=__doc__.splitlines()[0])
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--sites", default="")
    p.add_argument("--fine", default=FINE_DEM, help="LOLA 20 m DEM (local path or /vsicurl/ URL)")
    a = p.parse_args(argv)
    load_kernels(a.data / "spice")
    sites = json.loads((a.out / "sites.json").read_text())["sites"]
    only = set(filter(None, a.sites.split(",")))
    sites = [s for s in sites if s["lat"] is not None and (not only or s["id"] in only)]
    need = {s["terrain"] for s in sites}
    dems = {"fine": a.fine}
    if "polar80" in need:
        dems["polar80"] = Dem(a.data / "lola" / "LDEM_80S_80MPP_ADJ.TIF")
    if need & {"polar80", "polar240"}:
        dems["polar240"] = Dem(a.data / "lola" / "LDEM_60S_240MPP_ADJ.TIF")
    ets = epochs(START_UTC, END_UTC, STEP_MIN)
    (a.out / "variants").mkdir(parents=True, exist_ok=True)
    for s in sites:
        t = time.time()
        v = site_variants(s, dems, ets)
        (a.out / "variants" / f"{s['id']}.json").write_text(json.dumps(v, separators=(",", ":")))
        lit = [on_share(x["sun"], v["n"]) * 100 for x in v["variants"]]
        print(
            f"{s['id']:24s} light {min(lit):5.1f}..{max(lit):5.1f}% ({len(v['variants'])} var) {time.time() - t:4.1f} s"
        )
    sp.kclear()


if __name__ == "__main__":
    main()
