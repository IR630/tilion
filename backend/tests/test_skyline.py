import numpy as np

from precompute.geo import horizon_mask
from precompute.skyline import skyline_layers


def test_distance_cuts_give_near_le_mid_le_full_and_full_is_the_mask():
    class Bumps:
        step = 80.0

        def sample(self, x, y):
            x, y = np.asarray(x), np.asarray(y)
            return 40 + 30 * np.sin(x / 700) * np.cos(y / 900) + 400 * np.sin((x + 2 * y) / 9000)

    terrain = Bumps()
    near, mid, full = skyline_layers(terrain, 20, -85, az_step=7.5, max_m=60e3)
    _, mask, _ = horizon_mask(terrain, 20, -85, az_step=7.5, max_m=60e3)
    assert np.all(near <= mid) and np.all(mid <= full)
    assert np.array_equal(full, mask)
    # The cuts matter: far terrain sets the skyline at some azimuths, so the check is not trivial.
    assert np.any(near < mid) and np.any(mid < full)
