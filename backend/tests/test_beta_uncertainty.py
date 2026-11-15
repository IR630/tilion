"""BETA uncertainty (#258): Sun and Earth shares when the LOLA terrain is 1 sigma higher or lower."""

import json
from pathlib import Path

import numpy as np
import pytest

from precompute import beta_uncertainty as bu
from precompute.geo import R

WEB = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


def _tracks(n=2000):
    """Synthetic Sun and Earth: the Sun circles at a slowly changing elevation, the Earth bobs near 0 deg."""
    k = np.arange(n)
    saz = (k * 15.0) % 360
    sel = 1.5 * np.sin(k * 2 * np.pi / 700)
    eaz = np.full(n, 0.0)
    eel = 1.0 * np.sin(k * 2 * np.pi / 650)
    return saz, sel, np.full(n, 0.267), eaz, eel, np.full(n, 0.95)


def _mask():
    az = np.arange(720) * 0.5
    return 0.6 + 0.5 * np.sin(np.radians(3 * az))


def test_sigma_zero_collapses_to_the_value():
    mask = _mask()
    err = bu.error_profile(np.full(720, 5000.0), 0.0)
    assert not err.any()
    b = bu.bands(mask, err, *_tracks())
    for body in ("sun", "earth"):
        assert b[body]["lo"] == b[body]["value"] == b[body]["hi"]
    # The value is the plain share over the mask as given (D-010 flux > 0, Earth centre).
    sun, earth = bu.lit_and_view(mask, *_tracks())
    assert b["sun"]["value"] == round(sun.mean(), 4) and b["earth"]["value"] == round(
        earth.mean(), 4
    )


def test_raised_terrain_hides_lowered_reveals():
    b = bu.bands(_mask(), bu.error_profile(np.full(720, 2000.0), 20.0), *_tracks())
    for body in ("sun", "earth"):
        assert b[body]["lo"] < b[body]["value"] < b[body]["hi"]


def test_missing_terrain_azimuths_do_not_move():
    mask = np.full(720, -90.0)
    b = bu.bands(mask, np.full(720, 5.0), *_tracks())
    assert b["sun"]["lo"] == b["sun"]["hi"] == b["sun"]["value"]


def test_error_angle_matches_exact_geometry():
    """atan(sigma / d) against the exact elevation change of a point raised by sigma on the sphere."""

    def elev(d, h, ro=R + 2.0):
        psi = d / R
        rq = R + h
        return np.degrees(
            np.arcsin((rq * np.cos(psi) - ro) / np.sqrt(rq**2 + ro**2 - 2 * rq * ro * np.cos(psi)))
        )

    for d, h in ((300.0, 20.0), (5000.0, 150.0), (50e3, 2500.0), (150e3, 3000.0)):
        exact = elev(d, h + 0.5) - elev(d, h)
        approx = bu.error_profile([d], 0.5)[0]
        assert approx == pytest.approx(exact, rel=0.05), (d, h)
    assert bu.error_profile([0.0, np.nan], 1.0).tolist() == [0.0, 0.0]


def test_blocker_points_lie_at_the_arc_distance():
    from precompute.geo import from_xy

    x, y = bu.blocker_points(222.69, -89.45, np.full(720, 10e3))
    lon, lat = from_xy(x, y)
    a, b = np.radians(-89.45), np.radians(lat)
    c = np.sin(a) * np.sin(b) + np.cos(a) * np.cos(b) * np.cos(np.radians(lon - 222.69))
    assert np.allclose(np.arccos(np.clip(c, -1, 1)) * R, 10e3, rtol=1e-6)


def test_file_value_equals_timeline_share_and_band_brackets_it():
    """sigma = 0 point of the published band is the share the app shows today (timeline/<id>.json)."""
    f = WEB / "beta" / "uncertainty.json"
    if not f.exists():
        pytest.skip("beta/uncertainty.json not generated")
    data = json.loads(f.read_text())
    assert data["sigma"] and data["sites"]
    for row in data["sites"]:
        tl = json.loads((WEB / "timeline" / f"{row['siteId']}.json").read_text())
        n = len(tl["sunVisible"])
        assert n == data["hours"]
        assert row["sun"]["value"] == pytest.approx(
            sum(v > 0 for v in tl["sunVisible"]) / n, abs=1e-4
        )
        assert row["earth"]["value"] == pytest.approx(sum(tl["earthVisible"]) / n, abs=1e-4)
        for body in ("sun", "earth"):
            assert row[body]["lo"] <= row[body]["value"] <= row[body]["hi"]


