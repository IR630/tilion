// Pure time helpers of the HUD time strip: the shared moment (whole hours, clamped to the data),
// Play ticks, the compass scale, pins, mission window drag math, the Sun / Earth / both shares
// used for colours and the date picker. No React, no DOM.
import { DATA_END_UTC, DATA_START_UTC } from "../api";
import { fmtUntil } from "../format";
import type { Hours, SiteHours } from "../route/hours";

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const T0 = Date.parse(DATA_START_UTC);
export const T_END = Date.parse(DATA_END_UTC); // exclusive end of the data
export const T1 = T_END - HOUR; // last hourly step
export const TICK_MS = 250;
/** Step of one lunar day in whole hours: the synodic month, 29.53 d, one full cycle of sunlight at a site. */
export const LUNAR_DAY_H = 709;
export const SPEEDS: [number, string][] = [
  [1, "1 h/s"],
  [6, "6 h/s"],
  [24, "1 d/s"],
];

/** Play tick for a speed (h/s): a whole number of hours and the delay that keeps the rate exact. */
export function playTick(speed: number): { hours: number; ms: number } {
  const hours = Math.max(1, Math.ceil((speed * TICK_MS) / 1000));
  return { hours, ms: (hours * 1000) / speed };
}

/** ISO UTC at whole minutes, the form every screen receives: 2027-01-15T00:00:00Z. */
export function isoUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16) + ":00Z";
}

/** Clamp to the data range and round to the hour. */
export function clampUtc(ms: number): string {
  return isoUtc(Math.min(T1, Math.max(T0, Math.round(ms / HOUR) * HOUR)));
}

/** "2027-01-15 06:00" (24 h, UTC) for the exact-time field. */
export const fmtExact = (atUtc: string) => atUtc.slice(0, 16).replace("T", " ");

