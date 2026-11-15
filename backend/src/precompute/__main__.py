"""Precompute horizon masks and Sun/Earth timelines for the static UI (contract web/src/contracts.ts).

Run from backend/:

    uv run python -m precompute --data <nasa data dir> --out ../web/public/data [--sites id,id]

<data> holds spice/, lola/ (see data/README.md). --inset-only writes only the map inset tiles
(inset.py, #125). Output: <out>/mask/<id>.json, <out>/timeline/<id>.json and
<out>/blocker/<id>.json (blocker.py) for every site in <out>/sites.json that has lat/lon.
Mask: 720 azimuths (0.5 deg), observer 2 m, ray along the sphere to 300 km. polar80 sites: nested
LOLA grid (Barker et al. 2021) - 20 m within 5 km (read over HTTP, --fine), 80 m, 240 m beyond;
polar240 sites: 240 m; terrain "none" gives a zero mask.
Timeline: hourly 2026-12-01T00:00Z .. 2028-01-01T00:00Z, MOON_ME, LT+S. Sun visible = share of
the limb-darkened disc flux above the mask and outside the Earth disc (eclipse, Danjon radius;
D-010). Earth visible = centre above the mask (Q9).
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
import spiceypy as sp

from . import inset
from .dsn import visible as dsn_visible
from .ephem import load_kernels, topo, utc_to_et
from .geo import (
    FINE_DEM,
    Dem,
    Terrain,
    centre_visible,
    fine_dem,
    horizon_mask,
    shadow_radius,
    sun_visible_fraction,
    to_xy,
    unit,
)

OBSERVER_M = 2.0
AZ_STEP = 0.5
START_UTC = "2026-12-01T00:00:00Z"
END_UTC = "2028-01-01T00:00:00Z"
STEP_MIN = 60
EARTH_MARGIN_DEG = 0.0


def site_terrain(site, dems) -> Terrain:
    """App terrain: nested 20 m + 80 m + 240 m for polar80 sites, 240 m for polar240."""
    if site["terrain"] == "polar80":
        fine = fine_dem(site["lonE"], site["lat"], dems["fine"])
        return Terrain(fine, dems["polar80"], dems["polar240"])
    return Terrain(dems["polar240"])


def site_mask(site, dems) -> tuple[dict, float]:
    """Contract HorizonMask and the ground height (m) at the site."""
    az = np.arange(0.0, 360.0, AZ_STEP)
    if site["terrain"] == "none":
        el, h0 = np.zeros_like(az), 0.0
    else:
        terrain = site_terrain(site, dems)
        az, el, h0 = horizon_mask(terrain, site["lonE"], site["lat"], OBSERVER_M, AZ_STEP)
    mask = {
        "siteId": site["id"],
        "observerHeightM": OBSERVER_M,
        "terrain": site["terrain"],
        "azStepDeg": AZ_STEP,
        "elevDeg": [round(float(v), 2) for v in el],
    }
    return mask, h0


def epochs(start_utc=START_UTC, end_utc=END_UTC, step_min=STEP_MIN) -> np.ndarray:
    e0, e1 = utc_to_et(start_utc.rstrip("Z")), utc_to_et(end_utc.rstrip("Z"))
    return e0 + np.arange(0, e1 - e0, step_min * 60.0)


def round_flux(flux) -> list[float]:
    """Sun flux share rounded to 0.01; any flux > 0 stays >= 0.01, so a thin crescent is still lit (D-010)."""
    return [max(0.01, round(float(v), 2)) if v > 0 else 0.0 for v in flux]


def site_timeline(site, mask, h0, ets, start_utc=START_UTC, step_min=STEP_MIN) -> dict:
    maz = np.arange(len(mask["elevDeg"])) * mask["azStepDeg"]
    mel = np.array(mask["elevDeg"])
    h = h0 + mask["observerHeightM"]
    saz, sel, srad = topo("SUN", ets, site["lonE"], site["lat"], h)
    eaz, eel, erad = topo("EARTH", ets, site["lonE"], site["lat"], h)
    sun = sun_visible_fraction(saz, sel, srad, maz, mel, eaz, eel, shadow_radius(erad))

    def r2(a):
        return [round(float(v), 2) for v in a]

    earth = [int(v) for v in centre_visible(eaz, eel, maz, mel, EARTH_MARGIN_DEG)]
    return {
        "siteId": site["id"],
        "startUtc": start_utc,
        "stepMin": step_min,
        "sunAz": r2(saz),
        "sunEl": r2(sel),
        "sunVisible": round_flux(sun),
        "earthAz": r2(eaz),
        "earthEl": r2(eel),
        "earthVisible": earth,
        "dsnVisible": dsn_visible(ets, site["lonE"], site["lat"], h, maz, mel),
    }


def main(argv=None) -> None:
    p = argparse.ArgumentParser(prog="precompute", description=__doc__.splitlines()[0])
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--sites", default="", help="comma-separated site ids (default: all)")
    p.add_argument("--fine", default=FINE_DEM, help="LOLA 20 m DEM (local path or /vsicurl/ URL)")
    p.add_argument(
        "--inset-only", action="store_true", help="write only inset/<id>.webp + .json (#125)"
    )
    p.add_argument("--dsn-only", action="store_true", help="update DSN in existing timelines only")
    p.add_argument(
        "--blocker-only", action="store_true", help="write horizon point distances and rises"
    )
    a = p.parse_args(argv)

    if a.blocker_only:
        from .blocker import run

        run(a.data, a.out, a.fine, a.sites)
        return
    if a.inset_only:  # terrain only: no SPICE kernels needed
        sites = json.loads((a.out / "sites.json").read_text())["sites"]
        only = set(filter(None, a.sites.split(",")))
        inset.run([s for s in sites if not only or s["id"] in only], a.data, a.out, a.fine)
        return
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
    if a.dsn_only:
        for site in sites:
            path = a.out / "timeline" / f"{site['id']}.json"
            tl = json.loads(path.read_text())
            mask = json.loads((a.out / "mask" / f"{site['id']}.json").read_text())
            h0 = 0.0
            if site["terrain"] != "none":
                terrain = site_terrain(site, dems)
                h0 = float(terrain.sample(*to_xy(unit(site["lonE"], site["lat"]))))
                if np.isnan(h0):
                    raise ValueError(f"no DEM under the site {site['id']}")
            ets = utc_to_et(tl["startUtc"].rstrip("Z")) + np.arange(len(tl["earthVisible"])) * (
                tl["stepMin"] * 60
            )
            tl["dsnVisible"] = dsn_visible(
                ets,
                site["lonE"],
                site["lat"],
                h0 + mask["observerHeightM"],
                np.arange(len(mask["elevDeg"])) * mask["azStepDeg"],
                np.array(mask["elevDeg"]),
            )
            path.write_text(json.dumps(tl, separators=(",", ":")))
            print(f"{tl['siteId']}: DSN {np.mean(tl['dsnVisible']):.1%}")
        sp.kclear()
        return
    ets = epochs()
    for d in ("mask", "timeline"):
        (a.out / d).mkdir(parents=True, exist_ok=True)
    for s in sites:
        t = time.time()
        mask, h0 = site_mask(s, dems)
        tl = site_timeline(s, mask, h0, ets)
        (a.out / "mask" / f"{s['id']}.json").write_text(json.dumps(mask, separators=(",", ":")))
        (a.out / "timeline" / f"{s['id']}.json").write_text(json.dumps(tl, separators=(",", ":")))
        lit = float(np.mean(np.array(tl["sunVisible"]) > 0))
        comm = float(np.mean(tl["earthVisible"]))
        print(
            f"{s['id']:24s} h0={h0:8.1f} m mask {min(mask['elevDeg']):+6.2f}..{max(mask['elevDeg']):+6.2f}"
            f" | Sun lit {lit * 100:5.1f}% Earth {comm * 100:5.1f}% | {time.time() - t:4.1f} s"
        )
    sp.kclear()
    from .blocker import run as write_blocker

    write_blocker(a.data, a.out, a.fine, a.sites)


if __name__ == "__main__":
    main()
