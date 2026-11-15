"""Проверки сценариев для make eval / make eval-final (scripts/eval_harness.py).

check_<id сценария>(case) -> (bool, заметка). Данные — готовая статика web/public/data
(validation.json, timeline/). Допуск берём из сценария (eval/cases.json), а не из данных.
metric(split) -> система против baseline «голая сфера» (eval/baseline.json).
"""

import json
from pathlib import Path
from statistics import median

DATA = Path(__file__).resolve().parents[3] / "web" / "public" / "data"


def _rows(group: str) -> list[dict]:
    groups = json.loads((DATA / "validation.json").read_text(encoding="utf-8"))["groups"]
    return next(g["rows"] for g in groups if g["id"] == group)


def _within(case: dict) -> tuple[bool, str]:
    """Every scored row of the group (row tolerance set) has |diff| <= case tolerance."""
    tol = case["tolerance"]
    rows = [
        r
        for r in _rows(case["group"])
        if r["tolerance"] is not None and r["check"].startswith(case.get("check_prefix", ""))
    ]
    missing = [r for r in rows if r["diff"] is None]  # contact not found: FAIL, not a crash
    bad = [r for r in rows if r["diff"] is not None and abs(r["diff"]) > tol]
    diffs = [abs(r["diff"]) for r in rows if r["diff"] is not None]
    worst = max(diffs, default=float("nan"))
    note = (
        f"{len(rows) - len(bad) - len(missing)}/{len(rows)} в допуске {tol} {case['unit']}, "
        f"max {worst:g}"
    )
    if bad:
        note += "; вне допуска: " + ", ".join(f"{r['siteId']} {r['diff']:+g}" for r in bad)
    if missing:
        note += "; контакт не найден: " + ", ".join(f"{r['siteId']} {r['check']}" for r in missing)
    return bool(rows) and not bad and not missing, note


def check_S1(case: dict) -> tuple[bool, str]:
    tol = case["tolerance"]
    rows = _rows(case["group"])
    trap = [r for r in rows if r["check"].startswith("Trap check")]
    main = [r for r in rows if r not in trap]
    ok_main = all(abs(r["diff"]) <= tol for r in main)
    # The MOON_PA frame must break the tolerance, or the check cannot catch the trap.
    ok_trap = bool(trap) and all(abs(r["diff"]) > tol for r in trap)
    worst = max(abs(r["diff"]) for r in main)
    pa = ", ".join(f"{r['diff']:g}" for r in trap)
    return ok_main and ok_trap, f"max {worst:g}° при допуске {tol}°; MOON_PA даёт {pa}°"


def check_S2(case: dict) -> tuple[bool, str]:
    return _within(case)


def check_S3(case: dict) -> tuple[bool, str]:
    return _within(case)


def check_S4(case: dict) -> tuple[bool, str]:
    return _within(case)


def check_S4_patch(case: dict) -> tuple[bool, str]:
    return _within(case)


def check_S4_same_dem(case: dict) -> tuple[bool, str]:
    return _within(case)


def check_S4_random(case: dict) -> tuple[bool, str]:
    # Pre-registered (#331): RMSE over all N random points <= tolerance; recomputed from the points.
    groups = json.loads((DATA / "validation.json").read_text(encoding="utf-8"))["groups"]
    g = next((g for g in groups if g["id"] == case["group"]), None)
    if g is None:
        return False, f"нет группы {case['group']} в validation.json"
    pts = g.get("points", [])
    d = [p["diff"] for p in pts if p.get("diff") is not None]
    if len(pts) != case["n"] or len(d) != case["n"] or g.get("seed") != case["seed"]:
        return False, f"точек {len(d)}/{case['n']}, seed {g.get('seed')} (нужен {case['seed']})"
    rmse = (sum(x * x for x in d) / len(d)) ** 0.5
    bias = sum(d) / len(d)
    worst = max(abs(x) for x in d)
    share = 100.0 * sum(abs(x) <= 5.0 for x in d) / len(d)
    ok = rmse <= case["tolerance"]
    note = (
        f"{len(d)} точек, seed {case['seed']}: RMSE {rmse:.2f} {case['unit']} (порог {case['tolerance']}), "
        f"смещение {bias:+.2f}, max |ошибки| {worst:.2f}, в 5 п.п. {share:.0f} %"
    )
    return ok, note


def check_S4_random_earth(case: dict) -> tuple[bool, str]:
    # Pre-registered (#367): Earth RMSE at 0 m over the same N random points <= tolerance.
    groups = json.loads((DATA / "validation.json").read_text(encoding="utf-8"))["groups"]
    g = next((g for g in groups if g["id"] == case["group"]), None)
    if g is None:
        return False, f"нет группы {case['group']} в validation.json"
    pts = g.get("points", [])
    d = [p["earthDiff"] for p in pts if p.get("earthDiff") is not None]
    if len(pts) != case["n"] or len(d) != case["n"] or g.get("seed") != case["seed"]:
        return (
            False,
            f"точек Земли {len(d)}/{case['n']}, seed {g.get('seed')} (нужен {case['seed']})",
        )
    rmse = (sum(x * x for x in d) / len(d)) ** 0.5
    bias = sum(d) / len(d)
    mae = sum(abs(x) for x in d) / len(d)
    worst = max(abs(x) for x in d)
    # #374: INFO only, the pass rule stays the pre-registered RMSE.
    within = 100 * sum(abs(x) <= case["tolerance"] for x in d) / len(d)
    ok = rmse <= case["tolerance"]
    note = (
        f"{len(d)} точек, seed {case['seed']}: RMSE {rmse:.2f} {case['unit']} (порог {case['tolerance']}), "
        f"смещение {bias:+.2f}, MAE {mae:.2f}, max |ошибки| {worst:.2f}, "
        f"в пределах {case['tolerance']:g} {case['unit']}: {within:.1f} %"
    )
    return ok, note


