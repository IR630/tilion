import type { Interval } from "./contracts";

/** "12.3 h (11.0–13.1)". Null means the body is not visible now. */
export function fmtHours(v: Interval | null): string {
  if (v === null) return "not visible";
  return `${v.value.toFixed(1)} h (${v.lo.toFixed(1)}–${v.hi.toFixed(1)})`;
}

// #162 One precision for every screen (error budget: Sun elevation ~0.1°, timeline step 1 h).

/** Elevation to 0.1° with a true minus: "0.3°", "−0.3°". */
export function fmtElevation(deg: number): string {
  const s = Math.abs(deg).toFixed(1);
  return `${deg < 0 && s !== "0.0" ? "−" : ""}${s}°`;
}

/** #206 "1.3° above terrain", "0.4° below level": the word carries the sign. */
export function fmtAbove(deg: number, ref: "terrain" | "level"): string {
  return `${Math.abs(deg).toFixed(1)}° ${deg < 0 ? "below" : "above"} ${ref}`;
}

/**
 * #206 The headline angle of a body: above the LOLA terrain horizon at its azimuth, then above level
 * (a flat 0° horizon) in brackets: "1.3° above terrain (0.3° above level)". `clearDeg` null = no
 * terrain model or no mask: "0.3° above level". `sunLit` (the timeline flag, any part of the disc):
 * a lit Sun with its centre under the terrain line says that the upper limb is still visible.
 */
export function fmtClearance(clearDeg: number | null, elDeg: number, sunLit?: boolean): string {
  const level = fmtAbove(elDeg, "level");
  if (clearDeg === null) return level;
  const lit = sunLit && clearDeg < 0 ? "centre " : "";
  const limb = sunLit && clearDeg < 0 ? ", upper limb visible" : "";
  return `${lit}${fmtAbove(clearDeg, "terrain")}${limb} (${level})`;
}

/** Tooltip of every terrain-clearance readout (#206). */
export const CLEARANCE_TIP =
  "Above terrain: the centre of the body above the LOLA terrain horizon at its azimuth, seen from 2 m. Above level: above a " +
  "flat 0° horizon (JPL Horizons gives this one). The Sun is up while any part of its 0.53° disc is above the terrain; the " +
  "Earth is in view while its centre is above the terrain. Hourly data, 0.1°.";

/** Duration: hours under 48 h ("31 h"; one decimal under 10 h only when not whole), else days with one decimal ("4.6 d"). */
export function fmtDuration(h: number): string {
  if (h >= 48) return `${(h / 24).toFixed(1)} d`;
  return `${h < 10 && !Number.isInteger(h) ? h.toFixed(1) : Math.round(h)} h`;
}

/** #436 Two durations of one sentence ("before → after") in one unit: both in days when either is
 *  ≥ 48 h (the fmtDuration switch), else both in hours as fmtDuration writes them. */
export function fmtDurationPair(a: number, b: number): [string, string] {
  if (a < 48 && b < 48) return [fmtDuration(a), fmtDuration(b)];
  const d = (h: number) => `${(h / 24).toFixed(1)} d`;
  return [d(a), d(b)];
}

/** Time to an event; `beyond` = no event before the data end, h = time to the data end: "> 351.5 d". */
export function fmtUntil(h: number, beyond = false): string {
  return `${beyond ? "> " : ""}${fmtDuration(h)}`;
}

/** #196: "Sun 0.3°, sunset in 61 d" reads as a contradiction near the pole. One line explains it when
 *  the Sun is lit, its centre is under 2° and it sets in more than 2 d; else null. */
export function lowSunNote(sunElDeg: number | null, hoursToSunset: number | null, beyond = false): string | null {
  if (sunElDeg === null || hoursToSunset === null || !(sunElDeg < 2) || !(hoursToSunset > 48)) return null;
  return `Sun circles low along the horizon; stays above terrain for ${fmtUntil(hoursToSunset, beyond)}`;
}

/** Spread "3.2–58.0 d", "19 h – 61.2 d"; null when both ends read the same. */
export function fmtDurationRange(lo: number, hi: number, hiBeyond = false): string | null {
  const a = fmtDuration(lo);
  const b = fmtUntil(hi, hiBeyond);
  if (a === b || `> ${a}` === b) return null; // #450: no "389.0 d – > 389.0 d" at the data end
  const [an, au] = a.split(" ");
  return !hiBeyond && au === b.split(" ")[1] ? `${an}–${b}` : `${a} – ${b}`;
}

