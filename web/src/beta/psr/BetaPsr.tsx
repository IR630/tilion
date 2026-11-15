// BETA nearest cold-trap candidate (#175). One mount in Navigator.tsx, behind BETA.psr.
// Draws the PGDA 69 never-lit patches on the map instance (hatched blue-grey, toggle chip on the
// map) and puts one line into the open place card (a slot after its facts list). Remove this
// folder and the mount line: nothing else refers to it.
import type * as maplibregl from "maplibre-gl";
import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Site } from "../../contracts";
import { toMap } from "../../navigator/geo";
import { gridNote, hatch, loadPsr, loadPsrPolygons, type PsrFile, psrLine, type PsrPolygons, type PsrSite } from "./psr";
import "./psr.css";

const SRC = "beta-psr";
const LINK = "beta-psr-link";
const IMG = "beta-psr-hatch";
const IDS = ["beta-psr-tint", "beta-psr-fill", "beta-psr-line", "beta-psr-sel", "beta-psr-link"];
const STORE = "tilion.beta.psr";
const BLUE_GREY = "#8fa3b8";
const NONE = "__none__";

function readOn(): boolean {
  try {
    return localStorage.getItem(STORE) === "on"; // off by default: the beta layer is not part of the task (#233)
  } catch {
    return false;
  }
}

function linkFc(site: Site | null, e: PsrSite | undefined) {
  const features =
    site && site.lat !== null && site.lonE !== null && e && e.distanceKm > 0
      ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [toMap(site.lat, site.lonE), toMap(e.nearest.lat, e.nearest.lonE)] } }]
      : [];
  return { type: "FeatureCollection" as const, features };
}

/** Add the image, sources and layers when missing (a basemap swap drops them); keep them on top. */
function ensure(map: maplibregl.Map, poly: PsrPolygons, link: () => ReturnType<typeof linkFc>, sel: () => string) {
  if (!map.style) return;
  try {
    if (!map.hasImage(IMG)) map.addImage(IMG, hatch());
    if (!map.getSource(SRC)) map.addSource(SRC, { type: "geojson", data: poly as unknown as maplibregl.GeoJSONSourceSpecification["data"] });
    if (!map.getSource(LINK)) map.addSource(LINK, { type: "geojson", data: link() });
    const layers: maplibregl.LayerSpecification[] = [
      { id: "beta-psr-tint", type: "fill", source: SRC, paint: { "fill-color": BLUE_GREY, "fill-opacity": 0.1 } },
      { id: "beta-psr-fill", type: "fill", source: SRC, paint: { "fill-pattern": IMG, "fill-opacity": 0.55 } },
      { id: "beta-psr-line", type: "line", source: SRC, paint: { "line-color": BLUE_GREY, "line-width": 0.6, "line-opacity": 0.65 } },
      { id: "beta-psr-sel", type: "line", source: SRC, filter: ["==", ["get", "id"], sel()], paint: { "line-color": "#d6e2ee", "line-width": 1.6 } },
      { id: "beta-psr-link", type: "line", source: LINK, paint: { "line-color": "#d6e2ee", "line-width": 1.2, "line-dasharray": [2, 2] } },
    ];
    for (const l of layers) if (!map.getLayer(l.id)) map.addLayer(l);
    const order = map.getStyle().layers;
    const first = order.findIndex((l) => l.id === IDS[0]);
    if (first >= 0 && order.slice(first + 1).some((l) => l.type === "raster")) for (const id of IDS) map.moveLayer(id);
  } catch {
    // Style not loaded yet: the next "styledata" calls again.
  }
}

function remove(map: maplibregl.Map) {
  try {
    for (const id of IDS) if (map.getLayer(id)) map.removeLayer(id);
    for (const s of [SRC, LINK]) if (map.getSource(s)) map.removeSource(s);
    if (map.hasImage(IMG)) map.removeImage(IMG);
  } catch {
    // The map is already removed.
  }
}

/** A slot element right after the place card's facts list, while the card shows this site. */
function useCardSlot(siteId: string | null): HTMLElement | null {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const facts = siteId ? document.querySelector('.place-card[aria-label="Place card"] .place-facts') : null;
    if (!facts) return setSlot(null);
    const el = document.createElement("div");
    el.className = "beta-psr-slot";
    facts.after(el);
    setSlot(el);
    return () => el.remove();
  }, [siteId]);
  return slot;
}

