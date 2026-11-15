"""BETA (#258): Sun-lit and Earth-in-view hour shares when the LOLA terrain is 1 sigma higher or lower.

Run from backend/ after the main precompute (needs <out>/sites.json, mask/, blocker/):

    uv run python -m precompute.beta_uncertainty --data <nasa data dir> --out ../web/public/data

Method:
  - sigma(az) = LOLA height error (1 sigma, m) at the terrain point that sets the horizon at az.
    The point is the blocker (blocker.py: arc distance distM along azimuth az from the site).
    The error comes from the product's own error layer, PGDA 90 LDEM_*_ADJ_ERR.TIF, of the same
    grid the app terrain uses there (20 m within 5 km of polar80 sites, then 80 m, then 240 m).
    Where the layer has no value: the median of that layer (FLAT_SIGMA_M).
  - err(az) = atan(sigma(az) / distM(az)); raised mask = mask + err, lowered mask = mask - err.
    All azimuths move together: the unfavourable case for a share (no averaging along the limb).
  - Sun lit = D-010 flux (limb-darkened disc above the mask and outside the Earth) > 0.
    Earth in view = centre above the mask (Q9). Same epochs, ephemerides and mask as the timeline.
  - lo = share over the raised mask, hi = share over the lowered mask. sigma = 0 gives lo = value = hi
    and value equals the share in timeline/<id>.json (tests/test_beta_uncertainty.py).
Assumptions (the UI says them): 1 sigma from the product error layer; the horizon-setting point
does not change when the terrain moves; the site's own height error is not included.

Output (web/src/beta/uncertainty/ is the only reader): beta/uncertainty.json and, since #379,
beta/uncertainty_events.json (Sun and Earth transitions over the nominal, raised and lowered masks,
for the sunset and Earthset time band in the place card).
"""

import argparse
import json
import time
from pathlib import Path

import numpy as np
import spiceypy as sp

from .__main__ import EARTH_MARGIN_DEG, END_UTC, START_UTC, epochs, site_terrain
from .ephem import load_kernels, topo
from .geo import (
    FINE_DEM,
    FINE_HALF_M,
    Dem,
    R,
    Terrain,
    centre_visible,
    frame,
    shadow_radius,
    sun_visible_fraction,
    to_xy,
    unit,
)

ERR_BASE = "/vsicurl/https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/"
ERR_20 = ERR_BASE + "LDEM_80S_20MPP_ADJ_ERR.TIF"
ERR_80 = ERR_BASE + "LDEM_80S_80MPP_ADJ_ERR.TIF"
ERR_240 = ERR_BASE + "LDEM_60S_240MPP_ADJ_ERR.TIF"
# Median of each error layer over its valid pixels, read at the 1/16 overview on 2026-11-15
# (#258): 20 m 0.59 m, 80 m 0.46 m, 240 m 0.91 m. Used only where the layer has no value.
FLAT_SIGMA_M = 0.91
# Overview step for the 80 m and 240 m layers: 2 = 160 m and 480 m pixels, ~60 MB each over HTTP.
ERR_DECIMATE = 2
SIGMA_LABEL = (
    "LOLA height error, 1 sigma, from the PGDA 90 error layer (LDEM_*_ADJ_ERR) at the terrain point "
    "that sets the horizon; the whole horizon raised or lowered together"
)


def error_profile(dist_m, sigma_m) -> np.ndarray:
    """Horizon error per azimuth, degrees: atan(sigma / distance). 0 where the distance is unknown."""
    d = np.asarray(dist_m, dtype=float)
    s = np.broadcast_to(np.asarray(sigma_m, dtype=float), d.shape)
    with np.errstate(invalid="ignore", divide="ignore"):
        a = np.degrees(np.arctan(s / d))
    return np.where(np.isfinite(d) & (d > 0) & np.isfinite(a), a, 0.0)


