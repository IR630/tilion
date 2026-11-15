// Landing window: does a mission of `days` starting at hour t meet the light and comms limits?
// Input is the hourly timeline (sunVisible > 0 = Sun lit, earthVisible > 0 = Earth contact). Contract unchanged.
// Window metrics: longest night and longest comm gap inside [t, t+T], plus Sun / Earth share (prefix sums).
import type { Timeline } from "./contracts";

export type Conditions = {
  days: number; // mission length, 1..30
  maxNightH: number; // longest continuous Sun-down stretch allowed, hours
  maxGapH: number; // longest continuous Earth-down stretch allowed, hours
};
export type Preset = { id: string; label: string } & Conditions;

// Team planning assumptions, not mission requirements; the user can edit every number.
export const PRESETS: Preset[] = [
  { id: "robot", label: "Robot 14 d", days: 14, maxNightH: 100, maxGapH: 120 },
  { id: "crew", label: "Crew 6.5 d, no night", days: 6.5, maxNightH: 0, maxGapH: 12 },
  { id: "long", label: "Long stay 30 d", days: 30, maxNightH: 150, maxGapH: 150 },
];

/** The Windows panel's mission and limits, shared with the Mission plan card (#210). */
export type Limits = { cond: Conditions; preset: string | null };
export const DEFAULT_LIMITS: Limits = {
  cond: { days: PRESETS[0].days, maxNightH: PRESETS[0].maxNightH, maxGapH: PRESETS[0].maxGapH },
  preset: PRESETS[0].id,
};

/** Share of a limit above which a passing window is only marginal. */
export const MARGINAL_SHARE = 0.75;

export type Level = "OK" | "MARGINAL" | "FAIL";
export type Binding = "Sun" | "Earth" | "Sun + Earth" | null;

/** Metrics of the window that starts at hour index `start`. */
export type Win = {
  start: number;
  sunAtLanding: boolean;
  earthAtLanding: boolean;
  nightH: number;
  gapH: number;
  sunShare: number;
  earthShare: number;
};

export type Verdict = { level: Level; binding: Binding; reason: string; win: Win };

export type NoWindow = {
  reason: string;
  starts: number; // candidate starts that fit in the data
  bestNightH: number | null; // min night among starts where landing and comm gap hold
  bestGapH: number | null; // min comm gap among starts where landing and night hold
  closest: Win | null;
};

const num = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const ratio = (v: number, limit: number) => (limit > 0 ? v / limit : v > 0 ? Infinity : 0);
const pct = (x: number) => `${Math.round(x * 100)} %`;
/** #162: night and comm gap here are counted inside the mission window, not the whole data. */
const inMission = (c: Conditions) => ` for a ${num(c.days)} d mission from this hour`;

/** Number of hourly steps of a mission; at least 1. */
export function windowSteps(tl: Timeline, days: number): number {
  return Math.max(1, Math.round((days * 24 * 60) / tl.stepMin));
}

export function indexToUtc(tl: Timeline, i: number): string {
  return new Date(Date.parse(tl.startUtc) + i * tl.stepMin * 60000).toISOString().replace(".000Z", "Z");
}

/** Index of the step that holds `utc`; may fall outside the data. */
export function utcToIndex(tl: Timeline, utc: string): number {
  return Math.floor((Date.parse(utc) - Date.parse(tl.startUtc)) / (tl.stepMin * 60000));
}

const label = (tl: Timeline, i: number) => indexToUtc(tl, i).slice(0, 16).replace("T", " ") + " UTC";

/** Runs [from, to) where `off(i)` holds. */
function runs(n: number, off: (i: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  let from = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && off(i);
    if (on && from < 0) from = i;
    if (!on && from >= 0) (out.push([from, i]), (from = -1));
  }
  return out;
}

