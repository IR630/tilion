// Mission schedule (#73): pure layout math of the Gantt timeline. No React, no DOM.
import { DATA_END_UTC, DATA_START_UTC } from "../api";
import type { Site } from "../contracts";
import type { DayStat } from "../route/route";

export const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
export const RANGE_START_MS = Date.parse(DATA_START_UTC);
export const RANGE_END_MS = Date.parse(DATA_END_UTC);
export const RANGE_DAYS = Math.round((RANGE_END_MS - RANGE_START_MS) / DAY_MS);

export type Zoom = "weeks" | "months" | "range";
export const ZOOMS: [Zoom, string][] = [
  ["weeks", "Weeks"],
  ["months", "Months"],
  ["range", "Whole range"],
];

/** Pixels per day for a zoom. "range" fits the whole data range into the viewport width. */
export function pxPerDay(zoom: Zoom, viewportPx: number): number {
  if (zoom === "weeks") return 30;
  if (zoom === "months") return 7;
  return Math.max(1, viewportPx / RANGE_DAYS);
}

export const xOf = (ms: number, ppd: number): number => ((ms - RANGE_START_MS) / DAY_MS) * ppd;
export const msOf = (x: number, ppd: number): number => RANGE_START_MS + (x / ppd) * DAY_MS;
export const totalWidth = (ppd: number): number => RANGE_DAYS * ppd;

