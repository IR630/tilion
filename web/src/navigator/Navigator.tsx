// The navigator (#36, #72): the map is the app. Floating search pill (or the route header while a
// plan is open) and a left panel below it (site list or mission route), the place card on the
// right, map controls bottom-right. Only the panels read the shared moment; the map never
// re-renders on a time change.
import type { Map as MapLibreMap } from "maplibre-gl";
import { type Dispatch, lazy, type ReactNode, type SetStateAction, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadFullTimeline, loadValidation } from "../api";
import type { Site, Timeline, ValidationFile } from "../contracts";
import type { Conditions } from "../landing";
import { CLEARANCE_TIP, DATA_PERIOD, fmtClearance, fmtLatLon, fmtShare, sharePeriod } from "../format";
import { useMask } from "../useMask";
import { onShare, stepIndex } from "../summary";
import { planLatLon, RouteHeader, RoutePanel } from "../mission/RoutePanel";
import { calloutText, routeKey } from "../mission/routeMap";
import { selectOption } from "../mission/plan";
import type { MissionState } from "../mission/types";
import { useRoutes } from "../mission/useRoutes";
import { useTraverse } from "../mission/useTraverse";
import { scoreOf } from "../route/score";
import { tieDeciders } from "../route/route";
import { NasaLinks } from "../NasaLinks";
import { siteEvidence, verdictRow } from "./SiteEvidence";
import { BETA } from "../beta/flags";
import { BetaPsr } from "../beta/psr/BetaPsr";
import { FeatureCard } from "../features/FeatureCard";
import { type Feature, loadFeatures, searchFeatures } from "../features/features";
import { addWaypoint, MAX_WAYPOINTS } from "../mission/waypoints";
import { customSite } from "../screens/PolarMap";
import { NearbyRow, useNearby } from "../mission/NearbySpot";
import type { Nearby } from "../mission/nearby";
import { Icon } from "../ui/icons";
import { SlideMark } from "../ui/Slide";
import { Countdown } from "./Countdown";
import { StatusStrip } from "./StatusStrip";
import { SiteStationLinks } from "../beta/dsnStations/SiteStationLinks";
import { NextWindows } from "../timeline/NextWindows";
import { type BasemapMeta, liveState, matches, onMap, parseLatLon, rampCss, type RampStop } from "./geo";
import type { Focus, MapApi, MapRoutes, Overlay } from "./MapView";
import "./navigator.css";
import { GEO_CAVEAT, Info } from "../ui/Info";
import { UncertaintyLine } from "../beta/uncertainty/UncertaintyLine";
import { SetSpread } from "../beta/uncertainty/SetSpread";
import { SiteEvidenceBlock } from "./SiteEvidence";
import { SphereComparison } from "./SphereComparison";
import { downloadCsv } from "../timeline/csv";
import { SlipTable } from "../timeline/SlipTable";
import { sunVector } from "./shadows";
import { LOOKBACK_H, PAINT_MAX_K, PAINT_MIN_K, snapBack } from "../beta/thermal/mapThermal";
import { rampCss as thermalRampCss } from "../beta/thermal/globeThermal";
import { BetaTag } from "../beta/BetaTag";

// MapLibre is the heaviest chunk: it loads on the first switch from the globe to the map (#72),
// prefetched when the browser is idle.
const loadMap = () => import("./MapView").then((m) => ({ default: m.MapView }));
const MapView = lazy(loadMap);
const InsetLayer = lazy(() => import("./InsetLayer").then((m) => ({ default: m.InsetLayer })));
// IAU names (#147) and mission waypoints (#148) draw on the map instance: they load with MapLibre.
const FeatureLayer = lazy(() => import("../features/FeatureLayer").then((m) => ({ default: m.FeatureLayer })));
const WaypointLayer = lazy(() => import("../mission/WaypointLayer").then((m) => ({ default: m.WaypointLayer })));

/** #197: the source names in plain words. */
const PGDA_TIP =
  "PGDA product 69 (NASA Goddard Planetary Geodesy Data Archive): share of time any part of the Sun and of the Earth is in view over 18.6 years, from LOLA terrain (Mazarico et al. 2011).";
const ATTRIB_TIP =
  "Polar stereographic projection. LOLA: NASA laser-altimeter terrain. PGDA 69: NASA long-term illumination maps. SPICE DE440: JPL ephemeris. Coordinates: IAU Moon mean-Earth frame (MOON_ME), longitude 0–360° east.";

export const GROUPS: [Site["group"], string][] = [
  ["ridge", "Illuminated ridges"],
  ["artemis", "Artemis III candidate regions"],
  ["clps", "CLPS & commercial"],
  ["international", "Other national programs"],
  ["historic", "Historic landings"],
];
const GROUP_LABEL = Object.fromEntries(GROUPS) as Record<Site["group"], string>;
const TERRAIN: Record<Site["terrain"], string> = {
  polar80: "LOLA 20 m within 5 km + 80 m + 240 m polar DEM (NASA laser-altimeter elevation map)",
  polar240: "LOLA 240 m polar DEM (NASA laser-altimeter elevation map)",
  none: "Smooth sphere (no terrain)",
};
const OVERLAYS: [Overlay, string, string][] = [
  ["relief", "Relief", "LOLA shaded relief, 240 m to 5 m by zoom"],
  ["photo", "Photo", "LROC WAC mosaic, 100 m"],
  ["sun", "Sunlight", "Mean sunlight, 18.6 y (PGDA 69)"],
  ["earth", "Earth view", "Mean Earth visibility, 18.6 y (PGDA 69)"],
  ["shadow", "Shadows now", "Terrain shadows at this hour, ±32 km of the pole"],
  ...(BETA.thermal ? [["thermal", "Thermal now", "Regolith temperature at this hour, ±32 km of the pole"] as [Overlay, string, string]] : []),
];
// Fallback legend ramps (the basemap meta.json carries the real ones).
const RAMP: Record<"sun" | "earth", RampStop[]> = {
  sun: [
    [0, [20, 16, 10]],
    [0.3, [120, 70, 10]],
    [0.6, [242, 182, 50]],
    [1, [255, 245, 200]],
  ],
  earth: [
    [0, [8, 14, 30]],
    [0.3, [20, 60, 140]],
    [0.6, [78, 161, 255]],
    [1, [215, 240, 255]],
  ],
};
/** Rail + gap + left panel, px: the camera keeps targets clear of it. */
const RAIL_W = 64;
const COL_W = 420;

