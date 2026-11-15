// Mission route (D-004): from a planned (site, landing moment) find alternative
// (site × landing date) options for a schedule slip, with metrics, and rank them.
// Pure functions over decoded hours (D-006). No UI.
//
// Ranking, in this order:
//  1. Filter: site has codes and coordinates; distance from the plan site <= radiusKm;
//     slip is a whole number of days in [slipMinDays, slipMaxDays], same time of day;
//     the full window [landing, landing + windowDays) is inside the data.
//  2. Primary metric of the mode, descending: energy = sunH, comms = earthH, balanced = bothH.
//  3. Ties: values within 1 % of the group leader count as equal (leader = best value not yet
//     grouped). Inside a group: smaller |slipDays| first, then smaller distanceKm, then site id.
//     With rank: "score" (#160) step 2 uses the route score (score.ts) and step 3 ties scores
//     within 1 point instead of 1 %.
//  4. Diversity: at most 2 dates per site in the result. The best date of the plan site is
//     always in the result (it replaces the last entry if it did not get in).

import type { Site } from "../contracts";
import { EARTH, SUN, type Hours, type SiteHours } from "./hours";
import { scoreOf } from "./score";

export type Plan = { siteId: string; landingUtc: string };
export type Mode = "energy" | "comms" | "balanced";
export type Options = {
  slipMinDays: number;
  slipMaxDays: number;
  radiusKm: number; // Infinity = any site
  windowDays: number;
  mode: Mode;
  /** "metric" (default, D-004): the primary metric of the mode; "score": the route score (#160). */
  rank?: "metric" | "score";
};
export const DEFAULT_OPTIONS: Options = {
  slipMinDays: -14,
  slipMaxDays: 30,
  radiusKm: Infinity,
  windowDays: 14,
  mode: "balanced",
};

export type Tag = "best" | "on-plan" | "nearest" | "no-slip";
/** UI labels. "nearest" is the nearest other site among the options shown, not among all sites. */
export const TAG_LABEL: Record<Tag, string> = {
  best: "best",
  "on-plan": "on plan",
  nearest: "nearest of those shown",
  "no-slip": "no slip",
};

/** Visibility metrics of one window. Hours are hours (steps × stepMin / 60). */
export type Metrics = {
  windowH: number; // actual window length; less than requested when clipped at data end
  sunH: number;
  earthH: number;
  bothH: number;
  longestDarkH: number; // longest run without Sun inside the window
  longestNoCommsH: number; // longest run without Earth inside the window
  windowClipped: boolean; // the data ends inside the window: windowH < requested
  hoursToSunset: number | null; // landing → first step without Sun; null = Sun down at landing
  hoursToEarthset: number | null; // landing → first step without Earth; null = Earth down
  sunsetBeyondData: boolean; // no sunset before the data end: hoursToSunset is a lower bound
  earthsetBeyondData: boolean; // no Earthset before the data end: hoursToEarthset is a lower bound
  sunUpAtLanding: boolean;
  earthUpAtLanding: boolean;
};

export type RouteOption = Metrics & {
  siteId: string;
  landingUtc: string;
  slipDays: number;
  distanceKm: number;
  tags: Tag[];
};

export type DayStat = { dayUtc: string; hours: number; sunH: number; earthH: number; bothH: number };

export const MOON_RADIUS_KM = 1737.4;
const DAY_MS = 86_400_000;
const TIE_FRACTION = 0.01;
/** Route scores within this many points tie (rule 3 with rank: "score"). */
export const TIE_POINTS = 1;
const MAX_PER_SITE = 2;

/** Great-circle distance on a sphere of the mean lunar radius (haversine). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * MOON_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Step index that contains the moment t (floor). May be outside [0, n). */
export function indexAt(hours: Hours, t: number): number {
  return Math.floor((t - hours.startMs) / (hours.stepMin * 60_000));
}

/** Longest runs without Sun and without Earth over steps [from, to), in one pass. */
function longestGaps(codes: Uint8Array, from: number, to: number): [number, number] {
  let dark = 0, darkRun = 0, quiet = 0, quietRun = 0;
  for (let i = from; i < to; i++) {
    const c = codes[i];
    if (c & SUN) darkRun = 0;
    else if (++darkRun > dark) dark = darkRun;
    if (c & EARTH) quietRun = 0;
    else if (++quietRun > quiet) quiet = quietRun;
  }
  return [dark, quiet];
}

