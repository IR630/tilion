// Drive elevation profile (#164): the LOLA terrain under a rover drive from the landing site
// through the mission waypoints, with along-track slope and the drive timeline.
// Pure functions. The DEM reader is the one of the approach profile (approach/profile.ts) and the
// custom point (custom/assets.ts): LOLA 240 m tiles, heights above the 1737.4 km sphere.
import { profilePath, profileTiles, safeSample } from "../approach/profile";
import type { CustomMeta, Tile } from "../custom/assets";
import type { Dem } from "../custom/horizon";
import { EARTH, SUN, type Hours } from "./hours";
import { ROVER_M_PER_H } from "../mission/traverse";
import { indexAt } from "./route";

export type DrivePoint = { name: string; lat: number; lonE: number };
/** One sample of the drive: distance from the start (m), DEM point (stereographic m), leg index. */
export type DriveSample = { dM: number; x: number; y: number; lat: number; leg: number };
/** heightM: null = no DEM (NoData, outside 60–90°S). slopeDeg: NaN where a height is missing. */
export type ProfileSample = DriveSample & { heightM: number | null; slopeDeg: number };

/** Rover slope limit choices, degrees. Default 15°: VIPER "can generally drive on a slope of up to
 *  15 degrees" (science.nasa.gov/mission/viper/lunar-operations); for another rover an assumption. */
export const SLOPE_LIMITS = [10, 15, 20, 25] as const;
export const DEFAULT_SLOPE_LIMIT = 15;
/** Longest drive the profile samples: the DEM box of a longer one is too large for the browser. */
export const MAX_DRIVE_KM = 300;

/** Great-circle legs start → wp1 → wp2 …, sampled every ≤ 120 m; legs join without a repeat. */
export function drivePath(points: DrivePoint[]): DriveSample[] {
  if (points.length < 2) throw new Error("A drive needs the landing site and at least one waypoint.");
  const out: DriveSample[] = [];
  let offset = 0;
  for (let k = 0; k + 1 < points.length; k++) {
    const a = points[k];
    const b = points[k + 1];
    const leg = profilePath({ lat: a.lat, lon: a.lonE }, { lat: b.lat, lon: b.lonE });
    leg.forEach((p, i) => {
      if (k > 0 && i === 0) return;
      out.push({ dM: offset + p.distanceM, x: p.x, y: p.y, lat: p.lat, leg: k });
    });
    offset += leg[leg.length - 1].distanceM;
    if (offset > MAX_DRIVE_KM * 1000) throw new Error(`The drive is longer than ${MAX_DRIVE_KM} km; the profile covers shorter drives.`);
  }
  return out;
}

/** DEM tiles the drive needs (the four pixels of each bilinear sample). */
export function driveTiles(meta: CustomMeta, path: DriveSample[]): Tile[] {
  return profileTiles(
    meta,
    path.map((p) => ({ distanceM: p.dM, x: p.x, y: p.y, lat: p.lat, fraction: 0 })),
  );
}

/**
 * Heights along the path and the along-track slope: central difference over the neighbour samples
 * (about 240 m, one DEM cell), one-sided at the ends. Cross slope is not included.
 */
export function sampleProfile(dem: Dem, path: DriveSample[], minLat = -60): ProfileSample[] {
  const h = path.map((p) => (p.lat > minLat ? null : safeSample(dem, p.x, p.y)));
  return path.map((p, i) => ({ ...p, heightM: h[i], slopeDeg: slopeAt(path, h, i) }));
}

function slopeAt(path: { dM: number }[], h: (number | null)[], i: number): number {
  const a = Math.max(0, i - 1);
  const b = Math.min(path.length - 1, i + 1);
  const ha = h[a];
  const hb = h[b];
  const run = path[b].dM - path[a].dM;
  if (ha === null || hb === null || !(run > 0)) return NaN;
  return (Math.atan(Math.abs(hb - ha) / run) * 180) / Math.PI;
}

/** Distance ranges [from, to] (m) where the slope is above the limit. */
export function steepRuns(s: ProfileSample[], limitDeg: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  s.forEach((p, i) => {
    const steep = p.slopeDeg > limitDeg;
    if (steep && start < 0) start = i;
    if (!steep && start >= 0) {
      out.push([s[start].dM, s[i - 1].dM]);
      start = -1;
    }
  });
  if (start >= 0) out.push([s[start].dM, s[s.length - 1].dM]);
  return out;
}

export type ProfileStats = { lengthM: number; minM: number; maxM: number; climbM: number; descentM: number; maxSlopeDeg: number; known: number };

export function profileStats(s: ProfileSample[]): ProfileStats {
  let minM = Infinity, maxM = -Infinity, climbM = 0, descentM = 0, maxSlopeDeg = 0, known = 0;
  let prev: number | null = null;
  for (const p of s) {
    if (p.slopeDeg > maxSlopeDeg) maxSlopeDeg = p.slopeDeg;
    if (p.heightM === null) {
      prev = null;
      continue;
    }
    known++;
    minM = Math.min(minM, p.heightM);
    maxM = Math.max(maxM, p.heightM);
    if (prev !== null) {
      if (p.heightM > prev) climbM += p.heightM - prev;
      else descentM += prev - p.heightM;
    }
    prev = p.heightM;
  }
  return { lengthM: s.length ? s[s.length - 1].dM : 0, minM, maxM, climbM, descentM, maxSlopeDeg, known };
}

/** Linear interpolation of the height at distance d; null in a gap. */
export function heightAt(s: ProfileSample[], d: number): number | null {
  const i = indexBefore(s, d);
  const a = s[i];
  const b = s[Math.min(i + 1, s.length - 1)];
  if (a.heightM === null || b.heightM === null) return null;
  const t = b.dM > a.dM ? (d - a.dM) / (b.dM - a.dM) : 0;
  return a.heightM + t * (b.heightM - a.heightM);
}

/** Index of the last sample with dM <= d (clamped). */
export function indexBefore(s: { dM: number }[], d: number): number {
  let lo = 0, hi = s.length - 1;
  if (d <= s[0].dM) return 0;
  if (d >= s[hi].dM) return hi;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (s[m].dM <= d) lo = m;
    else hi = m;
  }
  return lo;
}

/** Drive timeline: constant mean speed (m/h, the traverse speed) from the departure (landing) moment. */
export const timeAtDistance = (departMs: number, dM: number, mPerH: number = ROVER_M_PER_H) => departMs + (dM / mPerH) * 3_600_000;

/** Rover distance at a moment, clamped to [0, lengthM]: it waits at the site, then stops at the end. */
export function distanceAtTime(departMs: number, atMs: number, mPerH: number, lengthM: number): number {
  const d = ((atMs - departMs) / 3_600_000) * mPerH;
  return Math.min(lengthM, Math.max(0, d));
}

/** Sun and Earth codes of the site at a moment; null outside the hourly data. */
export function visibilityAt(hours: Hours, siteId: string, ms: number): { sun: boolean; earth: boolean } | null {
  const s = hours.sites.get(siteId);
  const i = indexAt(hours, ms);
  if (!s || !(i >= 0 && i < hours.n)) return null;
  return { sun: (s.codes[i] & SUN) !== 0, earth: (s.codes[i] & EARTH) !== 0 };
}

/** "Nice" axis ticks: about `count` steps of 1, 2 or 5 × 10^k covering [lo, hi]. */
export function ticks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((v) => v >= raw) as number;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}
