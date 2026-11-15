"""Geometry on the lunar reference sphere: local frames, polar stereographic, DEM, horizon mask.

Frame MOON_ME, longitude 0-360 deg east, sphere R = 1737.4 km (LOLA products and Horizons).
"""

from pathlib import Path

import numpy as np

R = 1737400.0  # m


def unit(lon_e: float, lat: float) -> np.ndarray:
    lo, la = np.radians(lon_e), np.radians(lat)
    return np.array([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def frame(lon_e: float, lat: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Local up, east, north unit vectors (MOON_ME body-fixed)."""
    up = unit(lon_e, lat)
    east = np.cross([0.0, 0.0, 1.0], up)
    east /= np.linalg.norm(east)
    return up, east, np.cross(up, east)


def to_xy(p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Unit vectors (..., 3) -> south polar stereographic x, y (m): x = r sin(lon), y = r cos(lon)."""
    k = 2 * R / (1 - p[..., 2])
    return k * p[..., 1], k * p[..., 0]


def from_xy(x, y) -> tuple[np.ndarray, np.ndarray]:
    """South polar stereographic x, y (m) -> lonE in [0, 360), lat (deg)."""
    lon = np.degrees(np.arctan2(x, y)) % 360
    lat = -90 + np.degrees(2 * np.arctan(np.hypot(x, y) / (2 * R)))
    return lon, lat


class Dem:
    """LOLA polar GeoTIFF (stereographic, metres above the sphere). Bilinear sample, NaN outside.

    window = (x, y, half) in metres reads only the square around (x, y).
    """

    def __init__(self, path: Path | str, window: tuple[float, float, float] | None = None):
        import rasterio
        from rasterio.windows import from_bounds

        with rasterio.open(path) as ds:
            w = None
            if window:
                x, y, half = window
                w = from_bounds(x - half, y - half, x + half, y + half, ds.transform)
                w = w.round_offsets().round_lengths()
            a = ds.read(1, window=w).astype(np.float32)
            if ds.nodata is not None:
                a[a == ds.nodata] = np.nan
            self.a = a * (ds.scales[0] or 1.0) + (ds.offsets[0] or 0.0)
            t = ds.window_transform(w) if w else ds.transform
            self.x0, self.y0, self.dx, self.dy = t.c, t.f, t.a, t.e

    def sample(self, x, y) -> np.ndarray:
        c = (np.asarray(x) - self.x0) / self.dx - 0.5
        r = (np.asarray(y) - self.y0) / self.dy - 0.5
        c0, r0 = np.floor(c).astype(int), np.floor(r).astype(int)
        ok = (c0 >= 0) & (r0 >= 0) & (c0 < self.a.shape[1] - 1) & (r0 < self.a.shape[0] - 1)
        c0, r0 = np.where(ok, c0, 0), np.where(ok, r0, 0)
        fc, fr = c - c0, r - r0
        a = self.a
        v = (
            a[r0, c0] * (1 - fc) * (1 - fr)
            + a[r0, c0 + 1] * fc * (1 - fr)
            + a[r0 + 1, c0] * (1 - fc) * fr
            + a[r0 + 1, c0 + 1] * fc * fr
        )
        return np.where(ok, v, np.nan)


# Nested grid as Barker et al. 2021 (sec. 5): fine DEM near the site, coarser beyond. The 20 m
# file is 2.7 GB, so we read only the window around each site over HTTP (GDAL /vsicurl/).
FINE_DEM = "/vsicurl/https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF"
FINE_HALF_M = 5000.0


def fine_dem(
    lon_e: float, lat: float, src: Path | str = FINE_DEM, half: float = FINE_HALF_M
) -> Dem:
    """LOLA 20 m DEM window (+-half m) centred on a site."""
    x, y = to_xy(unit(lon_e, lat))
    return Dem(src, (float(x), float(y), half))


class Terrain:
    """First DEM where it has data, the next one beyond its coverage (20 m window, 80 m, 240 m)."""

    def __init__(self, *dems: Dem):
        self.dems = [d for d in dems if d is not None]
        self.step = min(abs(d.dx) for d in self.dems)

    def sample(self, x, y) -> np.ndarray:
        v = self.dems[0].sample(x, y)
        for d in self.dems[1:]:
            v = np.where(np.isnan(v), d.sample(x, y), v)
        return v


def distances(first: float, max_m: float, growth: float = 0.005) -> np.ndarray:
    d = [first]
    while d[-1] < max_m:
        d.append(d[-1] + max(first, d[-1] * growth))
    return np.array(d)


def ray_elevations(terrain, lon_e, lat, h_obs=2.0, az_step=0.5, max_m=300e3):
    """Elevation angle (deg) of every ray sample, rays along the sphere from north to east.

    Returns (az, distance of each sample in m, elev[az, sample], ground height at the site in m).
    Missing terrain counts as -90 deg.
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
    rq = R + terrain.sample(*to_xy(p))
    vert = rq * np.cos(psi) - ro
    dist = np.sqrt(rq**2 + ro**2 - 2 * rq * ro * np.cos(psi))
    el = np.degrees(np.arcsin(vert / dist))
    el = np.where(np.isnan(el), -90.0, el)
    return az, d, el, h0


def horizon_mask(terrain, lon_e, lat, h_obs=2.0, az_step=0.5, max_m=300e3):
    """Terrain elevation angle (deg) per azimuth (from north to east), ray along the sphere.

    Returns (az, elev, ground height at the site in m). Missing terrain counts as -90 deg.
    """
    az, _, el, h0 = ray_elevations(terrain, lon_e, lat, h_obs, az_step, max_m)
    return az, el.max(axis=1), h0


# Solar limb darkening at 550 nm: I(mu)/I(1) = a0 + a1 mu + a2 mu^2 (Allen's Astrophysical
# Quantities, Cox 2000; NASA uses a limb-darkened Sun too, Barker et al. 2021 sec. 5,
# research/barker-2021-sun-model.md). D-010.
SUN_LIMB = (0.3, 0.93, -0.23)
UNIFORM = (1.0, 0.0, 0.0)


def _strip_flux(y, Y, limb):
    """Flux of a disc strip from its bottom to height y (unit disc, half-chord Y, mu^2 = Y^2 - y^2)."""
    a0, a1, a2 = limb
    root = np.sqrt(np.maximum(Y * Y - y * y, 0.0))
    return (
        a0 * y
        + a1 * 0.5 * (y * root + Y * Y * np.arcsin(np.clip(y / Y, -1, 1)))
        + a2 * (Y * Y * y - y**3 / 3)
    )


def visible_fraction(az, el, rad, mask_az, mask_el, strips=15, limb=UNIFORM):
    """Share of a disc's flux (centre az/el, angular radius rad, deg) above the mask.

    Vertical strips, each cut by the horizon at its own azimuth; the flux over the visible part is
    integrated exactly for the limb law. limb=UNIFORM gives the visible share of the disc area.
    """
    az, el, rad = np.asarray(az), np.asarray(el), np.asarray(rad)
    num = np.zeros_like(el, dtype=float)
    den = np.zeros_like(el, dtype=float)
    for x in (np.arange(strips) + 0.5) / strips * 2 - 1:
        Y = np.sqrt(1 - x * x)
        a = (az + x * rad / np.cos(np.radians(np.clip(el, -89, 89)))) % 360
        hz = np.interp(a, mask_az, mask_el, period=360)
        t = np.clip((hz - el) / rad, -Y, Y)
        top = _strip_flux(Y, Y, limb)
        num += top - _strip_flux(t, Y, limb)
        den += top - _strip_flux(-Y, Y, limb)
    return num / den


def sep_deg(a1, e1, a2, e2):
    """Great-circle angle between two az/el directions (deg)."""
    a1, e1, a2, e2 = map(np.radians, (a1, e1, a2, e2))
    c = np.sin(e1) * np.sin(e2) + np.cos(e1) * np.cos(e2) * np.cos(a1 - a2)
    return np.degrees(np.arccos(np.clip(c, -1.0, 1.0)))


# Earth's shadow as in the NASA GSFC eclipse predictions (Espenak, Danjon rule): Earth radius x
# (1 + 1/85 - 1/594) = an opaque air layer of ~75 km, oblateness at 45 deg latitude
# (https://eclipse.gsfc.nasa.gov/LEcat5/shadow.html). D-010.
EARTH_SHADOW_SCALE = 1.01


def shadow_radius(earth_rad):
    """Angular radius (deg) of the Earth disc with the opaque air layer, from the bare-Earth one."""
    return np.degrees(np.arcsin(EARTH_SHADOW_SCALE * np.sin(np.radians(earth_rad))))


def sun_visible_fraction(az, el, rad, mask_az, mask_el, earth_az, earth_el, earth_rad, strips=15):
    """Flux above terrain and outside Earth, using common disc strips and exact vertical integrals."""
    az, el, rad = np.asarray(az), np.asarray(el), np.asarray(rad)
    da = np.radians(np.asarray(earth_az) - az)
    se, ee = np.radians(el), np.radians(earth_el)
    dx = np.cos(ee) * np.sin(da)
    dy = np.cos(se) * np.sin(ee) - np.sin(se) * np.cos(ee) * np.cos(da)
    sin_sep = np.hypot(dx, dy)
    sep = np.radians(sep_deg(az, el, earth_az, earth_el))
    scale = np.divide(sep, sin_sep, out=np.ones_like(sin_sep), where=sin_sep > 1e-12)
    ex = np.degrees(dx * scale) / rad
    ey = np.degrees(dy * scale) / rad
    er = np.asarray(earth_rad) / rad
    overlaps = sep <= np.radians(rad + earth_rad)
    num = np.zeros_like(el, dtype=float)
    den = np.zeros_like(el, dtype=float)
    for x in (np.arange(strips) + 0.5) / strips * 2 - 1:
        Y = np.sqrt(1 - x * x)
        a = (az + x * rad / np.cos(np.radians(np.clip(el, -89, 89)))) % 360
        hz = np.interp(a, mask_az, mask_el, period=360)
        bottom = np.clip((hz - el) / rad, -Y, Y)
        top = _strip_flux(Y, Y, SUN_LIMB)
        width = np.where(overlaps, np.sqrt(np.maximum(er * er - (x - ex) ** 2, 0.0)), 0.0)
        low = np.clip(ey - width, bottom, Y)
        high = np.clip(ey + width, bottom, Y)
        num += (
            top
            - _strip_flux(bottom, Y, SUN_LIMB)
            - (_strip_flux(high, Y, SUN_LIMB) - _strip_flux(low, Y, SUN_LIMB))
        )
        den += top - _strip_flux(-Y, Y, SUN_LIMB)
    return np.clip(num / den, 0.0, 1.0)


def eclipsed_fraction(sep, sun_rad, earth_rad, rings=64, limb=SUN_LIMB):
    """Share of the Sun disc flux behind the Earth disc (centre separation sep, angular radii, deg).

    Rings of the Sun disc: each ring is cut by the Earth circle at its own arc; the ring weight is
    the limb law I(mu) at its radius. Partial phases to ~0.001; 0 and 1 are exact.
    """
    sep, s, e = (np.asarray(v, dtype=float)[..., None] for v in (sep, sun_rad, earth_rad))
    r = (np.arange(rings) + 0.5) / rings
    a0, a1, a2 = limb
    mu = np.sqrt(1 - r * r)
    w = (a0 + a1 * mu + a2 * mu * mu) * r
    rho = r * s
    c = (sep * sep + rho * rho - e * e) / (2 * np.maximum(sep, 1e-12) * rho)
    inside = np.arccos(np.clip(c, -1.0, 1.0)) / np.pi
    return (inside * w).sum(axis=-1) / w.sum()


def centre_visible(az, el, mask_az, mask_el, margin=0.0):
    """1 where the body centre is above the mask + margin (Q9: communication = centre)."""
    hz = np.interp(np.asarray(az) % 360, mask_az, mask_el, period=360)
    return (np.asarray(el) > hz + margin).astype(int)