/** Metrics for window [i0, i0 + w) clipped to the data. Caller checks 0 <= i0 < n. */
function windowMetrics(hours: Hours, s: SiteHours, i0: number, w: number): Metrics {
  const i1 = Math.min(i0 + w, hours.n);
  const h = hours.stepMin / 60;
  // Hours to the first loss, searched to the data end; never lost = hours to the data end,
  // flagged by sunsetBeyondData / earthsetBeyondData (the UI shows "> N h").
  const sunUp = (s.codes[i0] & SUN) !== 0;
  const earthUp = (s.codes[i0] & EARTH) !== 0;
  const [dark, quiet] = longestGaps(s.codes, i0, i1);
  const sunLoss = s.sunLoss[i0];
  const earthLoss = s.earthLoss[i0];
  return {
    windowH: (i1 - i0) * h,
    windowClipped: i0 + w > hours.n,
    sunH: (s.sunPre[i1] - s.sunPre[i0]) * h,
    earthH: (s.earthPre[i1] - s.earthPre[i0]) * h,
    bothH: (s.bothPre[i1] - s.bothPre[i0]) * h,
    longestDarkH: dark * h,
    longestNoCommsH: quiet * h,
    hoursToSunset: sunUp ? (sunLoss - i0) * h : null,
    hoursToEarthset: earthUp ? (earthLoss - i0) * h : null,
    sunsetBeyondData: sunUp && sunLoss >= hours.n,
    earthsetBeyondData: earthUp && earthLoss >= hours.n,
    sunUpAtLanding: sunUp,
    earthUpAtLanding: earthUp,
  };
}

function windowSteps(hours: Hours, windowDays: number): number {
  return Math.round((windowDays * 24 * 60) / hours.stepMin);
}

/** Metrics of one landing. The window is clipped at the data end (see windowH).
 *  null = unknown site or landing outside the data. */
export function metricsAt(hours: Hours, siteId: string, landingUtc: string, windowDays: number): Metrics | null {
  const s = hours.sites.get(siteId);
  const i0 = indexAt(hours, Date.parse(landingUtc));
  if (!s || !(i0 >= 0 && i0 < hours.n)) return null;
  return windowMetrics(hours, s, i0, windowSteps(hours, windowDays));
}

/** Per-day sums for a calendar strip: day k = [from + k days, from + k + 1 days), clipped to data. */
export function dayStrip(hours: Hours, siteId: string, fromUtc: string, days: number): DayStat[] {
  const s = hours.sites.get(siteId);
  const from = Date.parse(fromUtc);
  const perDay = windowSteps(hours, 1);
  const h = hours.stepMin / 60;
  const out: DayStat[] = [];
  for (let k = 0; k < days; k++) {
    const t = from + k * DAY_MS;
    const a = Math.max(0, Math.min(hours.n, indexAt(hours, t)));
    const b = Math.max(0, Math.min(hours.n, indexAt(hours, t) + perDay));
    const day: DayStat = { dayUtc: new Date(t).toISOString(), hours: (b - a) * h, sunH: 0, earthH: 0, bothH: 0 };
    if (s) {
      day.sunH = (s.sunPre[b] - s.sunPre[a]) * h;
      day.earthH = (s.earthPre[b] - s.earthPre[a]) * h;
      day.bothH = (s.bothPre[b] - s.bothPre[a]) * h;
    }
    out.push(day);
  }
  return out;
}

export function primaryMetric(o: Metrics, mode: Mode): number {
  return mode === "energy" ? o.sunH : mode === "comms" ? o.earthH : o.bothH;
}

const tieBreak = (a: RouteOption, b: RouteOption) =>
  Math.abs(a.slipDays) - Math.abs(b.slipDays) || a.distanceKm - b.distanceKm || (a.siteId < b.siteId ? -1 : a.siteId > b.siteId ? 1 : 0);

/** Rules 2–3 of the header: metric descending, 1 % tie groups, then |slip|, distance. */
export function rankOptions(list: RouteOption[], mode: Mode): RouteOption[] {
  const byMetric = [...list].sort((a, b) => primaryMetric(b, mode) - primaryMetric(a, mode) || tieBreak(a, b));
  const out: RouteOption[] = [];
  let i = 0;
  while (i < byMetric.length) {
    const floor = primaryMetric(byMetric[i], mode) * (1 - TIE_FRACTION);
    let j = i + 1;
    while (j < byMetric.length && primaryMetric(byMetric[j], mode) >= floor) j++;
    out.push(...byMetric.slice(i, j).sort(tieBreak));
    i = j;
  }
  return out;
}

/** Rank by the route score of the mode (#160): scores within 1 point tie, then |slip|, distance. */
export function rankByScore(list: RouteOption[], mode: Mode): RouteOption[] {
  const scored = list.map((o) => ({ o, s: scoreOf(o, mode).total }));
  scored.sort((a, b) => b.s - a.s || tieBreak(a.o, b.o));
  const out: RouteOption[] = [];
  let i = 0;
  while (i < scored.length) {
    const floor = scored[i].s - TIE_POINTS;
    let j = i + 1;
    while (j < scored.length && scored[j].s >= floor) j++;
    out.push(...scored.slice(i, j).map((x) => x.o).sort(tieBreak));
    i = j;
  }
  return out;
}

