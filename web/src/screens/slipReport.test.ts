import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Interval, Timeline } from "../contracts";
import { DEFAULT_LIMITS, judge, type Win } from "../landing";
import { stepIndex, summarize, type SummaryRow } from "../summary";
import { fmtDeltaHours, fmtEventDelta, fmtLightDelta, SYNODIC_HOURS } from "./Compare";
import { eventLine, lightLine, reportText, SAME_HOURS, SAME_NOTE, siteReport, windowsLine } from "./slipReport";

const iv = (value: number): Interval => ({ value, lo: value, hi: value });
const row = (light: number, sunsetH: number | null, earthsetH: number | null, leftH = 8000): SummaryRow => ({
  siteId: "s", atUtc: "2027-03-15T00:00:00Z", sunElDeg: 1,
  hoursToSunset: sunsetH === null ? null : iv(sunsetH),
  hoursToEarthset: earthsetH === null ? null : iv(earthsetH),
  lightFraction: iv(light), earthFraction: iv(0.6),
  longestNightH: iv(50), longestCommGapH: iv(100), leftH,
});
// The number in a "Date slip delta" cell: "−134 h of light" → -134; "—" → null.
const cell = (t: string) => (t.startsWith("—") ? null : Number(t.replace("−", "-").replace("±", "").replace(/ h.*$/, "")));
const C = DEFAULT_LIMITS.cond; // 14 d, night ≤ 100 h, gap ≤ 120 h
const win = (nightH: number, gapH: number): Win => ({ start: 0, sunAtLanding: true, earthAtLanding: true, nightH, gapH, sunShare: 0.8, earthShare: 0.6 });

