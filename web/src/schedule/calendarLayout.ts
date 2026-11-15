// Mission calendar (#159): pure month-grid math. No React, no DOM. All dates are UTC days.
import type { MissionPlan, MissionState } from "../mission/types";
import { DAY_MS } from "./layout";
import { samePlan, type ScheduleState } from "./store";

/** One mission on the calendar: the surface window [startMs, endMs). */
export type CalItem = { id: string; name: string; siteId: string; startMs: number; endMs: number; active: boolean; plan: MissionPlan };

/** Id of the app's plan when it is not in the schedule. */
export const CURRENT_ID = "current";

/** The schedule's missions plus the app's plan when it is not stored, sorted by landing. */
export function calendarItems(s: ScheduleState, mission: MissionState): CalItem[] {
  const item = (id: string, plan: MissionPlan, active: boolean): CalItem => {
    const startMs = Date.parse(plan.landingUtc);
    return { id, name: plan.name, siteId: plan.siteId, startMs, endMs: startMs + plan.durationDays * DAY_MS, active, plan };
  };
  const out = s.missions.map((m) => item(m.id, m.plan, m.id === s.activeId));
  const cur = mission.plan;
  if (cur && !s.missions.some((m) => samePlan(m.plan, cur))) out.push(item(CURRENT_ID, cur, true));
  return out.filter((i) => Number.isFinite(i.startMs)).sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

export const monthStart = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};
export const addMonths = (ms: number, k: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + k, 1);
};
const monthIndex = (ms: number): number => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};
export const dayStart = (ms: number): number => Math.floor(ms / DAY_MS) * DAY_MS;

/** The nearest mission at a moment: one on the surface, else the next to land. */
export function nearestMission(items: CalItem[], atMs: number): CalItem | null {
  let best: CalItem | null = null;
  for (const i of items) if (i.endMs > atMs && (!best || i.startMs < best.startMs)) best = i;
  return best;
}

/** Range rule: max(1 month, the months from `fromMs` through the end of the nearest mission at `atMs`),
 *  at most `max`. A nearest mission that does not start inside `max` months gives 1 month. */
export function rangeMonths(fromMs: number, atMs: number, items: CalItem[], max = 3): number {
  const n = nearestMission(items, atMs);
  const first = monthIndex(fromMs);
  if (!n || monthIndex(n.startMs) >= first + max) return 1;
  const span = monthIndex(n.endMs - 1) - first + 1;
  return Math.min(max, Math.max(1, span));
}

/** Monday 00:00 UTC of every week that meets months [fromMs, fromMs + months). */
export function weekStarts(fromMs: number, months: number): number[] {
  const a = monthStart(fromMs);
  const end = addMonths(a, months);
  const dow = (new Date(a).getUTCDay() + 6) % 7; // 0 = Monday
  const out: number[] = [];
  for (let w = a - dow * DAY_MS; w < end; w += 7 * DAY_MS) out.push(w);
  return out;
}

/** One bar piece inside a week row: columns col .. col + span - 1, in a lane. */
export type Seg = { id: string; col: number; span: number; lane: number; head: boolean; tail: boolean };

/** Bars of one week. Missions are laid out by landing (longer first on one day); each takes the lowest free
 *  lane. A mission that needs a lane >= maxLanes is hidden and counted in `more` for each of its days. */
export function layoutWeek(weekMs: number, items: CalItem[], maxLanes = 2): { segs: Seg[]; more: number[] } {
  const w0 = weekMs / DAY_MS;
  const lanes: boolean[][] = [];
  const more = [0, 0, 0, 0, 0, 0, 0];
  const segs: Seg[] = [];
  const spans = items
    .map((i) => ({ i, d0: Math.floor(i.startMs / DAY_MS), d1: Math.floor((i.endMs - 1) / DAY_MS) }))
    .filter(({ d0, d1 }) => d1 >= w0 && d0 <= w0 + 6)
    .sort((a, b) => a.d0 - b.d0 || b.d1 - a.d1 || a.i.id.localeCompare(b.i.id));
  for (const { i, d0, d1 } of spans) {
    const c0 = Math.max(0, d0 - w0);
    const c1 = Math.min(6, d1 - w0);
    let lane = 0;
    while (lanes[lane]?.slice(c0, c1 + 1).some(Boolean)) lane++;
    (lanes[lane] ??= [false, false, false, false, false, false, false]).fill(true, c0, c1 + 1);
    if (lane >= maxLanes) {
      for (let c = c0; c <= c1; c++) more[c]++;
      continue;
    }
    segs.push({ id: i.id, col: c0, span: c1 - c0 + 1, lane, head: d0 >= w0, tail: d1 <= w0 + 6 });
  }
  return { segs, more };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (ms: number): string => MONTHS[new Date(ms).getUTCMonth()];

/** "Jan 2027", "Jan – Feb 2027", "Dec 2026 – Feb 2027". */
export function rangeTitle(fromMs: number, months: number): string {
  const a = new Date(monthStart(fromMs));
  const b = new Date(addMonths(fromMs, months - 1));
  const ya = a.getUTCFullYear();
  const yb = b.getUTCFullYear();
  if (months <= 1) return `${MONTHS[a.getUTCMonth()]} ${ya}`;
  return ya === yb ? `${MONTHS[a.getUTCMonth()]} – ${MONTHS[b.getUTCMonth()]} ${yb}` : `${MONTHS[a.getUTCMonth()]} ${ya} – ${MONTHS[b.getUTCMonth()]} ${yb}`;
}

/** The same time of day on another day: a click on a day keeps the hour of the shared moment. */
export function utcOnDay(dayMs: number, atUtc: string): string {
  const t = Date.parse(atUtc);
  const tod = Number.isFinite(t) ? t - dayStart(t) : 0;
  return new Date(dayMs + tod).toISOString().replace(".000Z", "Z");
}
