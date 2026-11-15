// Pure helpers of the navigator map. Map coordinates follow D-005: polar stereographic metres
// (stereoXY) divided by 1e6 are used as MapLibre lng/lat, so +y (lon 0°E) is up.
import type { Site } from "../contracts";
import { fmtDuration, stereoXY } from "../format";

export const MAP_SCALE = 1e6; // metres per map "degree"

/** Site latitude/longitude → MapLibre [lng, lat] in pseudo-coordinates. */
export function toMap(lat: number, lonE: number): [number, number] {
  const [x, y] = stereoXY(lat, lonE);
  return [x / MAP_SCALE, y / MAP_SCALE];
}

/** Basemap meta.json (D-005): bounds are [xmin, ymin, xmax, ymax] in metres. */
export type BasemapLayer = { id: string; kind: "relief" | "sun" | "earth"; file: string; bounds: number[]; source?: string };
export type RampStop = [number, [number, number, number]];
/** One tile set of the basemap pyramid (#149): XYZ tiles at minzoom..maxzoom inside bounds (m). */
export type TileSet = {
  id: string;
  layer: "relief" | "photo";
  url: string; // "{z}/{x}/{y}" template, relative to the meta or manifest folder
  minzoom: number; // tile zoom (256 px tiles: map zoom + 1)
  maxzoom: number;
  bounds: number[];
  resolutionM: number;
  source: string;
};
export type TileManifest = { tileSize: number; sets: TileSet[] };
export type BasemapMeta = {
  layers: BasemapLayer[];
  tiles?: TileManifest;
  legend?: { sun?: string; earth?: string; ramp?: { sun?: RampStop[]; earth?: RampStop[] } };
};

/** MapLibre raster source of a tile set; base is an absolute folder URL ending with "/". Coarse
 *  sets come first in a sort by minzoom, so finer sets draw on top. */
export function tileSource(s: TileSet, base: string, tileSize: number) {
  const [x0, y0, x1, y1] = s.bounds.map((v) => v / MAP_SCALE);
  return {
    type: "raster" as const,
    tiles: [base + s.url],
    tileSize,
    minzoom: s.minzoom,
    maxzoom: s.maxzoom,
    bounds: [x0, y0, x1, y1] as [number, number, number, number],
  };
}

/** Deepest map zoom with real detail: tile zoom of 256 px tiles is map zoom + 1. */
export function detailZoom(sets: TileSet[]): number {
  return Math.max(0, ...sets.map((s) => s.maxzoom - 1));
}

/** Zoom cap when the centre has only the 240 m relief: deeper zooms stretch it into grey mush (#464). */
export const COARSE_ZOOM_LIMIT = 12.5;

/** Max map zoom at a centre (map lng/lat): `detail` when a finer-than-240 m relief set covers it,
 *  otherwise COARSE_ZOOM_LIMIT. Bounds are in metres, the centre in map units (metres / 1e6). */
export function zoomLimit(sets: TileSet[], center: [number, number], detail: number): number {
  const [x, y] = center.map((v) => v * MAP_SCALE);
  const covered = sets.some((s) => s.layer === "relief" && s.resolutionM < 240 && x >= s.bounds[0] && y >= s.bounds[1] && x <= s.bounds[2] && y <= s.bounds[3]);
  return covered ? Math.max(detail, COARSE_ZOOM_LIMIT) : COARSE_ZOOM_LIMIT;
}

/** Image source corners TL, TR, BR, BL (row 0 of the image = ymax, col 0 = xmin). */
export function boundsToCoords(b: number[]): [[number, number], [number, number], [number, number], [number, number]] {
  const [x0, y0, x1, y1] = b.map((v) => v / MAP_SCALE);
  return [
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [x0, y0],
  ];
}

/** Layers of one kind, coarse first (the finer, smaller extent draws on top). */
export function layersOf(meta: BasemapMeta, kind: BasemapLayer["kind"]): BasemapLayer[] {
  const area = (l: BasemapLayer) => (l.bounds[2] - l.bounds[0]) * (l.bounds[3] - l.bounds[1]);
  return meta.layers.filter((l) => l.kind === kind).sort((a, b) => area(b) - area(a));
}

/** CSS linear-gradient of a legend ramp. */
export function rampCss(stops: RampStop[]): string {
  return `linear-gradient(90deg, ${stops.map(([t, [r, g, b]]) => `rgb(${r} ${g} ${b}) ${Math.round(t * 100)}%`).join(", ")})`;
}

