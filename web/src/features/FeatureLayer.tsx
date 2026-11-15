// IAU feature names on the navigator map (#147): DOM labels (the style has no glyphs) for the
// features in view, biggest first, never overlapping. The selected feature also gets its
// gazetteer rim (centre + diameter) as a dashed ring. Recomputed on moveend only: no React render per frame.
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { Site } from "../contracts";
import { onMap, toMap } from "../navigator/geo";
import { type Box, chooseLabels, circleLatLon, diameterPx, type Feature } from "./features";
import { EMPTY_FC, ensureLayers, type LineFC, removeLayers, tok } from "./mapLayers";
import "./features.css";

const SRC = "iau-rings";
const RING_SEL = "iau-ring-sel";
const MIN_RING_PX = 10;

/** One label: a centre cross and the name in mono caps. Restyle here. */
function labelEl(f: Feature, onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "iau-label";
  el.dataset.feature = f.id;
  el.setAttribute("aria-label", `${f.name}, ${f.type}`);
  const cross = document.createElement("i");
  cross.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.textContent = f.name; // text node: never parsed as HTML
  el.append(cross, name);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

type Props = {
  map: maplibregl.Map | null;
  features: Feature[];
  selectedId: string | null;
  /** The selected site: its name moves the other site names, so the feature labels re-layout. */
  selectedSite?: string | null;
  sites: Site[];
  onPick: (f: Feature) => void;
};

export function FeatureLayer({ map, features, selectedId, selectedSite, sites, onPick }: Props) {
  const latest = useRef({ selectedId, sites, onPick });
  latest.current = { selectedId, sites, onPick };
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    if (!map || features.length === 0) return;
    const markers = new Map<string, maplibregl.Marker>();
    let rings: LineFC = EMPTY_FC;
    const layers: maplibregl.LayerSpecification[] = [
      {
        id: RING_SEL,
        type: "line",
        source: SRC,
        paint: { "line-color": tok("--fg", "white"), "line-width": 1.2, "line-dasharray": [3, 2] },
      },
    ];
    const ensure = () => ensureLayers(map, SRC, layers, () => rings);

    const update = () => {
      const { selectedId: sel, sites: ss } = latest.current;
      const zoom = map.getZoom();
      const c = map.getContainer();
      const project = (f: { lat: number; lonE: number }) => map.project(toMap(f.lat, f.lonE));
      // Site markers and the site names MapView placed are obstacles: the feature labels give way.
      const obstacles: Box[] = [];
      for (const s of ss) {
        if (!onMap(s)) continue;
        const p = project({ lat: s.lat as number, lonE: s.lonE as number });
        obstacles.push({ x: p.x, y: p.y, w: 18, h: 18 });
      }
      // #197: site names show at every zoom wherever they fit (#154), so read the placed boxes
      // (the selected name always among them) instead of guessing them from a zoom threshold.
      const cr = c.getBoundingClientRect();
      for (const el of c.querySelectorAll<HTMLElement>(".nav-marker.lbl-on .nav-marker-label, .nav-marker.is-selected .nav-marker-label")) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) obstacles.push({ x: r.left - cr.left + r.width / 2, y: r.top - cr.top + r.height / 2, w: r.width, h: r.height });
      }
      const chosen = chooseLabels(features, zoom, project, { w: c.clientWidth, h: c.clientHeight }, obstacles, sel);
      const keep = new Set(chosen.map((x) => x.f.id));
      for (const [id, m] of markers) {
        if (!keep.has(id)) {
          m.remove();
          markers.delete(id);
        }
      }
      for (const { f } of chosen) {
        let m = markers.get(f.id);
        if (!m) {
          m = new maplibregl.Marker({ element: labelEl(f, () => latest.current.onPick(f)), anchor: "top", offset: [0, -4] }).setLngLat(toMap(f.lat, f.lonE)).addTo(map);
          markers.set(f.id, m);
        }
        m.getElement().classList.toggle("is-selected", f.id === sel);
      }
      // Only the selected feature: its rim tells the planner where the named crater ends.
      const ringed = chosen.map((x) => x.f).filter((f) => f.id === sel && diameterPx(f.diameterKm, zoom) >= MIN_RING_PX && f.type !== "vallis");
      rings = {
        type: "FeatureCollection",
        features: ringed.map((f) => ({
          type: "Feature",
          properties: { id: f.id },
          geometry: { type: "LineString", coordinates: circleLatLon(f.lat, f.lonE, f.diameterKm / 2).map(([a, b]) => toMap(a, b)) },
        })),
      };
      ensure();
      (map.getSource(SRC) as maplibregl.GeoJSONSource | undefined)?.setData(rings);
    };
    redraw.current = update;

    map.on("moveend", update);
    map.on("resize", update);
    map.on("styledata", ensure);
    update(); // markers need no style; the rings come on the first idle if the style is still loading
    map.once("idle", update);
    return () => {
      redraw.current = () => {};
      map.off("moveend", update);
      map.off("resize", update);
      map.off("styledata", ensure);
      map.off("idle", update);
      for (const m of markers.values()) m.remove();
      markers.clear();
      removeLayers(map, SRC, [RING_SEL]);
    };
  }, [map, features]);

  // Selection or the site list changed: one re-layout, no camera move.
  useEffect(() => {
    redraw.current();
  }, [selectedId, selectedSite, sites]);

  return null;
}
