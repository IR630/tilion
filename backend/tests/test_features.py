"""IAU feature names (#147) and numeric PGDA 69 grids for waypoints (#148).

features.json comes from scripts/features_assets.py (IAU Gazetteer, USGS); the illum grids come
from scripts/illum_grid_assets.py (PGDA 69 GeoTIFFs). Grid-vs-source checks need data/illum.
"""

import gzip
import importlib.util
import json
import math
import struct
from pathlib import Path

import numpy as np
import pytest
from test_precompute import DATA, DATA_SKIP_TAG

REPO = Path(__file__).resolve().parents[2]
WEB_DATA = REPO / "web" / "public" / "data"
R_MOON = 1737.4e3


def _script(name: str):
    spec = importlib.util.spec_from_file_location(name, REPO / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def features() -> dict:
    return json.loads((WEB_DATA / "features.json").read_text(encoding="utf-8"))


def test_features_file_is_compact_and_cites_the_gazetteer(features):
    assert (WEB_DATA / "features.json").stat().st_size < 200_000
    assert "Gazetteer" in features["source"] and "planetarynames.wr.usgs.gov" in features["url"]
    assert features["downloadedUtc"].startswith("20")
    feats = features["features"]
    assert features["count"] == len(feats) > 300
    assert len({f["id"] for f in feats}) == len(feats)
    for f in feats:
        assert set(f) == {"id", "name", "type", "lat", "lonE", "diameterKm", "url"}
        assert -90 <= f["lat"] <= -60, f
        assert 0 <= f["lonE"] < 360, f  # 0-360 degE, never +-180
        assert f["diameterKm"] >= 0 and f["name"].strip()
        assert f["url"].startswith("https://planetarynames.wr.usgs.gov/Feature/")
    d = [f["diameterKm"] for f in feats]
    assert d == sorted(d, reverse=True)  # big features first: the map labels them first


# Gazetteer values (checked against planetarynames.wr.usgs.gov, 2026-11-15); tolerance only.
KNOWN = {
    "Shackleton": (-89.67, 129.78, 20.9),
    "Haworth": (-87.45, 354.83, 51.4),
    "Shoemaker": (-88.14, 45.91, 51.8),
    "Faustini": (-87.18, 84.31, 42.5),
    "de Gerlache": (-88.48, 271.66, 32.7),
    "Cabeus": (-85.33, 317.87, 100.6),
    "Amundsen": (-84.44, 83.07, 103.4),
    "Malapert": (-85.0, 11.40, 72.4),
    "Nobile": (-85.28, 53.27, 79.3),
}


@pytest.mark.parametrize("name", sorted(KNOWN))
def test_known_south_polar_craters_are_present(features, name):
    lat, lon, diam = KNOWN[name]
    f = next(x for x in features["features"] if x["name"] == name)
    assert f["type"] == "crater"
    assert f["lat"] == pytest.approx(lat, abs=0.05)
    assert f["lonE"] == pytest.approx(lon, abs=0.1)
    assert f["diameterKm"] == pytest.approx(diam, rel=0.03)


def _dbf(rows: list[dict]) -> bytes:
    fields = [("name", 40), ("clean_name", 40), ("diameter", 24), ("center_lon", 24),
              ("center_lat", 24), ("type", 40), ("approval", 40), ("link", 80)]  # fmt: skip
    rec_len = 1 + sum(n for _, n in fields)
    head_len = 32 + 32 * len(fields) + 1
    out = bytearray(struct.pack("<BBBBIHH20x", 3, 126, 11, 15, len(rows), head_len, rec_len))
    for name, n in fields:
        out += name.encode().ljust(11, b"\0") + b"C" + b"\0" * 4 + bytes([n, 0]) + b"\0" * 14
    out += b"\r"
    for r in rows:
        out += b" " + b"".join(str(r.get(k, "")).encode().ljust(n)[:n] for k, n in fields)
    return bytes(out) + b"\x1a"


def test_script_filters_approved_polar_names_and_wraps_longitude():
    mod = _script("features_assets")
    rows = mod.read_dbf(
        _dbf(
            [
                {"name": "Polar", "clean_name": "Polar", "diameter": 10, "center_lon": -10, "center_lat": -80,
                 "type": "Crater, craters", "approval": "Adopted by IAU", "link": "http://planetarynames.wr.usgs.gov/Feature/1"},
                {"name": "North", "clean_name": "North", "diameter": 50, "center_lon": 20, "center_lat": -59.9,
                 "type": "Crater, craters", "approval": "Adopted by IAU", "link": "http://planetarynames.wr.usgs.gov/Feature/2"},
                {"name": "Dropped", "clean_name": "Dropped", "diameter": 5, "center_lon": 20, "center_lat": -85,
                 "type": "Crater, craters", "approval": "Dropped", "link": "http://planetarynames.wr.usgs.gov/Feature/3"},
                {"name": "Mons X", "clean_name": "Mons X", "diameter": 20, "center_lon": 359.5, "center_lat": -85,
                 "type": "Mons, montes", "approval": "Adopted by IAU", "link": "http://planetarynames.wr.usgs.gov/Feature/4"},
            ]
        )
    )  # fmt: skip
    got = mod.polar_features(rows)
    assert [f["name"] for f in got] == ["Mons X", "Polar"]
    assert got[0]["type"] == "mons" and got[1]["lonE"] == 350.0
    assert got[1]["url"] == "https://planetarynames.wr.usgs.gov/Feature/1" and got[1]["id"] == "1"


# ---------- numeric PGDA 69 grids ----------


def _stereo(lat: float, lon_e: float) -> tuple[float, float]:
    k = 2 * R_MOON * math.tan(math.radians(90 + lat) / 2)
    a = math.radians(lon_e)
    return k * math.sin(a), k * math.cos(a)


def _cell(g: dict, lat: float, lon_e: float) -> tuple[int, int] | None:
    """The same rule as web/src/mission/illumGrid.ts: row 0 = +y, col 0 = -x."""
    x, y = _stereo(lat, lon_e)
    x0, _, _, y1 = g["bounds"]
    col = math.floor((x - x0) / g["cellM"])
    row = math.floor((y1 - y) / g["cellM"])
    return (row, col) if 0 <= row < g["size"] and 0 <= col < g["size"] else None


def test_illum_grid_meta_is_small_and_complete():
    meta = json.loads((WEB_DATA / "illum" / "meta.json").read_text())
    total = 0
    for g in meta["grids"]:
        f = WEB_DATA / "illum" / g["file"]
        total += f.stat().st_size
        raw = gzip.decompress(f.read_bytes())
        assert len(raw) == g["size"] ** 2
        assert max(raw) == 255 or max(raw) <= 100  # 255 = no data
        assert g["cellM"] == pytest.approx((g["bounds"][2] - g["bounds"][0]) / g["size"])
    assert {g["id"] for g in meta["grids"]} == {"sun85", "earth85", "sun65", "earth65"}
    assert total < 5_000_000


SITES = [
    "shackleton_rim",
    "cr1_connecting_ridge",
    "a_haworth",
    "a_malapert_massif",
    "chandrayaan3",
    "a_peak_cabeus_b",
]


@pytest.mark.parametrize("grid_id", ["sun85", "earth85", "sun65", "earth65"])
def test_illum_grid_matches_the_pgda69_source_at_known_sites(grid_id):
    """Each cell is the mean of its 4x4 block of the GeoTIFF (int16 x 4e-5), rounded to 1 %.

    A cell is an area mean: on a sharp rim it differs from the 60 m point value (Shackleton rim:
    54 % cell vs 85 % point), so the UI labels it "240 m cell mean"."""
    rasterio = pytest.importorskip("rasterio")
    meta = json.loads((WEB_DATA / "illum" / "meta.json").read_text())
    g = next(x for x in meta["grids"] if x["id"] == grid_id)
    src = None if DATA is None else DATA / "illum" / g["source"].split(",")[0]
    if src is None or not src.exists():
        pytest.skip(f"{DATA_SKIP_TAG} data/illum/{g['source'].split(',')[0]}")
    grid = np.frombuffer(gzip.decompress((WEB_DATA / "illum" / g["file"]).read_bytes()), np.uint8)
    grid = grid.reshape(g["size"], g["size"])
    sites = {s["id"]: s for s in json.loads((WEB_DATA / "sites.json").read_text())["sites"]}
    checked = 0
    with rasterio.open(src) as ds:
        scale = ds.scales[0]
        for sid in SITES:
            s = sites[sid]
            rc = _cell(g, s["lat"], s["lonE"])
            if rc is None:
                continue
            row, col = rc
            r0, c0 = ds.index(
                g["bounds"][0] + 1, g["bounds"][3] - 1
            )  # the grid may crop the source
            win = ds.read(
                1,
                window=((r0 + row * 4, r0 + row * 4 + 4), (c0 + col * 4, c0 + col * 4 + 4)),
                masked=True,
            )
            if win.mask.all():
                assert grid[row, col] == 255
                continue
            want = float(win.mean()) * scale * 100
            assert abs(int(grid[row, col]) - want) <= 1.0, (sid, int(grid[row, col]), want)
            checked += 1
    assert checked >= 3
