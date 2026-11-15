"""Sub-solar / sub-Earth points (#21) vs an independent SPICE routine and vs ephem.topo."""

import json
import math
from pathlib import Path

import numpy as np
import pytest
import spiceypy as sp
from test_precompute import DATA, SPICE, need

from precompute import ephem, subpoints
from precompute.geo import unit

OUT = Path(__file__).resolve().parents[2] / "web" / "public" / "data" / "globe" / "subpoints.json"


@pytest.fixture(scope="module")
def spice():
    ephem.load_kernels(DATA / "spice")
    yield
    sp.kclear()


def _sep(lat1, lon1, lat2, lon2) -> float:
    c = float(np.dot(unit(lon1, lat1), unit(lon2, lat2)))
    return math.degrees(math.acos(min(1.0, c)))


@need(*SPICE)
def test_subpoints_match_spice_subslr_and_subpnt(spice):
    et = ephem.utc_to_et("2027-03-15T06:00:00")
    for body, fn in (("SUN", sp.subslr), ("EARTH", sp.subpnt)):
        lat, lon, _ = subpoints.subpoint(body, et)
        # Independent routine: the near point on the Moon seen by an observer at that body.
        p = fn("NEAR POINT/ELLIPSOID", "MOON", et, ephem.FRAME, ephem.ABCORR, "EARTH")[0]
        _, lon2, lat2 = sp.reclat(p)
        assert _sep(lat, lon, math.degrees(lat2), math.degrees(lon2)) < 0.01
    assert 356_000 < subpoints.subpoint("EARTH", et)[2] < 407_000


@need(*SPICE)
def test_subsolar_point_gives_sun_elevation_of_a_site(spice):
    # Sun elevation at a site = 90 deg - angle(site, sub-solar point); parallax < 0.001 deg.
    et = ephem.utc_to_et("2027-01-15T00:00:00")
    lat, lon, _ = subpoints.subpoint("SUN", et)
    _, el, _ = ephem.topo("SUN", [et], 222.69, -89.45)
    assert 90 - _sep(lat, lon, -89.45, 222.69) == pytest.approx(el[0], abs=0.01)


@need(*SPICE)
def test_written_file_matches_spice_at_one_epoch(spice):
    if not OUT.exists():
        pytest.skip("subpoints.json not built")
    d = json.loads(OUT.read_text())
    assert d["n"] == len(d["sunLat"]) == len(d["earthDistKm"]) == 9505
    i = 2500
    utc = np.datetime64(d["startUtc"].rstrip("Z")) + np.timedelta64(i * d["stepMin"], "m")
    lat, lon, _ = subpoints.subpoint("SUN", ephem.utc_to_et(str(utc)))
    assert _sep(d["sunLat"][i], d["sunLonE"][i], lat, lon) < 0.01
    lat, lon, dist = subpoints.subpoint("EARTH", ephem.utc_to_et(str(utc)))
    assert _sep(d["earthLat"][i], d["earthLonE"][i], lat, lon) < 0.01
    assert abs(d["earthDistKm"][i] - dist) <= 1
