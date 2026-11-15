// #369: Earth eclipses of the Sun as events. The eclipse is already in timeline.sunVisible (D-010);
// here we only find the hours where the loss of light is the Earth's, not the terrain's.
//
// Rule: an hour is an eclipse hour when
//   1. the whole Sun disc is above the terrain mask (lower limb above the mask over the disc width),
//      so the terrain hides nothing;
//   2. the visible share is below 1 by at least MIN_HIDDEN;
//   3. the Earth disc can touch the Sun disc: centre separation < OVERLAP_DEG.
// Consecutive eclipse hours make one event. Numbers come from the loaded timeline only.
import type { HorizonMask, Timeline } from "../contracts";

/** Largest apparent Sun radius seen from the Moon, deg (0.262–0.272). */
export const SUN_R_DEG = 0.272;
/** Sun radius + largest Earth shadow radius with its air layer (1.03° at perigee), deg. */
export const OVERLAP_DEG = 1.31;
/** Smallest hidden share that counts: 1 % of the flux. */
export const MIN_HIDDEN = 0.01;

export type EclipseEvent = {
  startMs: number; // first eclipse step
  endMs: number; // end of the last eclipse step
  peakMs: number; // step with the largest hidden share
  maxHidden: number; // 0..1, share of the Sun flux hidden at the peak step
  hours: number; // eclipse steps × step length
};

const rad = Math.PI / 180;

function separationDeg(az1: number, el1: number, az2: number, el2: number): number {
  const c = Math.sin(el1 * rad) * Math.sin(el2 * rad) + Math.cos(el1 * rad) * Math.cos(el2 * rad) * Math.cos((az1 - az2) * rad);
  return Math.acos(Math.max(-1, Math.min(1, c))) / rad;
}

/** Mask elevation at an azimuth, linear between samples. */
function maskAt(mask: HorizonMask, az: number): number {
  const n = mask.elevDeg.length;
  const x = (((az % 360) + 360) % 360) / mask.azStepDeg;
  const i = Math.floor(x);
  const f = x - i;
  return mask.elevDeg[i % n] * (1 - f) + mask.elevDeg[(i + 1) % n] * f;
}

function arraysOk(tl: Timeline, mask: HorizonMask): boolean {
  const n = Array.isArray(tl?.sunVisible) ? tl.sunVisible.length : -1;
  return (
    n > 0 &&
    [tl.sunAz, tl.sunEl, tl.earthAz, tl.earthEl].every((a) => Array.isArray(a) && a.length === n) &&
    tl.stepMin > 0 &&
    Number.isFinite(Date.parse(tl.startUtc)) &&
    Array.isArray(mask?.elevDeg) &&
    mask.elevDeg.length > 0 &&
    mask.azStepDeg > 0
  );
}

/** Is step i an Earth-eclipse step (rule above)? */
export function isEclipseStep(tl: Timeline, mask: HorizonMask, i: number): boolean {
  const hidden = 1 - tl.sunVisible[i];
  if (!(hidden >= MIN_HIDDEN)) return false;
  const az = tl.sunAz[i];
  const el = tl.sunEl[i];
  if (separationDeg(az, el, tl.earthAz[i], tl.earthEl[i]) >= OVERLAP_DEG) return false;
  const dAz = SUN_R_DEG / Math.max(Math.cos(el * rad), 0.1); // half-width of the disc in azimuth
  const terrain = Math.max(maskAt(mask, az - dAz), maskAt(mask, az), maskAt(mask, az + dAz));
  return el - SUN_R_DEG > terrain;
}

/** All Earth eclipses in a timeline, in time order. A damaged or foreign file gives none. */
export function findEclipses(tl: Timeline | null, mask: HorizonMask | null): EclipseEvent[] {
  if (!tl || !mask || !arraysOk(tl, mask)) return [];
  const t0 = Date.parse(tl.startUtc);
  const step = tl.stepMin * 60_000;
  const out: EclipseEvent[] = [];
  let cur: EclipseEvent | null = null;
  for (let i = 0; i < tl.sunVisible.length; i++) {
    if (!isEclipseStep(tl, mask, i)) {
      cur = null;
      continue;
    }
    const t = t0 + i * step;
    const hidden = 1 - tl.sunVisible[i];
    if (!cur) {
      cur = { startMs: t, endMs: t + step, peakMs: t, maxHidden: hidden, hours: 0 };
      out.push(cur);
    }
    cur.endMs = t + step;
    cur.hours += tl.stepMin / 60;
    if (hidden > cur.maxHidden) {
      cur.maxHidden = hidden;
      cur.peakMs = t;
    }
  }
  return out;
}

/** The eclipse in progress at t, else the next one; null when none is left. */
export function eclipseAt(events: EclipseEvent[], t: number): EclipseEvent | null {
  return events.find((e) => e.endMs > t) ?? null;
}

/** "Earth eclipse 2027-08-17: up to 46 % of the Sun hidden for ~3 h" (date of the peak, UTC). */
export function eclipseLine(e: EclipseEvent): string {
  const day = new Date(e.peakMs).toISOString().slice(0, 10);
  const pct = Math.max(1, Math.round(e.maxHidden * 100));
  const h = Math.max(1, Math.round(e.hours));
  return `Earth eclipse ${day}: up to ${pct} % of the Sun hidden for ~${h} h`;
}
