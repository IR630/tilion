// SiteSummary from a loaded timeline (real or stub). Spread (Q8) = min–max over the visibility
// variants (observer 0/2/10 m × DEM); value = the reference timeline (2 m, 20 m + 80 m + 240 m).
import type { HorizonMask, Interval, SiteSummary, Timeline } from "./contracts";
import { DATA_PERIOD, fmtShare } from "./format";
import { horizonToward } from "./screens/DemInfo";

/** Hours while the series stays on from index 0; null when off at index 0. */
export function hoursOn(flags: number[], stepMin: number): number | null {
  if (!(flags[0] > 0)) return null;
  const k = flags.findIndex((v) => !(v > 0));
  return ((k < 0 ? flags.length : k) * stepMin) / 60;
}

export function onShare(flags: number[]): number {
  return flags.reduce((x, y) => x + (y > 0 ? 1 : 0), 0) / Math.max(1, flags.length);
}

export type Run = { hours: number; startUtc: string; endUtc: string } | null;

/** Longest run of consecutive steps where `on(i)` holds. */
export function longestRun(tl: Timeline, on: (i: number) => boolean): Run {
  let best = 0;
  let bestStart = -1;
  let cur = 0;
  for (let i = 0; i < tl.sunVisible.length; i++) {
    cur = on(i) ? cur + 1 : 0;
    if (cur > best) (best = cur), (bestStart = i - cur + 1);
  }
  if (!best) return null;
  const t0 = Date.parse(tl.startUtc);
  const stepMs = tl.stepMin * 60000;
  const iso = (k: number) => new Date(t0 + k * stepMs).toISOString().slice(0, 16).replace("T", " ");
  return { hours: (best * tl.stepMin) / 60, startUtc: iso(bestStart), endUtc: iso(bestStart + best) };
}

/** Longest night (Sun not lit) and longest gap in Earth contact over the whole of `tl`, hours, with variant spread. */
export function windowRuns(tl: Timeline): { longestNightH: Interval; longestCommGapH: Interval } {
  const gap = (off: (i: number) => boolean) => longestRun(tl, off)?.hours ?? 0;
  const vs = tl.variantSunLit ?? [];
  const ve = tl.variantEarthVisible ?? [];
  return {
    longestNightH: spread(gap((i) => !(tl.sunVisible[i] > 0)), vs.map((f) => gap((i) => !(f[i] > 0)))),
    longestCommGapH: spread(gap((i) => !(tl.earthVisible[i] > 0)), ve.map((f) => gap((i) => !(f[i] > 0)))),
  };
}

function spread(value: number, others: number[]): Interval {
  const all = [value, ...others];
  return { value, lo: Math.min(...all), hi: Math.max(...all) };
}

// #162 One computation per quantity. Every screen (place card, hero, Compare, Windows, globe caption)
// reads "now" from the step that holds the moment (floor) and counts time to an event to the data end.

/** Index of the step that holds `atUtc` (floor); may fall outside the data. */
export function stepIndex(tl: { startUtc: string; stepMin: number }, atUtc: string): number {
  return Math.floor((Date.parse(atUtc) - Date.parse(tl.startUtc)) / (tl.stepMin * 60000));
}

/** Start of the step that holds `atUtc` on an hourly (or stepMin) grid, ISO UTC. */
export function stepUtc(atUtc: string, stepMin = 60): string {
  const ms = stepMin * 60000;
  return new Date(Math.floor(Date.parse(atUtc) / ms) * ms).toISOString().replace(".000Z", "Z");
}

/** Steps from i until the flag changes state; null = no change before the series ends. */
function stepsToChange(flags: number[], i: number): number | null {
  const now = flags[i] > 0;
  for (let k = i + 1; k < flags.length; k++) if (flags[k] > 0 !== now) return k - i;
  return null;
}

/** Hours from step i to the next change of `flags`; beyond = no change before the data end (hours = to the last step). */
export function untilChange(flags: number[], i: number, stepMin: number): { hours: number; beyond: boolean } {
  const k = stepsToChange(flags, i);
  return k === null ? { hours: ((flags.length - 1 - i) * stepMin) / 60, beyond: true } : { hours: (k * stepMin) / 60, beyond: false };
}

/** #206 Angle of a body above the LOLA terrain horizon at its azimuth (elevation − mask), degrees.
 *  null = no mask, a site without terrain (the flat 0° horizon is the level) or no DEM toward it. */
export function terrainClearance(mask: HorizonMask | null | undefined, az: number, el: number): number | null {
  if (!mask || mask.terrain === "none") return null;
  const hz = horizonToward(mask, az);
  return hz === null ? null : el - hz;
}

export type LiveState = {
  utc: string; // the timeline step shown
  sunUp: boolean;
  sunVisible: number; // 0..1 share of the Sun's limb-darkened flux (timeline sunVisible)
  sunElDeg: number;
  /** #206 Sun centre above the terrain horizon at its azimuth; null = no mask or no terrain. */
  sunClearDeg: number | null;
  /** Hours to sunset (when up) or sunrise (when down); null = no change before data end. */
  sunChangeH: number | null;
  earthUp: boolean;
  earthElDeg: number;
  earthClearDeg: number | null;
  /** Hours to Earthset (when up) or Earthrise (when down); null = no change before data end. */
  earthChangeH: number | null;
  /** Hours from the step to the data end: the lower limit when a change is null. */
  leftH: number;
};

