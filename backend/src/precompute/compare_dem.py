"""Measurement only: local 5 m LOLA DEM (PGDA 78, Barker et al. 2021) vs LOLA 80 m at one site.

Run from backend/:

    uv run python -m precompute.compare_dem --data <nasa data dir> [--with-20m]

The 5 m tile is south polar stereographic, MOON_ME, heights in metres above the 1737.4 km sphere,
the same convention as the 80 m / 240 m LOLA products (geo.Dem). The tile covers only ~16 km
around the site; beyond its edge the ray falls back to 80 m, then 240 m (geo.Terrain).
Both masks use geo.horizon_mask (observer 2 m, 0.5 deg azimuth, 300 km), the Sun share uses the
app timeline window (precompute.__main__.epochs, hourly 2026-12-01 .. 2028-01-01).
"""

import json
from pathlib import Path

import numpy as np

from . import geo

LOCAL_URL = "https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/Site01/Site01_final_adj_5mpp_surf.tif"
LOCAL_FILE = "lola5/Site01_final_adj_5mpp_surf.tif"  # under the data dir
SITE_ID = "cr1_connecting_ridge"  # PGDA 78 Site01 "Connecting ridge"
SITES_JSON = Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "sites.json"


def coverage(dem: geo.Dem, lon_e: float, lat: float) -> dict:
    """Tile bounds (m) and the shortest distance from the site to a tile edge (m)."""
    x, y = (float(v) for v in geo.to_xy(geo.unit(lon_e, lat)))
    ny, nx = dem.a.shape
    xs = sorted((dem.x0, dem.x0 + nx * dem.dx))
    ys = sorted((dem.y0, dem.y0 + ny * dem.dy))
    inside = xs[0] <= x <= xs[1] and ys[0] <= y <= ys[1]
    edge = min(x - xs[0], xs[1] - x, y - ys[0], ys[1] - y) if inside else 0.0
    return {
        "x": xs,
        "y": ys,
        "inside": inside,
        "edgeM": edge,
        "validShare": float(np.isfinite(dem.a).mean()),
        "siteHeightM": float(dem.sample(x, y)),
    }


def height_diff(local: geo.Dem, coarse: geo.Dem, every: int = 16) -> dict:
    """local - coarse (m) at every n-th local pixel centre where both have data."""
    rows = np.arange(0, local.a.shape[0], every)
    cols = np.arange(0, local.a.shape[1], every)
    c, r = np.meshgrid(cols, rows)
    x = local.x0 + (c + 0.5) * local.dx
    y = local.y0 + (r + 0.5) * local.dy
    d = local.a[r, c] - coarse.sample(x, y)
    d = d[np.isfinite(d)]
    return {
        "n": int(d.size),
        "meanM": float(d.mean()),
        "medianM": float(np.median(d)),
        "rmsM": float(np.sqrt(np.mean(d**2))),
        "p95AbsM": float(np.percentile(np.abs(d), 95)),
    }


def mask_diff(az, a, b, sector_deg: float = 45.0) -> dict:
    """b - a (deg) per azimuth: overall max/mean |d| and per sector [start, start + sector)."""
    d = np.asarray(b) - np.asarray(a)
    ad = np.abs(d)
    sectors = []
    for s in np.arange(0.0, 360.0, sector_deg):
        m = (az >= s) & (az < s + sector_deg)
        sectors.append((float(s), float(ad[m].max()), float(ad[m].mean()), float(d[m].mean())))
    i = int(ad.argmax())
    return {
        "maxAbs": float(ad.max()),
        "azOfMax": float(az[i]),
        "signedAtMax": float(d[i]),
        "meanAbs": float(ad.mean()),
        "meanSigned": float(d.mean()),
        "sectors": sectors,
    }


def sun_share(ephem, ets, lon_e, lat, h0, az, el) -> np.ndarray:
    """Visible share of the Sun disc area per epoch (uniform disc; the app's sunVisible is limb-darkened flux)."""
    saz, sel, srad = ephem.topo("SUN", ets, lon_e, lat, h0 + 2.0)
    return geo.visible_fraction(saz, sel, srad, az, el)


def compare(a: dict, b: dict) -> dict:
    """b vs a: mask difference (deg) and Sun share difference (percentage points)."""
    lit_a, lit_b = a["share"] > 0, b["share"] > 0
    return {
        "mask": mask_diff(a["az"], a["el"], b["el"]),
        "dShareDiscPp": 100 * float(b["share"].mean() - a["share"].mean()),
        "dShareLimbPp": 100 * float(lit_b.mean() - lit_a.mean()),
        "flippedHours": int((lit_a != lit_b).sum()),
        "hours": len(a["share"]),
    }


