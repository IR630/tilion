import { R, sample, type Dem } from "../custom/horizon";
import type { CustomMeta, Tile } from "../custom/assets";

export type Point = { lat: number; lon: number };
export type ProfilePoint = { distanceM: number; heightM: number | null; trajectoryM: number | null; clearanceM: number | null };
const rad = Math.PI / 180;
type Vec = [number, number, number];
const vector = (p: Point): Vec => [Math.cos(p.lat * rad) * Math.cos(p.lon * rad), Math.cos(p.lat * rad) * Math.sin(p.lon * rad), Math.sin(p.lat * rad)];

/** Bilinear sampling preserves NoData and rejects outside points, rather than clamping. */
export function safeSample(d: Dem, x: number, y: number): number | null {
  const c = Math.floor((x - d.x0) / d.dx - 0.5);
  const r = Math.floor((y - d.y0) / d.dy - 0.5);
  if (c < 0 || r < 0 || c >= d.width - 1 || r >= d.height - 1) return null;
  const i = r * d.width + c;
  if ([d.q[i], d.q[i + 1], d.q[i + d.width], d.q[i + d.width + 1]].some((v) => v === -32768 || !Number.isFinite(v))) return null;
  const value = sample(d, x, y);
  return Number.isFinite(value) ? value : null;
}

type PathPoint = { distanceM: number; x: number; y: number; lat: number; fraction: number };

/** Great-circle samples in south-polar stereographic coordinates. */
export function profilePath(from: Point, to: Point): PathPoint[] {
  const vals = [from.lat, from.lon, to.lat, to.lon];
  if (vals.some((v) => !Number.isFinite(v)) || Math.abs(from.lat) > 90 || Math.abs(to.lat) > 90 || from.lon < 0 || from.lon >= 360 || to.lon < 0 || to.lon >= 360) throw new Error("Enter valid latitudes and longitudes (0–360°E).");
  const a = vector(from), b = vector(to);
  const angle = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
  const length = angle * R;
  if (length < 1 || length > 500000) throw new Error("Choose endpoints 1 m to 500 km apart.");
  const n = Math.ceil(length / 120), sinAngle = Math.sin(angle);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, wa = Math.sin((1 - t) * angle) / sinAngle, wb = Math.sin(t * angle) / sinAngle;
    const px = wa * a[0] + wb * b[0], py = wa * a[1] + wb * b[1], pz = wa * a[2] + wb * b[2];
    const k = 2 * R / (1 - pz);
    return { distanceM: length * t, x: k * py, y: k * px, lat: Math.asin(Math.max(-1, Math.min(1, pz))) / rad, fraction: t };
  });
}

/** Tiles covering the line and the four pixels needed by bilinear interpolation. */
export function profileTiles(meta: CustomMeta, path: PathPoint[]): Tile[] {
  const g = meta.dem, result = new Map<string, Tile>();
  for (const p of path) {
    if (p.lat > g.minLat) continue;
    const c = Math.floor((p.x - g.x0) / g.dx - 0.5), r = Math.floor((p.y - g.y0) / g.dy - 0.5);
    for (const row of [r, r + 1]) for (const col of [c, c + 1]) {
      if (row < 0 || col < 0 || row >= g.height || col >= g.width) continue;
      const tr = Math.floor(row / g.tilePx), tc = Math.floor(col / g.tilePx);
      const file = `${g.dir}${tr}-${tc}.bin`;
      result.set(file, { row: tr, col: tc, file });
    }
  }
  return [...result.values()];
}

/** Heights and optional trajectory relative to the LOLA reference sphere. */
export function approachProfile(dem: Dem, from: Point, to: Point, trajectory: [number, number] | null = null, minLat = -60): ProfilePoint[] {
  if (trajectory?.some((v) => !Number.isFinite(v))) throw new Error("Enter valid trajectory heights.");
  return profilePath(from, to).map((p) => {
    const heightM = p.lat > minLat ? null : safeSample(dem, p.x, p.y);
    const trajectoryM = trajectory ? trajectory[0] + p.fraction * (trajectory[1] - trajectory[0]) : null;
    return { distanceM: p.distanceM, heightM, trajectoryM, clearanceM: heightM === null || trajectoryM === null ? null : trajectoryM - heightM };
  });
}
