import math

import pytest

from precompute.earth_windows import windows


def test_rise_and_set_refine_without_merging():
    result = windows(lambda t: (t - 20) * (80 - t), 0, 100, 10, 0.001)
    assert result[0][0] == pytest.approx(20, abs=0.001)
    assert result[0][1] == pytest.approx(80, abs=0.001)


def test_period_edges_no_crossing_and_gap():
    assert windows(lambda _: 1, 0, 100, 10) == [(0, 100)]
    assert windows(lambda _: -1, 0, 100, 10) == []
    result = windows(lambda t: abs(t - 50) - 12, 0, 100, 5, 0.001)
    assert len(result) == 2
    assert result[0][1] == pytest.approx(38, abs=0.001)
    assert result[1][0] == pytest.approx(62, abs=0.001)
    assert result[1][1] == 100


def test_missing_coverage_and_invalid_range():
    assert windows(lambda t: math.nan if t == 50 else 1, 0, 100, 10) is None
    assert windows(lambda t: None if 50 < t < 60 else t - 55, 0, 100, 10) is None
    with pytest.raises(ValueError):
        windows(lambda _: 1, 0, 0)


def test_sampling_does_not_claim_to_find_substep_gap():
    # A 2-second gap between samples is intentionally not merged; it is unobserved.
    assert windows(lambda t: abs(t - 55) - 1, 0, 100, 10) == [(0, 100)]


def test_non_finite_step_rejected():
    with pytest.raises(ValueError):
        windows(lambda _: 1, 0, 10, math.nan)


def test_real_boundaries_against_independent_dense_samples():
    """Check the precomputed example against 1 s sampling, without the window finder."""
    import numpy as np
    import spiceypy as sp
    from test_precompute import DATA, SPICE, _complete

    needed = [*SPICE, "lola/LDEM_60S_240MPP_ADJ.TIF"]
    if not all(_complete(name) for name in needed):
        pytest.skip("NASA DATA MISSING: example needs checked SPICE and LOLA 240 m files")
    from precompute.ephem import load_kernels, topo, utc_to_et
    from precompute.geo import Dem, Terrain, horizon_mask

    load_kernels(DATA / "spice")
    try:
        terrain = Terrain(Dem(DATA / "lola/LDEM_60S_240MPP_ADJ.TIF"))
        az, el, ground = horizon_mask(terrain, 222.69, -89.45, h_obs=2, az_step=1)
        for utc, direction in [("2026-12-14T04:33:26", 1), ("2026-12-27T11:38:57", -1)]:
            center = utc_to_et(utc)
            times = center + np.arange(-10, 11, 1)
            earth_az, earth_el, _ = topo("EARTH", times, 222.69, -89.45, ground + 2)
            visible = earth_el > np.interp(earth_az, az, el, period=360)
            changes = np.flatnonzero(np.diff(visible.astype(int)) == direction)
            assert len(changes) == 1
            assert abs(times[changes[0]] - center) <= 2
    finally:
        sp.kclear()
