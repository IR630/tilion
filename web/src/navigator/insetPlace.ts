// Where the site inset sits on the navigator map (#129). Pure functions: the caller gives the outline
// on screen, the area the tile may use and the screen rects of the panels it must not cover.
import type { SiteInset } from "../contracts";
import { leaderLines, type Pt, type Rect } from "../inset/insetGeometry";

export type Corner = "bl" | "br" | "tl" | "tr";
export type Free = { left: number; top: number; right: number; bottom: number };
export type View = { w: number; h: number };
export type Placed = { corner: Corner; tile: Rect; frame: Rect; leaders: [Pt, Pt][] };

export const INSET_W = 220; // figure width = .site-inset --si-w
export const INSET_LABEL_H = 20; // caption line + gap above the framed tile
export const INSET_H = INSET_W + 2 * INSET_LABEL_H; // caption + frame + date line
export const OUTLINE_MIN_PX = 16; // a far zoom still shows a mark
const GAP = 12; // clear space between the tile and the outline, px
const PAD = 8; // clear space between the tile and a panel, px
const MAX_SHARE = 0.6; // an outline wider than this share of the viewport hides the inset
const ORDER: Corner[] = ["bl", "tl", "br", "tr"];

/** Only tiles from the 20 m LOLA grid; 80 and 240 m would be a blurred picture (#125). */
export function insetShown(meta: Pick<SiteInset, "resolutionM"> | null | undefined): boolean {
  return !!meta && meta.resolutionM <= 80;
}

function cornerRect(c: Corner, free: Free): Rect {
  return {
    x: c[1] === "l" ? free.left : free.right - INSET_W,
    y: c[0] === "t" ? free.top : free.bottom - INSET_H,
    w: INSET_W,
    h: INSET_H,
  };
}

const bbox = (ps: Pt[]) => {
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};

function hits(r: Rect, b: ReturnType<typeof bbox>, gap: number): boolean {
  return b.x1 + gap > r.x && b.x0 - gap < r.x + r.w && b.y1 + gap > r.y && b.y0 - gap < r.y + r.h;
}
const rectBox = (r: Rect) => ({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });

/**
 * The tile corner and the two leader lines, or null when there is no inset: the outline is off the
 * screen or larger than 60 % of it, the free area is too small, or every corner of it touches the
 * outline or a panel. The preferred corner (the previous one, else bottom left, away from the place
 * card) stays while it is clear; when the outline reaches it, the tile moves to the clear corner
 * farthest from the outline.
 */
export function placeInset(outline: Pt[], view: View, free: Free, blocked: Rect[] = [], prev?: Corner): Placed | null {
  const b = bbox(outline);
  if (b.x1 - b.x0 > MAX_SHARE * view.w || b.y1 - b.y0 > MAX_SHARE * view.h) return null;
  const c = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  if (c.x < 0 || c.y < 0 || c.x > view.w || c.y > view.h) return null;
  if (free.right - free.left < INSET_W || free.bottom - free.top < INSET_H) return null;
  const clear = ORDER.filter((k) => {
    const r = cornerRect(k, free);
    return !hits(r, b, GAP) && !blocked.some((q) => hits(r, rectBox(q), PAD));
  });
  const want = prev ?? "bl";
  const dist = (k: Corner) => {
    const r = cornerRect(k, free);
    return Math.hypot(r.x + r.w / 2 - c.x, r.y + r.h / 2 - c.y);
  };
  const corner = clear.includes(want) ? want : clear.sort((a, z) => dist(z) - dist(a))[0];
  if (!corner) return null;
  const tile = cornerRect(corner, free);
  const frame = { x: tile.x, y: tile.y + INSET_LABEL_H, w: INSET_W, h: INSET_W };
  const leaders = leaderLines(outline, frame);
  return leaders.length === 2 ? { corner, tile, frame, leaders } : null;
}