/** A moment from an x position: whole hour, clamped to the data range (last hour included). */
export function utcAtX(x: number, ppd: number): string {
  const ms = Math.round(msOf(x, ppd) / HOUR_MS) * HOUR_MS;
  const c = Math.min(RANGE_END_MS - HOUR_MS, Math.max(RANGE_START_MS, ms));
  return new Date(c).toISOString().replace(".000Z", "Z");
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Tick = { ms: number; label: string };

/** First day of every month in [start, end). Label "Jan 2027" for January and the first month. */
export function monthTicks(startMs = RANGE_START_MS, endMs = RANGE_END_MS): Tick[] {
  const out: Tick[] = [];
  const d = new Date(startMs);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth();
  if (Date.UTC(y, m, 1) < startMs) m++;
  for (;;) {
    const ms = Date.UTC(y, m, 1);
    if (ms >= endMs) break;
    const dd = new Date(ms);
    const first = out.length === 0 || dd.getUTCMonth() === 0;
    out.push({ ms, label: first ? `${MONTHS[dd.getUTCMonth()]} ${dd.getUTCFullYear()}` : MONTHS[dd.getUTCMonth()] });
    m++;
    if (m > 11) (m = 0), y++;
  }
  return out;
}

/** Every Monday 00:00 UTC in [start, end), labelled with the day of the month. */
export function weekTicks(startMs = RANGE_START_MS, endMs = RANGE_END_MS): Tick[] {
  const out: Tick[] = [];
  const dow = (new Date(startMs).getUTCDay() + 6) % 7; // 0 = Monday
  let ms = Math.floor(startMs / DAY_MS) * DAY_MS + ((7 - dow) % 7) * DAY_MS;
  for (; ms < endMs; ms += 7 * DAY_MS) out.push({ ms, label: String(new Date(ms).getUTCDate()) });
  return out;
}

// ---------- Day strip colours (same palette as the Calendar screen) ----------

export type Kind = "both" | "sun" | "earth" | "none";
// HUD tokens (#94): Sun red, Earth blue, both near-white, neither dark. CSS var() works in inline style.
export const KIND_COLOR: Record<Kind, string> = { both: "var(--fg)", sun: "var(--sun)", earth: "var(--earth)", none: "var(--ground)" };

/** The dominant kind of one day: the largest of both, Sun only, Earth only, neither. Ties prefer both > sun > earth. */
export function dayKind(d: DayStat): Kind {
  const parts: [Kind, number][] = [
    ["both", d.bothH],
    ["sun", d.sunH - d.bothH],
    ["earth", d.earthH - d.bothH],
    ["none", d.hours - d.sunH - d.earthH + d.bothH],
  ];
  let best = parts[0];
  for (const p of parts) if (p[1] > best[1]) best = p;
  return best[1] > 0 ? best[0] : "none";
}

export type Run = { from: number; days: number; kind: Kind };

/** Merge neighbouring days of one kind into runs: one SVG rect per run keeps the node count low. */
export function stripRuns(days: DayStat[]): Run[] {
  const out: Run[] = [];
  days.forEach((d, i) => {
    const kind = d.hours > 0 ? dayKind(d) : "none";
    const last = out.at(-1);
    if (last && last.kind === kind) last.days++;
    else out.push({ from: i, days: 1, kind });
  });
  return out;
}

// ---------- Slip ----------

/** Whole-day slip after a horizontal drag of dxPx, clamped to the allowed slip window. */
export function snapSlip(startSlip: number, dxPx: number, ppd: number, min: number, max: number): number {
  const s = startSlip + Math.round(dxPx / ppd);
  return Math.min(max, Math.max(min, s));
}

/** Whole days between the base landing and the current one (rounded). */
export const slipDays = (baseUtc: string, landingUtc: string): number =>
  Math.round((Date.parse(landingUtc) - Date.parse(baseUtc)) / DAY_MS);

export const addDays = (utc: string, days: number): string =>
  new Date(Date.parse(utc) + days * DAY_MS).toISOString().replace(".000Z", "Z");

/** "+3 d", "−2 d", "on plan". */
export function slipLabel(days: number): string {
  if (days === 0) return "on plan";
  return `${days > 0 ? "+" : "−"}${Math.abs(days)} d`;
}

// ---------- Overlaps ----------

export type Window = { id: string; landingUtc: string; durationDays: number };
export type Overlap = { a: string; b: string; fromMs: number; toMs: number };

/** Pairs of mission windows [landing, landing + duration) that overlap in time. */
export function overlaps(list: Window[]): Overlap[] {
  const out: Overlap[] = [];
  const span = list.map((w) => {
    const from = Date.parse(w.landingUtc);
    return { id: w.id, from, to: from + w.durationDays * DAY_MS };
  });
  for (let i = 0; i < span.length; i++) {
    for (let j = i + 1; j < span.length; j++) {
      const fromMs = Math.max(span[i].from, span[j].from);
      const toMs = Math.min(span[i].to, span[j].to);
      if (fromMs < toMs) out.push({ a: span[i].id, b: span[j].id, fromMs, toMs });
    }
  }
  return out;
}

// ---------- Relative time ----------

/** The landing relative to the shared moment: "in 61 d", "in 5 h", "landed 3 d ago", "on surface, day 4 of 14". */
export function relativeLabel(landingUtc: string, durationDays: number, atUtc: string): string {
  const dt = Date.parse(landingUtc) - Date.parse(atUtc);
  const days = Math.round(dt / DAY_MS);
  if (dt > 0) return Math.abs(dt) < DAY_MS ? `in ${Math.round(dt / HOUR_MS)} h` : `in ${days} d`;
  const since = -dt;
  if (since < durationDays * DAY_MS) return `on surface, day ${Math.floor(since / DAY_MS) + 1} of ${durationDays}`;
  return since < DAY_MS ? `landed ${Math.round(since / HOUR_MS)} h ago` : `landed ${-days} d ago`;
}

// ---------- Public missions (facts from sites.json only) ----------

export type PublicMission = { site: Site; year: number; fromMs: number; toMs: number };

/** Sites with status "planned YYYY" whose year meets the data range: a year-long band, no invented date. */
export function publicMissions(sites: Site[]): PublicMission[] {
  const out: PublicMission[] = [];
  for (const site of sites) {
    const m = /^planned\s+(\d{4})$/i.exec(site.status.trim());
    if (!m) continue;
    const year = Number(m[1]);
    const fromMs = Math.max(RANGE_START_MS, Date.UTC(year, 0, 1));
    const toMs = Math.min(RANGE_END_MS, Date.UTC(year + 1, 0, 1));
    if (fromMs < toMs) out.push({ site, year, fromMs, toMs });
  }
  return out;
}

/** Past landings and crashes (status with a year before the data range): count and year span. */
export function history(sites: Site[]): { count: number; from: number; to: number } | null {
  const years = sites
    .map((s) => /^(landed|crashed)\D*(\d{4})/i.exec(s.status)?.[2])
    .filter((y): y is string => !!y)
    .map(Number)
    .filter((y) => Date.UTC(y + 1, 0, 1) <= RANGE_START_MS);
  if (!years.length) return null;
  return { count: years.length, from: Math.min(...years), to: Math.max(...years) };
}

export const fmtUtc = (utc: string): string => utc.slice(0, 16).replace("T", " ") + " UTC";
export const fmtDay = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