/** Longest overlap of `rs` with every window [a, a+len); `rs` sorted and disjoint. Two pointers. */
function longestIn(rs: [number, number][], starts: number, len: number): number[] {
  const out = new Array<number>(starts).fill(0);
  let j = 0;
  for (let a = 0; a < starts; a++) {
    const b = a + len;
    while (j < rs.length && rs[j][1] <= a) j++;
    let best = 0;
    for (let k = j; k < rs.length && rs[k][0] < b; k++) {
      best = Math.max(best, Math.min(rs[k][1], b) - Math.max(rs[k][0], a));
    }
    out[a] = best;
  }
  return out;
}

/** Metrics for every start whose whole window fits in the data. Depends on the duration only. */
export function scanWindows(tl: Timeline, days: number): Win[] {
  const n = tl.sunVisible.length;
  const len = windowSteps(tl, days);
  const starts = n - len + 1;
  if (starts <= 0) return [];
  const h = tl.stepMin / 60;
  const sun = (i: number) => tl.sunVisible[i] > 0;
  const earth = (i: number) => tl.earthVisible[i] > 0;
  const sunSum = new Array<number>(n + 1).fill(0); // prefix sums: lit steps in [a, b) = sunSum[b] - sunSum[a]
  const earthSum = new Array<number>(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    sunSum[i + 1] = sunSum[i] + (sun(i) ? 1 : 0);
    earthSum[i + 1] = earthSum[i] + (earth(i) ? 1 : 0);
  }
  const night = longestIn(runs(n, (i) => !sun(i)), starts, len);
  const gap = longestIn(runs(n, (i) => !earth(i)), starts, len);
  return Array.from({ length: starts }, (_, a) => ({
    start: a,
    sunAtLanding: sun(a),
    earthAtLanding: earth(a),
    nightH: night[a] * h,
    gapH: gap[a] * h,
    sunShare: (sunSum[a + len] - sunSum[a]) / len,
    earthShare: (earthSum[a + len] - earthSum[a]) / len,
  }));
}

function failing(w: Win, c: Conditions): { sun: boolean; earth: boolean } {
  return {
    sun: !w.sunAtLanding || w.nightH > c.maxNightH,
    earth: !w.earthAtLanding || w.gapH > c.maxGapH,
  };
}

/** Closest-to-limit constraint of a window that passes: the larger share of its limit. */
function tightest(w: Win, c: Conditions): { binding: Binding; r: number } {
  const rn = ratio(w.nightH, c.maxNightH);
  const rg = ratio(w.gapH, c.maxGapH);
  if (rn === 0 && rg === 0) return { binding: null, r: 0 };
  if (rn === rg) return { binding: "Sun + Earth", r: rn };
  return rn > rg ? { binding: "Sun", r: rn } : { binding: "Earth", r: rg };
}

export function judge(w: Win, c: Conditions): Verdict {
  const f = failing(w, c);
  if (f.sun || f.earth) {
    const parts: string[] = [];
    if (!w.sunAtLanding) parts.push("Sun below the horizon at landing");
    if (!w.earthAtLanding) parts.push("Earth below the horizon at landing");
    if (w.nightH > c.maxNightH) parts.push(`longest night ${num(w.nightH)} h, limit ${num(c.maxNightH)} h`);
    if (w.gapH > c.maxGapH) parts.push(`longest comm gap ${num(w.gapH)} h, limit ${num(c.maxGapH)} h`);
    const binding: Binding = f.sun && f.earth ? "Sun + Earth" : f.sun ? "Sun" : "Earth";
    return { level: "FAIL", binding, reason: `Not suitable${inMission(c)}: ${parts.join("; ")}.`, win: w };
  }
  const { binding, r } = tightest(w, c);
  const used = `longest night ${num(w.nightH)} of ${num(c.maxNightH)} h, longest comm gap ${num(w.gapH)} of ${num(c.maxGapH)} h`;
  if (r > MARGINAL_SHARE) {
    const what = binding === "Sun" ? "night" : binding === "Earth" ? "comm gap" : "night and comm gap";
    return { level: "MARGINAL", binding, reason: `Marginal${inMission(c)}: ${what} uses ${pct(r)} of its limit (${used}).`, win: w };
  }
  return { level: "OK", binding, reason: `Suitable${inMission(c)}: ${used}.`, win: w };
}