export type Panel = "sites" | "mission";

type Props = {
  sites: Site[];
  atUtc: string;
  onAtUtc: (utc: string) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** The left panel under the search pill; null = folded. */
  panel: Panel | null;
  onPanel: (p: Panel | null) => void;
  onOpenHorizon: (id: string) => void;
  onOpenView: (id: string) => void;
  /** Base view: the globe (the map is hidden) or the map. */
  mode: "globe" | "map";
  /** Mount the map (after the first switch). */
  mapOn: boolean;
  /** A switch to the map, centred on a site or the default view. */
  entry: { siteId: string | null; n: number };
  onGlobe: () => void;
  onEnterMap: (siteId: string | null) => void;
  onCompare: (id: string) => void;
  onAddCustom: (s: Site) => void;
  /** The site the app shows as current (the place card, else the globe's first pick): "Plan a
   *  mission" starts there (#195). */
  currentSiteId?: string | null;
  /** Called by "Plan mission from here". */
  onPlanFrom: (id: string) => void;
  /** The mission plan (#57): the route panel edits it, the map draws its options. */
  mission: MissionState;
  onMission: Dispatch<SetStateAction<MissionState>>;
  /** #210: the Windows panel's mission limits; the plan card shows its verdict with them. */
  limits?: Conditions;
  /** The left column slot under the search pill (#158): shown while no Sites / Mission panel is
   *  open. The mission calendar (#159) mounts here. */
  left?: ReactNode;
};

