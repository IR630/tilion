"""Navigator map assets (#34): hours.json matches the timelines (D-006), basemap meta is complete (D-005)."""

import json
from pathlib import Path

import pytest

DATA = Path(__file__).resolve().parents[2] / "web" / "public" / "data"


def test_hours_index_matches_every_timeline():
    h = json.loads((DATA / "hours.json").read_text())
    files = sorted((DATA / "timeline").glob("*.json"))
    assert set(h["sites"]) == {f.stem for f in files}
    for f in files:
        t = json.loads(f.read_text())
        codes = h["sites"][t["siteId"]]
        assert (h["startUtc"], h["stepMin"], h["n"]) == (
            t["startUtc"],
            t["stepMin"],
            len(t["sunVisible"]),
        )
        assert len(codes) == h["n"] and set(codes) <= set("0123")
        for i in range(0, h["n"], 97):  # every 97th hour: covers all phases, fast
            want = (t["sunVisible"][i] > 0) + 2 * (t["earthVisible"][i] > 0)
            assert int(codes[i]) == want, (t["siteId"], i)


def test_basemap_meta_lists_existing_layers_with_square_bounds():
    meta = json.loads((DATA / "basemap" / "meta.json").read_text())
    kinds = {layer["kind"] for layer in meta["layers"]}
    assert kinds == {"sun", "earth"}  # the relief is a tile pyramid since #149 (test_basemap_tiles)
    for layer in meta["layers"]:
        assert (DATA / "basemap" / layer["file"]).stat().st_size > 10_000
        x0, y0, x1, y1 = layer["bounds"]
        assert x0 == pytest.approx(-x1) and y0 == pytest.approx(-y1) and x1 == pytest.approx(y1)
        assert "pgda.gsfc.nasa.gov" in layer["source"]