def run(data: Path, with_20m: bool = False, ets=None) -> dict:
    from . import ephem
    from .__main__ import OBSERVER_M, epochs

    site = next(s for s in json.loads(SITES_JSON.read_text())["sites"] if s["id"] == SITE_ID)
    lon, lat = site["lonE"], site["lat"]
    ephem.load_kernels(data / "spice")
    ets = epochs() if ets is None else ets
    d80 = geo.Dem(data / "lola" / "LDEM_80S_80MPP_ADJ.TIF")
    d240 = geo.Dem(data / "lola" / "LDEM_60S_240MPP_ADJ.TIF")
    d5 = geo.Dem(data / LOCAL_FILE)
    cov = coverage(d5, lon, lat)
    if not cov["inside"] or not np.isfinite(cov["siteHeightM"]):
        raise ValueError(f"{SITE_ID} is outside the local tile {LOCAL_FILE}")
    terrains = {
        "80m": geo.Terrain(d80, d240),
        "5m": geo.Terrain(d5, d80, d240),
    }
    if with_20m:  # the app's nested grid (20 m window over HTTP)
        terrains["20m"] = geo.Terrain(geo.fine_dem(lon, lat), d80, d240)
    out = {"site": site, "coverage": cov, "heights": height_diff(d5, d80), "terrain": {}}
    for k, t in terrains.items():
        az, el, h0 = geo.horizon_mask(t, lon, lat, OBSERVER_M)
        share = sun_share(ephem, ets, lon, lat, h0, az, el)
        out["terrain"][k] = {"az": az, "el": el, "h0": h0, "share": share}
    out["pairs"] = {}
    for new, old in (("5m", "80m"), ("20m", "80m"), ("5m", "20m")):
        if new in out["terrain"] and old in out["terrain"]:
            out["pairs"][(new, old)] = compare(out["terrain"][old], out["terrain"][new])
    import spiceypy

    spiceypy.kclear()
    return out


def main(argv=None) -> None:
    import argparse

    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--with-20m", action="store_true", help="also the app's 20 m window (HTTP)")
    a = p.parse_args(argv)
    r = run(a.data, a.with_20m)
    s, c, h = r["site"], r["coverage"], r["heights"]
    print(f"site {s['id']} {s['lat']} {s['lonE']}E; local tile {LOCAL_URL}")
    print(
        f"tile x {c['x'][0]:.0f}..{c['x'][1]:.0f} m, y {c['y'][0]:.0f}..{c['y'][1]:.0f} m; "
        f"site {c['edgeM']:.0f} m from the edge; valid {c['validShare'] * 100:.1f} %"
    )
    print(
        f"height 5m - 80m over the tile (n={h['n']}): mean {h['meanM']:+.2f} m, median "
        f"{h['medianM']:+.2f}, RMS {h['rmsM']:.2f}, p95 |d| {h['p95AbsM']:.2f} m"
    )
    for k, v in r["terrain"].items():
        print(
            f"[{k:>3s}] h0 {v['h0']:8.2f} m; mask {v['el'].min():+.2f}..{v['el'].max():+.2f} deg; "
            f"Sun disc {v['share'].mean() * 100:.2f} %, any limb {(v['share'] > 0).mean() * 100:.2f} %"
        )
    for (new, old), v in r["pairs"].items():
        m = v["mask"]
        print(
            f"{new} vs {old}: max |d| {m['maxAbs']:.3f} deg at az {m['azOfMax']:.1f} "
            f"({m['signedAtMax']:+.3f}); mean |d| {m['meanAbs']:.3f}, mean d {m['meanSigned']:+.3f}; "
            f"Sun disc {v['dShareDiscPp']:+.2f} pp, any limb {v['dShareLimbPp']:+.2f} pp, "
            f"{v['flippedHours']} of {v['hours']} h flip lit/dark"
        )
        for s0, mx, mn, sg in m["sectors"]:
            print(
                f"      az {s0:5.0f}-{s0 + 45:3.0f}: max |d| {mx:.3f}, mean |d| {mn:.3f}, mean d {sg:+.3f}"
            )


if __name__ == "__main__":
    main()
