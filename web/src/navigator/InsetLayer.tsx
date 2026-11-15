// Site inset on the navigator map (#129): the outline of the 5 × 5 km tile on the map, two thin leader
// lines and the framed hillshade tile (#125) in a free corner. Lazy: the tile loads after the selection,
// never before the map is ready. Re-projects on every map move through requestAnimationFrame.
import type { Map as MapLibreMap } from "maplibre-gl";
import { memo, useEffect, useRef, useState } from "react";
import { loadInset } from "../api";
import type { Site, SiteInset as SiteInsetMeta } from "../contracts";
import { insetOutline, type Pt, type Rect } from "../inset/insetGeometry";
import { SiteInset } from "../inset/SiteInset";
import { MAP_SCALE } from "./geo";
import { type Corner, INSET_W, insetShown, OUTLINE_MIN_PX, type Placed, placeInset } from "./insetPlace";
import "./insetLayer.css";

const metas = new Map<string, Promise<SiteInsetMeta | null>>();
const metaOf = (id: string) => {
  if (!metas.has(id)) metas.set(id, loadInset(id));
  return metas.get(id) as Promise<SiteInsetMeta | null>;
};

type Props = {
  map: MapLibreMap | null;
  site: Site;
  /** Changes when the left panel opens or closes: the tile looks for a free corner again. */
  layout: string;
};

/** Panels the tile must not cover: the left column, the place card, the map controls, the HUD text. */
const BLOCKERS = ".lcol > *, .place-card, .mapctl, .hud-corner, .nav-scale, .nav-attrib";

const px = (n: number) => `${Math.round(n * 10) / 10}`;
const toPoints = (ps: Pt[]) => ps.map((p) => `${px(p.x)},${px(p.y)}`).join(" ");

export const InsetLayer = memo(function InsetLayer({ map, site, layout }: Props) {
  const [meta, setMeta] = useState<SiteInsetMeta | null>(null);
  const [view, setView] = useState<{ outline: Pt[]; placed: Placed } | null>(null);
  const corner = useRef<Corner | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setMeta(null);
    corner.current = undefined;
    // After the paint: the tile never competes with the map for the first frames of a selection.
    const t = setTimeout(() => {
      metaOf(site.id).then((m) => live && setMeta(insetShown(m) ? m : null));
    }, 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [site.id]);

  useEffect(() => {
    if (!map || !meta) {
      setView(null);
      return;
    }
    let raf = 0;
    const root = map.getContainer().closest(".navigator") as HTMLElement | null;
    const project = (x: number, y: number): Pt => map.project([x / MAP_SCALE, y / MAP_SCALE]);
    // A panel that grows or shrinks (a search, a new list) moves the free corners.
    const watch = new ResizeObserver(() => schedule());
    const seen = new Set<Element>();
    const update = () => {
      raf = 0;
      if (!root) return;
      const o = root.getBoundingClientRect();
      const rel = (r: DOMRect): Rect => ({ x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height });
      const els = [...root.querySelectorAll(BLOCKERS)];
      for (const el of els) {
        if (seen.has(el)) continue;
        seen.add(el);
        watch.observe(el);
      }
      // The HUD frame ends above the time strip and right of the rail (--dock-h is a calc()).
      const f = root.querySelector(".vp-frame")?.getBoundingClientRect();
      const free = f
        ? { left: f.left - o.left + 12, top: f.top - o.top + 64, right: f.right - o.left - 12, bottom: f.bottom - o.top - 12 }
        : { left: 76, top: 64, right: o.width - 12, bottom: o.height - 12 };
      // #397: the Sun / Earth / DSN strip (#371) hangs from the top edge; the caption goes under it.
      const strip = root.querySelector(".status-strip")?.getBoundingClientRect();
      if (strip && strip.height > 0) free.top = Math.max(free.top, strip.bottom - o.top + 12);
      const outline = insetOutline(meta, project, OUTLINE_MIN_PX);
      const blocked = els.map((e) => rel(e.getBoundingClientRect()));
      // The left column (search, panel, mission calendar #159) can fill both left corners: then the
      // tile tries the corners right of the column.
      const col = root.querySelector(".lcol");
      const colRight = col ? Math.max(0, ...[...col.children].map((e) => rel(e.getBoundingClientRect())).map((r) => r.x + r.w)) : 0;
      const vp = { w: o.width, h: o.height };
      const placed =
        placeInset(outline, vp, free, blocked, corner.current) ??
        (colRight > free.left ? placeInset(outline, vp, { ...free, left: colRight + 12 }, blocked, corner.current) : null);
      corner.current = placed?.corner ?? corner.current;
      setView(placed ? { outline, placed } : null);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    map.on("move", schedule);
    map.on("resize", schedule);
    return () => {
      map.off("move", schedule);
      map.off("resize", schedule);
      watch.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [map, meta, layout]);

  if (!meta || !view) return null;
  const { outline, placed } = view;
  return (
    <div className="inset-layer" data-testid="site-inset" data-corner={placed.corner}>
      <svg className="inset-lines" aria-hidden="true">
        {placed.leaders.map(([a, b], i) => (
          <line key={i} x1={px(a.x)} y1={px(a.y)} x2={px(b.x)} y2={px(b.y)} />
        ))}
        <polygon points={toPoints(outline)} />
      </svg>
      <div className="inset-tile" style={{ left: placed.tile.x, top: placed.tile.y, width: INSET_W }}>
        <SiteInset meta={meta} siteName={site.name} />
      </div>
    </div>
  );
});
