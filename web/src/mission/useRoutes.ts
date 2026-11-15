// Route options of the current plan (#57, D-004), shared by the route panel and the map (#72):
// hours.json loads once; the search reruns on a calm (debounced) plan.
import { useEffect, useMemo, useState } from "react";
import type { Site } from "../contracts";
import { hoursLoader, type Hours } from "../route/hours";
import { findRoutes } from "../route/route";
import type { MissionPlan } from "./types";

const DEBOUNCE_MS = 150;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type Routes = {
  hours: Hours | null;
  loadError: string | null;
  /** Sites the search can use: a point and an hourly series. */
  usable: Site[];
  result: ReturnType<typeof findRoutes> | null;
  /** The plan changed and the result is from the previous one. */
  stale: boolean;
};

export function useRoutes(sites: Site[], plan: MissionPlan | null): Routes {
  const [hours, setHours] = useState<Hours | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // hours.json (shared, cached) loads once a plan exists: the start view does not wait for it.
  const want = !!plan;
  useEffect(() => {
    if (!want || hours) return;
    let live = true;
    hoursLoader().then(
      (h) => live && setHours(h),
      (e) => live && setLoadError(String(e instanceof Error ? e.message : e)),
    );
    return () => {
      live = false;
    };
  }, [want, hours]);

  const usable = useMemo(
    () => (hours ? sites.filter((s) => s.lat !== null && s.lonE !== null && hours.sites.has(s.id)) : []),
    [sites, hours],
  );
  // Waypoints and the name do not change the ranking: the search follows only these fields.
  const key = plan
    ? JSON.stringify([plan.siteId, plan.landingUtc, plan.slipMinDays, plan.slipMaxDays, String(plan.radiusKm), plan.durationDays, plan.mode])
    : "";
  const calmKey = useDebounced(key, DEBOUNCE_MS);
  // The plan as of the last calm key: a new object only when a ranking field settles.
  const calm = useMemo(() => (calmKey ? plan : null), [calmKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Alternatives come from sites with LOLA terrain: a smooth-sphere site (no horizon) would
  // always look better and is not a fair rival. The plan site is kept whatever its terrain.
  const calmSite = calm?.siteId;
  const rivals = useMemo(() => usable.filter((s) => s.terrain !== "none" || s.id === calmSite), [usable, calmSite]);
  const result = useMemo(() => {
    if (!hours || !calm || rivals.length === 0) return null;
    return findRoutes(
      hours,
      rivals,
      { siteId: calm.siteId, landingUtc: calm.landingUtc },
      {
        slipMinDays: calm.slipMinDays,
        slipMaxDays: calm.slipMaxDays,
        radiusKm: calm.radiusKm,
        windowDays: calm.durationDays,
        mode: calm.mode,
        rank: "score", // #160: best first by the route score of the mode
      },
      6,
    );
  }, [hours, calm, rivals]);
  return { hours, loadError, usable, result, stale: calmKey !== key };
}
