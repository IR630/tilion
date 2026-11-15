// #328: replan after a landing slip. Sites × days around the slipped landing; each cell is the Windows
// verdict (landing.ts judge, the PlanVerdict rule) over hours.json metrics (route.ts metricsAt).
// No new scoring rule: this module only picks cells, the first failed limit and the smallest passing change.
// Unknown (no data, window cut by the data end) is never a pass.
import { expandFlips } from "../api";
import type { Site, VisibilityVariants } from "../contracts";
import { type Conditions, type Verdict, type Win, judge } from "../landing";
import { decodeSite, encodeCodes, type Hours } from "../route/hours";
import { distanceKm, metricsAt, type Metrics } from "../route/route";

export const FROM_DAY = -7;
export const TO_DAY = 30;
/** Rows of the matrix: the plan site and the nearest sites in the plan radius. */
export const MAX_ROWS = 8;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** The body behind a FAIL: Sun (down at landing, or night over the limit) or Earth (hidden at landing, or a
 *  comm gap over the limit). The Sun series already holds the terrain horizon and Earth eclipses (D-010). */
export type Cause = "sun" | "earth";
/** verdict null = unknown: the site has no hours or the mission window leaves the data. */
export type Cell = { day: number; landingUtc: string; verdict: Verdict | null; cause: Cause | null };
export type Row = { siteId: string; distanceKm: number; cells: Cell[] };

export const passes = (v: Verdict | null): v is Verdict => v !== null && v.level !== "FAIL";

/** First failed hard limit, in the order of judge() and verdictRule(); null when all hold. */
export function firstCause(w: Win, c: Conditions): Cause | null {
  if (!w.sunAtLanding) return "sun";
  if (!w.earthAtLanding) return "earth";
  if (w.nightH > c.maxNightH) return "sun";
  if (w.gapH > c.maxGapH) return "earth";
  return null;
}

/** hours.json metrics as the Win that judge() reads: the same 0/1 series as the timeline. */
function winOf(m: Metrics): Win {
  return {
    start: 0,
    sunAtLanding: m.sunUpAtLanding,
    earthAtLanding: m.earthUpAtLanding,
    nightH: m.longestDarkH,
    gapH: m.longestNoCommsH,
    sunShare: m.windowH > 0 ? m.sunH / m.windowH : 0,
    earthShare: m.windowH > 0 ? m.earthH / m.windowH : 0,
  };
}

/** The Windows verdict of one landing; null when the mission window does not fit the data. */
export function verdictOf(hours: Hours, siteId: string, landingUtc: string, c: Conditions): Verdict | null {
  const m = metricsAt(hours, siteId, landingUtc, c.days);
  return m && !m.windowClipped ? judge(winOf(m), c) : null;
}

const shift = (utc: string, ms: number) => new Date(Date.parse(utc) + ms).toISOString().replace(".000Z", "Z");

/** Rows: the plan site first, then the nearest other sites within radiusKm, at most MAX_ROWS in all. */
export function pickRows(sites: Site[], planSiteId: string, radiusKm: number): { siteId: string; distanceKm: number }[] {
  const p = sites.find((s) => s.id === planSiteId);
  if (!p || p.lat === null || p.lonE === null) return [];
  const others = sites
    .filter((s) => s.id !== planSiteId && s.lat !== null && s.lonE !== null)
    .map((s) => ({ siteId: s.id, distanceKm: distanceKm(p.lat as number, p.lonE as number, s.lat as number, s.lonE as number) }))
    .filter((r) => r.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm || (a.siteId < b.siteId ? -1 : 1));
  return [{ siteId: planSiteId, distanceKm: 0 }, ...others].slice(0, MAX_ROWS);
}