describe("slipReport (#335)", () => {
  it("says worse in plain words, with the before and after values", () => {
    const a = row(0.81, 9.2 * 24, 100);
    const b = row(0.62, 2.1 * 24, 100);
    expect(lightLine(a, b)).toMatchObject({ mark: "worse", text: "Sun lit over the next 30 d: 81 % → 62 % (worse)." });
    expect(eventLine(a, b, "hoursToSunset")).toMatchObject({ mark: "worse", text: "Next sunset: in 9.2 d → in 2.1 d (worse)." });
    expect(eventLine(a, b, "hoursToEarthset")).toMatchObject({ mark: "same", text: "Next Earthset: in 4.2 d → in 4.2 d (same)." });
  });

  it("says better, and same under the signed threshold", () => {
    const a = row(0.5, 30, 40);
    const b = row(0.7, 30 + SAME_HOURS, 40 + SAME_HOURS - 1);
    expect(lightLine(a, b).mark).toBe("better");
    expect(eventLine(a, b, "hoursToSunset").mark).toBe("better");
    expect(eventLine(a, b, "hoursToEarthset").mark).toBe("same");
    expect(lightLine(row(0.5, 1, 1), row(0.515, 1, 1)).mark).toBe("same"); // 1.5 points < 2
    expect(SAME_NOTE).toBe("Same = change under 2 percentage points of hours, or under 12 h to sunset or Earthset.");
  });

  it("names the same event when the time changes by exactly the slip", () => {
    const a = row(0.5, 61.7 * 24, 213);
    const b = row(0.5, 61.7 * 24 - 168, 213 - 168);
    expect(eventLine(a, b, "hoursToSunset", 7).text).toBe("Next sunset: in 61.7 d → in 54.7 d (worse): the same sunset, the slip only moves the landing nearer to it.");
    expect(eventLine(b, a, "hoursToEarthset", -7).text).toBe("Next Earthset: in 1.9 d → in 8.9 d (better): the same Earthset, the slip only moves the landing away from it.");
    expect(eventLine(a, row(0.5, 61.7 * 24 - 100, 213), "hoursToSunset", 7).text).toBe("Next sunset: in 61.7 d → in 57.5 d (worse).");
  });

  it("writes the pair before → after in one unit (#436)", () => {
    // Either side ≥ 48 h: both in days; both under 48 h: both in hours.
    expect(eventLine(row(0.5, 30, 8.9 * 24), row(0.5, 30, 46), "hoursToEarthset").text).toBe("Next Earthset: in 8.9 d → in 1.9 d (worse).");
    expect(eventLine(row(0.5, 46, 1), row(0.5, 30, 1), "hoursToSunset").text).toBe("Next sunset: in 46 h → in 30 h (worse).");
    for (const l of [eventLine(row(0.5, 47, 1), row(0.5, 48, 1), "hoursToSunset"), eventLine(row(0.5, 5.5, 1), row(0.5, 700, 1), "hoursToSunset")]) {
      const units = [...l.text.matchAll(/in (?:> )?[\d.]+ ([hd])/g)].map((m) => m[1]);
      expect(units).toHaveLength(2);
      expect(new Set(units).size).toBe(1);
    }
  });

  it("handles unavailable data: body down, event past the data end", () => {
    const up = row(0.5, 30, 30);
    const down = row(0.5, null, null);
    expect(eventLine(up, down, "hoursToSunset")).toMatchObject({ mark: "worse", delta: null, text: "Next sunset: in 30 h → Sun down (worse)." });
    expect(eventLine(down, up, "hoursToEarthset")).toMatchObject({ mark: "better", text: "Next Earthset: Earth below the horizon → in 30 h (better)." });
    expect(eventLine(down, down, "hoursToSunset")).toMatchObject({ mark: "same", text: "Next sunset: Sun down at both dates (same)." });
    // Past the data end the value is a lower bound: a mark only when the bound decides.
    const end = row(0.5, 500, 500, 500);
    expect(eventLine(up, end, "hoursToSunset")).toMatchObject({ mark: "better", delta: null, text: "Next sunset: in 1.3 d → in > 20.8 d (better)." });
    expect(eventLine(row(0.5, 600, 1), end, "hoursToSunset")).toMatchObject({ mark: null, text: "Next sunset: in 25.0 d → in > 20.8 d, past the data end, not comparable." });
    expect(eventLine(end, end, "hoursToSunset").mark).toBeNull();
  });

  it("matches the Date slip delta table: the same rows give the same numbers", () => {
    const cases: [SummaryRow, SummaryRow][] = [
      [row(0.81, 220.4, 101), row(0.62, 50.2, 133)],
      [row(0.33, 7, 12), row(0.35, 31, 0.5)],
      [row(0.9, 300, 40), row(0.9, null, 40)],
    ];
    for (const [a, b] of cases) {
      const l = lightLine(a, b);
      expect(Number((l.delta! * SYNODIC_HOURS).toFixed(0))).toBe(cell(fmtLightDelta(a, b)));
      for (const k of ["hoursToSunset", "hoursToEarthset"] as const) {
        const e = eventLine(a, b, k);
        const t = cell(fmtDeltaHours(a[k], b[k]));
        expect(e.delta === null ? null : Number(e.delta.toFixed(0))).toBe(t); // the table rounds with toFixed(0)
        // The mark agrees with the sign of the table cell.
        if (t !== null && e.mark === "worse") expect(t).toBeLessThan(0);
        if (t !== null && e.mark === "better") expect(t).toBeGreaterThan(0);
      }
    }
  });

  it("#435: a body down at one date: the table cell says the same change and mark as the sentence, not \"—\"", () => {
    const cases: [SummaryRow, SummaryRow, "hoursToSunset" | "hoursToEarthset", string][] = [
      [row(0.5, null, 40), row(0.6, 7.6 * 24, 40), "hoursToSunset", "Sun down → up (better)"],
      [row(0.5, 100, 40), row(0.4, null, 40), "hoursToSunset", "Sun up → down (worse)"],
      [row(0.5, null, null), row(0.4, null, null), "hoursToEarthset", "Earth down at both (same)"],
    ];
    for (const [a, b, k, text] of cases) {
      const e = eventLine(a, b, k);
      const t = fmtEventDelta(a, b, k);
      expect(t).toBe(text);
      expect(t.endsWith(`(${e.mark})`)).toBe(true);
    }
    expect(eventLine(row(0.5, null, 40), row(0.6, 7.6 * 24, 40), "hoursToSunset").text).toBe("Next sunset: Sun down → in 7.6 d (better).");
  });

  it("takes the overall line from the Windows check, not from counting lines", () => {
    const ok = judge(win(10, 20), C);
    const fail = judge(win(10, 122), C);
    expect(windowsLine(ok, fail, C)).toMatchObject({
      mark: "worse",
      text: "Windows check, 14 d mission (night ≤ 100 h, comm gap ≤ 120 h): OK → FAIL (worse). Comm gap 122 h > 120 h limit.",
    });
    expect(windowsLine(ok, null, C)).toMatchObject({ mark: null, text: "Windows check, 14 d mission (night ≤ 100 h, comm gap ≤ 120 h): the mission does not fit the data at the new date." });
    // Two lines better and one worse still give no winner: the Windows line stays "same".
    const r = siteReport("Ridge", -89.45, 222.69, row(0.5, 30, 30), row(0.6, 60, 1), 7, { before: ok, after: judge(win(12, 25), C), limits: C });
    expect(r.lines.map((l) => l.mark)).toEqual(["better", "better", "worse", "same"]);
    expect(reportText([r], "2027-03-15T00:00:00Z", "2027-03-22T00:00:00Z", 7, false)).not.toMatch(/winner|is the better/i);
  });

  it("copies dates, site, the screen lines, the model note and the threshold", () => {
    const r = siteReport("Ridge", -89.45, 222.69, row(0.81, 220, 100), row(0.62, 50, 100), 7);
    const mock = siteReport("Far", 10, 20, { ...row(0.5, 1, 1), stub: true }, row(0.5, 1, 1), 7);
    const text = reportText([r, mock], "2027-03-15T00:00:00Z", "2027-03-22T00:00:00Z", 7, false);
    expect(text).toBe(
      [
        "Tilion date-slip report",
        "Landing: 2027-03-15 00:00 UTC → 2027-03-22 00:00 UTC (slip +7 d)",
        "",
        "Ridge, 89.4500°S 222.6900°E",
        "▼ Sun lit over the next 30 d: 81 % → 62 % (worse).",
        "▼ Next sunset: in 9.2 d → in 2.1 d (worse).",
        "= Next Earthset: in 4.2 d → in 4.2 d (same).",
        "",
        "Far, 10.0000°N 20.0000°E: synthetic mock data, no precomputed timeline",
        "",
        "Model: LOLA terrain horizon (PGDA 90), observer 2 m, finest DEM; SPICE DE440 ephemeris; hourly samples.",
        SAME_NOTE,
      ].join("\n"),
    );
    expect(reportText([r], "2027-03-15T00:00:00Z", "2027-03-01T00:00:00Z", -14, true)).toContain("(slip −14 d)");
    expect(reportText([r], "2027-03-15T00:00:00Z", "2027-03-01T00:00:00Z", -14, true)).toContain("Model: bare sphere");
  });

  // Independent recount: Python over the raw web/public/data/timeline JSON (first hour with the flag 0 after the
  // landing step; lit share over the next 720 h) gave these hours on 2026-11-15. The sentences must say the same.
  const tlDir = join(process.cwd(), "public", "data", "timeline");
  it.skipIf(!existsSync(tlDir))("says the hours recounted from the raw timeline (ridge C1, Haworth, +7 d from 2027-01-15)", () => {
    const rowAt = (id: string, at: string) => {
      const full = JSON.parse(readFileSync(join(tlDir, `${id}.json`), "utf8")) as Timeline;
      const i = stepIndex(full, at);
      const cut = (a: number[]) => a.slice(i, i + 720);
      const tl = { ...full, startUtc: at, sunVisible: cut(full.sunVisible), earthVisible: cut(full.earthVisible), sunEl: cut(full.sunEl), sunAz: cut(full.sunAz), earthEl: cut(full.earthEl), earthAz: cut(full.earthAz) };
      return summarize(tl, at, full);
    };
    const pair = (id: string) => [rowAt(id, "2027-01-15T00:00:00Z"), rowAt(id, "2027-01-22T00:00:00Z")] as const;
    const [ra, rb] = pair("cr1_connecting_ridge");
    expect([ra.hoursToSunset?.value, rb.hoursToSunset?.value, ra.hoursToEarthset?.value, rb.hoursToEarthset?.value]).toEqual([1481, 1313, 214, 46]);
    expect(eventLine(ra, rb, "hoursToSunset", 7).text).toMatch(/^Next sunset: in 61\.7 d → in 54\.7 d \(worse\): the same sunset/);
    const [ha, hb] = pair("a_haworth");
    expect(lightLine(ha, hb).text).toBe("Sun lit over the next 30 d: 47 % → 42 % (worse).");
    expect(eventLine(ha, hb, "hoursToSunset", 7).text).toBe("Next sunset: Sun down → in 2.8 d (better)."); // 67 h
    expect(eventLine(ha, hb, "hoursToEarthset", 7).text).toMatch(/^Next Earthset: in 9\.0 d → in 2\.0 d \(worse\)/);
  });
});
