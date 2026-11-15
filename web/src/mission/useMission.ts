// App-level mission state: restored from the URL on load, written back with history.replaceState.
import { useEffect, useState } from "react";
import { EMPTY_MISSION, openPlan, planFromQuery, planToQuery } from "./plan";
import type { MissionState } from "./types";

function initial(): MissionState {
  if (typeof window === "undefined") return EMPTY_MISSION;
  const r = planFromQuery(window.location.search);
  if (r?.warnings.length) console.warn(`[mission] link: ${r.warnings.join("; ")}`);
  return r ? openPlan(r.plan) : EMPTY_MISSION;
}

export function useMission() {
  const [mission, setMission] = useState<MissionState>(initial);
  const plan = mission.plan;
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const next = planToQuery(plan, search);
    if (next !== search) window.history.replaceState(window.history.state, "", pathname + next + hash);
  }, [plan]);
  return [mission, setMission] as const;
}
