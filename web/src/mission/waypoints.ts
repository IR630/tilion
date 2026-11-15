// Mission waypoints (#148, D-007 `waypoints`): geometry from the landing site and state transitions.
// Pure functions; the panel is WaypointList.tsx, the map layer WaypointLayer.tsx.
import type { MissionState, Waypoint } from "./types";

/** Mean lunar radius, km (the sphere of the LOLA products). */
export const R_KM = 1737.4;
export const MAX_WAYPOINTS = 20;
const rad = Math.PI / 180;

/** Great-circle distance, km (haversine on R = 1737.4 km). */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dp = (lat2 - lat1) * rad;
  const dl = (lon2 - lon1) * rad;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dl / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial azimuth from point 1 to point 2, degrees clockwise from local north, 0–360. */
export function azimuthDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * rad;
  const p2 = lat2 * rad;
  const dl = (lon2 - lon1) * rad;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / rad) % 360 + 360) % 360;
}

/** Map label: "WP1: SHACKLETON, 12.4 KM". Without a landing site: "WP1: SHACKLETON".
 *  No azimuth on the map: the line from the site shows the bearing; the panel lists the number. */
export function waypointLabel(i: number, w: Waypoint, from: [number, number] | null): string {
  const head = `WP${i + 1}: ${w.name.toUpperCase()}`;
  if (!from) return head;
  return `${head}, ${fmtKmShort(distanceKm(from[0], from[1], w.lat, w.lonE))}`;
}
export const fmtKmShort = (km: number) => `${km < 100 ? km.toFixed(1) : Math.round(km)} KM`;

/** Default name of a point clicked on the map: "88.12°S 45.3°E". */
export const pointName = (lat: number, lonE: number) => `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} ${lonE.toFixed(1)}°E`;

// ---------- transitions (keep the selected route option: waypoints do not change the ranking) ----------

const withWaypoints = (s: MissionState, list: Waypoint[]): MissionState => {
  if (!s.plan) return s;
  const plan = { ...s.plan };
  if (list.length) plan.waypoints = list;
  else delete plan.waypoints;
  return { ...s, plan };
};
const list = (s: MissionState) => s.plan?.waypoints ?? [];

export function addWaypoint(s: MissionState, w: Waypoint): MissionState {
  if (!s.plan || list(s).length >= MAX_WAYPOINTS) return s;
  const lonE = ((w.lonE % 360) + 360) % 360;
  const name = w.name.trim().slice(0, 60) || pointName(w.lat, lonE);
  return withWaypoints(s, [...list(s), { ...w, name, lat: Math.round(w.lat * 1e5) / 1e5, lonE: Math.round(lonE * 1e5) / 1e5 }]);
}

export function removeWaypoint(s: MissionState, i: number): MissionState {
  if (i < 0 || i >= list(s).length) return s;
  return withWaypoints(s, list(s).filter((_, k) => k !== i));
}

/** Move waypoint i by d places (−1 = up, +1 = down). Out of range: no change. */
export function moveWaypoint(s: MissionState, i: number, d: number): MissionState {
  const l = [...list(s)];
  const j = i + d;
  if (i < 0 || i >= l.length || j < 0 || j >= l.length) return s;
  [l[i], l[j]] = [l[j], l[i]];
  return withWaypoints(s, l);
}

/** Rename; an empty name keeps the old one. */
export function renameWaypoint(s: MissionState, i: number, name: string): MissionState {
  const l = list(s);
  const n = name.trim().slice(0, 60);
  if (i < 0 || i >= l.length || !n || n === l[i].name) return s;
  return withWaypoints(s, l.map((w, k) => (k === i ? { ...w, name: n } : w)));
}
