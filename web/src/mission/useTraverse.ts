// Hourly series for the traverse vertices (#160): the landing site reads its precomputed timeline,
// each waypoint is a custom point computed in the browser worker (LOLA 240 m + SPICE, D-013).
// Timelines are cached by api.ts, so reordering waypoints recomputes nothing.
import { useEffect, useMemo, useState } from "react";
import { loadFullTimeline } from "../api";
import type { Site, Timeline } from "../contracts";
import { customSite } from "../screens/PolarMap";
import { planTraverse, type Series, type Traverse, type Vertex } from "./traverse";
import type { Waypoint } from "./types";

const toSeries = (tl: Timeline, terrain: boolean): Series => ({
  startMs: Date.parse(tl.startUtc),
  stepMin: tl.stepMin,
  sun: tl.sunVisible,
  earth: tl.earthVisible,
  ...(tl.dsnVisible ? { dsn: tl.dsnVisible } : {}),
  terrain,
});

export type TraverseState = { traverse: Traverse | null; pending: number; failed: string[] };

export function useTraverse(planSite: Site | undefined, landingUtc: string | undefined, waypoints: Waypoint[]): TraverseState {
  const sites = useMemo<Site[]>(() => {
    if (!planSite || planSite.lat === null || planSite.lonE === null || waypoints.length === 0) return [];
    return [planSite, ...waypoints.map((w) => customSite(w.lat, w.lonE))];
  }, [planSite, waypoints]);
  const [got, setGot] = useState<Map<string, Series | "failed">>(new Map());

  useEffect(() => {
    let live = true;
    for (const s of sites) {
      if (got.has(s.id)) continue;
      loadFullTimeline(s).then(
        (tl) => live && setGot((m) => new Map(m).set(s.id, tl ? toSeries(tl, s.terrain !== "none") : "failed")),
        () => live && setGot((m) => new Map(m).set(s.id, "failed")),
      );
    }
    return () => {
      live = false;
    };
  }, [sites]); // eslint-disable-line react-hooks/exhaustive-deps

  return useMemo(() => {
    if (sites.length < 2 || !landingUtc) return { traverse: null, pending: 0, failed: [] };
    const vertices: Vertex[] = [
      { name: planSite!.name, lat: planSite!.lat as number, lonE: planSite!.lonE as number },
      ...waypoints.map((w) => ({ name: w.name, lat: w.lat, lonE: w.lonE })),
    ];
    const series = sites.map((s) => {
      const v = got.get(s.id);
      return v && v !== "failed" ? v : null;
    });
    const failed = sites.map((s, i) => (got.get(s.id) === "failed" ? vertices[i].name : null)).filter((x): x is string => !!x);
    return {
      traverse: planTraverse(vertices, series, Date.parse(landingUtc)),
      pending: sites.filter((s) => !got.has(s.id)).length,
      failed,
    };
  }, [sites, got, landingUtc, planSite, waypoints]);
}