export function Navigator(p: Props) {
  const { sites, selected, onSelect, panel, onPanel, onMission } = p;
  const [query, setQuery] = useState("");
  const [overlay, setOverlay] = useState<Overlay>("relief");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [pin, setPin] = useState<[number, number] | null>(null);
  const [meta, setMeta] = useState<BasemapMeta | null | undefined>(undefined);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const mapApi = useRef<MapApi | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [feature, setFeature] = useState<Feature | null>(null);
  const [wpMode, setWpMode] = useState(false);
  const [vf, setVf] = useState<ValidationFile | null>(null);
  useEffect(() => {
    loadValidation().then(setVf);
  }, []);

  const located = useMemo(() => sites.filter((s) => s.lat !== null && s.lonE !== null), [sites]);
  // #288: the Sun direction for "Shadows now" comes from the timeline of the terrain site nearest the pole.
  const [shadowProblem, setShadowProblem] = useState<string | null>(null);
  const sunRef = useMemo(() => [...located].filter((s) => s.terrain !== "none").sort((a, b) => a.lat! - b.lat!)[0], [located]);
  const [sunTl, setSunTl] = useState<Timeline | null>(null);
  useEffect(() => {
    if ((overlay !== "shadow" && overlay !== "thermal") || !sunRef || sunTl) return;
    loadFullTimeline(sunRef).then(setSunTl, (e) => setShadowProblem(`Sun timeline failed to load: ${String(e)}`));
  }, [overlay, sunRef, sunTl]);
  const shadowSun = useMemo(() => {
    if (!sunTl || !sunRef) return null;
    const k = stepIndex(sunTl, p.atUtc);
    if (!(k >= 0 && k < sunTl.sunAz.length)) return null;
    return sunVector(sunRef.lat!, sunRef.lonE!, sunTl.sunAz[k], sunTl.sunEl[k]);
  }, [sunTl, sunRef, p.atUtc]);
  // #325: the thermal layer also needs the Sun of earlier hours (growing stride, up to 720 h) from the same timeline.
  const thermalSun = useMemo(() => {
    if (overlay !== "thermal" || !shadowSun || !sunTl || !sunRef) return null;
    const k = stepIndex(sunTl, p.atUtc);
    const perH = 60 / sunTl.stepMin;
    const back = LOOKBACK_H.map((h) => snapBack(k, Math.round(h * perH)))
      .filter((s) => k - s >= 0)
      .map((s) => ({ h: s / perH, sun: sunVector(sunRef.lat!, sunRef.lonE!, sunTl.sunAz[k - s], sunTl.sunEl[k - s]) }));
    return { now: shadowSun, back };
  }, [overlay, shadowSun, sunTl, sunRef, p.atUtc]);
  const byId = useMemo(() => new Map(located.map((s) => [s.id, s])), [located]);
  const nameOf = useCallback((id: string) => byId.get(id)?.name ?? id, [byId]);
  const { plan, selected: option } = p.mission;
  const routes = useRoutes(located, plan);
  const { result } = routes;

  // IAU features (#147): loaded with the map or on the first search.
  const wantFeatures = p.mapOn || query.trim() !== "";
  useEffect(() => {
    if (!wantFeatures || features.length) return;
    let live = true;
    loadFeatures().then((f) => live && f && setFeatures(f.features));
    return () => {
      live = false;
    };
  }, [wantFeatures, features.length]);
  const featureHits = useMemo(() => searchFeatures(features, query), [features, query]);

  // Waypoints (#148) of the current plan, measured from its landing site.
  const waypoints = plan?.waypoints ?? [];
  const planSite = plan ? byId.get(plan.siteId) : undefined;
  const fromLat = planSite?.lat ?? null;
  const fromLon = planSite?.lonE ?? null;
  const wpFrom = useMemo<[number, number] | null>(() => planLatLon(planSite), [fromLat, fromLon]); // eslint-disable-line react-hooks/exhaustive-deps
  // Traverse (#160): landing site → WP1 → … with comms per leg.
  const traverse = useTraverse(planSite, plan?.landingUtc, waypoints);
  const levelKey = traverse.traverse?.legs.map((l) => l.level).join() ?? "";
  const legLevels = useMemo(() => traverse.traverse?.legs.map((l) => l.level), [levelKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasPlan = !!plan;
  useEffect(() => {
    if (!hasPlan) setWpMode(false);
  }, [hasPlan]);
  useEffect(() => {
    if (!wpMode) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setWpMode(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [wpMode]);
  // #207: add mode stays on after each map click (WP1, WP2, …) until Esc, Done or the last free slot.
  // A card's "Add as waypoint" adds one point and ends the mode.
  const addPoint = useCallback(
    (name: string, lat: number, lonE: number, keepMode = false) => {
      onMission((m) => addWaypoint(m, { name, lat, lonE }));
      if (!keepMode || waypoints.length + 1 >= MAX_WAYPOINTS) setWpMode(false);
      onPanel("mission");
    },
    [onMission, onPanel, waypoints.length],
  );
  // #195: in add mode a site marker adds that site as the next waypoint (not opens its card).
  const addSite = useCallback(
    (id: string) => {
      const s = byId.get(id);
      if (s) addPoint(s.name, s.lat as number, s.lonE as number, true);
    },
    [byId, addPoint],
  );
  // #210: "Add waypoint" on the globe switches to the polar map (the usual cross-fade), centred on
  // the plan site: waypoints are placed on the map only.
  const { onEnterMap, mode: baseView } = p;
  const setAddMode = useCallback(
    (on: boolean) => {
      setWpMode(on);
      if (on && baseView === "globe") onEnterMap(planSite && onMap(planSite) ? planSite.id : null);
    },
    [baseView, onEnterMap, planSite],
  );
  const isWaypoint = (lat: number | null, lonE: number | null) =>
    lat !== null && lonE !== null && waypoints.some((w) => Math.abs(w.lat - lat) < 1e-4 && Math.abs(w.lonE - lonE) < 1e-4);

  // Route options on the map: every option a line from the plan site, with a bubble.
  const planSiteId = plan?.siteId;
  const rankMode = plan?.mode ?? "balanced";
  const selKey = option ? routeKey(option) : null;
  const mapRoutes = useMemo<MapRoutes | null>(() => {
    const a = planSiteId ? byId.get(planSiteId) : undefined;
    if (!a || !onMap(a) || !result) return null;
    const deciders = tieDeciders(result.options, rankMode); // #204: what ranks a tied score
    const lines = result.options.flatMap((o, i) => {
      const b = byId.get(o.siteId);
      if (!b || !onMap(b)) return [];
      // Route score (#160), #195; rank and the tie-breaker (#204).
      const { rank, metric, slip, tie } = calloutText(scoreOf(o, rankMode).total, o.slipDays, i + 1, deciders[i], o.distanceKm);
      return [
        {
          key: routeKey(o),
          siteId: o.siteId,
          to: [b.lat, b.lonE] as [number, number],
          rank,
          metric,
          slip,
          tie,
          aria: `Option ${i + 1}: ${b.name}, ${metric}, ${slip}${tie ? `; ${tie}` : ""}`,
          selected: routeKey(o) === selKey,
        },
      ];
    });
    return { from: [a.lat as number, a.lonE as number], fromSiteId: a.id, lines };
  }, [planSiteId, rankMode, result, selKey, byId]);

  const pickRoute = useCallback(
    (key: string) => {
      const o = result?.options.find((x) => routeKey(x) === key);
      if (!o) return;
      onMission((m) => selectOption(m, o));
      onPanel("mission");
    },
    [result, onMission, onPanel],
  );

  const site = located.find((s) => s.id === selected) ?? null;
  const nearby = useNearby(site);
  const brighter = nearby && !(nearby instanceof Error) ? nearby.spot : null;
  const choose = useCallback(
    (id: string) => {
      setPin(null);
      setFeature(null);
      onSelect(id);
    },
    [onSelect],
  );
  const pick = useCallback(
    (lat: number, lonE: number) => {
      if (wpMode) {
        addPoint("", lat, lonE, true);
        return;
      }
      onSelect(null);
      setFeature(null);
      setPin([lat, lonE]);
    },
    [onSelect, wpMode, addPoint],
  );
  // A feature label on the map or a search result: open its card; in add mode, add it.
  const pickFeature = useCallback(
    (f: Feature) => {
      if (wpMode) {
        addPoint(f.name, f.lat, f.lonE, true);
        return;
      }
      onSelect(null);
      setPin(null);
      setFeature(f);
    },
    [onSelect, wpMode, addPoint],
  );
  const flyToFeature = (f: Feature) => {
    pickFeature(f);
    if (p.mode === "globe") p.onEnterMap(null);
    setFocus((x) => ({ lat: f.lat, lonE: f.lonE, n: (x?.n ?? 0) + 1 }));
  };
  // Typed "lat, lon": drop a pin there, as a map click does (#232).
  const flyToPoint = (lat: number, lonE: number) => {
    pick(lat, lonE);
    if (p.mode === "globe") p.onEnterMap(null);
    setFocus((x) => ({ lat, lonE, n: (x?.n ?? 0) + 1 }));
  };
  const focusOn = useCallback((s: Site) => {
    if (onMap(s)) setFocus((f) => ({ lat: s.lat as number, lonE: s.lonE as number, n: (f?.n ?? 0) + 1 }));
  }, []);
  const flyTo = (s: Site) => {
    choose(s.id);
    // On the globe a polar site opens the map there; the map flies on its own.
    if (p.mode === "globe" && onMap(s)) p.onEnterMap(s.id);
    else focusOn(s);
  };
  const { entry, mode } = p;
  useEffect(() => {
    const s = entry.siteId ? byId.get(entry.siteId) : undefined;
    if (s) focusOn(s);
  }, [entry.n]); // eslint-disable-line react-hooks/exhaustive-deps
  // Idle prefetch of the map chunk while the globe is up.
  useEffect(() => {
    if (mode !== "globe") return;
    // The globe renders every frame, so a plain idle callback may never come: cap the wait.
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const id = w.requestIdleCallback ? w.requestIdleCallback(() => void loadMap(), { timeout: 1500 }) : window.setTimeout(() => void loadMap(), 1500);
    return () => {
      (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
      clearTimeout(id);
    };
  }, [mode]);

  const groups = GROUPS.map(([g, label]) => ({
    g,
    label,
    // Sites that pass the PGDA 69 check come first, then sites without a verdict, then failing ones (stable sort).
    items: located
      .filter((s) => s.group === g && !s.id.startsWith("custom-") && matches(s, query, label))
      .sort((a, b) => checkRank(vf, a.id) - checkRank(vf, b.id)),
  })).filter((x) => x.items.length > 0);
  const found = groups.reduce((n, x) => n + x.items.length, 0);

  // A pick from typed search results closes the list (it covered the map and the inset); the query stays
  // in the pill. The list opened from the rail with no query stays open for browsing.
  const fromSearch = (go: () => void) => {
    go();
    if (query.trim() && !plan) onPanel(null);
  };

  const search = (
    <label className={plan ? "panel-search" : "pill-search"}>
      <Icon name="search" size={17} />
      <input
        type="search"
        placeholder="Search sites, craters or lat, lon"
        aria-label="Search sites"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onPanel("sites");
        }}
        onKeyDown={(e) => {
          const ll = e.key === "Enter" ? parseLatLon(query) : null;
          if (ll) flyToPoint(ll[0], ll[1]);
          else if (e.key === "Enter" && groups[0]) fromSearch(() => flyTo(groups[0].items[0]));
          else if (e.key === "Enter" && featureHits[0]) fromSearch(() => flyToFeature(featureHits[0]));
          if (e.key === "Escape") setQuery("");
        }}
      />
      {query && (
        <button type="button" className="pill-clear" aria-label="Clear search" onClick={() => setQuery("")}>
          <Icon name="close" size={15} />
        </button>
      )}
    </label>
  );

  return (
    <div className={`navigator is-${mode}${site || feature ? " has-card" : ""}${wpMode ? " is-wp-mode" : ""}`}>
      <div className="vp-frame" aria-hidden="true" />
      <HudCorners atUtc={p.atUtc} />
      {site && <StatusStrip site={site} atUtc={p.atUtc} />}
      {p.mapOn && (
        <Suspense fallback={null}>
        <MapView
          sites={located}
          selected={selected}
          pin={pin ?? (brighter ? [brighter.lat, brighter.lonE] : null)}
          overlay={overlay}
          focus={focus}
          routes={mapRoutes}
          leftInset={RAIL_W + (panel || p.left ? COL_W + 16 : 0)}
          api={mapApi}
          onSelect={wpMode ? addSite : choose}
          onPick={pick}
          onMeta={setMeta}
          onMapInstance={setMap}
          onRoute={wpMode ? undefined : pickRoute}
          onFarOut={p.onGlobe}
          shadowSun={overlay === "shadow" ? shadowSun : null}
          onShadow={setShadowProblem}
          thermalSun={thermalSun}
        />
        </Suspense>
      )}

      {p.mapOn && (
        <Suspense fallback={null}>
          <FeatureLayer map={map} features={features} selectedId={feature?.id ?? null} selectedSite={selected} sites={located} onPick={pickFeature} />
          <WaypointLayer map={map} from={wpFrom} waypoints={waypoints} levels={legLevels} onPick={() => onPanel("mission")} />
        </Suspense>
      )}
      {wpMode && mode === "map" && (
        <div className="wp-banner" role="status">
          <span>Click the map to place WP{waypoints.length + 1}. Press Esc to finish.</span>
          <button type="button" onClick={() => setWpMode(false)}>
            Done
          </button>
        </div>
      )}

      {site && onMap(site) && p.mapOn && mode === "map" && (
        <Suspense fallback={null}>
          <InsetLayer map={map} site={site} layout={panel ?? ""} />
        </Suspense>
      )}

      <div className={`lcol${panel || p.left ? " is-open" : ""}${panel === "sites" ? " has-list" : ""}`}>
        {plan ? (
          <div className="pill pill-route">
            <RouteHeader routes={routes} mission={p.mission} onMission={onMission} nameOf={nameOf} />
          </div>
        ) : (
          <div className="pill">{search}</div>
        )}

        {panel === "sites" && (
          <aside className="lpanel" aria-label="Sites">
            <div className="lpanel-head">
              <h2>Landing sites</h2>
              <span className="lpanel-count">{found}</span>
            </div>
            {plan && search}
            <div className="nav-list" role="list" aria-label="Site list">
              {groups.map(({ g, label, items }) => (
                <section key={g} className="nav-group" aria-label={label}>
                  <h3>
                    <span>{label}</span>
                    <span className="nav-count">{items.length}</span>
                  </h3>
                  {items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      role="listitem"
                      className={`nav-item${s.id === selected ? " is-selected" : ""}`}
                      onClick={() => fromSearch(() => flyTo(s))}
                    >
                      <i className={`nav-dot g-${s.group}`} aria-hidden="true" />
                      <span className="nav-item-text">
                        <span className="nav-item-name">{s.name}</span>
                        <span className="nav-item-sub">{onMap(s) ? fmtLatLon(s.lat, s.lonE) : "Outside the polar map"}</span>
                      </span>
                      {vf && <ListCheck f={vf} siteId={s.id} />}
                    </button>
                  ))}
                </section>
              ))}
              {featureHits.length > 0 && (
                <section className="nav-group" aria-label="Craters & features">
                  <h3>
                    <span>Craters &amp; features</span>
                    <span className="nav-count">{featureHits.length}</span>
                  </h3>
                  {featureHits.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      role="listitem"
                      className={`nav-item${f.id === feature?.id ? " is-selected" : ""}`}
                      onClick={() => fromSearch(() => flyToFeature(f))}
                    >
                      <i className="nav-dot feature-dot" aria-hidden="true" />
                      <span className="nav-item-text">
                        <span className="nav-item-name">{f.name}</span>
                        <span className="nav-item-sub">
                          {f.type}, {f.diameterKm >= 10 ? Math.round(f.diameterKm) : f.diameterKm.toFixed(1)} km, {fmtLatLon(f.lat, f.lonE)}
                        </span>
                      </span>
                    </button>
                  ))}
                </section>
              )}
              {found === 0 && featureHits.length === 0 && (
                <p className="nav-empty">
                  {parseLatLon(query) ? "Press Enter to drop a pin at these coordinates." : `No sites or features match “${query}”.`}
                </p>
              )}
            </div>
          </aside>
        )}

        {panel === "mission" && (
          <aside className="lpanel lpanel-mission" aria-label="Mission">
            <RoutePanel
              sites={located}
              routes={routes}
              mission={p.mission}
              onMission={onMission}
              atUtc={p.atUtc}
              onAtUtc={p.onAtUtc}
              selectedSiteId={selected ?? p.currentSiteId ?? null}
              onOpenHorizon={p.onOpenHorizon}
              onOpenView={p.onOpenView}
              waypointMode={wpMode}
              onWaypointMode={setAddMode}
              traverse={traverse}
              limits={p.limits}
            />
          </aside>
        )}

        {!panel && p.left && <div className="lslot">{p.left}</div>}
      </div>

      {site && (
        <PlaceCard
          site={site}
          nearby={nearby}
          onAddCustom={(s) => { p.onAddCustom(s); onSelect(s.id); p.onOpenHorizon(s.id); }}
          atUtc={p.atUtc}
          onChange={p.onAtUtc}
          onClose={() => onSelect(null)}
          onOpenHorizon={p.onOpenHorizon}
          onOpenView={p.onOpenView}
          onCompare={p.onCompare}
          onPlanFrom={p.onPlanFrom}
          onAddWaypoint={plan && site.lat !== null && site.lonE !== null ? () => addPoint(site.name, site.lat as number, site.lonE as number) : null}
          waypointAdded={isWaypoint(site.lat, site.lonE)}
        />
      )}
      {BETA.psr && <BetaPsr map={map} site={site} />}
      {feature && !site && !pin && (
        <FeatureCard
          feature={feature}
          onAddWaypoint={plan ? () => addPoint(feature.name, feature.lat, feature.lonE) : null}
          added={isWaypoint(feature.lat, feature.lonE)}
          onClose={() => setFeature(null)}
        />
      )}
      {pin && !site && (
        <PinCard
          pin={pin}
          onClose={() => setPin(null)}
          onAdd={() => {
            p.onAddCustom(customSite(pin[0], pin[1]));
            setPin(null);
          }}
        />
      )}

      <MapControls mode={mode} overlay={overlay} onOverlay={setOverlay} meta={meta} api={mapApi} onGlobe={p.onGlobe} onMap={() => p.onEnterMap(null)} shadowProblem={shadowProblem} />

      {meta === null && (
        <p className="nav-note" role="note">
          Basemap images are not generated yet: grid only.
        </p>
      )}
      <p className="nav-attrib" title={ATTRIB_TIP}>
        South pole map: LOLA terrain, PGDA 69 light maps, SPICE DE440. Longitude 0–360° E
      </p>
    </div>
  );
}

