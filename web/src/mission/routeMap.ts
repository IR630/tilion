// Route alternatives on the map (#72): every option is a great-circle line from the plan site,
// with a callout bubble like the route callouts of a map app. Pure helpers; MapView draws them.
import { greatCircle } from "../navigator/geo";
import type { Decider } from "../route/route";

export type LatLon = [number, number]; // [lat, lonE], degrees

export type RouteLineIn = { key: string; to: LatLon };

export type Callout = {
  key: string;
  at: LatLon; // anchor point of the bubble
  stack: number; // 0, 1, …: bubbles at the same point stack upwards
  onOrigin: boolean; // the option is at the plan site itself (no line)
};

/** Where on its line a bubble sits: past the middle, where lines from one origin spread apart. */
export const CALLOUT_AT = 0.62;
const SAME_DEG = 1e-6;

/** The key of an option: site and landing moment. */
export const routeKey = (o: { siteId: string; landingUtc: string }) => `${o.siteId}@${o.landingUtc}`;

/** Bubble text of an option (#195): "score 87" (route score, 0–100) and "slip −5 d" (landing date
 *  shift from the plan), so the numbers explain themselves. #204: "#2" is the rank of the option
 *  (the same as the card list). The score saturates at 100 on good polar windows; when the score
 *  ties a neighbour, `decider` names the tie-breaker that ranks it, and the bubble shows it (the
 *  slip, or the slip and the distance). */
export function calloutText(
  score: number,
  slipDays: number,
  rank?: number,
  decider: Decider | null = null,
  distanceKm = 0,
): { rank: string; metric: string; slip: string; tie: string } {
  const base = slipDays === 0 ? "same day" : `slip ${slipDays > 0 ? "+" : "−"}${Math.abs(slipDays)} d`;
  const slip = decider === "distance" ? `${base}, ${Math.round(distanceKm)} km` : base;
  const tie = decider ? `score ties a neighbour; the ${decider === "slip" ? "smaller date slip" : "shorter distance"} ranks it` : "";
  return { rank: rank === undefined ? "" : `#${rank}`, metric: `score ${Math.round(score)}`, slip, tie };
}

const same = (a: LatLon, b: LatLon) => Math.abs(a[0] - b[0]) < SAME_DEG && Math.abs(a[1] - b[1]) < SAME_DEG;

/** Point at fraction f along the great circle a → b. */
export function along(a: LatLon, b: LatLon, f: number, n = 50): LatLon {
  if (same(a, b)) return a;
  const pts = greatCircle(a, b, n);
  return pts[Math.round(Math.max(0, Math.min(1, f)) * n)];
}

/** Bubble anchors for options in list order. Options at the same target (two dates at one site)
 *  share a line and an anchor: they stack in list order. Options at the plan site have no line:
 *  their bubbles stack at the origin. */
export function placeCallouts(from: LatLon, lines: RouteLineIn[]): Callout[] {
  const seen: { to: LatLon; count: number }[] = [];
  return lines.map(({ key, to }) => {
    let g = seen.find((s) => same(s.to, to));
    if (!g) {
      g = { to, count: 0 };
      seen.push(g);
    }
    const stack = g.count++;
    const onOrigin = same(from, to);
    return { key, at: onOrigin ? from : along(from, to, CALLOUT_AT), stack, onOrigin };
  });
}

type LineFeature = {
  type: "Feature";
  properties: { key: string; sel: number };
  geometry: { type: "LineString"; coordinates: [number, number][] };
};

/** One GeoJSON collection of all option lines in map coordinates. The selected line comes last,
 *  so it draws on top. Options at the plan site have no line. */
export function routeFeatures(
  from: LatLon,
  lines: (RouteLineIn & { selected: boolean })[],
  project: (lat: number, lonE: number) => [number, number],
): { type: "FeatureCollection"; features: LineFeature[] } {
  const features = lines
    .filter((l) => !same(from, l.to))
    .map<LineFeature>((l) => ({
      type: "Feature",
      properties: { key: l.key, sel: l.selected ? 1 : 0 },
      geometry: { type: "LineString", coordinates: greatCircle(from, l.to).map(([lat, lon]) => project(lat, lon)) },
    }))
    .sort((a, b) => a.properties.sel - b.properties.sel);
  return { type: "FeatureCollection", features };
}

/** A bubble on screen: x = centre, y = bottom (the anchor), w × h px. `down` (#397): the lift that
 *  puts the bubble just under its anchor (negative), used when the space above is used up. */
export type Box = { x: number; y: number; w: number; h: number; down?: number };

/** A screen rectangle, px. */
export type Rect = { l: number; r: number; t: number; b: number };

/** Lift (px) for each bubble so no two overlap: bubbles keep their place in priority order
 *  (the selected one first); a later bubble that hits a placed one moves up above it.
 *  `fixed` rects (#204: the selected site name; #397: the status strip, the inset) are placed
 *  before every bubble. #397: a bubble that would rise above `ceil` (the map top) goes under its
 *  anchor instead (`down`) and moves down past what it hits. */
export function declutter(boxes: Box[], order: number[] = boxes.map((_, i) => i), gap = 4, fixed: Rect[] = [], ceil = -Infinity): number[] {
  const lift = boxes.map(() => 0);
  const placed: Rect[] = [...fixed];
  for (const i of order) {
    const { x, y, w, h, down } = boxes[i];
    const at = (up: number) => ({ l: x - w / 2, r: x + w / 2, t: y - up - h, b: y - up });
    const hitOf = (r: Rect) => placed.find((p) => r.l < p.r + gap && r.r > p.l - gap && r.t < p.b + gap && r.b > p.t - gap);
    let up = 0;
    for (let guard = 0; guard < 50; guard++) {
      const hit = hitOf(at(up));
      if (!hit) break;
      up = y - (hit.t - gap);
    }
    if (down !== undefined && at(up).t < ceil) {
      up = down;
      for (let guard = 0; guard < 50; guard++) {
        const hit = hitOf(at(up));
        if (!hit) break;
        up = y - h - (hit.b + gap);
      }
    }
    lift[i] = up;
    placed.push(at(up));
  }
  return lift;
}