def test_sigma_is_in_the_published_lola_error_range():
    """External scale: Barker et al. 2021 (PGDA 78) give a median height RMS error of 0.3-0.5 m; the
    PGDA 90 error layers have medians 0.46 m (80 m) and 0.91 m (240 m). A site median far outside
    0.05-2 m means the wrong layer, units or pixels were read."""
    f = WEB / "beta" / "uncertainty.json"
    if not f.exists():
        pytest.skip("beta/uncertainty.json not generated")
    rows = json.loads(f.read_text())["sites"]
    assert len(rows) >= 18
    for row in rows:
        assert 0.05 <= row["sigmaMedianM"] <= 2.0, row["siteId"]
        assert 0.0 < row["errMaxDeg"] < 2.0, row["siteId"]


def _series(s: dict, n: int) -> np.ndarray:
    """0/1 array back from {start, flips} (#379)."""
    a = np.zeros(n, dtype=int)
    state, prev = s["start"], 0
    for f in s["flips"] + [n]:
        a[prev:f] = state
        state, prev = 1 - state, f
    return a


def _sets(a: np.ndarray) -> list[int]:
    return (np.flatnonzero(np.diff(a) == -1) + 1).tolist()


def test_events_round_trip_and_raised_never_sets_later():
    """#379: flips() is lossless; over a raised mask every set comes no later than the nominal one,
    over a lowered mask no earlier (synthetic tracks)."""
    tr = _tracks()
    st = bu.states(_mask(), bu.error_profile(np.full(720, 2000.0), 20.0), *tr)
    ev = bu.events(st)
    n = len(tr[0])
    for j, body in enumerate(("sun", "earth")):
        assert np.array_equal(_series(ev[body]["nominal"], n), st["value"][j])
        nom, lo, hi = (_series(ev[body][k], n) for k in ("nominal", "raised", "lowered"))
        assert lo.sum() < nom.sum() < hi.sum()
        _check_band(nom, lo, hi)


def _check_band(nom, raised, lowered):
    # Raised terrain only hides, lowered only reveals: hour by hour, then per nominal set.
    assert not (raised & ~nom.astype(bool)).any() and not (nom & ~lowered.astype(bool)).any()
    for k in _sets(nom):
        assert raised[k] == 0  # the raised set comes at or before the nominal one
        assert lowered[k - 1] == 1  # the lowered set comes at or after it


def test_events_file_matches_timeline_and_brackets_it():
    """#379: the nominal transitions in beta/uncertainty_events.json are those of timeline/<id>.json
    (Sun lit = sunVisible > 0, Earth = earthVisible); raised sets never later, lowered never earlier."""
    f = WEB / "beta" / "uncertainty_events.json"
    if not f.exists():
        pytest.skip("beta/uncertainty_events.json not generated")
    data = json.loads(f.read_text())
    assert data["stepMin"] == 60 and len(data["sites"]) >= 18
    for row in data["sites"]:
        tl = json.loads((WEB / "timeline" / f"{row['siteId']}.json").read_text())
        assert tl["startUtc"] == data["startUtc"] and tl["stepMin"] == data["stepMin"]
        n = data["hours"]
        want = {
            "sun": (np.array(tl["sunVisible"]) > 0).astype(int),
            "earth": np.array(tl["earthVisible"], dtype=int),
        }
        for body in ("sun", "earth"):
            nom = _series(row[body]["nominal"], n)
            assert np.array_equal(nom, want[body]), (row["siteId"], body)
            _check_band(nom, _series(row[body]["raised"], n), _series(row[body]["lowered"], n))


def test_set_shift_matches_err_over_elevation_rate():
    """#379 independent check: Sun sinking at r deg/h toward a flat mask; a mask moved by e deg moves the
    set by e / r hours (here 0.5 / 0.1 = 5 h each way), within one hourly step."""
    n = 200
    k = np.arange(n)
    sel = 10.0 - 0.1 * k  # sets on the flat 0.6 deg mask near hour 95
    tr = (
        np.full(n, 90.0),
        sel,
        np.full(n, 0.267),
        np.full(n, 270.0),
        np.full(n, -30.0),
        np.full(n, 0.95),
    )
    st = bu.states(np.full(720, 0.6), np.full(720, 0.5), *tr)
    nom, lo, hi = (_sets(st[x][0]) for x in ("value", "lo", "hi"))
    assert len(nom) == len(lo) == len(hi) == 1
    assert abs((nom[0] - lo[0]) - 5) <= 1 and abs((hi[0] - nom[0]) - 5) <= 1
