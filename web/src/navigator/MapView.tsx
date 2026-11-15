// Full-screen MapLibre map of the lunar south polar region (D-005). No external tiles or glyphs:
// an empty style, a local basemap tile pyramid (+ /hd/ deep zooms), GeoJSON lines and HTML markers. The map is created once;
// sites, selection and layers update imperatively, so a time change never touches it.
import { memo, type RefObject, useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "maplibre-gl/dist/maplibre-gl.css";
import { BASEMAP_URL, HD_BASEMAP_URL, loadBasemapMeta, loadHdManifest } from "../api";
import type { Site } from "../contracts";
import { stereoInv } from "../format";
import { declutter, type LatLon, placeCallouts, type Rect, routeFeatures } from "../mission/routeMap";
import { litShare, loadShadowField, paintShadows } from "./shadows";
import { paintThermal, type SunVec, thermalField } from "../beta/thermal/mapThermal";
import { type BasemapMeta, boundsToCoords, detailZoom, graticule, layersOf, MAP_SCALE, onMap, scaleBar, type TileManifest, type TileSet, tileSource, toMap, zoomLimit } from "./geo";

maplibregl.setWorkerUrl(workerUrl);

export type Overlay = "relief" | "photo" | "sun" | "earth" | "shadow" | "thermal";
export type Focus = { lat: number; lonE: number; n: number };
/** One route option on the map (#72): a line from the plan site and a callout bubble. */
export type MapRoute = {
  key: string;
  siteId: string;
  to: LatLon;
  rank: string; // "#2": the rank of the option (#204)
  metric: string; // "score 87": the route score (#160, #195)
  slip: string; // "slip −2 d" or "same day"
  tie: string; // #204: non-empty when the score ties a neighbour: what ranks it (the slip is then marked)
  aria: string; // accessible name of the bubble
  selected: boolean;
};
export type MapRoutes = { from: LatLon; fromSiteId: string; lines: MapRoute[] };
/** Camera commands for the floating map controls. */
export type MapApi = { zoomBy: (d: number) => void; reset: () => void };

const EDGE_80 = toMap(-80, 0)[1]; // 80°S circle radius in map units
const EDGE_60 = toMap(-60, 0)[1];
const PAN_LIMIT = 1.12; // the camera may show a little black past the 60°S data square (#146)
const FRAME_REACH = 1.3; // the edge-fade image spans ±1.3 × the data square
const FADE_FROM = 0.7; // the fade starts at this share of the data half-width; black at 1.0
const OVERLAY_OPACITY = 0.78;
const CARD_INSET = 420; // place card width + margins, px
const FRAME_BOUNDS = (() => {
  const r = EDGE_60 * FRAME_REACH * MAP_SCALE;
  return [-r, -r, r, r];
})();
/** PNG data URL of a square frame: clear inside, fading to `color` between FADE_FROM and 1.0 of the
 *  60°S data half-width (Chebyshev distance: the data is a square), solid beyond. */
function edgeFadeUrl(color: string): string {
  const n = 2048;
  const c = document.createElement("canvas");
  c.width = c.height = n;
  const ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const img = ctx.createImageData(n, n);
  const half = n / 2;
  const edge = half / FRAME_REACH; // px of the data half-width
  const d = img.data;
  for (let y = 0; y < n; y++) {
    const dy = Math.abs(y + 0.5 - half) / edge;
    for (let x = 0; x < n; x++) {
      const t = Math.min(1, Math.max(0, (Math.max(dy, Math.abs(x + 0.5 - half) / edge) - FADE_FROM) / (1 - FADE_FROM)));
      const i = (y * n + x) * 4;
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}
/** A colour token from styles.css :root (#94): the map paints with the same palette as the HUD. */
const tok = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

type Props = {
  sites: Site[];
  selected: string | null;
  pin: [number, number] | null;
  overlay: Overlay;
  focus: Focus | null;
  routes?: MapRoutes | null;
  /** Width of the floating left column, px: the camera keeps the target clear of it. */
  leftInset: number;
  api?: RefObject<MapApi | null>;
  onSelect: (id: string) => void;
  /** A click on a route line or its bubble. */
  onRoute?: (key: string) => void;
  /** The user keeps zooming out at the widest view: show the globe. */
  onFarOut?: () => void;
  onPick: (lat: number, lonE: number) => void;
  onMeta: (meta: BasemapMeta | null) => void;
  /** The map object once it is created; null when it is removed (the inset layer projects with it, #129). */
  onMapInstance?: (map: maplibregl.Map | null) => void;
  /** #288: Sun unit vector (Moon body-fixed) for the "shadow" overlay; null = no Sun direction at this moment. */
  shadowSun?: [number, number, number] | null;
  /** #288: null = shadows drawn, a string = why they are not. */
  onShadow?: (problem: string | null) => void;
  /** #325 (beta): Sun now and at earlier hours for the "thermal" overlay; null = no Sun direction at this moment. */
  thermalSun?: { now: SunVec; back: { h: number; sun: SunVec }[] } | null;
};

function markerEl(s: Site): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `nav-marker g-${s.group}`;
  el.dataset.site = s.id;
  el.setAttribute("aria-label", s.name);
  const dot = document.createElement("span");
  dot.className = "nav-marker-dot";
  const label = document.createElement("span");
  label.className = "nav-marker-label";
  label.textContent = s.name; // text node: never parsed as HTML
  el.append(dot, label);
  return el;
}

function routeEndEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "nav-route-end";
  el.setAttribute("data-testid", "route-end");
  el.append(document.createElement("i"));
  return el;
}

function routeFromEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "nav-route-from";
  el.setAttribute("data-testid", "route-from");
  el.append(document.createElement("i"));
  return el;
}