/** Cells for whole-day slips FROM_DAY…TO_DAY from landingUtc, same time of day. */
export function buildMatrix(hours: Hours, rows: { siteId: string; distanceKm: number }[], landingUtc: string, c: Conditions): Row[] {
  return rows.map((r) => {
    const cells: Cell[] = [];
    for (let day = FROM_DAY; day <= TO_DAY; day++) {
      const utc = shift(landingUtc, day * DAY_MS);
      const verdict = verdictOf(hours, r.siteId, utc, c);
      cells.push({ day, landingUtc: utc, verdict, cause: verdict && verdict.level === "FAIL" ? firstCause(verdict.win, c) : null });
    }
    return { ...r, cells };
  });
}

/** Plan B, wait: the first passing day at the plan site at or after the slipped landing. */
export function waitAtSite(rows: Row[]): Cell | null {
  return rows[0]?.cells.find((x) => x.day >= 0 && passes(x.verdict)) ?? null;
}

/** Plan B, move: the nearest other site that passes on the slipped date. */
export function moveSameDate(rows: Row[]): { row: Row; cell: Cell } | null {
  for (const row of rows.slice(1)) {
    const cell = row.cells.find((x) => x.day === 0);
    if (cell && passes(cell.verdict)) return { row, cell };
  }
  return null;
}

/** Smallest change, time: the first hourly start at or after landingUtc that passes, within TO_DAY days. */
export function nearestStart(hours: Hours, siteId: string, landingUtc: string, c: Conditions): { hours: number; landingUtc: string; verdict: Verdict } | null {
  for (let h = 0; h <= TO_DAY * 24; h++) {
    const utc = shift(landingUtc, h * HOUR_MS);
    const verdict = verdictOf(hours, siteId, utc, c);
    if (passes(verdict)) return { hours: h, landingUtc: utc, verdict };
  }
  return null;
}

export type HeightTry = { heightM: number; verdict: Verdict | null };

/** Smallest change, height: the verdict at landingUtc for each precomputed observer height (reference DEM),
 *  lowest first. lowest = the lowest height that passes; null when none passes or all are unknown. */
export function lowestHeight(v: VisibilityVariants, landingUtc: string, c: Conditions): { tried: HeightTry[]; lowest: number | null } {
  const startMs = Date.parse(v.startUtc);
  const tried = v.variants
    .filter((x) => x.dem === v.ref.dem && Array.isArray(x.sun) && Array.isArray(x.earth))
    .sort((a, b) => a.heightM - b.heightM)
    .map((x) => {
      const codes = encodeCodes(expandFlips(x.sun, 0, v.n), expandFlips(x.earth, 0, v.n));
      const h: Hours = { startMs, stepMin: v.stepMin, n: v.n, sites: new Map([[v.siteId, decodeSite(codes, v.n, v.siteId)]]) };
      return { heightM: x.heightM, verdict: verdictOf(h, v.siteId, landingUtc, c) };
    });
  return { tried, lowest: tried.find((t) => passes(t.verdict))?.heightM ?? null };
}

/** The one-line verdict over the matrix: does the slipped landing hold, and if not, the nearest fix in days. */
export function headline(rows: Row[]): { level: "pass" | "fail" | "unknown"; passDays: number; total: number } {
  const plan = rows[0]?.cells.filter((x) => x.day >= 0) ?? [];
  const zero = plan.find((x) => x.day === 0);
  return {
    level: !zero || !zero.verdict ? "unknown" : passes(zero.verdict) ? "pass" : "fail",
    passDays: plan.filter((x) => passes(x.verdict)).length,
    total: plan.length,
  };
}

/** #435: what the matrix headline counts: one start per day at the plan's hour, day 0 to +TO_DAY (TO_DAY + 1 days).
 *  Windows counts differently (a UTC day passes if any hour in it passes, over 30 days), so the text says which. */
export function passDaysText(passDays: number, total: number, planName: string, landingUtc: string): string {
  const hh = String(new Date(landingUtc).getUTCHours()).padStart(2, "0");
  return `${passDays} of ${total} days pass at ${planName}, landing at ${hh}:00 UTC each day from day 0 to +${TO_DAY} (Windows counts a day if any hour in it passes).`;
}
