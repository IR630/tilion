"""DSN access through the lunar site mask; no station scheduling or link budget."""

import numpy as np
import spiceypy as sp

from .geo import R, centre_visible, frame

# DSS-14 (Goldstone), DSS-63 (Madrid), DSS-43 (Canberra): lon E, geodetic lat, height km.
# These are 70 m antennas without the 26 GHz lunar K-band; the 34 m K-band antennas are within
# 10 km, same geometry (DSN 810-005 module 104Q, https://deepspace.jpl.nasa.gov/dsndocs/810-005/104/104Q.pdf).
# 10 deg is the uplink limit (10.1 deg) in module 301P, https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301P.pdf.
# NAIF station coordinates and reference ellipsoid (ITRF93, epoch 2026-07-17):
# https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/stations/earth_topo_260814.tf
STATIONS = (
    (-116.8895431330483, 35.4258999225138, 1.001384087429),
    (-4.2480020535013, 40.4312138842194, 0.8648448375319),
    (148.9812726938012, -35.4024141881635, 0.6888431941637),
)


def station_elevation(ets, station, target="MOON"):
    """Apparent elevation in degrees above the station's geodetic horizon."""
    lon, lat = np.radians(station[:2])
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    obs = sp.georec(lon, lat, station[2], 6378.137, 1 / 298.2572236)
    v = np.array(
        [
            sp.spkcpo(target, et, "ITRF93", "OBSERVER", "LT+S", obs, "EARTH", "ITRF93")[0][:3]
            for et in ets
        ]
    )
    return np.degrees(np.arcsin((v @ up) / np.linalg.norm(v, axis=1)))


def station_topo(ets, station, lon_e, lat, h):
    """Station azimuth/elevation at the lunar site, MOON_ME, reception LT+S; h in metres."""
    up, east, north = frame(lon_e, lat)
    obs = up * (R + h) / 1000.0
    pos = sp.georec(*np.radians(station[:2]), station[2], 6378.137, 1 / 298.2572236)
    vectors = []
    for et in ets:
        # Both ends are fixed surface points. Compute the site's barycentric state first.
        observer = -sp.spkcpo("SSB", et, "J2000", "OBSERVER", "NONE", obs, "MOON", "MOON_ME")[0]
        target = sp.spkcpt(pos, "EARTH", "ITRF93", et, "J2000", "OBSERVER", "NONE", "SSB")[0]
        lt = np.linalg.norm(target[:3] - observer[:3]) / sp.clight()
        # One light-time iteration is SPICE's LT convention; stellar aberration uses site velocity.
        target = sp.spkcpt(pos, "EARTH", "ITRF93", et - lt, "J2000", "OBSERVER", "NONE", "SSB")[0]
        apparent = sp.stelab(target[:3] - observer[:3], observer[3:])
        vectors.append(sp.pxform("J2000", "MOON_ME", et) @ apparent)
    v = np.array(vectors)
    az = np.degrees(np.arctan2(v @ east, v @ north)) % 360
    el = np.degrees(np.arcsin((v @ up) / np.linalg.norm(v, axis=1)))
    return az, el


def visible(ets, lon_e, lat, h, mask_az, mask_el, stations=STATIONS):
    """At least one station clears the lunar mask AND sees the Moon centre above 10°."""
    access = np.zeros(len(ets), dtype=bool)
    for station in stations:
        az, el = station_topo(ets, station, lon_e, lat, h)
        access |= (station_elevation(ets, station) > 10) & (
            centre_visible(az, el, mask_az, mask_el) > 0
        )
    return access.astype(int).tolist()
