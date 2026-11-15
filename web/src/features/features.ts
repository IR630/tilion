// Official IAU feature names of the south polar region (#147). Data: web/public/data/features.json,
// written by scripts/features_assets.py from the IAU Gazetteer of Planetary Nomenclature (USGS).
// Pure helpers: search, label choice and screen-space collision. The map layer is FeatureLayer.tsx.

export type Feature = {
  id: string;
  name: string;
  type: string; // "crater", "satellite crater", "mons", "vallis", …
  lat: number;
  lonE: number; // 0–360°E
  diameterKm: number;
  url: string; // gazetteer record
};
export type FeaturesFile = { source: string; url: string; downloadedUtc: string; count: number; features: Feature[] };

let cache: Promise<FeaturesFile | null> | null = null;
/** features.json, fetched once. null when the file is missing. */
export function loadFeatures(): Promise<FeaturesFile | null> {
  cache ??= fetch(`${import.meta.env.BASE_URL}data/features.json`, { signal: AbortSignal.timeout(15000) })
    .then((r) => (r.ok ? (r.json() as Promise<FeaturesFile>) : null))
    .catch(() => null);
  return cache;
}

/** Lower case without diacritics: "Schrödinger" matches "schrodinger". */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Features whose name matches the query: name starts first, then word starts, then any match;
 *  bigger first inside a rank. Empty query: nothing (the list is long). */
export function searchFeatures(list: Feature[], query: string, limit = 8): Feature[] {
  const q = fold(query.trim());
  if (!q) return [];
  const rank = (f: Feature) => {
    const n = fold(f.name);
    if (n.startsWith(q)) return 0;
    if (n.split(/[\s-]+/).some((w) => w.startsWith(q))) return 1;
    return n.includes(q) ? 2 : -1;
  };
  return list
    .map((f) => ({ f, r: rank(f) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || b.f.diameterKm - a.f.diameterKm)
    .slice(0, limit)
    .map((x) => x.f);
}

/** "Crater", "Satellite crater", "Mons": the type with a capital letter. */
export const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
export const fmtDiameter = (km: number) => (km <= 0 ? "—" : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);

// ---------- labels ----------

/** Map pixels per map unit (D-005: 1 unit = 1e6 m) at a MapLibre zoom: 512 px per 360 units at z 0. */
export const pxPerUnit = (zoom: number) => (512 * 2 ** zoom) / 360;
/** On-screen diameter of a feature, px. Stereographic scale is ~1 near the pole. */
export const diameterPx = (km: number, zoom: number) => (km * 1000 * pxPerUnit(zoom)) / 1e6;
/** A feature gets a label once it is at least this wide on screen (40 px: at the default polar
 *  view only craters of ~45 km and more; small ones appear as the planner zooms in). */
export const MIN_LABEL_PX = 40;
/** At most this many names at once: the landing sites stay the main layer. */
export const MAX_LABELS = 24;
/** Mono caps 10 px with 0.1 em tracking: about 7 px per character. */
export const labelBox = (name: string) => ({ w: Math.ceil(name.length * 7.1) + 6, h: 14 });

export type Box = { x: number; y: number; w: number; h: number }; // centre and size, px
type Rect = { l: number; r: number; t: number; b: number };
const rect = (b: Box): Rect => ({ l: b.x - b.w / 2, r: b.x + b.w / 2, t: b.y - b.h / 2, b: b.y + b.h / 2 });
const hits = (a: Rect, b: Rect, gap: number) => a.l < b.r + gap && a.r > b.l - gap && a.t < b.b + gap && a.b > b.t - gap;

/** Greedy label placement: candidates in priority order (the caller sorts, biggest first); a label
 *  that overlaps an obstacle or an earlier label is dropped. Returns the kept indices. */
export function placeLabels(cands: Box[], obstacles: Box[] = [], max = MAX_LABELS, gap = 3): number[] {
  const taken: Rect[] = obstacles.map(rect);
  const kept: number[] = [];
  for (let i = 0; i < cands.length && kept.length < max; i++) {
    const r = rect(cands[i]);
    if (taken.some((t) => hits(r, t, gap))) continue;
    taken.push(r);
    kept.push(i);
  }
  return kept;
}

/** Features to label in the current view: inside the viewport (with a margin), big enough at this
 *  zoom, biggest first, then no overlaps. `project` maps a feature to screen px. `force` is always
 *  tried first (the selected feature). */
export function chooseLabels(
  list: Feature[],
  zoom: number,
  project: (f: Feature) => { x: number; y: number },
  view: { w: number; h: number },
  obstacles: Box[] = [],
  force: string | null = null,
): { f: Feature; x: number; y: number }[] {
  const margin = 40;
  const cands: { f: Feature; x: number; y: number }[] = [];
  for (const f of list) {
    if (f.id !== force && diameterPx(f.diameterKm, zoom) < MIN_LABEL_PX) continue;
    const p = project(f);
    if (p.x < -margin || p.y < -margin || p.x > view.w + margin || p.y > view.h + margin) continue;
    cands.push({ f, x: p.x, y: p.y });
  }
  cands.sort((a, b) => b.f.diameterKm - a.f.diameterKm);
  // The box sits under the centre cross: the label reads below the point.
  const box = (c: { f: Feature; x: number; y: number }) => ({ x: c.x, y: c.y + 10, ...labelBox(c.f.name) });
  // The forced (selected) feature always shows, over sites too; the others give way to it.
  const forced = cands.find((c) => c.f.id === force);
  const rest = cands.filter((c) => c !== forced);
  const kept = placeLabels(rest.map(box), forced ? [...obstacles, box(forced)] : obstacles, forced ? MAX_LABELS - 1 : MAX_LABELS);
  return [...(forced ? [forced] : []), ...kept.map((i) => rest[i])];
}

/** A circle of radius r km around (lat, lonE) on the sphere, as [lat, lonE] points (closed ring). */
export function circleLatLon(lat: number, lonE: number, rKm: number, n = 48): [number, number][] {
  const R = 1737.4;
  const d = rKm / R;
  const r = Math.PI / 180;
  const p1 = lat * r;
  const l1 = lonE * r;
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const b = (2 * Math.PI * i) / n;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    out.push([p2 / r, ((((l2 / r) % 360) + 360) % 360)]);
  }
  return out;
}
