// Mission schedule (#73): the operator's missions, kept in localStorage.
// Pure transitions + a small React hook. A plan is stored as a tilion-mission/1 object (D-007),
// so Infinity radius survives JSON and a damaged entry is dropped, not shown.
import { useCallback, useEffect, useRef, useState } from "react";
import { FILE_FORMAT, moveLanding, planFromJson, planToJson } from "../mission/plan";
import type { MissionPlan, MissionState } from "../mission/types";

/** One mission of the schedule. baseLandingUtc = the landing as planned; the slip is counted from it. */
export type ScheduledMission = { id: string; plan: MissionPlan; baseLandingUtc: string };
export type ScheduleState = { missions: ScheduledMission[]; activeId: string | null };

export const STORAGE_KEY = "tilion.schedule.v1";
export const EMPTY_SCHEDULE: ScheduleState = { missions: [], activeId: null };

export const samePlan = (a: MissionPlan | null, b: MissionPlan | null): boolean =>
  !!a && !!b && planToJson(a) === planToJson(b);

let seq = 0;
export function newId(): string {
  seq++;
  return `m${Date.now().toString(36)}${seq.toString(36)}`;
}

export function addMission(s: ScheduleState, plan: MissionPlan, id = newId()): { state: ScheduleState; id: string } {
  const m: ScheduledMission = { id, plan, baseLandingUtc: plan.landingUtc };
  return { state: { ...s, missions: [...s.missions, m] }, id };
}

export function updateMission(s: ScheduleState, id: string, plan: MissionPlan): ScheduleState {
  const cur = s.missions.find((m) => m.id === id);
  if (!cur || samePlan(cur.plan, plan)) return s;
  return { ...s, missions: s.missions.map((m) => (m.id === id ? { ...m, plan } : m)) };
}

export function removeMission(s: ScheduleState, id: string): ScheduleState {
  return { missions: s.missions.filter((m) => m.id !== id), activeId: s.activeId === id ? null : s.activeId };
}

export function setActive(s: ScheduleState, id: string | null): ScheduleState {
  if (id !== null && !s.missions.some((m) => m.id === id)) return s;
  return s.activeId === id ? s : { ...s, activeId: id };
}

/** Follow the app's mission. `anchor` = the plan the active mission had when it was put on the map.
 *  - The app plan still comes from that anchor (edited in the route panel, slipped on the HUD):
 *    the active mission takes the new plan.
 *  - Else a stored mission with the same name and site becomes active and takes the plan.
 *  - Else the map shows a plan that is not in the schedule: no mission is active. */
export function syncFromApp(s: ScheduleState, mission: MissionState, anchor: MissionPlan | null): ScheduleState {
  const plan = mission.plan;
  if (!plan) return s;
  const active = s.missions.find((m) => m.id === s.activeId);
  if (active && (samePlan(active.plan, plan) || (anchor && samePlan(mission.original, anchor)))) {
    return updateMission(s, active.id, plan);
  }
  const match = matchStored(s, plan);
  if (match) return setActive(updateMission(s, match.id, plan), match.id);
  return setActive(s, null);
}

const DAY_MS = 86400000;

/** A stored mission for a plan opened from a link or a file: same name and site, and the landing is
 *  the stored one or inside that mission's allowed slip from its planned landing (nearest wins).
 *  Two missions with one name and site at different dates are never mixed up. */
export function matchStored(s: ScheduleState, plan: MissionPlan): ScheduledMission | null {
  const t = Date.parse(plan.landingUtc);
  let best: ScheduledMission | null = null;
  let bestGap = Infinity;
  for (const m of s.missions) {
    if (m.plan.name !== plan.name || m.plan.siteId !== plan.siteId) continue;
    if (m.plan.landingUtc === plan.landingUtc) return m;
    const days = (t - Date.parse(m.baseLandingUtc)) / DAY_MS;
    if (days < m.plan.slipMinDays || days > m.plan.slipMaxDays) continue;
    if (Math.abs(days) < bestGap) (best = m), (bestGap = Math.abs(days));
  }
  return best;
}

// ---------- Persistence ----------

type Saved = { v: 1; activeId: string | null; missions: { id: string; base: string; plan: unknown }[] };

export function serialise(s: ScheduleState): string {
  const out: Saved = {
    v: 1,
    activeId: s.activeId,
    missions: s.missions.map((m) => ({ id: m.id, base: m.baseLandingUtc, plan: JSON.parse(planToJson(m.plan)) })),
  };
  return JSON.stringify(out);
}