export const GRATICULE_LATS = [-60, -65, -70, -75, -80, -85, -88, -89];
export const GRATICULE_LONS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

type Line = { type: "Feature"; properties: { kind: "lat" | "lon"; value: number }; geometry: { type: "LineString"; coordinates: [number, number][] } };

/** Latitude circles 60–89°S and meridians every 30°, as GeoJSON lines in map coordinates. */
export function graticule(): { type: "FeatureCollection"; features: Line[] } {
  const features: Line[] = [];
  for (const lat of GRATICULE_LATS) {
    const coordinates: [number, number][] = [];
    for (let lon = 0; lon <= 360; lon += 2) coordinates.push(toMap(lat, lon));
    features.push({ type: "Feature", properties: { kind: "lat", value: lat }, geometry: { type: "LineString", coordinates } });
  }
  for (const lon of GRATICULE_LONS) {
    // From 60°S to the 89°S circle: meridians do not crowd the pole.
    const coordinates = [toMap(-60, lon), toMap(-89, lon)];
    features.push({ type: "Feature", properties: { kind: "lon", value: lon }, geometry: { type: "LineString", coordinates } });
  }
  return { type: "FeatureCollection", features };
}

/** Lunar metres per screen pixel at a zoom (512 px tiles; 1 map degree = 1e6 m). */
export function metresPerPixel(zoom: number): number {
  return (MAP_SCALE * 360) / (512 * 2 ** zoom);
}

/** Scale bar: the largest 1/2/5 × 10^n km length that fits maxPx; returns its label and width. */
export function scaleBar(zoom: number, maxPx = 110): { km: number; px: number; label: string } {
  const mpp = metresPerPixel(zoom);
  const maxKm = (maxPx * mpp) / 1000;
  const p = 10 ** Math.floor(Math.log10(maxKm));
  const km = [5, 2, 1].map((m) => m * p).find((v) => v <= maxKm) ?? p;
  const label = km >= 1 ? `${km} km` : `${Math.round(km * 1000)} m`;
  return { km, px: (km * 1000) / mpp, label };
}

/** Sites the polar map can show: a known point south of 60°S. */
export function onMap(s: Site): boolean {
  return s.lat !== null && s.lonE !== null && s.lat <= -60;
}

// #162: the live state and the duration format are shared with Compare and Windows (summary.ts, format.ts).
export { liveState, type LiveState } from "../summary";

/** "31 h", "4.5 d" for longer waits. */
export const fmtWait = fmtDuration;

/** Case-insensitive match of a site against a search query (name, status, id, group label). */
export function matches(s: Site, q: string, groupLabel = ""): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [s.name, s.status, s.id, groupLabel].some((v) => v.toLowerCase().includes(t));
}

/** "lat, lon" typed in the search box: signed degrees or N/S, E/W letters.
 *  Returns [lat, lonE] with longitude 0–360°E, or null for anything else. */
export function parseLatLon(q: string): [number, number] | null {
  const m = q.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  const lat = Number(m[1]) * (m[2]?.toUpperCase() === "S" ? -1 : 1);
  const lon = Number(m[3]) * (m[4]?.toUpperCase() === "W" ? -1 : 1);
  if (Math.abs(lat) > 90 || lon < -180 || lon >= 360) return null;
  return [lat, ((lon % 360) + 360) % 360];
}

/** Points along the great circle from a to b ([lat, lonE] in degrees), both ends included.
 *  A short arc is almost straight in the stereographic map, but a long one bends. */
export function greatCircle(a: [number, number], b: [number, number], n = 32): [number, number][] {
  const r = Math.PI / 180;
  const vec = ([lat, lon]: [number, number]) => [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
  const p = vec(a);
  const q = vec(b);
  const w = Math.acos(Math.min(1, Math.max(-1, p[0] * q[0] + p[1] * q[1] + p[2] * q[2])));
  if (w < 1e-9) return [a, b];
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const ka = Math.sin((1 - f) * w) / Math.sin(w);
    const kb = Math.sin(f * w) / Math.sin(w);
    const [x, y, z] = [0, 1, 2].map((k) => ka * p[k] + kb * q[k]);
    const lon = ((Math.atan2(y, x) / r) % 360 + 360) % 360;
    out.push([Math.asin(Math.max(-1, Math.min(1, z))) / r, lon]);
  }
  return out;
}
