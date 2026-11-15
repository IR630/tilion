"""BETA hindcast (#174): our sunset/sunrise at two real polar landers vs events the missions announced.

Run from backend/:

    uv run python -m precompute.beta_hindcast --data <nasa data dir>

Writes web/public/data/beta/hindcast.json. Removable: the UI lives in web/src/beta/hindcast/.

Method: the same pipeline as the app - SPICE DE440, frame MOON_ME, LT+S, the site horizon mask from
web/public/data/mask/<id>.json (LOLA, observer 2 m), 10-minute steps. Sunset = the whole Sun disc
goes below the terrain horizon; sunrise = the upper limb clears it (the app rule, any limb = light).
The Sun-centre crossing is kept for reference (the disc rule is 1.5-2.2 h wider at these sites).

Reported events come from news reports, not telemetry. We say "consistent with", never "matches".
No DSN figures: the Earth orientation kernel (earth_2026_*) covers 2026-2126 only, not 2023-2024.
"""

import argparse
import json
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import spiceypy as sp

from . import ephem
from .geo import SUN_LIMB, visible_fraction

WEB_DATA = Path(__file__).resolve().parents[3] / "web" / "public" / "data"
OUT_REL = "beta/hindcast.json"
STEP_MIN = 10
# Earth orientation is not needed for Sun/Earth in MOON_ME, and the 2026 kernel does not cover 2023-24.
KERNELS = [k for k in ephem.KERNELS if not k.startswith("earth_")]

MISSIONS = [
    {
        "id": "im1",
        "mission": "IM-1 Odysseus",
        "siteId": "im1_odysseus",
        "searchStartUtc": "2024-02-22T23:23:00",  # landing
        "searchDays": 12,
        "event": "sunset",
        "reported": "Intuitive Machines announced the end of the mission with the onset of lunar night",
        "reportedUtc": "2024-02-29",
        "precision": "day",
        "consistency": "Our sunset falls on the day the operator announced the end of the mission at lunar night.",
        "source": "Universe Today",
        "url": "https://www.universetoday.com/articles/lunar-night-permanently-ends-the-odysseus-mission",
    },
    {
        "id": "ch3-sleep",
        "mission": "Chandrayaan-3 Vikram",
        "siteId": "chandrayaan3",
        "searchStartUtc": "2023-08-23T12:33:00",  # landing
        "searchDays": 32,
        "event": "sunset",
        "reported": "ISRO set Vikram into sleep mode around 08:00 IST, 4 Sep 2023",
        "reportedUtc": "2023-09-04T02:30Z",
        "precision": "time",
        "consistency": "The lander was put to sleep a few hours before our sunset, while the Sun was still up.",
        "source": "Deccan Herald (PTI, ISRO statement)",
        "url": "https://www.deccanherald.com/amp/story/science%2Fspace%2Fchandrayaan-3-after-rover-lander-set-into-sleep-mode-hoping-for-their-awakening-by-sep-22-says-isro-2672110",
    },
    {
        "id": "ch3-wake",
        "mission": "Chandrayaan-3 Vikram",
        "siteId": "chandrayaan3",
        "searchStartUtc": "2023-08-23T12:33:00",
        "searchDays": 32,
        "event": "sunrise",
        "reported": "ISRO hoped for the awakening around 22 Sep 2023",
        "reportedUtc": "2023-09-22",
        "precision": "day",
        "consistency": "Our sunrise comes about two days before the wake-up target, so the panels had Sun by then.",
        "source": "The National",
        "url": "https://www.thenationalnews.com/world/asia/2023/09/05/indias-chandrayaan-3-mission-lander-and-rover-in-sleep-mode-for-lunar-night",
    },
]

NOTE = (
    "BETA. Reported events come from news reports of operator statements, not telemetry, and the "
    "reports give no local sunset time. A row says our time is consistent with the "
    "reported event, not that it matches it. No DSN figures: the Earth orientation kernel we use "
    "covers 2026-2126 only, not 2023-2024."
)