function calloutEl(onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "nav-callout";
  const i = document.createElement("i");
  const b = document.createElement("b");
  const s = document.createElement("span");
  el.append(i, b, s);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}
const CALLOUT_LIFT = 22; // px above the anchor
const CALLOUT_BELOW = 14; // px: a bubble under its anchor (#397) leaves this gap for the leader
const DOT_HALF = 8; // px: half the site dot with its outline (navigator.css .nav-marker-dot) + 1 px
const LABEL_H = 14; // px: the site name line height (navigator.css .nav-marker-label)
const SELECTED_LABEL_PAD = 14; // px: the boxed selected name adds 2 × (6 px padding + 1 px border)

const EMPTY_FC = { type: "FeatureCollection" as const, features: [] };

function gridLabel(text: string, cls: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = `nav-grid-label ${cls}`;
  el.textContent = text;
  return el;
}

export const MapView = memo(function MapView(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const limitRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef(new Map<string, { marker: maplibregl.Marker; el: HTMLButtonElement }>());
  const labelW = useRef(new WeakMap<HTMLElement, number>()); // site name widths, px (layoutLabels)
  const pinMarker = useRef<maplibregl.Marker | null>(null);
  const overlayIds = useRef<{ sun: string[]; earth: string[] }>({ sun: [], earth: [] });
  const tileIds = useRef<{ relief: string[]; photo: string[] }>({ relief: [], photo: [] });
  const routeEnd = useRef<maplibregl.Marker | null>(null);
  const routeFrom = useRef<maplibregl.Marker | null>(null);
  const callouts = useRef(new Map<string, maplibregl.Marker>());
  // Laid-out bubbles: anchor, size and priority, re-decluttered on every camera move.
  const bubbles = useRef<{ m: maplibregl.Marker; at: [number, number]; base: number; w: number; h: number; sel: boolean }[]>([]);
  const fitKeys = useRef("");
  const latest = useRef(props);
  latest.current = props;

  const padding = () => {
    const w = window.innerWidth;
    const left = w > 760 ? latest.current.leftInset + 24 : 16;
    return { top: 80, bottom: 96, left, right: w > 760 ? 96 : 16 };
  };

  // Create the map once.
  useEffect(() => {
    if (!host.current) return;
    const map = new maplibregl.Map({
      container: host.current,
      style: {
        version: 8,
        sources: {},
        layers: [{ id: "background", type: "background", paint: { "background-color": tok("--bg", "black") } }],
      },
      bounds: [
        [-EDGE_80, -EDGE_80],
        [EDGE_80, EDGE_80],
      ],
      fitBoundsOptions: { padding: padding() },
      maxBounds: [
        [-EDGE_60 * PAN_LIMIT, -EDGE_60 * PAN_LIMIT],
        [EDGE_60 * PAN_LIMIT, EDGE_60 * PAN_LIMIT],
      ],
      maxZoom: 15.5,
      renderWorldCopies: false,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0,
    });
    map.touchZoomRotate.disableRotation();
    if (import.meta.env.DEV) (window as unknown as { __map?: maplibregl.Map }).__map = map;
    map.keyboard.disableRotation();
    mapRef.current = map;
    latest.current.onMapInstance?.(map);

    const updateScale = () => {
      const s = scaleBar(map.getZoom());
      const el = scaleRef.current;
      if (el) {
        el.style.width = `${Math.round(s.px)}px`;
        el.textContent = s.label;
      }
    };
    map.on("zoom", updateScale);
    map.on("move", () => layoutLabels()); // also lays out the route bubbles (#204)
    map.on("resize", () => layoutLabels());
    document.fonts?.ready.then(() => {
      if (mapRef.current !== map) return;
      labelW.current = new WeakMap(); // names re-measured in the final font
      layoutLabels();
    });
    updateScale();

    map.on("click", (e) => {
      if ((e.originalEvent.target as Element | null)?.closest?.(".nav-marker, .nav-callout, .iau-label, .wp-marker")) return;
      // No onRoute (waypoint add mode, #148): a route line under the cursor does not take the click.
      const hit = latest.current.onRoute && map.getLayer("route-hit") ? map.queryRenderedFeatures(e.point, { layers: ["route-hit"] }) : [];
      if (hit.length > 0) {
        // The top line under the cursor: the selected one draws last.
        const key = hit[hit.length - 1].properties?.key;
        if (typeof key === "string") latest.current.onRoute?.(key);
        return;
      }
      const [lat, lonE] = stereoInv(e.lngLat.lng * MAP_SCALE, e.lngLat.lat * MAP_SCALE);
      if (lat <= -60) latest.current.onPick(lat, lonE);
    });

    // #146: one more zoom out at the widest view returns to the globe (the same whip-pan as the
    // globe → map step). A gesture counts only if it starts at the limit: the tail of a spin that
    // reached the limit on its own does not leave the map.
    let live = true;
    let lastWheel = 0;
    let gestureStuck = false;
    let pushed = 0;
    map.on("wheel", (e) => {
      const dy = e.originalEvent.deltaY;
      if (dy <= 0) return;
      const now = performance.now();
      const first = now - lastWheel > 450;
      lastWheel = now;
      if (first) pushed = 0;
      const z = map.getZoom();
      setTimeout(() => {
        const stuck = Math.abs(map.getZoom() - z) < 0.01;
        if (first) gestureStuck = stuck;
        if (!gestureStuck || !stuck || !live) return;
        pushed += dy;
        if (pushed >= 100) {
          pushed = -Infinity;
          latest.current.onFarOut?.();
        }
      }, 150);
    });

    map.on("load", () => {
      map.addSource("graticule", { type: "geojson", data: graticule() });
      map.addLayer({
        id: "graticule",
        type: "line",
        source: "graticule",
        paint: {
          "line-color": tok("--muted", "grey"),
          "line-opacity": ["case", ["==", ["get", "value"], -80], 0.32, 0.16],
          "line-width": 0.8,
        },
      });
      for (const lat of [-60, -70, -80, -85, -88]) {
        new maplibregl.Marker({ element: gridLabel(`${-lat}°S`, "lat"), anchor: "bottom-left" })
          .setLngLat(toMap(lat, 45))
          .addTo(map);
      }
      for (const lon of [0, 90, 180, 270]) {
        new maplibregl.Marker({ element: gridLabel(`${lon}°E`, "lon") }).setLngLat(toMap(-79.2, lon)).addTo(map);
      }
      map.addSource("route", { type: "geojson", data: EMPTY_FC });
      // Selected option: a solid line in the active colour; the others dashed grey (#94).
      const sel: maplibregl.ExpressionSpecification = ["==", ["get", "sel"], 1];
      const alt: maplibregl.ExpressionSpecification = ["==", ["get", "sel"], 0];
      const round = { "line-cap": "round", "line-join": "round" } as const;
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        filter: sel,
        layout: round,
        paint: { "line-color": tok("--bg", "black"), "line-width": 7, "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "route-alt",
        type: "line",
        source: "route",
        filter: alt,
        paint: { "line-color": tok("--muted", "grey"), "line-width": 1.5, "line-dasharray": [4, 3] },
      });
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        filter: sel,
        layout: round,
        paint: { "line-color": tok("--earth", "white"), "line-width": 3 },
      });
      map.addLayer({
        id: "route-hit",
        type: "line",
        source: "route",
        layout: { "line-cap": "round" },
        paint: { "line-color": tok("--bg", "black"), "line-width": 18, "line-opacity": 0 },
      });
      map.on("mouseenter", "route-hit", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "route-hit", () => (map.getCanvas().style.cursor = ""));
      drawRoutes();
      if (section.current) section.current.dataset.ready = "1";

      loadBasemapMeta().then((meta) => {
        if (!live) return;
        latest.current.onMeta(meta);
        // Tile pyramid (#149): git tier from meta.json, deep zooms from /hd/ when the server has them.
        // Anchors keep the order relief < photo < sun/earth whenever a set arrives.
        for (const a of ["relief-top", "photo-top"]) map.addLayer({ id: a, type: "background", layout: { visibility: "none" } }, "graticule");
        const addTiles = (m: TileManifest, base: string) => {
          for (const s of [...m.sets].sort((a, b) => a.minzoom - b.minzoom)) {
            const id = `tiles-${s.id}`;
            if (map.getSource(id)) continue;
            map.addSource(id, tileSource(s, base, m.tileSize));
            const photo = s.layer === "photo";
            map.addLayer(
              {
                id,
                type: "raster",
                source: id,
                layout: { visibility: photo === (latest.current.overlay === "photo") ? "visible" : "none" },
                paint: {
                  "raster-fade-duration": 0,
                  "raster-resampling": "linear",
                  // Monochrome HUD (#94): the relief sits dark under the white and grey overlays.
                  ...(photo ? { "raster-brightness-max": 0.8 } : { "raster-brightness-max": 0.48, "raster-contrast": 0.15 }),
                },
              },
              `${s.layer}-top`,
            );
            tileIds.current[s.layer].push(id);
          }
        };
        // Zoom cap by the data under the centre (#464): past z12.5 the 240 m relief turns to grey mush.
        const detailSets: TileSet[] = [];
        let detailMax = map.getMaxZoom();
        const applyLimit = () => {
          const c = map.getCenter();
          const lim = zoomLimit(detailSets, [c.lng, c.lat], detailMax);
          if (map.getMaxZoom() !== lim) map.setMaxZoom(lim);
          if (limitRef.current) limitRef.current.hidden = lim > 12.5;
        };
        map.on("moveend", applyLimit);
        if (meta?.tiles) {
          addTiles(meta.tiles, new URL(BASEMAP_URL, document.baseURI).href);
          detailSets.push(...meta.tiles.sets);
          applyLimit();
        }
        loadHdManifest().then((hd) => {
          if (!live || !hd) return;
          addTiles(hd, new URL(HD_BASEMAP_URL, location.origin).href);
          detailSets.push(...hd.sets);
          detailMax = Math.max(detailMax, detailZoom(hd.sets));
          applyLimit();
        });
        for (const kind of ["sun", "earth"] as const) {
          for (const l of layersOf(meta ?? { layers: [] }, kind)) {
            const id = `basemap-${l.id}`;
            map.addSource(id, { type: "image", url: BASEMAP_URL + l.file, coordinates: boundsToCoords(l.bounds) });
            map.addLayer(
              {
                id,
                type: "raster",
                source: id,
                layout: { visibility: kind === latest.current.overlay ? "visible" : "none" },
                paint: { "raster-opacity": OVERLAY_OPACITY, "raster-fade-duration": 0, "raster-resampling": "linear" },
              },
              "graticule",
            );
            overlayIds.current[kind].push(id);
          }
        }
        // The 60°S data edge fades to the page colour instead of ending in a hard crop (#146).
        map.addSource("edge-fade", { type: "image", url: edgeFadeUrl(tok("--bg", "#08090a")), coordinates: boundsToCoords(FRAME_BOUNDS) });
        map.addLayer(
          { id: "edge-fade", type: "raster", source: "edge-fade", paint: { "raster-fade-duration": 0, "raster-resampling": "linear" } },
          "graticule",
        );
      });
    });

    return () => {
      live = false;
      routeEnd.current = null;
      routeFrom.current = null;
      callouts.current.clear();
      bubbles.current = [];
      fitKeys.current = "";
      markers.current.clear();
      pinMarker.current = null;
      overlayIds.current = { sun: [], earth: [] };
      tileIds.current = { relief: [], photo: [] };
      map.remove();
      mapRef.current = null;
      latest.current.onMapInstance?.(null);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Site markers: add the new ones, drop the gone ones.
  const { sites } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const want = new Set(sites.filter(onMap).map((s) => s.id));
    for (const [id, m] of markers.current) {
      if (!want.has(id)) {
        m.marker.remove();
        markers.current.delete(id);
      }
    }
    for (const s of sites) {
      if (!want.has(s.id) || markers.current.has(s.id)) continue;
      const el = markerEl(s);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        latest.current.onSelect(s.id);
      });
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat(toMap(s.lat as number, s.lonE as number))
        .addTo(map);
      markers.current.set(s.id, { marker, el });
    }
    layoutLabels();
  }, [sites]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selection: one class toggle, the selected marker on top.
  const { selected } = props;
  useEffect(() => {
    for (const [id, { el }] of markers.current) el.classList.toggle("is-selected", id === selected);
    layoutLabels();
  }, [selected, sites]); // eslint-disable-line react-hooks/exhaustive-deps

  // Site names (#154, as FloodValue's text-optional labels): a name shows wherever it fits, right of
  // the dot or else left, never over another name, dot or route bubble. Order (#204): the selected
  // name, then the route bubbles (they move up off it and off each other), then the other names,
  // which go to the other side or drop.
  const layoutLabels = () => {
    const map = mapRef.current;
    if (!map) return;
    const W = map.getContainer().clientWidth;
    const H = map.getContainer().clientHeight;
    // Name widths are measured once (a forced layout per map frame would cost the pan its frames).
    const items = [...markers.current.values()].map(({ marker, el }) => {
      const p = map.project(marker.getLngLat());
      const sel = el.classList.contains("is-selected");
      let w = labelW.current.get(el);
      if (w === undefined) {
        w = el.querySelector<HTMLElement>(".nav-marker-label")?.offsetWidth ?? 0;
        if (sel) w -= SELECTED_LABEL_PAD;
        labelW.current.set(el, w);
      }
      return { el, x: p.x, y: p.y, w: w + (sel ? SELECTED_LABEL_PAD : 0), sel };
    });
    const shown = items.filter((i) => i.x > -50 && i.y > -50 && i.x < W + 50 && i.y < H + 50);
    const taken = shown.map((i) => ({ l: i.x - DOT_HALF, r: i.x + DOT_HALF, t: i.y - DOT_HALF, b: i.y + DOT_HALF }));
    const free = (r: { l: number; r: number; t: number; b: number }) =>
      !taken.some((q) => r.l < q.r && r.r > q.l && r.t < q.b && r.b > q.t);
    const placed = new Map<HTMLElement, "right" | "left">();
    let bubblesDone = false;
    for (const i of [...shown].sort((a, b) => Number(b.sel) - Number(a.sel))) {
      if (!i.sel && !bubblesDone) {
        taken.push(...layoutCallouts(map, taken.slice(shown.length))); // after the dots: the selected names
        bubblesDone = true;
      }
      const off = i.sel ? 19 : 11; // px from the dot centre to the name (the selected one clears its ring)
      const t = i.y - LABEL_H / 2;
      const right = { l: i.x + off, r: i.x + off + i.w, t, b: t + LABEL_H };
      const left = { l: i.x - off - i.w, r: i.x - off, t, b: t + LABEL_H };
      const side = free(right) ? "right" : free(left) ? "left" : i.sel ? "right" : null;
      if (!side) continue;
      placed.set(i.el, side);
      taken.push(side === "right" ? right : left);
    }
    if (!bubblesDone) layoutCallouts(map, taken.slice(shown.length));
    for (const i of items) {
      const side = placed.get(i.el);
      i.el.classList.toggle("lbl-on", !!side);
      i.el.classList.toggle("lbl-left", side === "left");
    }
  };

  // Dropped pin.
  const { pin } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!pin) {
      pinMarker.current?.remove();
      pinMarker.current = null;
      return;
    }
    if (!pinMarker.current) {
      const el = document.createElement("div");
      el.className = "nav-pin";
      el.setAttribute("data-testid", "custom-marker");
      pinMarker.current = new maplibregl.Marker({ element: el, anchor: "bottom" });
    }
    pinMarker.current.setLngLat(toMap(pin[0], pin[1])).addTo(map);
  }, [pin]);

  // Overlay switch.
  const { overlay } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const kind of ["sun", "earth"] as const) {
      for (const id of overlayIds.current[kind]) {
        if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", kind === overlay ? "visible" : "none");
      }
    }
    // The LROC photo replaces the relief; sun and earth draw over the relief.
    for (const layer of ["relief", "photo"] as const) {
      const on = (layer === "photo") === (overlay === "photo");
      for (const id of tileIds.current[layer]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    }
  }, [overlay]);

  // #288: terrain shadows at the moment, recomputed on each step of the time dock.
  const { shadowSun } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const on = overlay === "shadow" && !!shadowSun;
    if (map.getLayer("shadow-now")) map.setLayoutProperty("shadow-now", "visibility", on ? "visible" : "none");
    if (overlay !== "shadow") return;
    if (!shadowSun) return latest.current.onShadow?.("No Sun direction at this moment (outside the data range).");
    let live = true;
    const draw = () =>
      loadShadowField().then(
        (f) => {
          if (!live || mapRef.current !== map) return;
          const canvas = document.createElement("canvas");
          paintShadows(canvas, f, litShare(f, shadowSun));
          const url = canvas.toDataURL();
          const coordinates = boundsToCoords([-f.extentM, -f.extentM, f.extentM, f.extentM]);
          const src = map.getSource("shadow-now") as maplibregl.ImageSource | undefined;
          if (src) src.updateImage({ url, coordinates });
          else {
            map.addSource("shadow-now", { type: "image", url, coordinates });
            map.addLayer({ id: "shadow-now", type: "raster", source: "shadow-now", paint: { "raster-fade-duration": 0, "raster-resampling": "linear" } }, "graticule");
            // First switch-on: bring the shadow field into view.
            const e = f.extentM / MAP_SCALE;
            map.fitBounds([[-e, -e], [e, e]], { padding: 60, duration: reducedMotion() ? 0 : 900 });
          }
          latest.current.onShadow?.(null);
        },
        (e) => live && latest.current.onShadow?.(`Shadow field failed to load: ${e instanceof Error ? e.message : String(e)}`),
      );
    if (map.getLayer("graticule")) draw();
    else map.once("load", draw);
    return () => {
      live = false;
    };
  }, [overlay, shadowSun]);

  // #325 (beta): regolith temperature at the moment over the same field, recomputed on each step of the time dock.
  const { thermalSun } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const on = overlay === "thermal" && !!thermalSun;
    if (map.getLayer("thermal-now")) map.setLayoutProperty("thermal-now", "visibility", on ? "visible" : "none");
    if (overlay !== "thermal") return;
    if (!thermalSun) return latest.current.onShadow?.("No Sun direction at this moment (outside the data range).");
    let live = true;
    const draw = () =>
      loadShadowField().then(
        (f) => {
          if (!live || mapRef.current !== map) return;
          const canvas = document.createElement("canvas");
          paintThermal(canvas, f, thermalField(f, thermalSun.now, thermalSun.back));
          const url = canvas.toDataURL();
          const coordinates = boundsToCoords([-f.extentM, -f.extentM, f.extentM, f.extentM]);
          const src = map.getSource("thermal-now") as maplibregl.ImageSource | undefined;
          if (src) src.updateImage({ url, coordinates });
          else {
            map.addSource("thermal-now", { type: "image", url, coordinates });
            map.addLayer({ id: "thermal-now", type: "raster", source: "thermal-now", paint: { "raster-fade-duration": 0, "raster-resampling": "linear" } }, "graticule");
            const e = f.extentM / MAP_SCALE;
            map.fitBounds([[-e, -e], [e, e]], { padding: 60, duration: reducedMotion() ? 0 : 900 });
          }
          latest.current.onShadow?.(null);
        },
        (e) => live && latest.current.onShadow?.(`Shadow field failed to load: ${e instanceof Error ? e.message : String(e)}`),
      );
    if (map.getLayer("graticule")) draw();
    else map.once("load", draw);
    return () => {
      live = false;
    };
  }, [overlay, thermalSun]);

  // Route options (#72): all lines in one GeoJSON source, one HTML bubble per option, a ring at
  // the plan site and an end ring on the selected option. Updated imperatively; the camera fits
  // the lines only when the set of options changes, not on a selection.
  const drawRoutes = () => {
    const map = mapRef.current;
    const r = latest.current.routes ?? null;
    const src = map?.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (!map || !src) return;
    const lines = r?.lines ?? [];
    src.setData(r ? routeFeatures(r.from, lines, toMap) : EMPTY_FC);

    const placed = r ? placeCallouts(r.from, lines) : [];
    const keep = new Set(placed.map((c) => c.key));
    for (const [k, m] of callouts.current) {
      if (!keep.has(k)) {
        m.remove();
        callouts.current.delete(k);
      }
    }
    placed.forEach((c, n) => {
      const line = lines[n];
      let m = callouts.current.get(c.key);
      if (!m) {
        m = new maplibregl.Marker({ element: calloutEl(() => latest.current.onRoute?.(c.key)), anchor: "bottom" });
        callouts.current.set(c.key, m);
      }
      const el = m.getElement();
      el.dataset.key = c.key;
      el.dataset.site = line.siteId;
      el.setAttribute("aria-label", line.aria);
      el.setAttribute("aria-pressed", String(line.selected));
      el.classList.toggle("is-selected", line.selected);
      el.classList.toggle("on-origin", c.onOrigin);
      el.style.zIndex = line.selected ? "6" : "4";
      el.classList.toggle("is-tie", !!line.tie);
      if (line.tie) el.title = `${line.metric}: ${line.tie}`;
      else el.removeAttribute("title");
      (el.children[0] as HTMLElement).textContent = line.rank;
      (el.children[1] as HTMLElement).textContent = line.metric;
      (el.children[2] as HTMLElement).textContent = line.slip;
      m.setLngLat(toMap(c.at[0], c.at[1])).addTo(map);
    });
    bubbles.current = placed.map((c, n) => {
      const m = callouts.current.get(c.key) as maplibregl.Marker;
      const el = m.getElement();
      return { m, at: toMap(c.at[0], c.at[1]), base: CALLOUT_LIFT + (c.onOrigin ? 8 : 0), w: el.offsetWidth || 90, h: el.offsetHeight || 26, sel: lines[n].selected };
    });
    layoutLabels(); // bubbles first, then the site names around them (#204)

    if (r) {
      if (!routeFrom.current) routeFrom.current = new maplibregl.Marker({ element: routeFromEl(), anchor: "center" });
      routeFrom.current.getElement().dataset.site = r.fromSiteId;
      routeFrom.current.setLngLat(toMap(r.from[0], r.from[1])).addTo(map);
    } else {
      routeFrom.current?.remove();
      routeFrom.current = null;
    }
    const sel = lines.find((l) => l.selected && (l.to[0] !== r?.from[0] || l.to[1] !== r?.from[1]));
    if (sel) {
      if (!routeEnd.current) routeEnd.current = new maplibregl.Marker({ element: routeEndEl(), anchor: "center" });
      routeEnd.current.getElement().dataset.site = sel.siteId;
      routeEnd.current.setLngLat(toMap(sel.to[0], sel.to[1])).addTo(map);
    } else {
      routeEnd.current?.remove();
      routeEnd.current = null;
    }

    const keys = r ? `${r.fromSiteId}|${lines.map((l) => l.key).join(",")}` : "";
    if (!r || keys === fitKeys.current) {
      fitKeys.current = keys;
      return;
    }
    fitKeys.current = keys;
    const first = toMap(r.from[0], r.from[1]);
    const b = new maplibregl.LngLatBounds(first, first);
    for (const l of lines) b.extend(toMap(l.to[0], l.to[1]));
    const p = padding();
    map.fitBounds(b, {
      padding: { ...p, right: p.right + 60, top: p.top + 70, bottom: p.bottom + 40 },
      maxZoom: Math.max(map.getZoom(), 11.5),
      duration: reducedMotion() ? 0 : 900,
    });
  };
  // Bubbles never overlap: the selected one keeps its place, then the best, and so on in rank
  // order; the others move up (screen space). `fixed` (#204: the selected site name) is placed
  // first. Returns the screen boxes of the bubbles as laid out.
  const layoutCallouts = (map: maplibregl.Map, fixed: Rect[]): Rect[] => {
    const list = bubbles.current;
    if (list.length === 0) return [];
    // #397: the status strip and the site inset sit over the map; bubbles keep off them, and a
    // stack that would rise past the map top goes under its anchor. #437: the place card too.
    const o = map.getContainer().getBoundingClientRect();
    const rel = (r: DOMRect) => ({ l: r.left - o.left, r: r.right - o.left, t: r.top - o.top, b: r.bottom - o.top });
    const nav = map.getContainer().closest(".navigator");
    const over = [...(nav?.querySelectorAll(".status-strip, .inset-tile, .place-card") ?? [])]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0)
      .map(rel);
    // #437: a side card (right half of the map) is as tall as the map, so lifting cannot clear it;
    // a bubble that reaches under it slides left instead, at most until its leader hits its edge.
    const cardEl = nav?.querySelector(".place-card");
    const cardR = cardEl ? cardEl.getBoundingClientRect() : null;
    const cardL = cardR && cardR.width > 0 && cardR.left - o.left > o.width / 2 ? cardR.left - o.left - 5 : Infinity;
    const boxes = list.map((b) => {
      const p = map.project(b.at);
      const dx = Math.max(Math.min(0, cardL - (p.x + b.w / 2)), -(b.w / 2 - 6));
      return { x: p.x + dx, y: p.y - b.base, w: b.w, h: b.h, down: -(b.base + b.h + CALLOUT_BELOW), dx };
    });
    const order = list.map((_, i) => i).sort((a, b) => Number(list[b].sel) - Number(list[a].sel));
    const lift = declutter(boxes, order, 4, [...fixed, ...over], 0);
    return list.map((b, i) => {
      const below = b.base + lift[i] < 0;
      b.m.setOffset([boxes[i].dx, -(b.base + lift[i])]);
      b.m.getElement().style.setProperty("--shift", `${-boxes[i].dx}px`);
      b.m.getElement().classList.toggle("is-below", below);
      b.m.getElement().style.setProperty("--lead", `${below ? -(b.base + lift[i]) - b.h : b.base + lift[i]}px`);
      const { x, y, w, h } = boxes[i];
      return { l: x - w / 2, r: x + w / 2, t: y - lift[i] - h, b: y - lift[i] };
    });
  };
  const { routes } = props;
  useEffect(() => {
    drawRoutes();
  }, [routes]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fly to a requested point.
  const { focus } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus) return;
    const center = toMap(focus.lat, focus.lonE);
    const zoom = Math.max(map.getZoom(), 12);
    // Centre between the site list and the place card. An offset, not `padding`: MapLibre keeps
    // camera padding for later moves, and the next fit would be shifted.
    const p = padding();
    const right = window.innerWidth > 760 ? CARD_INSET : 0;
    const offset: [number, number] = [(p.left - right) / 2, (p.top - p.bottom) / 2];
    if (reducedMotion()) map.easeTo({ center, zoom, offset, duration: 0 });
    else map.flyTo({ center, zoom, offset, duration: 1400, curve: 1.3, essential: true });
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const { api } = props;
  useEffect(() => {
    if (!api) return;
    api.current = {
      zoomBy: (d) => {
        const map = mapRef.current;
        if (!map) return;
        const z0 = map.getZoom();
        const duration = reducedMotion() ? 0 : 260;
        map.easeTo({ zoom: z0 + d, duration });
        // #146: "zoom out" at the widest view returns to the globe.
        if (d < 0)
          setTimeout(() => {
            if (mapRef.current === map && z0 - map.getZoom() < 0.01) latest.current.onFarOut?.();
          }, duration + 120);
      },
      reset: () =>
        mapRef.current?.fitBounds(
          [
            [-EDGE_80, -EDGE_80],
            [EDGE_80, EDGE_80],
          ],
          { padding: padding(), duration: reducedMotion() ? 0 : 900 },
        ),
    };
    return () => {
      api.current = null;
    };
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section ref={section} className="nav-map" aria-label="Navigator map" data-ready="0">
      <div ref={host} className="nav-map-canvas" role="img" aria-label="Map of the lunar south pole" />
      <div className="nav-scale" aria-label="Scale">
        <div ref={scaleRef} className="nav-scale-bar" />
        <div ref={limitRef} className="nav-scale-note" hidden>
          240 m relief: zoom limited
        </div>
      </div>
    </section>
  );
});