/** Parse "YYYY-MM-DD HH:MM" (24 h, UTC; "T", " UTC" or "Z" allowed). Rounded to the hour; null if malformed or outside the data. */
export function parseExact(text: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)(?:\s*(?:UTC|Z))?$/i.exec(text.trim());
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00Z`);
  if (!(ms >= T0 && ms <= T1) || isoUtc(ms).slice(0, 10) !== m[1]) return null;
  return clampUtc(ms);
}

/** Shift atUtc by whole hours, staying inside the data range. */
export function stepUtc(atUtc: string, hours: number): string {
  return clampUtc(Date.parse(atUtc) + hours * HOUR);
}

export const fmtDay = (t: number) => {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
export const fmtMonth = (t: number) => {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---------------------------------------------------------------- colours

/** Shares of a span: Sun + Earth, Sun only, Earth only, none. They sum to 1 (or all 0 for no data). */
export type Shares = { both: number; sun: number; earth: number; none: number };

export function shares(sunH: number, earthH: number, bothH: number, totalH: number): Shares {
  if (!(totalH > 0)) return { both: 0, sun: 0, earth: 0, none: 0 };
  const both = bothH / totalH;
  const sun = (sunH - bothH) / totalH;
  const earth = (earthH - bothH) / totalH;
  return { both, sun, earth, none: Math.max(0, 1 - both - sun - earth) };
}

/** Shares over hour steps [a, b) of one site, O(1) from the prefix sums. */
export function spanShares(s: SiteHours, a: number, b: number): Shares {
  const n = s.codes.length;
  const i = Math.max(0, Math.min(n, a));
  const j = Math.max(i, Math.min(n, b));
  return shares(s.sunPre[j] - s.sunPre[i], s.earthPre[j] - s.earthPre[i], s.bothPre[j] - s.bothPre[i], j - i);
}

// ---------------------------------------------------------------- mission window

/** Whole days from the original landing to the current one. */
export function slipOf(landingUtc: string, originalUtc: string): number {
  return Math.round((Date.parse(landingUtc) - Date.parse(originalUtc)) / DAY);
}

/** "+3 d", "−2 d", "0 d" */
export function fmtSlip(days: number): string {
  return days > 0 ? `+${days} d` : days < 0 ? `−${-days} d` : "0 d";
}

/** Allowed slips (whole days): the plan's slip window cut so the whole surface window
 *  [landing, landing + durationDays] stays inside the data. */
export function slipBounds(
  originalUtc: string,
  durationDays: number,
  slipMinDays: number,
  slipMaxDays: number,
): [number, number] {
  const o = Date.parse(originalUtc);
  const lo = Math.max(slipMinDays, Math.ceil((T0 - o) / DAY));
  const hi = Math.min(slipMaxDays, Math.floor((T_END - durationDays * DAY - o) / DAY));
  return lo <= hi ? [lo, hi] : [0, 0];
}

/** Slip after a horizontal drag of dx pixels that started at startSlip: snapped to whole days, clamped. */
export function dragSlip(startSlip: number, dxPx: number, msPerPx: number, bounds: [number, number]): number {
  const d = Math.round(startSlip + (dxPx * msPerPx) / DAY);
  return Math.min(bounds[1], Math.max(bounds[0], d));
}

/** Landing moment for a slip: the original landing plus whole days (same time of day). */
export function landingFor(originalUtc: string, slip: number): string {
  return isoUtc(Date.parse(originalUtc) + slip * DAY);
}

/** A calendar day (any moment inside it) at the time of day of ref: 2027-03-15 + 06:00 → 2027-03-15T06:00. */
export function atTimeOfDay(dayMs: number, refUtc: string | null): string {
  const day = Math.floor(dayMs / DAY) * DAY;
  const tod = refUtc ? (((Date.parse(refUtc) % DAY) + DAY) % DAY) : 0;
  return isoUtc(day + tod);
}

// ---------------------------------------------------------------- HUD time strip

export const HUD_MIN_SPAN = DAY; // most zoomed in: one day across the strip
export const HUD_MAX_SPAN = 45 * DAY; // most zoomed out: about a month and a half
export const clampSpan = (ms: number) => Math.min(HUD_MAX_SPAN, Math.max(HUD_MIN_SPAN, ms));
/** The centre of the strip stays on the data (whole hours are applied on release). */
export const clampCentre = (t: number) => Math.min(T1, Math.max(T0, t));

export type HudTick = { t: number; level: 0 | 1 | 2; label: string };
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** Compass-style scale over [a, b]. Hour mode (an hour >= 6 px): minor tick every hour, medium
 *  every 6 h ("06", "12", "18"), major at day starts ("JAN 15"). Day mode: minor tick per day
 *  (6-h minors when a day >= 40 px), medium with the day of month, major at month starts ("FEB"). */
export function hudTicks(a: number, b: number, msPerPx: number): HudTick[] {
  const out: HudTick[] = [];
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(msPerPx > 0)) return out;
  const hourPx = HOUR / msPerPx;
  if (hourPx >= 6) {
    for (let t = Math.ceil(a / HOUR) * HOUR; t <= b; t += HOUR) {
      const d = new Date(t);
      if (t % DAY === 0) out.push({ t, level: 2, label: `${MON[d.getUTCMonth()]} ${d.getUTCDate()}` });
      else if (t % (6 * HOUR) === 0) out.push({ t, level: 1, label: String(d.getUTCHours()).padStart(2, "0") });
      else out.push({ t, level: 0, label: "" });
    }
    return out;
  }
  const dayPx = DAY / msPerPx;
  const sub = dayPx >= 40 ? 6 * HOUR : DAY;
  for (let t = Math.ceil(a / sub) * sub; t <= b; t += sub) {
    const d = new Date(t);
    if (t % DAY !== 0) {
      out.push({ t, level: 0, label: "" });
      continue;
    }
    const day = d.getUTCDate();
    if (day === 1) out.push({ t, level: 2, label: d.getUTCMonth() === 0 ? `JAN ${d.getUTCFullYear()}` : MON[d.getUTCMonth()] });
    else if (dayPx >= 22 || day % 5 === 0) out.push({ t, level: 1, label: String(day) });
    else out.push({ t, level: 0, label: "" });
  }
  return out;
}

/** "JAN 15 2027 06:00 UTC" */
export function fmtHud(t: number): string {
  const d = new Date(t);
  return `${MON[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()} ${d.toISOString().slice(11, 16)} UTC`;
}

export type Pin = { t: number; kind: EventKind | "landing" | "end" | "option" };

/** The pin to show at one edge for pins beyond the visible span: the landing first, then the
 *  window end, then the nearest event. side −1 = before a, +1 = after b. */
export function edgePin(pins: Pin[], a: number, b: number, side: -1 | 1): Pin | null {
  const out = pins.filter((p) => (side < 0 ? p.t < a : p.t > b));
  if (!out.length) return null;
  for (const k of ["landing", "end"] as const) {
    const p = out.find((x) => x.kind === k);
    if (p) return p;
  }
  return out.reduce((best, p) => (Math.abs(p.t - (side < 0 ? a : b)) < Math.abs(best.t - (side < 0 ? a : b)) ? p : best));
}

export type EventKind = "sunrise" | "sunset" | "earthrise" | "earthset";
export type StripEvent = { i: number; kind: EventKind }; // i = first hour step of the new state

/** Rise and set events over steps (i0, i1]: a change of the Sun or Earth bit between steps i-1 and i. */
export function eventsIn(codes: Uint8Array, i0: number, i1: number): StripEvent[] {
  const out: StripEvent[] = [];
  const a = Math.max(1, i0 + 1);
  const b = Math.min(codes.length - 1, i1);
  for (let i = a; i <= b; i++) {
    const was = codes[i - 1];
    const now = codes[i];
    if (was === now) continue;
    if ((was ^ now) & 1) out.push({ i, kind: now & 1 ? "sunrise" : "sunset" });
    if ((was ^ now) & 2) out.push({ i, kind: now & 2 ? "earthrise" : "earthset" });
  }
  return out;
}

/** Next change of a bit (1 Sun, 2 Earth) after step i: the step index, or null when it stays to the data end. */
export function nextChange(codes: Uint8Array, i: number, bit: number): number | null {
  if (i < 0 || i >= codes.length) return null;
  const up = codes[i] & bit;
  for (let j = i + 1; j < codes.length; j++) if ((codes[j] & bit) !== up) return j;
  return null;
}

/** Runs of steps with `bit` set (1 Sun, 2 Earth) in codes[i0, i1), as [start, end) step indexes.
 *  The strip's bands and the "Next windows" list both come from here (#196). */
export function bandRuns(codes: Uint8Array, bit: number, i0: number, i1: number): [number, number][] {
  const out: [number, number][] = [];
  const end = Math.min(codes.length, i1);
  let i = Math.max(0, i0);
  while (i < end) {
    const on = codes[i] & bit;
    let j = i + 1;
    while (j < end && (codes[j] & bit) === on) j++;
    if (on) out.push([i, j]);
    i = j;
  }
  return out;
}

/** One window of the list: shown part [startMs, clipEndMs) inside the period, true end endMs.
 *  ongoing = it opened before the moment; openEnd = it lasts to the data end. hours = from startMs to endMs. */
export type BandWindow = { startMs: number; clipEndMs: number; endMs: number; ongoing: boolean; openEnd: boolean; hours: number };

/** Sun-lit (bit 1) or Earth-in-view (bit 2) windows of a site over [atMs, atMs + spanMs), from hours.json. */
export function nextWindows(hours: Hours, siteId: string, atMs: number, spanMs: number, bit: number): BandWindow[] {
  const s = hours.sites.get(siteId);
  if (!s) return [];
  const step = hours.stepMin * 60_000;
  const at = (i: number) => hours.startMs + i * step;
  const i0 = Math.floor((atMs - hours.startMs) / step);
  const i1 = Math.min(hours.n, Math.ceil((atMs + spanMs - hours.startMs) / step));
  if (i0 < 0 || i0 >= hours.n) return [];
  return bandRuns(s.codes, bit, i0, i1).map(([a, b]) => {
    const ongoing = a === i0 && a > 0 && (s.codes[a - 1] & bit) !== 0;
    const trueEnd = b === i1 ? (nextChange(s.codes, b - 1, bit) ?? hours.n) : b;
    const startMs = a === i0 ? atMs : at(a);
    const endMs = at(trueEnd);
    return { startMs, clipEndMs: Math.min(at(b), atMs + spanMs), endMs, ongoing, openEnd: trueEnd === hours.n, hours: (endMs - startMs) / HOUR };
  });
}

/** #162: the shared duration format, "31 h" under 48 h, else "9.3 d"; beyond the data: "> …". */
export const fmtWait = fmtUntil;

/** Signed offset from a reference: "+12 h", "−3 d 4 h". */
export function fmtOffset(ms: number): string {
  const sign = ms < 0 ? "−" : "+";
  const h = Math.round(Math.abs(ms) / HOUR);
  if (h < 48) return `${sign}${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${sign}${d} d ${h % 24} h` : `${sign}${d} d`;
}

/** Day quality of a landing window for the date picker. both = Sun and Earth together. */
export type Quality = "both" | "sun" | "earth" | "poor";
export function windowQuality(m: { windowH: number; sunH: number; earthH: number; bothH: number }): {
  kind: Quality;
  bothShare: number;
} {
  const w = m.windowH > 0 ? m.windowH : 1;
  const both = m.bothH / w;
  const kind: Quality = both >= 0.5 ? "both" : m.sunH / w >= 0.6 ? "sun" : m.earthH / w >= 0.6 ? "earth" : "poor";
  return { kind, bothShare: both };
}

/** Month grid (Monday first) for the date picker: leading blanks, then day starts (ms). */
export function monthGrid(year: number, month: number): (number | null)[] {
  const first = Date.UTC(year, month, 1);
  const days = Math.round((Date.UTC(year, month + 1, 1) - first) / DAY);
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  return [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, k) => first + k * DAY)];
}

/** Labels on one row without overlap: an item is a centre x and a width (px), with a priority
 *  (higher first). blocked = [from, to] px spans already taken (edge labels). Returns which items
 *  to draw, in input order. gap = free pixels kept between two labels. */
export function placeLabels(items: { x: number; w: number; level: number }[], blocked: [number, number][] = [], gap = 6): boolean[] {
  const taken: [number, number][] = [...blocked];
  const order = items.map((_, k) => k).sort((p, q) => items[q].level - items[p].level || p - q);
  const out = items.map(() => false);
  for (const k of order) {
    const { x, w } = items[k];
    const a = x - w / 2 - gap / 2;
    const b = x + w / 2 + gap / 2;
    if (taken.some(([u, v]) => a < v && b > u)) continue;
    taken.push([a, b]);
    out[k] = true;
  }
  return out;
}