def sun_events(
    site: dict,
    mask: dict,
    start_utc: str,
    days: float,
    step_min: int = STEP_MIN,
    rule: str = "disc",
) -> list[dict]:
    """Sunrise/sunset times (UTC, ISO, minute) at a site from its horizon mask; kernels must be loaded.

    rule "disc": any limb above the mask is light (the app rule). rule "centre": the Sun centre.
    """
    maz = np.arange(len(mask["elevDeg"])) * mask["azStepDeg"]
    mel = np.array(mask["elevDeg"], dtype=float)
    h = float(site.get("elevM") or 0.0) + mask["observerHeightM"]
    et0 = ephem.utc_to_et(start_utc)
    ets = et0 + np.arange(0, int(days * 24 * 60 / step_min) + 1) * step_min * 60.0
    az, el, rad = ephem.topo("SUN", ets, site["lonE"], site["lat"], h)
    if rule == "disc":
        lit = visible_fraction(az, el, rad, maz, mel, limb=SUN_LIMB) > 0
    else:
        lit = el > np.interp(az, maz, mel, period=360)
    out = []
    for i in np.flatnonzero(np.diff(lit.astype(int))):
        out.append(
            {
                "kind": "sunrise" if lit[i + 1] else "sunset",
                "utc": sp.et2utc(ets[i + 1], "ISOC", 0)[:16] + "Z",
                "sunElDeg": round(float(el[i + 1]), 2),
                "sunAzDeg": round(float(az[i + 1]), 1),
            }
        )
    return out


def _utc(s: str) -> datetime:
    return datetime.fromisoformat(s.removesuffix("Z")).replace(tzinfo=UTC)


def delta(ours_utc: str, reported_utc: str, precision: str) -> tuple[float, str]:
    """Ours minus reported, hours, and a label. A date-only report counts as its whole UTC day."""
    ours, rep = _utc(ours_utc), _utc(reported_utc)
    h = (ours - rep).total_seconds() / 3600
    if precision == "time":
        return round(h, 1), f"{h:+.1f} h"
    if 0 <= h < 24:
        return 0.0, "same day"
    d = h / 24 if h < 0 else (h - 24) / 24
    return round(d * 24, 1), f"{d:+.1f} d (date only)"


def build(sites: dict, masks: dict) -> dict:
    rows = []
    for m in MISSIONS:
        s = sites[m["siteId"]]
        found = {}
        for rule in ("disc", "centre"):
            ev = sun_events(s, masks[m["siteId"]], m["searchStartUtc"], m["searchDays"], rule=rule)
            ev = [e for e in ev if e["kind"] == m["event"]]
            if not ev:
                raise RuntimeError(
                    f"no {m['event']} ({rule}) for {m['siteId']} in {m['searchDays']} days"
                )
            found[rule] = ev[0]
        ours = found["disc"]
        dh, dtext = delta(ours["utc"], m["reportedUtc"], m["precision"])
        rows.append(
            {
                "id": m["id"],
                "mission": m["mission"],
                "siteId": s["id"],
                "site": s["name"],
                "lat": s["lat"],
                "lonE": s["lonE"],
                "event": m["event"],
                "oursUtc": ours["utc"],
                "oursCentreUtc": found["centre"]["utc"],
                "sunAzDeg": ours["sunAzDeg"],
                "reported": m["reported"],
                "reportedUtc": m["reportedUtc"],
                "precision": m["precision"],
                "deltaH": dh,
                "delta": dtext,
                "consistency": m["consistency"],
                "source": m["source"],
                "url": m["url"],
            }
        )
    return {
        "beta": True,
        "generatedUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "command": "cd backend && uv run python -m precompute.beta_hindcast --data <nasa data dir>",
        "method": (
            "SPICE DE440, MOON_ME, LT+S; site horizon mask from LOLA (observer 2 m); 10-minute steps. "
            "Sunset: whole Sun disc below the terrain horizon. Sunrise: upper limb above it. "
            "The Sun-centre crossing is given for reference."
        ),
        "note": NOTE,
        "rows": rows,
    }


def main(argv=None) -> None:
    p = argparse.ArgumentParser(
        prog="precompute.beta_hindcast", description=__doc__.splitlines()[0]
    )
    p.add_argument("--data", type=Path, required=True, help="NASA data dir with spice/")
    p.add_argument(
        "--web-data", type=Path, default=WEB_DATA, help="web/public/data (sites.json, mask/)"
    )
    a = p.parse_args(argv)
    for k in KERNELS:
        sp.furnsh(str(a.data / "spice" / k))
    sites = {s["id"]: s for s in json.loads((a.web_data / "sites.json").read_text())["sites"]}
    ids = {m["siteId"] for m in MISSIONS}
    masks = {i: json.loads((a.web_data / "mask" / f"{i}.json").read_text()) for i in ids}
    out = build(sites, masks)
    path = a.web_data / OUT_REL
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=1) + "\n")
    for r in out["rows"]:
        print(
            f"{r['mission']:22s} {r['event']:8s} ours {r['oursUtc']}  reported {r['reportedUtc']:20s} {r['delta']}"
        )
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