def lit_and_view(mask_el, saz, sel, srad, eaz, eel, erad, az_step=0.5):
    """Sun lit (D-010 flux > 0) and Earth centre in view (Q9), 0/1 per epoch, over one mask."""
    maz = np.arange(len(mask_el)) * az_step
    mel = np.asarray(mask_el, dtype=float)
    flux = sun_visible_fraction(saz, sel, srad, maz, mel, eaz, eel, shadow_radius(erad))
    return (flux > 0).astype(int), centre_visible(eaz, eel, maz, mel, EARTH_MARGIN_DEG)


def states(mask_el, err_deg, saz, sel, srad, eaz, eel, erad, az_step=0.5) -> dict:
    """Sun lit and Earth in view (0/1 per epoch) over the mask as given, raised by err and lowered by err."""
    mel = np.asarray(mask_el, dtype=float)
    err = np.asarray(err_deg, dtype=float)
    # Azimuths without terrain (-90) stay as they are.
    err = np.where(mel <= -89.0, 0.0, err)
    return {
        name: lit_and_view(m, saz, sel, srad, eaz, eel, erad, az_step)
        for name, m in (("value", mel), ("lo", mel + err), ("hi", mel - err))
    }


def bands(mask_el, err_deg, saz, sel, srad, eaz, eel, erad, az_step=0.5, st=None) -> dict:
    """Sun and Earth shares (0..1) over the mask as given (value), raised by err (lo), lowered by err (hi)."""
    st = st or states(mask_el, err_deg, saz, sel, srad, eaz, eel, erad, az_step)
    return {
        body: {k: round(float(st[k][j].mean()), 4) for k in ("value", "lo", "hi")}
        for j, body in enumerate(("sun", "earth"))
    }


def flips(state) -> dict:
    """Compact 0/1 series: the state at hour 0 and the hour indices where it changes (#379)."""
    a = np.asarray(state, dtype=int)
    return {"start": int(a[0]), "flips": (np.flatnonzero(np.diff(a)) + 1).tolist()}


def events(st: dict) -> dict:
    """#379: transitions per body over the nominal, raised (terrain +1 sigma) and lowered (-1 sigma) masks."""
    names = (("nominal", "value"), ("raised", "lo"), ("lowered", "hi"))
    return {
        body: {out: flips(st[k][j]) for out, k in names} for j, body in enumerate(("sun", "earth"))
    }


def blocker_points(lon_e, lat, dist_m, az_step=0.5) -> tuple[np.ndarray, np.ndarray]:
    """Stereographic x, y (m) of the horizon-setting points: arc distance dist_m along each azimuth."""
    up, east, north = frame(lon_e, lat)
    az = np.radians(np.arange(len(dist_m)) * az_step)[:, None]
    psi = (np.asarray(dist_m, dtype=float) / R)[:, None]
    p = np.cos(psi) * up + np.sin(psi) * (np.cos(az) * north + np.sin(az) * east)
    return to_xy(p)