type SubPoints = { startUtc: string; stepMin: number; n: number; sunLat: number[]; sunLonE: number[]; earthLat: number[]; earthLonE: number[] };
let subCache: Promise<SubPoints | null> | null = null;
/** Sub-solar and sub-Earth points (SPICE, hourly), the same file the globe reads. */
/** List order key: 0 = PGDA 69 pass, 1 = no verdict, 2 = fail. */
function checkRank(f: ValidationFile | null, siteId: string): number {
  const r = f ? verdictRow(siteEvidence(f, siteId)) : null;
  return !r || r.pass === null ? 1 : r.pass ? 0 : 2;
}

/** #305, #311: the site's PGDA 69 sunlight verdict in the site list, on the map's DEM when that row exists; nothing when the site has no such row. */
function ListCheck({ f, siteId }: { f: ValidationFile; siteId: string }) {
  const r = verdictRow(siteEvidence(f, siteId));
  if (!r || r.pass === null) return null;
  const off = r.diff === null ? "" : ` ${Math.abs(r.diff).toFixed(0)} pp`;
  return (
    <span className={`nav-chk ${r.pass ? "pass" : "fail"}`} title={`Sunlight vs NASA PGDA 69: ${r.pass ? "pass" : "fail"},${off} off, tolerance ±${r.tolerance ?? "—"} pp`}>
      {r.pass ? "PGDA ✓" : `PGDA ✗${off}`}
    </span>
  );
}

