// Map overlay of a site inset (#125): the outline square of the 5 × 5 km tile on the map and the two
// leader lines to the framed tile, as in the ESA Rosetta zoom insets. Pure functions: the caller gives
// the map projection (metres of polar stereographic, D-005 → screen px), e.g. from MapLibre.
import type { SiteInset } from "../contracts";

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };
/** Polar stereographic metres (x, y) → screen pixels. */
export type Project = (xM: number, yM: number) => Pt;

/** Tile pixel centre (col, row) → polar stereographic metres. Row 0 = ymax (0°E side), col 0 = xmin. */
export function tilePixelToXY(meta: Pick<SiteInset, "bounds" | "pixelM">, col: number, row: number): [number, number] {
  const [xmin, , , ymax] = meta.bounds;
  return [xmin + (col + 0.5) * meta.pixelM, ymax - (row + 0.5) * meta.pixelM];
}

/** Site position in the tile, 0..1 from the top left. The tile is centred on the site. */
export function siteInTile(meta: Pick<SiteInset, "bounds">, xM: number, yM: number): Pt {
  const [x0, y0, x1, y1] = meta.bounds;
  return { x: (xM - x0) / (x1 - x0), y: (y1 - yM) / (y1 - y0) };
}

/**
 * Corners of the tile on the map, in the order top left, top right, bottom right, bottom left of the
 * image. A square smaller than minPx grows around its centre, so a far zoom still shows a mark.
 */
export function insetOutline(meta: Pick<SiteInset, "bounds">, project: Project, minPx = 0): Pt[] {
  const [x0, y0, x1, y1] = meta.bounds;
  const c = [project(x0, y1), project(x1, y1), project(x1, y0), project(x0, y0)];
  const side = Math.hypot(c[1].x - c[0].x, c[1].y - c[0].y);
  if (side <= 0 || side >= minPx) return c;
  const mid = { x: (c[0].x + c[2].x) / 2, y: (c[0].y + c[2].y) / 2 };
  const k = minPx / side;
  return c.map((p) => ({ x: mid.x + (p.x - mid.x) * k, y: mid.y + (p.y - mid.y) * k }));
}

const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
const mean = (ps: Pt[]): Pt => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });

/**
 * The two leader lines from the outline to the framed tile: the two common outer tangents of the two
 * convex shapes (the hull edges that bridge them), so the lines never cross. [] when they overlap.
 */
export function leaderLines(outline: Pt[], tile: Rect): [Pt, Pt][] {
  const corners = [
    { x: tile.x, y: tile.y },
    { x: tile.x + tile.w, y: tile.y },
    { x: tile.x + tile.w, y: tile.y + tile.h },
    { x: tile.x, y: tile.y + tile.h },
  ];
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const apart = Math.max(...xs) < tile.x || Math.min(...xs) > tile.x + tile.w || Math.max(...ys) < tile.y || Math.min(...ys) > tile.y + tile.h;
  if (!apart) return [];
  const all = [...outline, ...corners];
  const eps = 1e-6;
  const from = mean(outline);
  const dir = mean(corners);
  const best = new Map<number, { line: [Pt, Pt]; len: number }>();
  for (const a of outline) {
    for (const b of corners) {
      const s = all.map((p) => cross(a, b, p));
      if (!(s.every((v) => v >= -eps) || s.every((v) => v <= eps))) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const side = Math.sign(cross(from, dir, mid));
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      // Collinear corners give several candidates on one side: keep the shortest.
      if (len > 0 && (!best.has(side) || len < best.get(side)!.len)) best.set(side, { line: [a, b], len });
    }
  }
  return [...best.values()].map((v) => v.line);
}
