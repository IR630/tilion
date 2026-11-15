// #335: what a landing-date slip changes, in plain sentences, and the same text for Copy.
// Adapted from dan-od/lunar-landing@7f3dee6968989e9272606242cb6a16b3fc7b483a, core/src/report.ts, MIT:
// a mark is a symbol and a word (never colour alone), and the copied text equals the screen.
// Not ported: the donor's "winner = count of improved metrics" (report.ts:83-91). Here the overall
// line is the Windows check (landing.ts judge, hard limits), the same verdict as PlanVerdict.
// Every number comes from the Compare rows (summary.ts summarize): the same values as the table cells
// and the "Date slip delta" table. Compare.test / slipReport.test check that they agree.
import type { Interval } from "../contracts";
import { fmtDurationPair, fmtLatLon, fmtShare } from "../format";
import type { Conditions, Level, Verdict } from "../landing";
import { verdictRule } from "../landing";
import type { SummaryRow } from "../summary";

export type Mark = "better" | "worse" | "same";
export const MARK_SYMBOL: Record<Mark, string> = { better: "▲", worse: "▼", same: "=" };

/** "Same" thresholds: a change smaller than this is not called better or worse. */
export const SAME_SHARE = 0.02; // 2 percentage points of hours, about 14 h over 30 d
export const SAME_HOURS = 12; // half of the 1-day slip step
export const SAME_NOTE = `Same = change under ${SAME_SHARE * 100} percentage points of hours, or under ${SAME_HOURS} h to sunset or Earthset.`;

export type SlipLine = {
  key: "light" | "sunset" | "earthset" | "windows";
  /** null = the change cannot be told (an event beyond the data end, or no data). */
  mark: Mark | null;
  text: string;
  /** After − before: share (0..1) for light, hours for an event. Null where the delta table shows "—". */
  delta: number | null;
};

export type SiteReport = { name: string; place: string; mock: boolean; lines: SlipLine[] };

const markOf = (d: number, same: number): Mark => (Math.abs(d) < same ? "same" : d > 0 ? "better" : "worse");
const end = (mark: Mark | null) => (mark ? ` (${mark})` : "");

/** Light over the next 30 d: shares as in the table, mark by the change in percentage points. */
export function lightLine(a: SummaryRow, b: SummaryRow): SlipLine {
  const delta = b.lightFraction.value - a.lightFraction.value;
  const mark = markOf(delta, SAME_SHARE);
  return { key: "light", mark, delta, text: `Sun lit over the next 30 d: ${fmtShare(a.lightFraction.value)} → ${fmtShare(b.lightFraction.value)}${end(mark)}.` };
}

type Ev = { v: Interval | null; beyond: boolean };
const ev = (r: SummaryRow, k: "hoursToSunset" | "hoursToEarthset"): Ev => {
  const v = r[k];
  return { v, beyond: !!v && r.leftH !== undefined && v.value >= r.leftH };
};

/** Time to sunset or Earthset. A body that is down now ranks lowest (as Compare `metric`); an event past the
 *  data end is only a lower bound, so it gets a mark only when the bound alone decides. */
