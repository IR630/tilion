"""BETA hindcast (#174): our sunset/sunrise at IM-1 and Chandrayaan-3 vs announced mission events."""

import json
import shutil
from datetime import datetime, timedelta

import pytest
from test_precompute import DATA, need

from precompute import beta_hindcast as bh

WEB = bh.WEB_DATA
HIND_SPICE = [f"spice/{k}" for k in bh.KERNELS]
# Scout prototype (Sun centre vs mask, 10-minute steps), 2026-11-15.
PROTOTYPE_CENTRE = {
    "im1": "2024-02-29T09:03Z",
    "ch3-sleep": "2023-09-04T06:13Z",
    "ch3-wake": "2023-09-20T00:13Z",
}


def _t(s):
    return datetime.fromisoformat(s.removesuffix("Z"))


def test_delta_time_precision_is_signed_hours():
    assert bh.delta("2023-09-04T07:43Z", "2023-09-04T02:30Z", "time") == (5.2, "+5.2 h")
    assert bh.delta("2023-09-04T01:30Z", "2023-09-04T02:30Z", "time") == (-1.0, "-1.0 h")


def test_delta_date_only_counts_the_whole_utc_day():
    assert bh.delta("2024-02-29T11:13Z", "2024-02-29", "day") == (0.0, "same day")
    assert bh.delta("2024-02-29T23:59Z", "2024-02-29", "day") == (0.0, "same day")
    h, label = bh.delta("2023-09-19T22:43Z", "2023-09-22", "day")
    assert label == "-2.1 d (date only)" and h == pytest.approx(-49.3, abs=0.1)
    h, label = bh.delta("2024-03-02T12:00Z", "2024-02-29", "day")
    assert label == "+1.5 d (date only)" and h == 36.0


def test_wording_never_claims_a_match():
    text = json.dumps(bh.MISSIONS) + bh.NOTE
    assert "consistent with" in bh.NOTE
    assert "not that it matches" in bh.NOTE
    assert "2026-2126" in bh.NOTE and "DSN" in bh.NOTE
    for m in bh.MISSIONS:
        assert "match" not in m["consistency"].lower()
        assert m["url"].startswith("https://")
    assert "telemetry" in text


@pytest.fixture(scope="module")
def hindcast():
    import spiceypy

    for k in bh.KERNELS:
        spiceypy.furnsh(str(DATA / "spice" / k))
    sites = {s["id"]: s for s in json.loads((WEB / "sites.json").read_text())["sites"]}
    masks = {
        m["siteId"]: json.loads((WEB / "mask" / f"{m['siteId']}.json").read_text())
        for m in bh.MISSIONS
    }
    yield {r["id"]: r for r in bh.build(sites, masks)["rows"]}
    spiceypy.kclear()


@need(*HIND_SPICE)
def test_centre_times_within_1_h_of_prototype(hindcast):
    for rid, want in PROTOTYPE_CENTRE.items():
        got = _t(hindcast[rid]["oursCentreUtc"])
        assert abs(got - _t(want)) <= timedelta(hours=1), (rid, got, want)


@need(*HIND_SPICE)
def test_disc_rule_widens_the_day_and_keeps_the_story(hindcast):
    # Any limb = light: last light after the centre sets, first light before the centre rises.
    assert _t(hindcast["im1"]["oursUtc"]) > _t(hindcast["im1"]["oursCentreUtc"])
    assert _t(hindcast["ch3-sleep"]["oursUtc"]) > _t(hindcast["ch3-sleep"]["oursCentreUtc"])
    assert _t(hindcast["ch3-wake"]["oursUtc"]) < _t(hindcast["ch3-wake"]["oursCentreUtc"])
    for r in hindcast.values():
        assert abs(_t(r["oursUtc"]) - _t(r["oursCentreUtc"])) < timedelta(hours=3)
    # IM-1: sunset on the day the operator announced the end at lunar night.
    assert hindcast["im1"]["delta"] == "same day"
    # Chandrayaan-3: put to sleep at 02:30 UTC, before our sunset; our sunrise before the 22 Sep target.
    assert 0 < hindcast["ch3-sleep"]["deltaH"] < 12
    assert -72 < hindcast["ch3-wake"]["deltaH"] < 0


@need(*HIND_SPICE)
def test_main_writes_json_with_beta_flag(tmp_path, hindcast):
    (tmp_path / "mask").mkdir()
    shutil.copy(WEB / "sites.json", tmp_path / "sites.json")
    for sid in {m["siteId"] for m in bh.MISSIONS}:
        shutil.copy(WEB / "mask" / f"{sid}.json", tmp_path / "mask" / f"{sid}.json")
    bh.main(["--data", str(DATA), "--web-data", str(tmp_path)])
    out = json.loads((tmp_path / bh.OUT_REL).read_text())
    assert out["beta"] is True
    assert [r["id"] for r in out["rows"]] == list(PROTOTYPE_CENTRE)
    shipped = json.loads((WEB / bh.OUT_REL).read_text())
    strip = lambda f: {**f, "generatedUtc": None}
    assert strip(out) == strip(shipped), (
        "web/public/data/beta/hindcast.json is stale: rerun the script"
    )