export function BetaPsr({ map, site }: { map: maplibregl.Map | null; site: Site | null }) {
  const [file, setFile] = useState<PsrFile | null | undefined>(undefined);
  const [on, setOn] = useState(readOn);
  const [poly, setPoly] = useState<PsrPolygons | null | undefined>(undefined); // null = failed
  const slot = useCardSlot(site?.id ?? null);
  const entry = site ? file?.sites[site.id] : undefined;

  useEffect(() => {
    let live = true;
    loadPsr().then((f) => live && setFile(f));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!map || !on || poly !== undefined) return;
    let live = true;
    loadPsrPolygons().then((g) => live && setPoly(g));
    return () => {
      live = false;
    };
  }, [map, on, poly]);

  const toggle = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(STORE, v ? "on" : "off");
    } catch {
      // Private mode: the choice lasts for this page only.
    }
  };

  // Patches on the map; the selected site's patch and the line to it follow the selection.
  const selId = entry?.patch ?? NONE;
  useEffect(() => {
    if (!map || !on || !poly) return;
    const link = () => linkFc(site, entry);
    const sel = () => selId;
    const up = () => ensure(map, poly, link, sel);
    up();
    try {
      (map.getSource(LINK) as maplibregl.GeoJSONSource | undefined)?.setData(link());
      if (map.getLayer("beta-psr-sel")) map.setFilter("beta-psr-sel", ["==", ["get", "id"], selId]);
    } catch {
      // Style not loaded: ensure() adds the current values on "styledata".
    }
    map.on("styledata", up);
    return () => {
      map.off("styledata", up);
    };
  }, [map, on, poly, site, entry, selId]);

  useEffect(() => {
    if (!map || on) return;
    remove(map);
  }, [map, on]);
  useEffect(() => () => void (map && remove(map)), [map]);

  const show = () => {
    toggle(true);
    if (!map || !site || site.lat === null || site.lonE === null || !entry) return;
    const pts = [toMap(site.lat, site.lonE), toMap(entry.nearest.lat, entry.nearest.lonE), toMap(entry.centroid.lat, entry.centroid.lonE)];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const narrow = window.innerWidth <= 760;
    map.fitBounds(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      { padding: narrow ? 40 : { top: 90, bottom: 90, left: 140, right: 420 }, maxZoom: 13, duration: 800 },
    );
  };

  const card = slot && site && site.lat !== null && site.lonE !== null && file !== undefined && (
    <section className="beta-psr-card" aria-label="Nearest cold-trap candidate">
      <p className="beta-psr-k">
        <span className="beta-tag">Beta</span> Nearest cold-trap candidate
      </p>
      {file === null ? (
        <p className="beta-psr-v" role="alert">Cold-trap data failed to load.</p>
      ) : entry ? (
        <>
          <p className="beta-psr-v">
            <span data-testid="psr-line">{psrLine(entry)}</span>
            <button type="button" onClick={show} disabled={!map} title={map ? "Show the patch and the path to it on the map" : "Open the south pole map first"}>
              Show on map
            </button>
          </p>
          <p className="beta-psr-src">
            {file.label}. {gridNote(entry, file)}. Distance to the nearest never-lit pixel. Not detected ice.
          </p>
        </>
      ) : (
        <p className="beta-psr-src">
          {site.lat <= -65 ? "Precomputed for the listed sites only: no value for this point yet." : "Outside the PGDA 69 polar maps (65–90°S): no data."}
        </p>
      )}
    </section>
  );

  return (
    <>
      {map && (
        <div className="beta-psr-chip" role="group" aria-label="Cold-trap candidates layer">
          <span className="beta-tag">Beta</span>
          <button type="button" aria-pressed={on} onClick={() => toggle(!on)} title={file?.definition ?? "PGDA 69: never lit in 18.6 years"}>
            <i className="beta-psr-swatch" aria-hidden="true" />
            Cold-trap candidates
            <span className="beta-psr-state">{!on ? "Off" : poly ? "On" : poly === null ? "Failed to load" : "Loading"}</span>
          </button>
        </div>
      )}
      {card && createPortal(card, slot)}
    </>
  );
}