function useSubPoints(): SubPoints | null {
  const [d, setD] = useState<SubPoints | null>(null);
  useEffect(() => {
    let live = true;
    subCache ??= fetch(`${import.meta.env.BASE_URL}data/globe/subpoints.json`, { signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? (r.json() as Promise<SubPoints>) : null))
      .catch(() => null);
    subCache.then((x) => {
      if (!x) {
        subCache = null;
        console.error("subpoints.json failed to load");
      }
      if (live) setD(x);
    });
    return () => {
      live = false;
    };
  }, []);
  return d;
}
const ll = (lat: number, lonE: number) => `${Math.abs(lat).toFixed(2)}°${lat < 0 ? "S" : "N"} ${lonE.toFixed(2)}°E`;

/** Sub-solar and sub-Earth points under the map (bottom left): the direction the light and the
 *  Earth come from on the polar map. The date, projection and site live in the time strip,
 *  the attribution line and the place card (#155). */
function HudCorners({ atUtc }: { atUtc: string }) {
  const sp = useSubPoints();
  const i = sp ? Math.round((Date.parse(atUtc) - Date.parse(sp.startUtc)) / (sp.stepMin * 60000)) : -1;
  if (!sp || !(i >= 0 && i < sp.n)) return null;
  return (
    <p className="hud-corner hud-bl" aria-hidden="true">
      <span className="sun">Sun overhead</span> {ll(sp.sunLat[i], sp.sunLonE[i])}
      {"\n"}
      <span className="earth">Earth overhead</span> {ll(sp.earthLat[i], sp.earthLonE[i])}
    </p>
  );
}

