import numpy as np
import pytest

from precompute.blocker import horizon_blocker, horizon_peaks
from precompute.geo import horizon_mask, to_xy, unit


def test_single_wall_distance_is_within_one_ray_step():
    _, y0 = to_xy(unit(0, -89))

    class Wall:
        step = 80.0

        def sample(self, x, y):
            return np.where(abs(np.asarray(y) - y0 - 1000) <= self.step / 2, 100.0, 0.0)

    terrain = Wall()
    result = horizon_blocker(terrain, 0, -89, az_step=90, max_m=3000)
    assert result["distM"][0] == pytest.approx(1000, abs=terrain.step / 2)
    assert result["riseM"][0] == 100
    # The copied ray loop must identify the same peak as the mask.
    _, el, _ = horizon_mask(terrain, 0, -89, az_step=90, max_m=3000)
    assert el[0] > 5


def test_peak_elevation_equals_horizon_mask_on_rough_terrain():
    # Two ray loops (blocker.py and geo.horizon_mask) must keep the same peak at every azimuth.
    class Bumps:
        step = 80.0

        def sample(self, x, y):
            x, y = np.asarray(x), np.asarray(y)
            return 40 + 30 * np.sin(x / 700) * np.cos(y / 900) + 25 * np.sin((x + 2 * y) / 311)

    terrain = Bumps()
    az, el, _ = horizon_mask(terrain, 20, -85, h_obs=2.0, az_step=7.5, max_m=20e3)
    peak_el, dist, _, _ = horizon_peaks(terrain, 20, -85, h_obs=2.0, az_step=7.5, max_m=20e3)
    assert len(az) == len(peak_el) == 48
    assert peak_el == pytest.approx(el, abs=1e-9)
    assert len(set(dist)) > 5  # peaks differ by azimuth, so the comparison is not trivial
