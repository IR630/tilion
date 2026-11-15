"""BETA #187: ellipse statistics against the scout prototype (+-1 pp) and the committed JSON."""

import json

import numpy as np
import pytest
from test_precompute import DATA, REPO, need

from precompute import beta_ellipse as be

OUT = REPO / "web" / "public" / "data" / "beta" / "ellipse.json"
# Numbers below come from the scout prototype ell.py (1 km radius).


def test_disc_offsets_stay_inside_radius():
    x, y = be.disc_offsets(500)
    assert (x**2 + y**2 <= 500**2).all() and len(x) > 800


def test_stats_percentile_and_share():
    v = np.arange(0.0, 101.0)
    s = be.stats(v, 7.04)
    assert s == {"aim": 7.0, "p10": 10.0, "shareGe40": round(61 / 101 * 100, 1)}


def test_committed_json_matches_prototype_numbers():
    doc = json.loads(OUT.read_text())
    slater = doc["sites"]["a_slater_plain"]["1000"]
    assert slater["sun"]["aim"] == pytest.approx(48.5, abs=1)
    assert slater["sun"]["p10"] == pytest.approx(18.8, abs=1)
    assert slater["sun"]["shareGe40"] == pytest.approx(14.0, abs=1)
    assert slater["earth"]["p10"] == pytest.approx(0.0, abs=1)
    assert doc["sites"]["a_malapert_massif"]["1000"]["sun"]["shareGe40"] == pytest.approx(
        80.0, abs=1
    )


@need("illum/AVGVISIB_85S_060M_201608.TIF", "illum/AVGVISIB_85S_060M_201608_EARTH.TIF")
def test_rebuild_from_pgda_matches_committed_json():
    sites = json.loads((REPO / "web/public/data/sites.json").read_text())["sites"]
    assert be.build(DATA, sites) == json.loads(OUT.read_text())