/** #399 Keeps a number on one line with its unit (U+00A0) and writes a true minus (U+2212):
 *  "Shackleton ridge (C1, 2 m)", "-192 °C" → "−192\u00a0°C". For names and labels from data. */
export function keepUnits(s: string): string {
  return s
    .replace(/(^|[\s(])-(?=\d)/g, "$1\u2212")
    .replace(/(\d) (?=(?:%|°C|K|m|km|h|d|pp|W|Wh)(?![\p{L}\d]))/gu, "$1\u00a0");
}

/** Share as an integer percent: "56 %". */
export function fmtShare(x: number): string {
  return `${Math.round(x * 100)} %`;
}

/** The whole precomputed data window (api.ts DATA_START_UTC … DATA_END_UTC), for period labels. */
export const DATA_PERIOD = "Dec 2026 – Dec 2027";

/** End of the precomputed hourly data (api.ts re-exports it). */
export const DATA_END_UTC = "2028-01-01T00:00:00Z";

/** #424: the period of a "next N d" share from startUtc: "30 d", or "12 d of data" when the data ends first
 *  (the share then counts fewer days than the label says). `sp` = the space before the unit. */
export function sharePeriod(startUtc: string, days = 30, sp = " "): string {
  const h = (Date.parse(DATA_END_UTC) - Date.parse(startUtc)) / 3600000;
  if (!(h < days * 24)) return `${days}${sp}d`;
  return h < 24 ? `${Math.max(0, Math.round(h))}${sp}h of data` : `${Math.floor(h / 24)}${sp}d of data`;
}

/** #197: tooltip of every "relief height" control (vertical exaggeration). */
export const EXAG_TIP =
  "Vertical exaggeration: hills are drawn this many times taller so the relief is visible. Display only; all numbers use true heights.";

/** Tooltip of every spread (Q8). */
export const SPREAD_NOTE =
  "Range over 9 terrain variants: observer height 0, 2 and 10 m × LOLA DEM 20+80+240, 80+240 and 240 m. " +
  "The large number is the reference (2 m, finest DEM). A low end far below it means a lower observer loses the Sun behind nearby terrain sooner.";

export function fmtPercent(v: Interval): string {
  const p = (x: number) => Math.round(x * 100);
  return `${p(v.value)} % (${p(v.lo)}–${p(v.hi)})`;
}

/** Latitude with N/S, longitude 0–360°E (MOON_ME convention). */
export function fmtLatLon(lat: number | null, lonE: number | null): string {
  if (lat === null || lonE === null) return "region only";
  const ns = lat < 0 ? "S" : "N";
  return `${Math.abs(lat).toFixed(4)}°${ns} ${(((lonE % 360) + 360) % 360).toFixed(4)}°E`;
}

/** Lunar reference sphere radius, m (LOLA products and Horizons). */
export const MOON_R = 1737400;

/**
 * South polar stereographic, true scale at the pole (same as the NASA LOLA polar products and
 * task/_arch/00b-probe/terrain_probe.py to_xy). Returns metres; lon 0 -> +y, lon 90 -> +x.
 */
export function stereoXY(lat: number, lonE: number): [number, number] {
  const colat = ((90 + lat) * Math.PI) / 180;
  const k = 2 * MOON_R * Math.tan(colat / 2);
  const a = (lonE * Math.PI) / 180;
  return [k * Math.sin(a), k * Math.cos(a)];
}

/** Inverse of stereoXY: metres -> [lat, lonE 0-360]. */
export function stereoInv(x: number, y: number): [number, number] {
  const lat = -90 + (2 * Math.atan(Math.hypot(x, y) / (2 * MOON_R)) * 180) / Math.PI;
  const lonE = (((Math.atan2(x, y) * 180) / Math.PI) % 360 + 360) % 360;
  return [lat, lonE];
}

/** Old azimuthal-equidistant helper (degrees of colatitude). Kept for existing tests; the map uses stereoXY. */
export function polarXY(lat: number, lonE: number): [number, number] {
  const r = 90 + lat;
  const a = (lonE * Math.PI) / 180;
  return [r * Math.sin(a), r * Math.cos(a)];
}
