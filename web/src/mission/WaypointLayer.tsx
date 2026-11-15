// Mission waypoints on the navigator map (#148): a diamond per waypoint and a label
// "WP1: SHACKLETON, 12.4 KM". The traverse (#160) is one great-circle line per leg, landing site →
// WP1 → WP2 …, coloured by comms on that leg (Earth in view during the hours the rover drives it).
// Imperative: markers update when the waypoints change, never per frame.
import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import { EMPTY_FC, ensureLayers, type LineFC, removeLayers, tok } from "../features/mapLayers";
import { greatCircle, toMap } from "../navigator/geo";
import type { Level } from "./traverse";
import type { Waypoint } from "./types";
import { waypointLabel } from "./waypoints";
import "./waypoints.css";

const SRC = "wp-lines";
const LINE = "wp-line";
const lineLayers = (): maplibregl.LayerSpecification[] => [
  {
    id: LINE,
    type: "line",
    source: SRC,
    paint: {
      "line-color": [
        "match",
        ["get", "level"],
        "good",
        tok("--earth", "#4a90e2"),
        "partial",
        tok("--warn", "#c9a45a"),
        "poor",
        tok("--bad", "#ff5a1f"),
        tok("--muted", "#8a8c8f"),
      ],
      "line-width": 2.5,
      "line-opacity": 0.9,
    },
  },
];

/** One waypoint marker. Marker styling lives here and in waypoints.css only. */
function markerEl(onClick: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "wp-marker";
  el.setAttribute("data-testid", "waypoint-marker");
  const dia = document.createElement("i");
  dia.className = "wp-diamond";
  dia.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.className = "wp-label";
  el.append(dia, label);
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onClick();
  });
  return el;
}

type Props = {
  map: maplibregl.Map | null;
  /** Landing site [lat, lonE]; null = no line and no distance. */
  from: [number, number] | null;
  waypoints: Waypoint[];
  /** Comms level per leg (leg i ends at waypoint i); missing = pending. */
  levels?: Level[];
  onPick: (i: number) => void;
};

export function WaypointLayer({ map, from, waypoints, levels, onPick }: Props) {
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const state = useRef<{ markers: maplibregl.Marker[]; data: LineFC }>({ markers: [], data: EMPTY_FC });

  // Layers: once per map; re-added after a style or basemap swap.
  useEffect(() => {
    if (!map) return;
    const ensure = () => ensureLayers(map, SRC, lineLayers(), () => state.current.data);
    ensure();
    map.on("styledata", ensure);
    map.once("idle", ensure);
    const s = state.current;
    return () => {
      map.off("styledata", ensure);
      map.off("idle", ensure);
      for (const m of s.markers) m.remove();
      s.markers = [];
      removeLayers(map, SRC, [LINE]);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const s = state.current;
    while (s.markers.length > waypoints.length) s.markers.pop()?.remove();
    waypoints.forEach((w, i) => {
      let m = s.markers[i];
      if (!m) {
        m = new maplibregl.Marker({ element: markerEl(() => onPickRef.current(i)), anchor: "center" });
        s.markers[i] = m;
      }
      const el = m.getElement();
      const text = waypointLabel(i, w, from);
      el.dataset.index = String(i);
      el.setAttribute("aria-label", text);
      (el.querySelector(".wp-label") as HTMLElement).textContent = text;
      m.setLngLat(toMap(w.lat, w.lonE)).addTo(map);
    });
    s.data = from
      ? {
          type: "FeatureCollection",
          features: waypoints.map((w, i) => {
            const a: [number, number] = i === 0 ? from : [waypoints[i - 1].lat, waypoints[i - 1].lonE];
            return {
              type: "Feature",
              properties: { i, level: levels?.[i] ?? "pending" },
              geometry: { type: "LineString", coordinates: greatCircle(a, [w.lat, w.lonE], 24).map(([x, y]) => toMap(x, y)) },
            };
          }),
        }
      : EMPTY_FC;
    // The source may be missing yet (style still loading): ensureLayers adds it with s.data.
    const src = map.getSource(SRC) as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(s.data);
    else ensureLayers(map, SRC, lineLayers(), () => s.data);
  }, [map, from, waypoints, levels]);

  return null;
}
