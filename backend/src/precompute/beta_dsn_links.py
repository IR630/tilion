"""Per-station geometry for the place card (#383); consumes the #329 DSN method.

Writes beta/dsn_links.json. Readers: stationLinks.ts and StationPanel in PlaceCard.
The time grid and station order match beta/dsn_stations.json. moonElevationDeg has
one row per station. sites maps each site id to hourly bit masks (characters 0..7).
A bit requires that same station above the lunar mask AND Moon elevation >10 deg.
No station scheduling or link budget. Existing timelines are never modified.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import spiceypy as sp

from . import dsn
from .__main__ import site_terrain
from .ephem import load_kernels, utc_to_et
from .geo import FINE_DEM, Dem, centre_visible, to_xy, unit


def site_codes(ets, site, mask, height_m, moon_elevation, threshold):
    """Return station bits, using unrounded elevations for threshold decisions."""
    az = np.arange(len(mask["elevDeg"])) * mask["azStepDeg"]
    el = np.asarray(mask["elevDeg"])
    codes = np.zeros(len(ets), dtype=np.uint8)
    for k, station in enumerate(dsn.STATIONS):
        saz, sel = dsn.station_topo(ets, station, site["lonE"], site["lat"], height_m)
        visible = (moon_elevation[k] > threshold) & (centre_visible(saz, sel, az, el) > 0)
        codes |= visible.astype(np.uint8) << k
    return "".join(str(int(value)) for value in codes)


def check_timeline(codes, timeline):
    """Reject a sidecar that disagrees with the #329 timeline's any-station rule."""
    expected = timeline.get("dsnVisible")
    actual = [int(code != "0") for code in codes]
    if expected is None or actual != expected:
        raise ValueError(f"{timeline['siteId']}: station links disagree with #329 dsnVisible")


def build(data: Path, out: Path, fine=FINE_DEM):
    base = json.loads((out / "beta/dsn_stations.json").read_text())
    if not hasattr(dsn, "station_topo"):
        raise RuntimeError("#329 must be merged before generating station links")
    if (
        base["thresholdDeg"] != 10
        or [station["id"] for station in base["complexes"]] != ["G", "M", "C"]
        or len(dsn.STATIONS) != 3
    ):
        raise ValueError("DSN station grid does not match the #329 method")
    ets = utc_to_et(base["startUtc"].rstrip("Z")) + np.arange(base["n"]) * base["stepMin"] * 60
    moon = np.asarray([dsn.station_elevation(ets, station) for station in dsn.STATIONS])
    if not np.isfinite(moon).all():
        raise ValueError("non-finite Moon elevation")
    catalog = json.loads((out / "sites.json").read_text())["sites"]
    sites = [site for site in catalog if site["lat"] is not None]
    need = {site["terrain"] for site in sites}
    dems = {"fine": fine}
    if "polar80" in need:
        dems["polar80"] = Dem(data / "lola/LDEM_80S_80MPP_ADJ.TIF")
    if need & {"polar80", "polar240"}:
        dems["polar240"] = Dem(data / "lola/LDEM_60S_240MPP_ADJ.TIF")
    by_site = {}
    for site in sites:
        timeline = json.loads((out / "timeline" / f"{site['id']}.json").read_text())
        if (
            timeline["startUtc"] != base["startUtc"]
            or timeline["stepMin"] != base["stepMin"]
            or len(timeline["earthVisible"]) != base["n"]
            or timeline.get("stub")
        ):
            raise ValueError(f"{site['id']}: mismatched or synthetic timeline")
        mask = json.loads((out / "mask" / f"{site['id']}.json").read_text())
        ground = 0.0
        if site["terrain"] != "none":
            terrain = site_terrain(site, dems)
            ground = float(terrain.sample(*to_xy(unit(site["lonE"], site["lat"]))))
            if not np.isfinite(ground):
                raise ValueError(f"no DEM under site {site['id']}")
        codes = site_codes(
            ets, site, mask, ground + mask["observerHeightM"], moon, base["thresholdDeg"]
        )
        check_timeline(codes, timeline)
        by_site[site["id"]] = codes
        print(f"{site['id']}: {len(codes)} station samples match #329", flush=True)
    return {
        **{key: base[key] for key in ("startUtc", "stepMin", "n", "thresholdDeg", "complexes")},
        "moonElevationDeg": np.round(moon, 2).tolist(),
        "sites": by_site,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    load_kernels(args.data / "spice")
    try:
        doc = build(args.data, args.out)
    finally:
        sp.kclear()
    target = args.out / "beta/dsn_links.json"
    target.write_text(json.dumps(doc, separators=(",", ":")))
    print(f"{target}: {len(doc['sites'])} sites, {target.stat().st_size} bytes")


if __name__ == "__main__":
    main()
