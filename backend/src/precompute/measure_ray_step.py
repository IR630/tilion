"""Measurement only: refine the current ray grid without changing production sampling."""

from itertools import pairwise
from pathlib import Path

import numpy as np

from . import geo
from .geo import visible_fraction


def refined_distances(original, cap_m=240.0):
    """Keep all original samples and endpoints; subdivide each gap to at most cap_m."""
    if not np.isfinite(cap_m) or cap_m <= 0:
        raise ValueError("ray step cap must be finite and positive")
    parts = [
        np.linspace(a, b, int(np.ceil((b - a) / cap_m)), endpoint=False)
        for a, b in pairwise(original)
    ]
    return np.concatenate([*parts, original[-1:]])


def subdivided(original, factor=4):
    """Keep all original samples; split each gap into `factor` equal parts (a factor× finer step)."""
    if int(factor) != factor or factor < 1:
        raise ValueError("refinement factor must be a positive integer")
    parts = [np.linspace(a, b, int(factor), endpoint=False) for a, b in pairwise(original)]
    return np.concatenate([*parts, original[-1:]])


def sunset_shifts_h(lit_coarse, lit_fine, step_h):
    """Sunsets (lit -> dark) on both grids. Returns (count coarse, count fine, max shift h).

    Each coarse sunset is paired with the nearest fine sunset; the shift is their time difference.
    """

    def sets(lit):
        lit = np.asarray(lit, dtype=bool)
        return np.flatnonzero(lit[:-1] & ~lit[1:]) + 1

    c, f = sets(lit_coarse), sets(lit_fine)
    if len(c) == 0 or len(f) == 0:
        return len(c), len(f), 0.0 if len(c) == len(f) else float("inf")
    j = np.searchsorted(f, c)
    lo, hi = f[np.clip(j - 1, 0, len(f) - 1)], f[np.clip(j, 0, len(f) - 1)]
    near = np.minimum(np.abs(lo - c), np.abs(hi - c))
    return len(c), len(f), float(near.max() * step_h)


def mask_on_grid(terrain, lon_e, lat, d, h_obs=2.0, az_step=0.5):
    """Same maths as geo.horizon_mask, but on the given ray distances d (m)."""
    up, east, north = geo.frame(lon_e, lat)
    h0 = float(terrain.sample(*geo.to_xy(up)))
    if np.isnan(h0):
        raise ValueError(f"no DEM under the site {lon_e}E {lat}")
    ro = geo.R + h0 + h_obs
    az = np.arange(0.0, 360.0, az_step)
    psi = d / geo.R
    a = np.radians(az)[:, None, None]
    direction = np.cos(a) * north + np.sin(a) * east
    p = np.cos(psi)[None, :, None] * up + np.sin(psi)[None, :, None] * direction
    rq = geo.R + terrain.sample(*geo.to_xy(p))
    vert = rq * np.cos(psi) - ro
    dist = np.sqrt(rq**2 + ro**2 - 2 * rq * ro * np.cos(psi))
    el = np.degrees(np.arcsin(vert / dist))
    el = np.where(np.isnan(el), -90.0, el)
    return az, el.max(axis=1), h0


def compare_masks(
    terrain, lon_e, lat, h_obs=2.0, az_step=0.5, max_m=300e3, cap_m=240.0, factor=None
):
    """Production grid vs a refined grid: each gap capped to cap_m, or split `factor` times.

    Returns (az, coarse, fine, ground height m).
    """
    d = geo.distances(terrain.step / 2, max_m)
    az, coarse, h0 = mask_on_grid(terrain, lon_e, lat, d, h_obs, az_step)
    fine_d = subdivided(d, factor) if factor else refined_distances(d, cap_m)
    _, fine, _ = mask_on_grid(terrain, lon_e, lat, fine_d, h_obs, az_step)
    return az, coarse, fine, h0