/** Parse the saved schedule. Bad JSON = empty; a bad mission is dropped and counted. */
export function deserialise(text: string | null): { state: ScheduleState; dropped: number } {
  if (!text) return { state: EMPTY_SCHEDULE, dropped: 0 };
  let o: Saved;
  try {
    o = JSON.parse(text);
  } catch {
    return { state: EMPTY_SCHEDULE, dropped: 1 };
  }
  if (!o || o.v !== 1 || !Array.isArray(o.missions)) return { state: EMPTY_SCHEDULE, dropped: 1 };
  const missions: ScheduledMission[] = [];
  let dropped = 0;
  for (const e of o.missions) {
    const r = e && typeof e.id === "string" ? planFromJson(JSON.stringify({ format: FILE_FORMAT, ...(e.plan as object) })) : null;
    if (!r || "error" in r) {
      dropped++;
      continue;
    }
    const base = typeof e.base === "string" && Number.isFinite(Date.parse(e.base)) ? e.base : r.plan.landingUtc;
    missions.push({ id: e.id, plan: r.plan, baseLandingUtc: base });
  }
  const activeId = missions.some((m) => m.id === o.activeId) ? o.activeId : null;
  return { state: { missions, activeId }, dropped };
}

export function loadSchedule(storage: Pick<Storage, "getItem"> | null = safeStorage()): ScheduleState {
  try {
    const r = deserialise(storage?.getItem(STORAGE_KEY) ?? null);
    if (r.dropped) console.warn(`[schedule] ${r.dropped} saved mission(s) were damaged and dropped`);
    return r.state;
  } catch {
    return EMPTY_SCHEDULE;
  }
}

export function saveSchedule(s: ScheduleState, storage: Pick<Storage, "setItem"> | null = safeStorage()): boolean {
  try {
    storage?.setItem(STORAGE_KEY, serialise(s));
    return !!storage;
  } catch {
    return false; // private mode or quota: the schedule lives for this page only
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Landings of the other missions of the schedule, for the pins of the HUD time strip. */
export function otherMissionPins(
  s: ScheduleState,
  mission: MissionState,
  groupOf: (siteId: string) => string | undefined = () => undefined,
): { utc: string; label: string; color: string }[] {
  return s.missions
    .filter((m) => m.id !== s.activeId && !samePlan(m.plan, mission.plan))
    .map((m) => {
      const g = groupOf(m.plan.siteId);
      return { utc: m.plan.landingUtc, label: m.plan.name, color: g ? `var(--g-${g})` : "var(--fg)" };
    });
}

// ---------- Hook ----------

/** The schedule of this browser, synced with the app's mission. */
export function useSchedule(mission: MissionState, onMission: (m: MissionState) => void) {
  const [state, setState] = useState<ScheduleState>(() => loadSchedule());
  const anchor = useRef<MissionPlan | null>(null);

  useEffect(() => {
    saveSchedule(state);
  }, [state]);

  // Follow edits made elsewhere (route panel, HUD time strip).
  useEffect(() => {
    setState((s) => {
      const next = syncFromApp(s, mission, anchor.current);
      // The active mission now follows this app plan: later edits keep its original.
      const active = next.missions.find((m) => m.id === next.activeId);
      anchor.current = active && samePlan(active.plan, mission.plan) ? mission.original : null;
      return next;
    });
  }, [mission]);

  /** Put a stored mission on the map. */
  const activate = useCallback(
    (m: ScheduledMission) => {
      anchor.current = m.plan;
      setState((s) => setActive(s, m.id));
      onMission({ plan: m.plan, original: m.plan, selected: null });
    },
    [onMission],
  );

  const add = useCallback(
    (plan: MissionPlan, makeActive: boolean) => {
      const id = newId();
      setState((s) => addMission(s, plan, id).state);
      if (makeActive) {
        anchor.current = plan;
        setState((s) => setActive(s, id));
        onMission({ plan, original: plan, selected: null });
      }
      return id;
    },
    [onMission],
  );

  /** Change a stored plan (slip drag). The active mission also moves on the map. */
  const update = useCallback(
    (id: string, plan: MissionPlan) => {
      setState((s) => updateMission(s, id, plan));
      if (id === state.activeId && mission.plan) onMission(moveLanding(mission, plan.landingUtc));
    },
    [mission, onMission, state.activeId],
  );

  const remove = useCallback((id: string) => setState((s) => removeMission(s, id)), []);

  return { state, activate, add, update, remove };
}

export type Schedule = ReturnType<typeof useSchedule>;