def check_S4_same_dem_60(case: dict) -> tuple[bool, str]:
    return _within(case)


def check_S4_same_dem_60_patch(case: dict) -> tuple[bool, str]:
    return _within(case)


def check_S10(case: dict) -> tuple[bool, str]:
    return _within(case)


def check_S11(case: dict) -> tuple[bool, str]:
    return _within(case)


def check_S5(case: dict) -> tuple[bool, str]:
    errs = {r["siteId"]: r["diff"] for r in _rows(case["group"])}
    low = [s for s, h in errs.items() if h < case["min_hours"]]
    note = (
        f"{len(errs)} площадок: медиана ошибки сферы {median(errs.values()):g} ч, "
        f"min {min(errs.values()):g} ч, max {max(errs.values()):g} ч"
    )
    if low:
        note += "; рельеф не меняет ответ: " + ", ".join(low)
    return not low, note


def check_S6(case: dict) -> tuple[bool, str]:
    # Band from Barker et al. 2021 Table 2: case B (lower) .. case C (upper), per RoI in table order.
    from precompute.validation import BARKER_ROI

    rows = _rows(case["group"])
    bad = [
        i + 1
        for i, (r, (_, _, b, c)) in enumerate(zip(rows, BARKER_ROI))
        if not b <= r["ours"] <= c
    ]
    margin = ", ".join(
        f"{r['ours']:.1f}∈[{b:g}, {c:g}]" for r, (_, _, b, c) in zip(rows, BARKER_ROI)
    )
    note = f"{len(rows) - len(bad)}/{len(rows)} точек в коридоре B..C: {margin}"
    if bad:
        note += "; вне коридора: RoI " + ", ".join(map(str, bad))
    return len(rows) == len(BARKER_ROI) and not bad, note


def check_S7(case: dict) -> tuple[bool, str]:
    # Whole-Moon contacts: diff vs the catalogue; site rows: seconds outside the catalogue window.
    return _within(case)


SUN_RADIUS_DEG = 0.265  # same rule as web/src/summary.ts: lit = any limb above the 0° horizon


def _sphere_sun_share(site_id: str) -> float:
    el = json.loads((DATA / "timeline" / f"{site_id}.json").read_text(encoding="utf-8"))["sunEl"]
    return 100.0 * sum(e + SUN_RADIUS_DEG > 0 for e in el) / len(el)


def metric(split: str) -> dict | None:
    rows = [r for r in _rows("illumination") if r["check"].startswith("Mean visible solar disc")]
    system = sum(abs(r["diff"]) <= 5.0 for r in rows)
    sphere = sum(abs(_sphere_sun_share(r["siteId"]) - r["reference"]) <= 5.0 for r in rows)
    return {
        "name": f"PGDA 69, Солнце: площадок в допуске 5 п.п., % (из {len(rows)})",
        "system": round(100.0 * system / len(rows), 1),
        "baseline": round(100.0 * sphere / len(rows), 1),
    }


def _lroc(split: str) -> list[dict]:
    lroc = DATA / "lroc"
    ids = json.loads((lroc / "index.json").read_text(encoding="utf-8"))["ids"]
    metas = [json.loads((lroc / f"{i}.json").read_text(encoding="utf-8")) for i in ids]
    return [m for m in metas if m.get("split", "dev") == split]


def check_S8(case: dict) -> tuple[bool, str]:
    # LROC NAC images vs model shadows (#217); thresholds from the case, not from the data.
    metas = _lroc("dev")
    parts, ok = [], bool(metas)
    for m in metas:
        i = m["id"]
        good = (
            m["agreementPct"] >= case["min_agreement"]
            and m["shadowIou"] >= case["min_iou"]
            and m["agreementPct"] > m["sphereAgreementPct"]
        )
        ok &= good
        parts.append(
            f"{i.split('_')[2]} {'pass' if good else 'FAIL'}: совпадение {m['agreementPct']:g} %, "
            f"IoU {m['shadowIou']:g}, сфера {m['sphereAgreementPct']:g} %"
        )
    head = f"порог: совпадение ≥ {case['min_agreement']:g} %, IoU ≥ {case['min_iou']:g}; "
    return ok, head + "; ".join(parts)


def check_S9(case: dict) -> tuple[bool, str]:
    # Photometric image shadow vs model shadows on the test images fixed before download (#217).
    metas = {m["id"]: m["s9"] for m in _lroc("test")}
    parts, ok = [], True
    for i in case["test"]:
        m = metas.get(i)
        if m is None:
            ok = False
            parts.append(f"{i.split('_')[2]} нет результата")
            continue
        good = (
            m["agreementPct"] >= case["min_agreement"]
            and m["shadowIou"] >= case["min_iou"]
            and m["agreementPct"] > m["sphereAgreementPct"]
            and m["excludedPct"] <= case["max_excluded"]
        )
        ok &= good
        parts.append(
            f"{i.split('_')[2]} {'pass' if good else 'FAIL'}: совпадение {m['agreementPct']:g} %, "
            f"IoU {m['shadowIou']:g}, сфера {m['sphereAgreementPct']:g} %, "
            f"не оценено {m['excludedPct']:g} %"
        )
    head = (
        f"порог: совпадение ≥ {case['min_agreement']:g} %, IoU ≥ {case['min_iou']:g}, "
        f"не оценено ≤ {case['max_excluded']:g} %; "
    )
    return ok, head + "; ".join(parts)
