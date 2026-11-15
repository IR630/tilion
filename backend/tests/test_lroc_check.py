"""LROC shadow check (#217): Otsu cut, agreement/IoU, cast-shadow length on a synthetic wall."""

import numpy as np

from precompute.geo import Dem, Terrain, frame, from_xy, unit
from precompute.lroc_check import otsu, photometric_shadow, scores, sun_horizon, sun_vector


def test_otsu_cuts_between_two_brightness_groups():
    rng = np.random.default_rng(1)
    dark, bright = rng.normal(0.01, 0.002, 3000), rng.normal(0.05, 0.005, 1000)
    t = otsu(np.concatenate([dark, bright]))
    assert dark.max() < t < bright.min()


def test_scores_count_agreement_and_shadow_iou():
    image = np.array([1, 1, 1, 0, 0, 0, 0, 0], bool)
    model = np.array([1, 1, 0, 1, 0, 0, 0, 0], bool)
    agree, iou = scores(image, model)
    assert agree == 75.0  # 6 of 8 cells
    assert iou == 0.5  # 2 shared shadow cells of 4 shadow cells in either mask


def _flat_with_wall(x_wall: float, height: float) -> Dem:
    """10 m grid, 0 m everywhere, a wall `height` m tall on the column at x = x_wall."""
    d = Dem.__new__(Dem)
    n = 801
    d.x0, d.y0, d.dx, d.dy = -4000.0, 4000.0 + 100e3, 10.0, -10.0  # centred at x 0, y 100 km
    d.a = np.zeros((n, n), np.float32)
    col = int((x_wall - d.x0) / d.dx)
    d.a[:, col - 1 : col + 2] = height
    return d


def test_wall_casts_shadow_of_height_over_tan_elevation():
    # Sun 10 deg high, due along +x of the map; wall 100 m tall at x = 0: shadow ~567 m towards -x.
    terrain = Terrain(_flat_with_wall(0.0, 100.0))
    lon, lat = (float(v) for v in from_xy(0.0, 100e3))
    up = unit(lon, lat)
    east_map = np.array([0.0, 1.0, 0.0])  # map +x at (0, y > 0), lon 0: MOON_ME +y
    sun = np.cos(np.radians(10)) * east_map + np.sin(np.radians(10)) * up
    xs = np.array([-300.0, -500.0, -650.0, -900.0])
    el, hz = sun_horizon(terrain, xs, np.full(4, 100e3), sun, max_m=3000)
    lit = el + 0.265 > hz
    assert list(lit) == [False, False, True, True]


def test_sun_vector_round_trips_local_angles():
    lon, lat = 222.8, -89.44
    s = sun_vector(123.0, 1.5, lon, lat)
    up, east, north = frame(lon, lat)
    assert np.isclose(np.degrees(np.arcsin(s @ up)), 1.5)
    assert np.isclose(np.degrees(np.arctan2(s @ east, s @ north)), 123.0)


def test_photometric_shadow_keeps_dim_lit_slopes_lit():
    # S8 failure mode: a sunlit slope under grazing light is dim, but not a shadow (S9, #217).
    case = {"tau": 0.3, "min_p": 0.05, "ref_p": 0.05}
    cos_e = np.ones(8)
    cos_i = np.array([0.30, 0.30, 0.30, 0.30, 0.08, 0.08, -0.10, 0.02])
    p = np.clip(cos_i, 0, None) / (np.clip(cos_i, 0, None) + cos_e)
    iof = 0.1 * p  # all lit with albedo 0.1 ...
    iof[[1, 5, 6]] = 0.0008  # ... except a bright-slope and a dim-slope cast shadow, a back slope
    shadow, scored, albedo = photometric_shadow(iof, cos_i, cos_e, case)
    assert np.isclose(albedo, 0.1)
    # Cell 4 is a dim lit slope: it stays lit.
    assert np.flatnonzero(shadow[:7]).tolist() == [1, 5, 6]
    assert list(scored) == [True] * 7 + [False]  # 0 < P < min_p: left out