export const isViable = (w: Win, c: Conditions) => judge(w, c).level !== "FAIL";

/** First viable start at or after `from`; -1 when none. */
export function findWindow(ws: Win[], c: Conditions, from: number): number {
  for (let i = Math.max(0, from); i < ws.length; i++) if (isViable(ws[i], c)) return i;
  return -1;
}

/** Start of the next separate window: skip the viable run that holds or follows `from`. */
export function nextWindow(ws: Win[], c: Conditions, from: number): number {
  const first = findWindow(ws, c, from);
  if (first < 0) return -1;
  let i = first;
  while (i < ws.length && isViable(ws[i], c)) i++;
  return findWindow(ws, c, i);
}

/** No viable start: best value of each condition among starts where the others hold, and the closest start. */
export function explainNoWindow(tl: Timeline, ws: Win[], c: Conditions): NoWindow {
  const landing = (w: Win) => w.sunAtLanding && w.earthAtLanding;
  const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
  const bestNightH = min(ws.filter((w) => landing(w) && w.gapH <= c.maxGapH).map((w) => w.nightH));
  const bestGapH = min(ws.filter((w) => landing(w) && w.nightH <= c.maxNightH).map((w) => w.gapH));
  const landings = ws.filter(landing).length;
  // Closest = smallest worst excess over a limit (hours; works for a 0 h limit) among starts with Sun and Earth up; ties go to the earliest.
  const pool = landings ? ws.filter(landing) : ws;
  let closest: Win | null = null;
  let score = Infinity;
  for (const w of pool) {
    const s = Math.max(w.nightH - c.maxNightH, w.gapH - c.maxGapH);
    if (s < score) (score = s), (closest = w);
  }
  const parts: string[] = [];
  if (!ws.length) {
    parts.push(`a ${num(c.days)} d mission does not fit in the data range`);
  } else {
    parts.push(`Sun and Earth are both up at landing in ${landings} of ${ws.length} start hours`);
    parts.push(
      bestNightH === null
        ? "no start keeps the comm gap in its limit with both up at landing"
        : `best longest night ${num(bestNightH)} h (limit ${num(c.maxNightH)} h) where the comm gap holds`,
    );
    parts.push(
      bestGapH === null
        ? "no start keeps the night in its limit with both up at landing"
        : `best longest comm gap ${num(bestGapH)} h (limit ${num(c.maxGapH)} h) where the night holds`,
    );
    if (closest) parts.push(`closest start ${label(tl, closest.start)}`);
  }
  return { reason: `No window: ${parts.join("; ")}.`, starts: ws.length, bestNightH, bestGapH, closest };
}

/** #210: the verdict for a landing at `utc`; null when the mission window does not fit the data.
 *  The Windows panel and the Mission plan card both read this one function. */
export function verdictAt(tl: Timeline, ws: Win[], c: Conditions, utc: string): Verdict | null {
  const at = utcToIndex(tl, utc);
  return at >= 0 && at < ws.length ? judge(ws[at], c) : null;
}

/** #210: the rule behind a verdict, short: "Comm gap 122 h > 120 h limit"; for a pass, how close it is. */
export function verdictRule(v: Verdict, c: Conditions): string {
  const w = v.win;
  if (v.level === "FAIL") {
    const parts: string[] = [];
    if (!w.sunAtLanding) parts.push("Sun down at landing");
    if (!w.earthAtLanding) parts.push("Earth hidden at landing");
    if (w.nightH > c.maxNightH) parts.push(`Night ${num(w.nightH)} h > ${num(c.maxNightH)} h limit`);
    if (w.gapH > c.maxGapH) parts.push(`Comm gap ${num(w.gapH)} h > ${num(c.maxGapH)} h limit`);
    return parts.join("; ");
  }
  return `Night ${num(w.nightH)} of ${num(c.maxNightH)} h, comm gap ${num(w.gapH)} of ${num(c.maxGapH)} h`;
}