export function eventLine(a: SummaryRow, b: SummaryRow, k: "hoursToSunset" | "hoursToEarthset", slipD = 0): SlipLine {
  const sun = k === "hoursToSunset";
  const key = sun ? "sunset" : "earthset";
  const name = sun ? "Next sunset" : "Next Earthset";
  const down = sun ? "Sun down" : "Earth below the horizon";
  const x = ev(a, k);
  const y = ev(b, k);
  // #436: one unit for the pair "before → after" (both in days when either is ≥ 48 h).
  const [ua, ub] = fmtDurationPair(x.v?.value ?? 0, y.v?.value ?? 0);
  const show = (e: Ev) => (e.v ? `in ${e.beyond ? "> " : ""}${e === x ? ua : ub}` : down);
  if (!x.v && !y.v) return { key, mark: "same", delta: null, text: `${name}: ${down} at both dates (same).` };
  if (!x.v || !y.v) {
    const mark: Mark = y.v ? "better" : "worse";
    return { key, mark, delta: null, text: `${name}: ${show(x)} → ${show(y)} (${mark}).` };
  }
  const d = y.v.value - x.v.value;
  let mark: Mark | null;
  if (!x.beyond && !y.beyond) {
    mark = markOf(d, SAME_HOURS);
    // The time shrinks or grows by exactly the slip: the same event, only the landing moved (hourly data: 1 h tolerance).
    if (slipD !== 0 && Math.abs(d + slipD * 24) <= 1) {
      const what = sun ? "sunset" : "Earthset";
      return { key, mark, delta: d, text: `${name}: ${show(x)} → ${show(y)}${end(mark)}: the same ${what}, the slip only moves the landing ${slipD > 0 ? "nearer to it" : "away from it"}.` };
    }
  }
  else if (x.beyond && y.beyond) mark = null;
  else if (y.beyond) mark = d >= SAME_HOURS ? "better" : null; // after ≥ its value
  else mark = d <= -SAME_HOURS ? "worse" : null; // before ≥ its value
  const tail = mark ? end(mark) : x.beyond && y.beyond ? ", no event before the data end at either date" : ", past the data end, not comparable";
  return { key, mark, delta: x.beyond || y.beyond ? null : d, text: `${name}: ${show(x)} → ${show(y)}${tail}.` };
}

const RANK: Record<Level, number> = { FAIL: 0, MARGINAL: 1, OK: 2 };
const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** The overall line: the Windows check (hard limits) at both dates, not a count of improved lines. */
export function windowsLine(a: Verdict | null, b: Verdict | null, c: Conditions): SlipLine {
  const head = `Windows check, ${num(c.days)} d mission (night ≤ ${num(c.maxNightH)} h, comm gap ≤ ${num(c.maxGapH)} h)`;
  if (!a || !b) return { key: "windows", mark: null, delta: null, text: `${head}: the mission does not fit the data at ${a ? "the new" : b ? "the original" : "either"} date.` };
  const mark: Mark = RANK[b.level] === RANK[a.level] ? "same" : RANK[b.level] > RANK[a.level] ? "better" : "worse";
  return { key: "windows", mark, delta: null, text: `${head}: ${a.level} → ${b.level}${end(mark)}. ${verdictRule(b, c)}.` };
}

/** All lines of one site; `before`/`after` = the Windows verdicts at both dates (undefined = still loading). */
export function siteReport(
  name: string, lat: number | null, lonE: number | null, a: SummaryRow, b: SummaryRow, slipD: number,
  verdicts?: { before: Verdict | null; after: Verdict | null; limits: Conditions },
): SiteReport {
  const lines = [lightLine(a, b), eventLine(a, b, "hoursToSunset", slipD), eventLine(a, b, "hoursToEarthset", slipD)];
  if (verdicts) lines.push(windowsLine(verdicts.before, verdicts.after, verdicts.limits));
  return { name, place: fmtLatLon(lat, lonE), mock: !!(a.stub || b.stub), lines };
}

const utc = (t: string) => `${t.slice(0, 16).replace("T", " ")} UTC`;

/** Model note of the copied text: what produced the numbers. */
export function modelNote(sphere: boolean): string {
  return sphere
    ? "Model: bare sphere, flat 0° horizon, no terrain; SPICE DE440 ephemeris; hourly samples."
    : "Model: LOLA terrain horizon (PGDA 90), observer 2 m, finest DEM; SPICE DE440 ephemeris; hourly samples.";
}

/** Plain text for Copy: dates, sites, the same lines as on screen, the model note and the threshold. */
export function reportText(reports: SiteReport[], fromUtc: string, toUtc: string, slipD: number, sphere: boolean): string {
  const slip = `${slipD > 0 ? "+" : "−"}${Math.abs(slipD)} d`;
  const out = ["Tilion date-slip report", `Landing: ${utc(fromUtc)} → ${utc(toUtc)} (slip ${slip})`];
  for (const r of reports) {
    out.push("", `${r.name}, ${r.place}${r.mock ? ": synthetic mock data, no precomputed timeline" : ""}`);
    if (!r.mock) for (const l of r.lines) out.push(`${l.mark ? MARK_SYMBOL[l.mark] : "?"} ${l.text}`);
  }
  out.push("", modelNote(sphere), SAME_NOTE);
  return out.join("\n");
}