/** What ranks a tied option (#204). */
export type Decider = "slip" | "distance";

/** For each option of a ranked list: the tie-breaker of rule 3 that orders it against a neighbour
 *  whose score is within TIE_POINTS (the score terms saturate at 1, so good polar windows often all
 *  score 100). null = no tied neighbour, or the neighbour differs only by site id. */
export function tieDeciders(list: RouteOption[], mode: Mode): (Decider | null)[] {
  const s = list.map((o) => scoreOf(o, mode).total);
  const tied = (i: number, j: number) => j >= 0 && j < list.length && Math.abs(s[i] - s[j]) <= TIE_POINTS;
  return list.map((o, i) => {
    const n = tied(i, i - 1) ? list[i - 1] : tied(i, i + 1) ? list[i + 1] : null;
    if (!n) return null;
    if (Math.abs(n.slipDays) !== Math.abs(o.slipDays)) return "slip";
    return n.distanceKm !== o.distanceKm ? "distance" : null;
  });
}

/** Rule 4 of the header: at most 2 dates per site; keep the plan site's best date. */
export function pickDiverse(ranked: RouteOption[], planSiteId: string, limit: number): RouteOption[] {
  const perSite = new Map<string, number>();
  const picked: RouteOption[] = [];
  for (const o of ranked) {
    if (picked.length >= limit) break;
    const c = perSite.get(o.siteId) ?? 0;
    if (c >= MAX_PER_SITE) continue;
    perSite.set(o.siteId, c + 1);
    picked.push(o);
  }
  const planBest = ranked.find((o) => o.siteId === planSiteId);
  if (planBest && limit > 0 && !picked.includes(planBest)) {
    if (picked.length >= limit) picked.pop();
    picked.push(planBest); // ranked lower than everything picked, so the order stays ranked
  }
  return picked;
}

function addTags(list: RouteOption[], planSiteId: string): void {
  let nearest: RouteOption | null = null;
  for (const o of list) {
    if (o.siteId !== planSiteId && (!nearest || o.distanceKm < nearest.distanceKm)) nearest = o;
  }
  list.forEach((o, i) => {
    if (i === 0) o.tags.push("best");
    if (o.slipDays === 0 && o.siteId === planSiteId) o.tags.push("on-plan");
    if (nearest && o.siteId === nearest.siteId) o.tags.push("nearest");
    if (o.slipDays === 0 && o.siteId !== planSiteId) o.tags.push("no-slip");
  });
}

/** Search all eligible sites × whole-day slips and return the plan metrics and ranked options.
 *  plan = null when the plan site has no codes or no coordinates, or the landing is outside the
 *  data; options are then empty. The plan window may be clipped at the data end; options never are. */
export function findRoutes(
  hours: Hours,
  sites: Site[],
  plan: Plan,
  opts: Options = DEFAULT_OPTIONS,
  limit = 6,
): { plan: RouteOption | null; options: RouteOption[] } {
  const planSite = sites.find((s) => s.id === plan.siteId);
  const planSh = hours.sites.get(plan.siteId);
  const t0 = Date.parse(plan.landingUtc);
  const p0 = indexAt(hours, t0);
  if (!planSite || planSite.lat === null || planSite.lonE === null || !planSh || !(p0 >= 0 && p0 < hours.n)) {
    return { plan: null, options: [] };
  }
  const w = windowSteps(hours, opts.windowDays);
  const planOpt: RouteOption = {
    ...windowMetrics(hours, planSh, p0, w),
    siteId: plan.siteId,
    landingUtc: new Date(t0).toISOString(),
    slipDays: 0,
    distanceKm: 0,
    tags: ["on-plan"],
  };

  const candidates: RouteOption[] = [];
  for (const site of sites) {
    const sh = hours.sites.get(site.id);
    if (!sh || site.lat === null || site.lonE === null) continue;
    const d = site.id === plan.siteId ? 0 : distanceKm(planSite.lat, planSite.lonE, site.lat, site.lonE);
    if (d > opts.radiusKm) continue;
    for (let slip = Math.ceil(opts.slipMinDays); slip <= opts.slipMaxDays; slip++) {
      const t = t0 + slip * DAY_MS;
      const i0 = indexAt(hours, t);
      if (i0 < 0 || i0 + w > hours.n) continue; // window leaves the data
      candidates.push({
        ...windowMetrics(hours, sh, i0, w),
        siteId: site.id,
        landingUtc: new Date(t).toISOString(),
        slipDays: slip,
        distanceKm: d,
        tags: [],
      });
    }
  }

  const ranked = opts.rank === "score" ? rankByScore(candidates, opts.mode) : rankOptions(candidates, opts.mode);
  const options = pickDiverse(ranked, plan.siteId, limit);
  addTags(options, plan.siteId);
  return { plan: planOpt, options };
}
