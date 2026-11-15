import numpy as np
import pytest

from precompute import beta_dsn_links as links


def test_each_station_must_clear_both_horizons(monkeypatch):
    stations = ((0,), (1,), (2,))
    monkeypatch.setattr(links.dsn, "STATIONS", stations)
    lunar_elevation = ([2, -1, 2], [2, 2, 2], [-1, 2, 2])
    monkeypatch.setattr(
        links.dsn,
        "station_topo",
        lambda ets, station, *_: (np.zeros(3), np.asarray(lunar_elevation[station[0]])),
        raising=False,
    )
    # At hour 0 only Goldstone clears both ends. At hour 1 Madrid is exactly
    # on the strict Earth-side threshold. At hour 2 all three stations clear.
    moon = np.array([[20, 20, 20], [5, 10, 20], [20, 20, 20]])
    codes = links.site_codes(
        np.arange(3),
        {"lonE": 0, "lat": -89},
        {"elevDeg": [0, 0], "azStepDeg": 180},
        2,
        moon,
        10,
    )
    assert codes == "147"


def test_rejects_stale_earth_centre_timeline():
    links.check_timeline("107", {"siteId": "ridge", "dsnVisible": [1, 0, 1]})
    with pytest.raises(ValueError, match="disagree"):
        links.check_timeline("107", {"siteId": "ridge", "dsnVisible": [0, 0, 1]})