def main(argv=None) -> None:
    import argparse

    from . import ephem

    p = argparse.ArgumentParser(
        description="Mask and Sun share: production ray step vs capped step."
    )
    p.add_argument("--data", type=Path, required=True)
    p.add_argument("--cap", type=float, default=240.0)
    p.add_argument(
        "--catalog",
        action="store_true",
        help="#381: catalog sites with DEM, step split --factor times, sunset shift",
    )
    p.add_argument("--factor", type=int, default=4)
    a = p.parse_args(argv)
    ephem.load_kernels(a.data / "spice")
    terrain = geo.Terrain(
        geo.Dem(a.data / "lola" / "LDEM_80S_80MPP_ADJ.TIF"),
        geo.Dem(a.data / "lola" / "LDEM_60S_240MPP_ADJ.TIF"),
    )
    if a.catalog:
        return catalog(a, terrain)
    ets = ephem.utc_to_et("2020-01-01T00:00:00") + np.arange(0, int(18.6 * 365.25 * 8)) * 10800.0
    sites = {"ridge C1": (222.83, -89.4398), "Shackleton rim": (203.97, -89.7849)}
    for name, (lon, lat) in sites.items():
        az, coarse, fine, h0 = compare_masks(terrain, lon, lat, cap_m=a.cap)
        saz, sel, srad = ephem.topo("SUN", ets, lon, lat, h0 + 2.0)
        share = [visible_fraction(saz, sel, srad, az, m) for m in (coarse, fine)]
        d = fine - coarse
        print(
            f"{name:15s} cap {a.cap:.0f} m: max|d elev| {np.abs(d).max():.4f} deg "
            f"(mean {np.abs(d).mean():.5f}, az {az[np.abs(d).argmax()]:.1f}); "
            f"disc share {share[0].mean() * 100:.2f} -> {share[1].mean() * 100:.2f} % "
            f"(d {100 * (share[1].mean() - share[0].mean()):+.3f} pp); "
            f"any limb {(share[0] > 0).mean() * 100:.2f} -> {(share[1] > 0).mean() * 100:.2f} %"
        )


def catalog(a, terrain, step_min=10):
    """#381 measurement: every catalog site with DEM, production step vs a factor× finer step."""
    import json

    from . import ephem
    from .__main__ import END_UTC, START_UTC

    root = Path(__file__).resolve().parents[3]
    sites = json.loads((root / "web/public/data/sites.json").read_text(encoding="utf-8"))["sites"]
    sites = [s for s in sites if s["terrain"] in ("polar80", "polar240") and s["lat"] is not None]
    t0, t1 = (ephem.utc_to_et(t.rstrip("Z")) for t in (START_UTC, END_UTC))
    ets = np.arange(t0, t1, step_min * 60.0)
    worst_el, worst_h = 0.0, 0.0
    for s in sites:
        az, coarse, fine, h0 = compare_masks(terrain, s["lonE"], s["lat"], factor=a.factor)
        saz, sel, srad = ephem.topo("SUN", ets, s["lonE"], s["lat"], h0 + 2.0)
        lit = [visible_fraction(saz, sel, srad, az, m) > 0 for m in (coarse, fine)]
        nc, nf, shift = sunset_shifts_h(*lit, step_min / 60)
        d = np.abs(fine - coarse)
        worst_el, worst_h = max(worst_el, d.max()), max(worst_h, shift)
        print(
            f"{s['id']:24s} {s['terrain']:8s} max|d mask| {d.max():.4f} deg (az {az[d.argmax()]:5.1f}); "
            f"lit {lit[0].mean() * 100:6.2f} -> {lit[1].mean() * 100:6.2f} %; "
            f"sunsets {nc} -> {nf}; max sunset shift {shift:.2f} h"
        )
    print(
        f"RESULT {len(sites)} sites, step /{a.factor}: max|d mask| {worst_el:.4f} deg, "
        f"max sunset shift {worst_h:.2f} h; port bound if > 0.05 deg or > 1 h: "
        f"{'YES' if worst_el > 0.05 or worst_h > 1 else 'NO'}"
    )


if __name__ == "__main__":
    main()
