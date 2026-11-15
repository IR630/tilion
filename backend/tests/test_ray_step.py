"""The measurement refines distant rays without losing existing terrain samples."""

import numpy as np
import pytest

from precompute import geo


def test_refinement_preserves_samples_and_caps_every_gap():
    from precompute.measure_ray_step import refined_distances

    original = geo.distances(40.0, 300e3)
    refined = refined_distances(original, 240.0)
    assert np.all(np.isin(original, refined))
    assert refined[0] == original[0]
    assert refined[-1] == original[-1]
    assert np.diff(refined).min() > 0
    assert np.diff(refined).max() <= 240.0
    assert np.diff(original).max() > 1400.0
    assert len(refined) > len(original)
    with pytest.raises(ValueError):
        refined_distances(original, 0)


def test_measurement_detects_a_narrow_ridge_without_changing_production_grid():
    from precompute.measure_ray_step import compare_masks

    original = geo.distances(40.0, 300e3)
    i = np.searchsorted(original, 150e3)
    ridge_m = (original[i - 1] + original[i]) / 2

    class NarrowRidge:
        step = 80.0

        def sample(self, x, y):
            distance = 2 * geo.R * np.arctan(np.hypot(x, y) / (2 * geo.R))
            return np.where(np.abs(distance - ridge_m) < 100, 10000.0, 0.0)

    az, coarse, fine, h0 = compare_masks(NarrowRidge(), 0.0, -90.0, az_step=90.0)
    assert len(az) == 4 and h0 == 0
    assert np.all(fine > coarse + 1.0)
    np.testing.assert_array_equal(geo.distances(40.0, 300e3), original)


def test_coarse_side_is_the_production_mask():
    from precompute.measure_ray_step import compare_masks

    class Hill:
        step = 80.0

        def sample(self, x, y):
            return 300.0 * np.sin(np.hypot(x, y) / 5e3) + 300.0

    _, coarse, _, h0 = compare_masks(Hill(), 40.0, -89.0, az_step=45.0)
    _, prod, h0_prod = geo.horizon_mask(Hill(), 40.0, -89.0, az_step=45.0)
    np.testing.assert_allclose(coarse, prod)
    assert h0 == h0_prod


def test_subdivided_is_four_times_finer_and_keeps_samples():
    from precompute.measure_ray_step import subdivided

    original = geo.distances(40.0, 300e3)
    fine = subdivided(original, 4)
    assert np.all(np.isin(original, fine))
    assert len(fine) == 4 * (len(original) - 1) + 1
    np.testing.assert_allclose(np.diff(fine).max(), np.diff(original).max() / 4)
    with pytest.raises(ValueError):
        subdivided(original, 0)


def test_sunset_shift_pairs_each_sunset_with_the_nearest_one():
    from precompute.measure_ray_step import sunset_shifts_h

    coarse = np.array([1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0], bool)
    fine = np.array([1, 1, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0], bool)
    assert sunset_shifts_h(coarse, fine, 0.5) == (2, 2, 0.5)
    assert sunset_shifts_h(coarse, coarse, 0.5) == (2, 2, 0.0)
    assert sunset_shifts_h(coarse, np.ones(12, bool), 0.5)[2] == float("inf")
