"""Local 5 m DEM (PGDA 78 Site01) vs LOLA 80 m: coverage, fallback, and the measured difference."""

import numpy as np
import pytest
from test_precompute import DATA, SPICE, need

from precompute import geo
from precompute.compare_dem import LOCAL_FILE, coverage, mask_diff

LOLA = ["lola/LDEM_80S_80MPP_ADJ.TIF", "lola/LDEM_60S_240MPP_ADJ.TIF"]


def _tif(path, x0, y0, step, a):
    import rasterio
    from rasterio.transform import from_origin

    with rasterio.open(
        path, "w", driver="GTiff", width=a.shape[1], height=a.shape[0], count=1,
        dtype="float32", transform=from_origin(x0, y0, step, step), nodata=np.nan,
    ) as ds:  # fmt: skip
        ds.write(a.astype(np.float32), 1)
    return geo.Dem(path)


def test_local_tile_is_not_extended_beyond_its_coverage(tmp_path):
    # 5 m tile 1 km wide at 100 m height inside an 80 m grid at 0 m.
    local = _tif(tmp_path / "local.tif", -1000.0, 1000.0, 5.0, np.full((200, 200), 100.0))
    coarse = _tif(tmp_path / "coarse.tif", -8000.0, 8000.0, 80.0, np.zeros((200, 200)))
    t = geo.Terrain(local, coarse)
    assert t.step == 5.0
    x = np.array([-500.0, -1500.0, 2000.0])
    y = np.array([500.0, 500.0, -3000.0])
    np.testing.assert_allclose(t.sample(x, y), [100.0, 0.0, 0.0])
    lon, lat = (float(v) for v in geo.from_xy(-500.0, 500.0))
    c = coverage(local, lon, lat)
    assert c["inside"] and c["edgeM"] == pytest.approx(500.0, abs=0.01)
    assert c["siteHeightM"] == pytest.approx(100.0)
    lon, lat = (float(v) for v in geo.from_xy(2000.0, -3000.0))
    assert not coverage(local, lon, lat)["inside"]


def test_mask_diff_reports_max_mean_and_sectors():
    az = np.arange(0.0, 360.0, 0.5)
    a = np.zeros_like(az)
    b = np.where((az >= 90) & (az < 135), 2.0, 0.0)
    b[0] = -3.0
    m = mask_diff(az, a, b)
    assert m["maxAbs"] == 3.0 and m["azOfMax"] == 0.0 and m["signedAtMax"] == -3.0
    assert m["meanAbs"] == pytest.approx((90 * 2 + 3) / 720)
    assert len(m["sectors"]) == 8
    assert m["sectors"][2] == (90.0, 2.0, 2.0, 2.0)


@need(*SPICE, *LOLA, LOCAL_FILE)
def test_5m_vs_80m_at_connecting_ridge():
    from precompute.compare_dem import run

    r = run(DATA)
    c, h = r["coverage"], r["heights"]
    assert c["inside"] and c["edgeM"] > 7000  # measured 7452 m
    # Same sphere and frame: no vertical offset. Measured median +0.01 m, RMS 1.22 m.
    assert abs(h["medianM"]) < 1.0 and h["rmsM"] < 3.0, h
    assert abs(r["terrain"]["5m"]["h0"] - r["terrain"]["80m"]["h0"]) < 3.0  # measured 0.91 m
    p = r["pairs"][("5m", "80m")]
    m = p["mask"]
    assert 0.2 < m["maxAbs"] < 1.0 and m["meanAbs"] < 0.2, m  # measured 0.576 / 0.113 deg
    assert -2.0 < p["dShareDiscPp"] < -0.5, p["dShareDiscPp"]  # measured -1.11 pp