/** Sun and Earth at atUtc from a full timeline; null when atUtc is outside it. With `mask`, also the clearance above terrain. */
export function liveState(tl: Timeline, atUtc: string, mask?: HorizonMask | null): LiveState | null {
  const i = stepIndex(tl, atUtc);
  if (!(i >= 0 && i < tl.sunVisible.length)) return null;
  const sun = untilChange(tl.sunVisible, i, tl.stepMin);
  const earth = untilChange(tl.earthVisible, i, tl.stepMin);
  return {
    utc: new Date(Date.parse(tl.startUtc) + i * tl.stepMin * 60000).toISOString().slice(0, 16) + ":00Z",
    sunUp: tl.sunVisible[i] > 0,
    sunVisible: tl.sunVisible[i],
    sunElDeg: tl.sunEl[i],
    sunClearDeg: terrainClearance(mask, tl.sunAz[i], tl.sunEl[i]),
    sunChangeH: sun.beyond ? null : sun.hours,
    earthUp: tl.earthVisible[i] > 0,
    earthElDeg: tl.earthEl[i],
    earthClearDeg: terrainClearance(mask, tl.earthAz[i], tl.earthEl[i]),
    earthChangeH: earth.beyond ? null : earth.hours,
    leftH: sun.beyond ? sun.hours : ((tl.sunVisible.length - 1 - i) * tl.stepMin) / 60,
  };
}

/** A Compare row with `leftH`: hours from the step to the data end (a time to an event equal to it is "> leftH"),
 *  #206 `sunClearDeg`: the Sun centre above the terrain horizon (null = no mask or no terrain), and #424
 *  `noSpread`: a terrain site without visibility variants (Compare shows a "no spread" badge). */
export type SummaryRow = SiteSummary & { leftH?: number; sunClearDeg?: number | null; noSpread?: boolean };

/**
 * `tl` = the slice that starts at the step of atUtc (shares, next 30 d); `full` = the whole data window
 * with variants: Sun elevation, time to sunset / Earthset and the night and contact-gap runs.
 */
export function summarize(tl: Timeline, atUtc: string, full: Timeline = tl, mask?: HorizonMask | null): SummaryRow {
  const vs = tl.variantSunLit ?? [];
  const ve = tl.variantEarthVisible ?? [];
  const n = full.sunVisible.length;
  const i = Math.min(n - 1, Math.max(0, stepIndex(full, atUtc)));
  const until = (flags: number[], variants: number[][]): Interval | null => {
    if (!(flags[i] > 0)) return null;
    return spread(
      untilChange(flags, i, full.stepMin).hours,
      variants.map((f) => (f[i] > 0 ? untilChange(f, i, full.stepMin).hours : 0)),
    );
  };
  return {
    siteId: tl.siteId,
    atUtc,
    sunElDeg: full.sunEl[i],
    sunClearDeg: terrainClearance(mask, full.sunAz[i], full.sunEl[i]),
    hoursToSunset: until(full.sunVisible, full.variantSunLit ?? []),
    hoursToEarthset: until(full.earthVisible, full.variantEarthVisible ?? []),
    lightFraction: spread(onShare(tl.sunVisible), vs.map(onShare)),
    earthFraction: spread(onShare(tl.earthVisible), ve.map(onShare)),
    ...(tl.dsnVisible ? { dsnFraction: onShare(tl.dsnVisible) } : {}),
    ...windowRuns(full),
    ...(tl.stub ? { stub: true } : {}),
    leftH: ((n - 1 - i) * full.stepMin) / 60,
  };
}

// Bare sphere = the trivial answer: a flat 0° horizon. The data has no "none" visibility variant for
// terrain sites, so the series is derived from the Sun and Earth elevations of the timeline (same rule as
// backend variants.py "none": Sun lit = any limb above 0°, Earth = centre above 0°).
const SUN_RADIUS_DEG = 0.265;

/** Timeline of the same site over a flat 0° horizon. No variant spread: the sphere has one answer. */
export function sphereTimeline(tl: Timeline): Timeline {
  const { variantSunLit: _s, variantEarthVisible: _e, dsnVisible: _d, ...rest } = tl;
  return {
    ...rest,
    sunVisible: tl.sunEl.map((el) => (el + SUN_RADIUS_DEG > 0 ? 1 : 0)),
    earthVisible: tl.earthEl.map((el) => (el > 0 ? 1 : 0)),
  };
}

export type Shares = { sphere: number; terrain: number };
export type TerrainEffect = { sun: Shares; earth: Shares; both: Shares };

/** Share of steps with the Sun lit, the Earth in view, and both, over the whole of `tl`: sphere vs terrain. */
export function terrainEffect(tl: Timeline): TerrainEffect {
  const sp = sphereTimeline(tl);
  const both = (t: Timeline) => onShare(t.sunVisible.map((v, i) => (v > 0 && t.earthVisible[i] > 0 ? 1 : 0)));
  return {
    sun: { sphere: onShare(sp.sunVisible), terrain: onShare(tl.sunVisible) },
    earth: { sphere: onShare(sp.earthVisible), terrain: onShare(tl.earthVisible) },
    both: { sphere: both(sp), terrain: both(tl) },
  };
}

/** "Terrain changes the Sun share from 51 % to 54 % …": sphere → terrain, the whole data period in words (#206). */
export function terrainCaption(e: TerrainEffect): string {
  const p = fmtShare;
  const ft = (s: Shares) => `from ${p(s.sphere)} to ${p(s.terrain)}`;
  return `Terrain changes the Sun share ${ft(e.sun)}, the Earth share ${ft(e.earth)}, and the share with both in view ${ft(e.both)} (over the whole data period ${DATA_PERIOD}, flat 0° horizon vs LOLA terrain).`;
}
