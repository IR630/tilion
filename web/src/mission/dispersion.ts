// #327: landing dispersion. The lander does not touch down on the exact point: scatter N points
// around the target, judge each with the same mission rules (landing.ts verdictAt), count the share
// that passes. Pure functions; the worker is dispersionWorker.ts, the UI is DispersionPanel.tsx.
// Plain seeded pseudo-random sampling, so the binomial Wilson interval applies to the share.
import type { Timeline } from "../contracts";
import { type Conditions, type Verdict, isViable, scanWindows, verdictAt, windowSteps } from "../landing";

export const DEFAULT_SIGMA_M = 100;
export const DEFAULT_N = 200;
export const DEFAULT_SEED = 1;

const R = 1737400; // m, LOLA reference sphere (custom/horizon.ts R)
const D = Math.PI / 180;

/** mulberry32: a small seeded generator, uniform in [0, 1). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** N east/north offsets (m), each axis Gaussian with sigma sigmaM (Box–Muller). Same seed, same offsets. */
export function scatter(n: number, sigmaM: number, seed: number): { e: number; n: number }[] {
  const u = rng(seed);
  return Array.from({ length: n }, () => {
    const r = sigmaM * Math.sqrt(-2 * Math.log(1 - u())); // 1 - u in (0, 1]: no log(0)
    const a = 2 * Math.PI * u();
    return { e: r * Math.cos(a), n: r * Math.sin(a) };
  });
}

/** The point at east/north offset (m) from lat/lonE, along the sphere. lonE 0–360°E. */
export function offsetPoint(lat: number, lonE: number, e: number, n: number): { lat: number; lonE: number } {
  const d = Math.hypot(e, n);
  if (d === 0) return { lat, lonE };
  const la = lat * D;
  const lo = lonE * D;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const c = Math.cos(d / R);
  const s = Math.sin(d / R) / d;
  const p = [0, 1, 2].map((k) => c * up[k] + s * (e * east[k] + n * north[k]));
  return { lat: Math.asin(Math.max(-1, Math.min(1, p[2]))) / D, lonE: ((Math.atan2(p[1], p[0]) / D) % 360 + 360) % 360 };
}

/** Steps [at, at + len) of an hourly grid that the mission from landingUtc covers; null outside the grid. */
export function missionSpan(startUtc: string, stepMin: number, n: number, landingUtc: string, days: number): { at: number; len: number } | null {
  const at = Math.floor((Date.parse(landingUtc) - Date.parse(startUtc)) / (stepMin * 60000));
  const len = windowSteps({ stepMin } as Timeline, days);
  return at >= 0 && at + len <= n ? { at, len } : null;
}

/** The mission verdict at one point: the Windows panel rule (landing.ts), no second rule set. */
export function pointVerdict(tl: Timeline, c: Conditions, landingUtc: string): Verdict | null {
  return verdictAt(tl, scanWindows(tl, c.days), c, landingUtc);
}

export type Outcome = "pass" | "fail" | "unknown";
/** One sampled touchdown point; verdict null = unknown (no DEM, no data for the window). */
export type Sample = { e: number; n: number; lat: number; lonE: number; verdict: Verdict | null; why?: string };

export const outcome = (s: Sample, c: Conditions): Outcome => (!s.verdict ? "unknown" : isViable(s.verdict.win, c) ? "pass" : "fail");

const Z95 = 1.959963984540054;

/** Wilson score interval, 95 %, for k successes of n. */
export function wilson(k: number, n: number): { lo: number; hi: number } {
  if (n <= 0) return { lo: 0, hi: 1 };
  const p = k / n;
  const z2 = Z95 * Z95;
  const den = 1 + z2 / n;
  const mid = (p + z2 / (2 * n)) / den;
  const half = (Z95 / den) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { lo: Math.max(0, mid - half), hi: Math.min(1, mid + half) };
}

/** How far a verdict is from passing: landing with the Sun or Earth down first, then the larger share of a limit used. */
function badness(v: Verdict, c: Conditions): number {
  const w = v.win;
  if (!w.sunAtLanding || !w.earthAtLanding) return Infinity;
  const r = (x: number, lim: number) => (lim > 0 ? x / lim : x > 0 ? 1e9 : 0);
  return Math.max(r(w.nightH, c.maxNightH), r(w.gapH, c.maxGapH));
}

export type Summary = {
  total: number;
  pass: number;
  marginal: number; // passes at MARGINAL, part of `pass`
  fail: number;
  unknown: number;
  share: number; // pass / total: unknown points stay in the denominator
  lo: number;
  hi: number;
  worst: number; // index of the worst judged sample, -1 when none is judged
};

export function summarize(samples: Sample[], c: Conditions): Summary {
  let pass = 0;
  let marginal = 0;
  let fail = 0;
  let worst = -1;
  let worstBad = -1;
  samples.forEach((s, i) => {
    const o = outcome(s, c);
    if (o === "unknown" || !s.verdict) return;
    if (o === "pass") pass++;
    else fail++;
    if (s.verdict.level === "MARGINAL") marginal++;
    // A FAIL is always worse than a pass; ties keep the first sample.
    const b = badness(s.verdict, c) + (o === "fail" ? 1e12 : 0);
    if (b > worstBad) (worstBad = b), (worst = i);
  });
  const total = samples.length;
  const { lo, hi } = wilson(pass, total);
  return { total, pass, marginal, fail, unknown: total - pass - fail, share: total ? pass / total : 0, lo, hi, worst };
}
