// Route points as plain JSON (#160): [{"name": "Shackleton rim", "lat": -89.67, "lon": 197.0}].
// lon is degrees east 0–360 (MOON_ME, like the rest of Tilion); lat must be inside the LOLA
// terrain 60–90°S. Pure functions: parse with every error listed, and write back.
import type { Waypoint } from "./types";

export const ROUTE_MAX_POINTS = 20;
export const LAT_NORTH_LIMIT = -60; // LOLA terrain covers 60–90°S only
const NAME_MAX = 60;

export const ROUTE_JSON_EXAMPLE = `[
  {"name": "Landing", "lat": -89.45, "lon": 222.7},
  {"name": "Ridge crest", "lat": -89.40, "lon": 210.0}
]`;

export type RouteParse = { points: Waypoint[] } | { errors: string[] };

const fmt = (v: unknown) => (typeof v === "string" ? `"${v}"` : JSON.stringify(v));

/** Parse and validate route points. Every problem is listed; one bad point rejects the file. */
export function parseRouteJson(text: string): RouteParse {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch (e) {
    const msg = (e as Error).message.replace(/^JSON\.parse: /, "");
    return { errors: [`Not valid JSON: ${msg}`] };
  }
  if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as { waypoints?: unknown }).waypoints)) {
    v = (v as { waypoints: unknown[] }).waypoints; // a tilion-mission/1 file or {"waypoints": [...]}
  }
  if (!Array.isArray(v)) return { errors: ['Expected a list of points: [{"name", "lat", "lon"}, …]'] };
  if (v.length === 0) return { errors: ["The list is empty: add at least one point"] };
  if (v.length > ROUTE_MAX_POINTS) return { errors: [`${v.length} points: at most ${ROUTE_MAX_POINTS}`] };

  const errors: string[] = [];
  const points: Waypoint[] = [];
  v.forEach((raw, i) => {
    const at = `Point ${i + 1}`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      errors.push(`${at}: expected an object {"name", "lat", "lon"}, got ${fmt(raw)}`);
      return;
    }
    const o = raw as Record<string, unknown>;
    const lonRaw = o.lon ?? o.lonE;
    const own: string[] = [];
    if (o.name !== undefined && (typeof o.name !== "string" || !o.name.trim())) own.push("name must be non-empty text");
    if (typeof o.lat !== "number" || !Number.isFinite(o.lat)) own.push(`lat must be a number, got ${fmt(o.lat)}`);
    else if (o.lat > 90 || o.lat < -90) own.push(`lat ${o.lat} is outside −90…90`);
    else if (o.lat > LAT_NORTH_LIMIT) own.push(`lat ${o.lat} is north of 60°S: terrain covers −60…−90 only`);
    if (typeof lonRaw !== "number" || !Number.isFinite(lonRaw)) own.push(`lon must be a number, got ${fmt(lonRaw)}`);
    else if (lonRaw < 0 && lonRaw >= -180) own.push(`lon ${lonRaw} is negative: use 0–360°E (${lonRaw} → ${+(lonRaw + 360).toFixed(6)})`);
    else if (lonRaw < 0 || lonRaw >= 360) own.push(`lon ${lonRaw} is outside 0–360°E`);
    const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, NAME_MAX) : `P${i + 1}`;
    if (own.length) {
      errors.push(`${at}${typeof o.name === "string" && o.name.trim() ? ` (${name})` : ""}: ${own.join("; ")}`);
      return;
    }
    points.push({ name, lat: o.lat as number, lonE: lonRaw as number });
  });
  return errors.length ? { errors } : { points };
}

/** Write points in the same format, lon 0–360°E. */
export function routeToJson(points: Waypoint[]): string {
  return JSON.stringify(points.map((p) => ({ name: p.name, lat: p.lat, lon: p.lonE })), null, 2) + "\n";
}
