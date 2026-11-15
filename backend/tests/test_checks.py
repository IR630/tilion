"""make eval checks (api.checks): a missing contact is a FAIL row, not an exception."""

from api import checks

CASE = {"group": "eclipse", "tolerance": 30.0, "unit": "s"}


def _row(site_id, diff, tol=30.0):
    return {"check": "x", "siteId": site_id, "diff": diff, "tolerance": tol}


def test_within_passes_when_every_diff_is_inside(monkeypatch):
    monkeypatch.setattr(checks, "_rows", lambda group: [_row("a", 1.0), _row("b", -29.0)])
    ok, note = checks._within(CASE)
    assert ok and "2/2" in note


def test_within_fails_on_missing_contact_instead_of_crashing(monkeypatch):
    rows = [_row("a", 1.0), _row("b", None)]
    monkeypatch.setattr(checks, "_rows", lambda group: rows)
    ok, note = checks._within(CASE)
    assert not ok
    assert "контакт не найден" in note and "b" in note


def test_within_fails_when_all_contacts_are_missing(monkeypatch):
    monkeypatch.setattr(checks, "_rows", lambda group: [_row("a", None)])
    ok, note = checks._within(CASE)
    assert not ok and "контакт не найден" in note


def test_within_fails_when_no_row_is_scored(monkeypatch):
    monkeypatch.setattr(checks, "_rows", lambda group: [_row("a", 1.0, tol=None)])
    ok, _ = checks._within(CASE)
    assert not ok


R_CASE = {"group": "random", "n": 3, "seed": 1, "tolerance": 5.0, "unit": "п.п."}


def _random_file(tmp_path, diffs, seed=1):
    import json

    g = {"id": "random", "seed": seed, "rows": [], "points": [{"diff": d} for d in diffs]}
    (tmp_path / "validation.json").write_text(json.dumps({"groups": [g]}), encoding="utf-8")


def test_random_check_uses_rmse_of_all_points(monkeypatch, tmp_path):
    monkeypatch.setattr(checks, "DATA", tmp_path)
    _random_file(tmp_path, [3.0, -4.0, 12.0])  # RMSE = 7.51: one far point fails the sample
    ok, note = checks.check_S4_random(R_CASE)
    assert not ok and "RMSE 7.51" in note and "max |ошибки| 12.00" in note
    _random_file(tmp_path, [3.0, -4.0, 5.0])  # RMSE = 4.08
    assert checks.check_S4_random(R_CASE)[0]


def test_random_check_fails_on_missing_points_or_other_seed(monkeypatch, tmp_path):
    monkeypatch.setattr(checks, "DATA", tmp_path)
    _random_file(tmp_path, [1.0, None, 1.0])
    assert not checks.check_S4_random(R_CASE)[0]
    _random_file(tmp_path, [1.0, 1.0, 1.0], seed=2)
    assert not checks.check_S4_random(R_CASE)[0]
    (tmp_path / "validation.json").write_text('{"groups": []}', encoding="utf-8")
    assert not checks.check_S4_random(R_CASE)[0]


E_CASE = {"group": "random", "n": 3, "seed": 1, "tolerance": 5.0, "unit": "п.п."}


def _earth_file(tmp_path, diffs, seed=1):
    import json

    pts = [{"diff": 0.0, "earthDiff": d} for d in diffs]
    g = {"id": "random", "seed": seed, "rows": [], "points": pts}
    (tmp_path / "validation.json").write_text(json.dumps({"groups": [g]}), encoding="utf-8")


def test_random_earth_check_uses_rmse_of_earth_diffs(monkeypatch, tmp_path):
    monkeypatch.setattr(checks, "DATA", tmp_path)
    _earth_file(tmp_path, [3.0, -4.0, 12.0])  # RMSE 7.51, MAE 6.33
    ok, note = checks.check_S4_random_earth(E_CASE)
    assert not ok and "RMSE 7.51" in note and "MAE 6.33" in note
    _earth_file(tmp_path, [3.0, -4.0, 5.0])  # RMSE 4.08
    assert checks.check_S4_random_earth(E_CASE)[0]


def test_random_earth_check_reports_share_within_tolerance(monkeypatch, tmp_path):
    # #374: |diff| <= tolerance counts as within, including the edge 5.0.
    monkeypatch.setattr(checks, "DATA", tmp_path)
    _earth_file(tmp_path, [3.0, -5.0, 12.0])
    note = checks.check_S4_random_earth(E_CASE)[1]
    assert "в пределах 5 п.п.: 66.7 %" in note
    _earth_file(tmp_path, [3.0, -6.0, 12.0])
    assert "в пределах 5 п.п.: 33.3 %" in checks.check_S4_random_earth(E_CASE)[1]


def test_random_earth_check_fails_without_earth_or_on_other_seed(monkeypatch, tmp_path):
    monkeypatch.setattr(checks, "DATA", tmp_path)
    _random_file(tmp_path, [1.0, 1.0, 1.0])  # Sun-only points: no Earth yet
    assert not checks.check_S4_random_earth(E_CASE)[0]
    _earth_file(tmp_path, [1.0, None, 1.0])  # Earth map NoData at one point
    assert not checks.check_S4_random_earth(E_CASE)[0]
    _earth_file(tmp_path, [1.0, 1.0, 1.0], seed=2)
    assert not checks.check_S4_random_earth(E_CASE)[0]
