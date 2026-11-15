"""Slope share inside a landing ellipse: synthetic surfaces, NoData, coverage edge, bad inputs, PGDA 78."""

import re
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from test_precompute import DATA, need

from precompute.ellipse import LOCAL_FILE, SLOPE_FILE, area_shares, slope_deg

STEP = 5.0
# 10 km x 10 km grid centred 20 km from the pole (azimuth needs a centre off the pole).
X0, Y0, N = 15000.0, 5000.0, 2000
CX, CY = X0 + N * STEP / 2, Y0 - N * STEP / 2


def _dem(z):
    return SimpleNamespace(a=np.asarray(z, dtype=np.float32), x0=X0, y0=Y0, dx=STEP, dy=-STEP)


def _plane(deg):
    # z rises along +x with the given slope; rows run along -y.
    xs = X0 + (np.arange(N) + 0.5) * STEP
    return np.tile(np.tan(np.radians(deg)) * (xs - X0), (N, 1))


def test_flat_plane_meets_any_threshold():
    r = area_shares(_dem(np.zeros((N, N))), CX, CY, 1000.0, 500.0, 30.0, [0.0, 2.0, 45.0])
    assert r["unknown"] == 0.0 and r["nodata"] == 0.0
    assert [t["meets"] for t in r["thresholds"]] == [1.0, 1.0, 1.0]
    assert r["baselineM"] == 10.0


def test_tilted_plane_splits_at_its_slope():
    z = _plane(8.0)
    np.testing.assert_allclose(slope_deg(z, STEP)[1:-1, 1:-1], 8.0, atol=1e-6)
    r = area_shares(_dem(z), CX, CY, 800.0, 800.0, 0.0, [7.9, 8.1])
    below, above = r["thresholds"]
    assert below["meets"] == 0.0 and below["fails"] == 1.0
    assert above["meets"] == 1.0 and above["fails"] == 0.0


def test_central_difference_baseline_is_2k_pixels():
    # A 1 m step between columns 9 and 10: k=1 sees it on 2 columns, k=2 on 4 columns.
    z = np.zeros((20, 20))
    z[:, 10:] = 1.0
    s1, s2 = slope_deg(z, STEP, 1), slope_deg(z, STEP, 2)
    assert np.count_nonzero(s1[5] > 0) == 2 and np.count_nonzero(s2[5] > 0) == 4
    assert s1[5, 9] == pytest.approx(np.degrees(np.arctan(1 / 10)))
    assert s2[5, 9] == pytest.approx(np.degrees(np.arctan(1 / 20)))


def test_nodata_patch_is_its_own_share_never_flat():
    z = np.zeros((N, N))
    # 100 x 100 px NoData square at the centre; central difference spreads it by 1 px each side.
    z[950:1050, 950:1050] = np.nan
    a = b = 1000.0
    r = area_shares(_dem(z), CX, CY, a, b, 0.0, [5.0])
    expected = (102 * STEP) ** 2 / (np.pi * a * b)
    assert r["nodata"] == pytest.approx(expected, rel=0.01)
    assert r["thresholds"][0]["meets"] == pytest.approx(1 - expected, rel=0.01)
    assert r["unknown"] == 0.0


def test_ellipse_over_coverage_edge_is_unknown_not_nodata():
    # Centre on the west edge of the tile: half the circle is outside coverage.
    r = area_shares(_dem(np.zeros((N, N))), X0, CY, 500.0, 500.0, 0.0, [5.0])
    assert r["unknown"] == pytest.approx(0.5, abs=0.01)
    assert r["nodata"] == 0.0
    t = r["thresholds"][0]
    assert t["meets"] + r["unknown"] == pytest.approx(1.0)
    far = area_shares(_dem(np.zeros((N, N))), X0 - 5000.0, CY, 500.0, 500.0, 0.0, [5.0])
    assert far["unknown"] == 1.0 and far["thresholds"][0]["meets"] == 0.0


def test_azimuth_turns_the_major_axis():
    # NoData band across x > CX + 600 m: a major axis of 1000 m along x reaches it, along y does not.
    z = np.zeros((N, N))
    z[:, int((CX + 600.0 - X0) / STEP) :] = np.nan
    # Local north = -(x, y)/r, east = (y, -x)/r, so the +x grid direction has azimuth atan2(y, -x).
    az_x = np.degrees(np.arctan2(CY, -CX))
    along_x = area_shares(_dem(z), CX, CY, 1000.0, 200.0, az_x, [5.0])
    along_y = area_shares(_dem(z), CX, CY, 1000.0, 200.0, az_x + 90.0, [5.0])
    assert along_x["nodata"] > 0.05
    assert along_y["nodata"] == 0.0


@pytest.mark.parametrize(
    "a, b, thr",
    [(-100.0, 50.0, 5.0), (100.0, 0.0, 5.0), (100.0, 50.0, -1.0), (100.0, 50.0, 90.0),
     (100.0, 50.0, float("nan")), (8.0, 50.0, 5.0)],
)  # fmt: skip
def test_invalid_inputs_raise(a, b, thr):
    with pytest.raises(ValueError):
        area_shares(_dem(np.zeros((N, N))), CX, CY, a, b, 0.0, [thr])


def test_centre_at_pole_raises():
    with pytest.raises(ValueError):
        area_shares(_dem(np.zeros((N, N))), 0.0, 0.0, 100.0, 50.0, 0.0, [5.0])


@need(LOCAL_FILE, SLOPE_FILE)
def test_slope_matches_pgda78_site01_slope_map():
    from precompute.ellipse import run

    r = run(DATA)
    s = r["slope"]
    # Same 5 m grid, central difference over 10 m: measured median 0, RMS 0.0002 deg.
    assert s["n"] > 10_000_000 and abs(s["medianDeg"]) < 1e-3 and s["rmsDeg"] < 1e-3, s
    assert r["slopeHorn"]["rmsDeg"] > 0.2  # Horn 3x3 is a different method: measured RMS 0.38 deg
    sh = r["shares"]
    assert sh["unknown"] == 0.0 and sh["nodata"] == 0.0  # cr1 is 7.4 km inside the tile
    m = [t["meets"] for t in sh["thresholds"]]
    assert m == sorted(m) and 0.0 < m[-1] <= 1.0
    # The UI example shows these shares; it must not drift from the computation.
    tsx = Path(__file__).resolve().parents[2] / "web" / "src" / "screens" / "EllipseExample.tsx"
    shown = [float(v) for v in re.findall(r"≤ \d+°: ([\d.]+) %", tsx.read_text(encoding="utf-8"))]
    assert [t["deg"] for t in sh["thresholds"]] == [5.0, 10.0, 15.0]
    assert [round(v * 100, 2) for v in m] == shown == [38.16, 85.35, 97.67]
