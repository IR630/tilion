// Own GeoJSON layers on the navigator map (#147, #148). They are appended on top (no beforeId) and
// survive a basemap swap: on every style change a missing source or layer is added again, and a
// raster layer that lands above them is passed (the layer moves to the top).
import type * as maplibregl from "maplibre-gl";

/** A line collection in map coordinates (the only GeoJSON these layers draw). */
export type LineFC = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: Record<string, string | number>; geometry: { type: "LineString"; coordinates: [number, number][] } }[];
};
export const EMPTY_FC: LineFC = { type: "FeatureCollection", features: [] };

/** A colour token from styles.css :root: the map paints with the HUD palette. */
export const tok = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Add the source and the layers when missing; move them above any raster drawn later.
 *  Not gated on isStyleLoaded(): it stays false while basemap tiles load, and a layer added in that
 *  time would never appear. Before the style JSON itself is loaded MapLibre throws: the next
 *  "styledata" event tries again. */
export function ensureLayers(map: maplibregl.Map, source: string, layers: maplibregl.LayerSpecification[], data: () => LineFC) {
  if (!map.style) return;
  try {
    if (!map.getSource(source)) map.addSource(source, { type: "geojson", data: data() });
    for (const l of layers) if (!map.getLayer(l.id)) map.addLayer(l);
    const order = map.getStyle().layers;
    const first = order.findIndex((l) => l.id === layers[0].id);
    if (first >= 0 && order.slice(first + 1).some((l) => l.type === "raster")) for (const l of layers) map.moveLayer(l.id);
  } catch {
    // Style not done loading: "styledata" calls again.
  }
}

export function removeLayers(map: maplibregl.Map, source: string, ids: string[]) {
  try {
    for (const id of ids) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(source)) map.removeSource(source);
  } catch {
    // The map is already removed.
  }
}
