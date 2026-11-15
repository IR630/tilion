"""BETA dsnStations (#259): the per-complex sidecar against dsnVisible and against JPL Horizons."""

import json

import numpy as np
import pytest
from test_precompute import DATA, REPO, SPICE, need

WEB_DATA = REPO / "web" / "public" / "data"
SIDECAR = WEB_DATA / "beta" / "dsn_stations.json"

# External judge: JPL Horizons API (https://ssd.jpl.nasa.gov/api/horizons.api), queried 2026-11-15.
# COMMAND=301, CENTER=coord@399, COORD_TYPE=GEODETIC, SITE_COORD = the dsn.py station (E-lon, lat, km),
# TIME_TYPE=UT, QUANTITIES=4, APPARENT=AIRLESS, EXTRA_PREC=YES. Moon centre apparent elevation, deg.
# Each moment puts one complex 0.2-1 deg from the 10 deg limit, so a wrong bit cannot hide.
HORIZONS = {
    "2027-03-13T02:00:00Z": {"G": 53.427182305, "M": -22.595084355, "C": 10.966458830},
    "2027-04-29T11:00:00Z": {"G": 17.240976395, "M": 9.786708231, "C": -30.343743174},
    "2027-07-27T08:00:00Z": {"G": 10.938248016, "M": 61.568021682, "C": -74.863976757},
}


def sidecar():
    doc = json.loads(SIDECAR.read_text())
    assert len(doc["codes"]) == doc["n"]
    assert set(doc["codes"]) <= set("01234567")
    return doc


def bits_at(doc, utc):
    from datetime import datetime

    t = datetime.fromisoformat(utc)
    t0 = datetime.fromisoformat(doc["startUtc"])
    i, rem = divmod((t - t0).total_seconds(), doc["stepMin"] * 60)
    assert rem == 0
    code = int(doc["codes"][int(i)])
    return {c["id"]: bool(code >> k & 1) for k, c in enumerate(doc["complexes"])}


def test_dsn_requires_ground_access_but_can_differ_from_earth_centre():
    doc = sidecar()
    any_complex = np.array([c != "0" for c in doc["codes"]])
    checked = 0
    station_only = centre_only = 0
    for path in sorted((WEB_DATA / "timeline").glob("*.json")):
        tl = json.loads(path.read_text())
        if "dsnVisible" not in tl:
            continue
        assert (tl["startUtc"], tl["stepMin"]) == (doc["startUtc"], doc["stepMin"]), path.name
        n = len(tl["earthVisible"])
        assert n == doc["n"], path.name
        dsn = np.array(tl["dsnVisible"])
        assert len(dsn) == n and set(dsn) <= {0, 1}, path.name
        assert not np.any((dsn > 0) & ~any_complex), path.name
        earth = (np.array(tl["earthVisible"]) > 0) & any_complex
        station_only += np.count_nonzero((dsn > 0) & ~earth)
        centre_only += np.count_nonzero((dsn == 0) & earth)
        checked += 1
    assert checked >= 20
    assert station_only > 0 and centre_only > 0


def test_complex_bits_agree_with_horizons_elevation():
    doc = sidecar()
    assert doc["thresholdDeg"] == 10
    for utc, el in HORIZONS.items():
        bits = bits_at(doc, utc)
        for cid, deg in el.items():
            assert bits[cid] == (deg > doc["thresholdDeg"]), (utc, cid, deg)


@need(*SPICE)
def test_station_elevation_matches_horizons_and_rebuild_matches_sidecar():
    import spiceypy as sp

    from precompute import ephem
    from precompute.beta_dsn_stations import COMPLEXES, station_codes
    from precompute.dsn import STATIONS, station_elevation

    ephem.load_kernels(DATA / "spice")
    try:
        ids = [c[0] for c in COMPLEXES]
        for utc, el in HORIZONS.items():
            et = [ephem.utc_to_et(utc.rstrip("Z"))]
            for cid, deg in el.items():
                ours = station_elevation(et, STATIONS[ids.index(cid)])[0]
                assert ours == pytest.approx(deg, abs=0.002), (utc, cid)
        doc = sidecar()
        ets = ephem.utc_to_et(doc["startUtc"].rstrip("Z")) + np.arange(0, doc["n"], 97) * 3600.0
        assert station_codes(ets) == doc["codes"][::97]
    finally:
        sp.kclear()