/** Bottom-right: Layers (popover with the legend), Globe, zoom, reset. */
function MapControls({
  mode,
  onMap: enterMap,
  overlay,
  onOverlay,
  meta,
  api,
  onGlobe,
  shadowProblem,
}: {
  shadowProblem: string | null;
  mode: "globe" | "map";
  onMap: () => void;
  overlay: Overlay;
  onOverlay: (o: Overlay) => void;
  meta: BasemapMeta | null | undefined;
  api: React.RefObject<MapApi | null>;
  onGlobe: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const ramp = overlay === "sun" || overlay === "earth" ? (meta?.legend?.ramp?.[overlay] ?? RAMP[overlay]) : null;

  // Base view switch, the same in both modes: the globe or the south polar map.
  const views = (
    <div className="viewsw" role="group" aria-label="Base view">
      <button type="button" aria-label="Globe" aria-pressed={mode === "globe"} title="Whole Moon, 3D globe" onClick={() => mode !== "globe" && onGlobe()}>
        <Icon name="globe" size={17} />
        <span>Globe</span>
      </button>
      <button type="button" aria-label="South pole map" aria-pressed={mode === "map"} title="South polar map, 60–90°S, LOLA relief" onClick={() => mode !== "map" && enterMap()}>
        <Icon name="map" size={17} />
        <span>Map</span>
      </button>
    </div>
  );
  if (mode === "globe")
    return (
      <div className="mapctl">
        <div className="mapctl-col">{views}</div>
      </div>
    );
  return (
    <div className="mapctl" ref={box}>
      {ramp && (
        <div className="nav-legend" aria-label="Layer legend">
          <span className="nav-legend-title">
            {overlay === "sun" ? "Sunlight: % of time any part of the solar disc is up" : "Earth in view: mean % of time"}
          </span>
          <span className="nav-legend-ramp" style={{ background: rampCss(ramp) }} />
          <span className="nav-legend-ticks">
            <span>0 %</span>
            <span>50 %</span>
            <span>100 %</span>
          </span>
          <span className="nav-legend-src" title={PGDA_TIP}>
            NASA PGDA 69 maps, 18.6-year mean (Mazarico et al. 2011)
          </span>
          {overlay === "earth" && <span className="nav-legend-src">Any part of the Earth disc; long-term geometry, not confirmed contact.</span>}
        </div>
      )}
      {overlay === "shadow" && (
        <div className="nav-legend" aria-label="Layer legend">
          <span className="nav-legend-title">Shadows now: dark = Sun hidden by terrain</span>
          {shadowProblem && <span className="nav-legend-src" role="alert">{shadowProblem}</span>}
          <span className="nav-legend-src">
            Horizon field from Lunar Window (adqm0001, LOLA, 250 m, observer 2 m); Sun from SPICE DE440. Overview only: site numbers use our
            20 m horizon. The two agree within 1.2° (median) at the 3 sites inside ±32 km.
          </span>
        </div>
      )}
      {overlay === "thermal" && (
        <div className="nav-legend" aria-label="Layer legend">
          <span className="nav-legend-title">
            Thermal now: surface temperature, K <BetaTag />
          </span>
          {shadowProblem && <span className="nav-legend-src" role="alert">{shadowProblem}</span>}
          <span className="nav-legend-ramp" style={{ background: thermalRampCss() }} />
          <span className="nav-legend-kticks">
            {[40, 100, 150, 200, 250].map((t) => (
              <span key={t} style={{ left: `${((t - PAINT_MIN_K) / (PAINT_MAX_K - PAINT_MIN_K)) * 100}%` }}>
                {t === PAINT_MAX_K ? `${t} K` : t}
              </span>
            ))}
          </span>
          <span className="nav-legend-src">
            Estimate. Sunlit cells: radiative equilibrium of flat ground. Shadowed cells: cooling curve of the 1D model by hours in
            shadow. Terrain shadows are real (horizon field, 250 m). No heat from nearby slopes. Not the lander temperature.
          </span>
        </div>
      )}
      {open && (
        <div className="layers-pop" role="dialog" aria-label="Map layers">
          <p className="layers-pop-title">Map layer</p>
          <div className="layers-grid" role="group" aria-label="Map layer">
            {OVERLAYS.map(([k, label, sub]) => (
              <button key={k} type="button" aria-pressed={overlay === k} onClick={() => onOverlay(k)}>
                <span className={`layers-thumb th-${k}`} aria-hidden="true" />
                <span className="layers-name">{label}</span>
                <span className="layers-sub">{sub}</span>
              </button>
            ))}
            <SlideMark />
          </div>
        </div>
      )}
      <div className="mapctl-col">
        <button
          type="button"
          className={`fab${open ? " is-on" : ""}`}
          aria-label="Layers"
          aria-expanded={open}
          title="Layers"
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="layers" size={19} />
        </button>
        {views}
        <div className="zoomgrp" role="group" aria-label="Zoom">
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => api.current?.zoomBy(1)}>
            <Icon name="plus" size={18} />
          </button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => api.current?.zoomBy(-1)}>
            <Icon name="minus" size={18} />
          </button>
          <button type="button" aria-label="Reset view" title="Show 80–90°S" onClick={() => api.current?.reset()}>
            <Icon name="locate" size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function useTimeline(site: Site): Timeline | Error | null | undefined {
  const [tl, setTl] = useState<{ id: string; tl: Timeline | Error | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadFullTimeline(site).then(
      (t) => live && setTl({ id: site.id, tl: t }), (e) => live && setTl({ id: site.id, tl: e instanceof Error ? e : new Error(String(e)) }),
    );
    return () => {
      live = false;
    };
  }, [site]);
  return tl && tl.id === site.id ? tl.tl : undefined;
}