def overview_dem(path: str, step: int) -> Dem:
    """Whole error layer read at 1/step resolution (COG overview), as a Dem for bilinear sampling."""
    import rasterio

    with rasterio.open(path) as ds:
        a = ds.read(1, out_shape=(ds.height // step, ds.width // step)).astype(np.float32)
        if ds.nodata is not None and not np.isnan(ds.nodata):
            a[a == ds.nodata] = np.nan
        t = ds.transform
        d = Dem.__new__(Dem)
        d.a = a
        d.x0, d.y0 = t.c, t.f
        d.dx, d.dy = t.a * ds.width / a.shape[1], t.e * ds.height / a.shape[0]
    return d


def sigma_at(err: Terrain, x, y) -> np.ndarray:
    s = np.asarray(err.sample(x, y), dtype=float)
    return np.where(np.isfinite(s) & (s > 0), s, FLAT_SIGMA_M)


def run(data: Path, out: Path, fine=FINE_DEM, only="", err20=ERR_20) -> dict:
    sites = json.loads((out / "sites.json").read_text())["sites"]
    ids = set(filter(None, only.split(",")))
    sites = [
        s
        for s in sites
        if s["terrain"] != "none"
        and s["lat"] is not None
        and (not ids or s["id"] in ids)
        and (out / "blocker" / f"{s['id']}.json").exists()
    ]
    dems = {"fine": fine}
    need = {s["terrain"] for s in sites}
    if "polar80" in need:
        dems["polar80"] = Dem(data / "lola" / "LDEM_80S_80MPP_ADJ.TIF")
    dems["polar240"] = Dem(data / "lola" / "LDEM_60S_240MPP_ADJ.TIF")
    t = time.time()
    err80 = overview_dem(ERR_80, ERR_DECIMATE) if "polar80" in need else None
    err240 = overview_dem(ERR_240, ERR_DECIMATE)
    print(f"error layers read in {time.time() - t:.0f} s", flush=True)
    load_kernels(data / "spice")
    ets = epochs()
    rows, ev_rows = [], []
    for site in sites:
        t = time.time()
        sid = site["id"]
        mask = json.loads((out / "mask" / f"{sid}.json").read_text())
        blk = json.loads((out / "blocker" / f"{sid}.json").read_text())
        assert blk["azStepDeg"] == mask["azStepDeg"] and len(blk["distM"]) == len(mask["elevDeg"])
        terrain = site_terrain(site, dems)
        h0 = float(terrain.sample(*to_xy(unit(site["lonE"], site["lat"]))))
        if site["terrain"] == "polar80":
            x, y = to_xy(unit(site["lonE"], site["lat"]))
            err = Terrain(Dem(err20, (float(x), float(y), FINE_HALF_M)), err80, err240)
        else:
            err = Terrain(err240)
        dist = np.asarray(blk["distM"], dtype=float)
        sigma = sigma_at(err, *blocker_points(site["lonE"], site["lat"], dist, blk["azStepDeg"]))
        e = error_profile(dist, sigma)
        h = h0 + mask["observerHeightM"]
        saz, sel, srad = topo("SUN", ets, site["lonE"], site["lat"], h)
        eaz, eel, erad = topo("EARTH", ets, site["lonE"], site["lat"], h)
        st = states(mask["elevDeg"], e, saz, sel, srad, eaz, eel, erad, mask["azStepDeg"])
        b = bands(mask["elevDeg"], e, saz, sel, srad, eaz, eel, erad, mask["azStepDeg"], st)
        ev_rows.append({"siteId": sid, **events(st)})
        rows.append(
            {
                "siteId": sid,
                "name": site["name"],
                "sigmaMedianM": round(float(np.median(sigma)), 2),
                "errMaxDeg": round(float(e.max()), 3),
                **b,
            }
        )
        print(
            f"{sid:24s} sigma med {np.median(sigma):4.2f} m err max {e.max():5.3f} deg"
            f" | Sun {b['sun']['value']:.1%} [{b['sun']['lo']:.1%}-{b['sun']['hi']:.1%}]"
            f" Earth {b['earth']['value']:.1%} [{b['earth']['lo']:.1%}-{b['earth']['hi']:.1%}]"
            f" | {time.time() - t:4.1f} s",
            flush=True,
        )
    sp.kclear()
    result = {
        "version": 1,
        "startUtc": START_UTC,
        "endUtc": END_UTC,
        "hours": len(ets),
        "sigma": SIGMA_LABEL,
        "method": "atan(sigma / distance)",
        "sites": rows,
    }
    (out / "beta").mkdir(parents=True, exist_ok=True)
    (out / "beta" / "uncertainty.json").write_text(json.dumps(result, indent=1) + "\n")
    ev = {
        "version": 1,
        "startUtc": START_UTC,
        "stepMin": 60,
        "hours": len(ets),
        "sigma": SIGMA_LABEL,
        "note": "Per body and mask: state at hour 0 (1 = Sun lit / Earth in view) and hour indices where it changes. "
        "raised = terrain +1 sigma, lowered = terrain -1 sigma.",
        "sites": ev_rows,
    }
    (out / "beta" / "uncertainty_events.json").write_text(
        json.dumps(ev, separators=(",", ":")) + "\n"
    )
    return result


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--fine", default=FINE_DEM)
    p.add_argument("--sites", default="", help="comma-separated site ids (default: all)")
    a = p.parse_args(argv)
    run(a.data, a.out, a.fine, a.sites)


if __name__ == "__main__":
    main()