/** #162: the published Gläser 2018 share next to Tilion's own shares, each with its period and measure.
 *  Source of 2017–2037 and the measure: research/ (Gläser et al. 2018, ntrs.nasa.gov 20170007365, Table 1). */
function PublishedShare({ tl, atUtc }: { tl: Timeline; atUtc: string }) {
  const i = stepIndex(tl, atUtc);
  const next = tl.sunVisible.slice(i, i + (30 * 24 * 60) / tl.stepMin);
  return (
    <Info label="About the Gläser 2018 share">
      Gläser 2018 gives the mean visible fraction of the solar disc over 2017–2037 (another period and measure). Tilion
      counts hours with any part of the Sun above the LOLA horizon at 2 m: {fmtShare(onShare(tl.sunVisible))} over{" "}
      {DATA_PERIOD}, {fmtShare(onShare(next))} over the next {sharePeriod(atUtc, 30, "\u00a0")}.
    </Info>
  );
}

export function PlaceCard({
  site,
  atUtc,
  onChange,
  onClose,
  onOpenHorizon,
  onOpenView,
  onCompare,
  onPlanFrom,
  onAddWaypoint,
  waypointAdded,
  nearby,
  onAddCustom,
}: {
  site: Site;
  nearby: Nearby | Error | null | undefined;
  onAddCustom: (s: Site) => void;
  atUtc: string;
  onChange: (t: string) => void;
  onClose: () => void;
  onOpenHorizon: (id: string) => void;
  onOpenView: (id: string) => void;
  onCompare: (id: string) => void;
  onPlanFrom: (id: string) => void;
  /** null = no mission plan (#148). */
  onAddWaypoint: (() => void) | null;
  waypointAdded: boolean;
}) {
  const result = useTimeline(site);
  const error = result instanceof Error ? result : null;
  const tl = result instanceof Error ? undefined : result;
  const mask = useMask(site);
  const st = useMemo(() => (tl ? liveState(tl, atUtc, mask) : null), [tl, atUtc, mask]);
  // #404: a new site opens the card from the top (name, Sun, Earth), not at the old scroll offset.
  const cardRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (cardRef.current) cardRef.current.scrollTop = 0;
  }, [site.id]);

  return (
    <article ref={cardRef} className="place-card" aria-label="Place card">
      <header>
        <p className="place-eyebrow">
          <i className={`nav-dot g-${site.group}`} aria-hidden="true" /> {GROUP_LABEL[site.group]}: {site.status}
        </p>
        <h2>{site.name}</h2>
        <p className="place-coords">{fmtLatLon(site.lat, site.lonE)}</p>
        <button type="button" className="place-close" aria-label="Close place card" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>

      <section className="place-live" aria-label="Sun and Earth now" role="status">
        {error && <p role="alert">Timeline failed to load: {error.message}</p>}
        {tl === undefined && !error && <p className="place-muted">Loading timeline…</p>}
        {tl === null && <p className="place-muted">Timeline unavailable: file missing or failed to load.</p>}
        {tl?.stub && <p className="place-muted">Mock data: synthetic visibility.</p>}
        {tl && !st && <p className="place-muted">The moment is outside the data range 2026-12-01 … 2028-01-01.</p>}
        {st && (
          <div className="place-tiles">
            <div className={`place-tile sun${st.sunUp ? " on" : ""}`}>
              <span className="place-tile-k">Sun</span>
              <b>{st.sunUp ? "Up" : "Down"}</b>
              <span className="place-clear" title={CLEARANCE_TIP}>{fmtClearance(st.sunClearDeg, st.sunElDeg, st.sunUp)}</span>
              {tl && <Countdown tl={tl} atUtc={atUtc} body="sun" terrain={site.terrain} onChange={onChange} />}
              {BETA.uncertainty && <SetSpread siteId={site.id} atUtc={atUtc} body="sun" />}
              <Info className="is-corner" label="What Sun up means">
                Sun up = any part of the disc above the LOLA horizon. Observer 2 m.
              </Info>
            </div>
            <div className={`place-tile earth${st.earthUp ? " on" : ""}`}>
              <span className="place-tile-k">Earth</span>
              <b>{st.earthUp ? "In view" : "Hidden"}</b>
              <span className="place-clear" title={CLEARANCE_TIP}>{fmtClearance(st.earthClearDeg, st.earthElDeg)}</span>
              {tl && <Countdown tl={tl} atUtc={atUtc} body="earth" terrain={site.terrain} onChange={onChange} />}
              {BETA.uncertainty && <SetSpread siteId={site.id} atUtc={atUtc} body="earth" />}
              <Info className="is-corner" label="What Earth in view means">
                {GEO_CAVEAT}
              </Info>
            </div>
          </div>
        )}
      </section>
      {BETA.dsnStations && <SiteStationLinks siteId={site.id} atUtc={atUtc} />}
      {st && <NextWindows siteId={site.id} atUtc={atUtc} onPick={onChange} />}
      {st && tl && <SlipTable tl={tl} atUtc={atUtc} onPick={onChange} />}
      {BETA.uncertainty && <UncertaintyLine siteId={site.id} />}
      {tl && !tl.stub && site.terrain !== "none" && <SphereComparison tl={tl} siteId={site.id} atUtc={atUtc} />}
      <SiteEvidenceBlock siteId={site.id} />
      <NearbyRow result={nearby} onOpen={(spot) => onAddCustom(customSite(spot.lat, spot.lonE))} />

      <div className="place-actions">
        <button type="button" className="primary" onClick={() => onPlanFrom(site.id)}>
          <Icon name="route" size={16} />
          Plan mission from here
        </button>
        <button
          type="button"
          disabled={!onAddWaypoint || waypointAdded}
          title={onAddWaypoint ? "Add this site to the mission waypoints" : "Plan a mission first"}
          onClick={() => onAddWaypoint?.()}
        >
          <Icon name="flag" size={16} />
          {waypointAdded ? "Added as waypoint" : onAddWaypoint ? "Add as waypoint" : "Add as waypoint (plan a mission first)"}
        </button>
        <div className="place-actions-row">
          <button type="button" onClick={() => onOpenHorizon(site.id)}>
            <Icon name="mountain" size={16} />
            Horizon view
          </button>
          <button
            type="button"
            onClick={() => onOpenView(site.id)}
            disabled={site.terrain === "none"}
            title={site.terrain === "none" ? "No terrain model at this site" : "3D terrain around the site, lit by the Sun at this moment"}
          >
            <Icon name="cube" size={16} />
            View from site
          </button>
          <button type="button" onClick={() => onCompare(site.id)}>
            <Icon name="compare" size={16} />
            Compare
          </button>
          <button
            type="button"
            disabled={!tl}
            title={`Hourly Sun and Earth az/el, visible share, Earth and DSN flags, ${DATA_PERIOD}, as CSV`}
            onClick={() => tl && downloadCsv(site, tl)}
          >
            <Icon name="download" size={16} />
            CSV
          </button>
        </div>
      </div>

      <dl className="place-facts">
        <dt>Terrain model</dt>
        <dd>{TERRAIN[site.terrain]}</dd>
        <dt>Confidence</dt>
        <dd>{site.confidence}</dd>
        {site.note && (
          <>
            <dt>Note</dt>
            <dd>
              {site.note}
              {tl && st && /^Gläser 2018 .*%/.test(site.note) && <PublishedShare tl={tl} atUtc={atUtc} />}
            </dd>
          </>
        )}
        {site.source.startsWith("http") && (
          <>
            <dt>Source</dt>
            <dd>
              <a href={site.source} target="_blank" rel="noreferrer">
                {new URL(site.source).hostname}
              </a>
            </dd>
          </>
        )}
      </dl>
      <NasaLinks site={site} atUtc={atUtc} />
      {site.terrain === "none" && <p className="place-muted small">Bare sphere: no terrain.</p>}
    </article>
  );
}

function PinCard({ pin, onClose, onAdd }: { pin: [number, number]; onClose: () => void; onAdd: () => void }) {
  return (
    <article className="place-card pin-card" aria-label="Dropped pin">
      <header>
        <p className="place-eyebrow">Dropped pin</p>
        <h2>Custom point</h2>
        <p className="place-coords" data-testid="custom-readout">
          {fmtLatLon(pin[0], pin[1])}
        </p>
        <button type="button" className="place-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <p className="place-muted" data-testid="custom-dem">
        {customSite(pin[0], pin[1]).note}
      </p>
      <div className="place-actions">
        <button type="button" className="primary" onClick={onAdd}>
          Add to comparison
        </button>
      </div>
    </article>
  );
}
