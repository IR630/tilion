import { lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadSites } from "./api";
import { DEFAULT_LIMITS, type Limits } from "./landing";
import type { Site } from "./contracts";
import { moveLanding, planFrom, wholeHourUtc } from "./mission/plan";
import { fmtMoment } from "./mission/RoutePanel";
import { useMission } from "./mission/useMission";
import type { Panel } from "./navigator/Navigator";
import { otherMissionPins, useSchedule } from "./schedule/store";
import { calendarItems, type CalItem } from "./schedule/calendarLayout";
import { MissionCalendar } from "./schedule/MissionCalendar";
import { openMoment } from "./timeline/now";
import { TimeSheet } from "./timeline/TimeSheet";
import { NextWindows } from "./timeline/NextWindows";
import { Guide, initialGuide, type GuideStep } from "./Guide";
import { BUILD_LABEL } from "./buildInfo";
import { Hero, initialHero, rememberEntered } from "./navigator/Hero";
import { Icon, type IconName } from "./ui/icons";
import { SlideMark } from "./ui/Slide";
import { Info } from "./ui/Info";
import { STEPS, stepFromHash, useProof, type StepId } from "./steps/StepBar";

// The map is the app (#72). A first visit opens on the welcome screen (#158), once; then the
// navigator fills the window above the time dock. Every other view is its own chunk and opens over
// the map: Compare, Schedule and NASA check as a large side panel from the rail; Horizon, "View from
// site" (3D) and the Globe as overlays from the place card, the itinerary and the map controls.
const Navigator = lazy(() => import("./navigator/Navigator").then((m) => ({ default: m.Navigator })));
const Compare = lazy(() => import("./screens/Compare").then((m) => ({ default: m.Compare })));
const Horizon = lazy(() => import("./screens/Horizon").then((m) => ({ default: m.Horizon })));
const Globe = lazy(() => import("./screens/Globe").then((m) => ({ default: m.Globe })));
const Terrain3D = lazy(() => import("./screens/Terrain3D").then((m) => ({ default: m.Terrain3D })));
const Validation = lazy(() => import("./screens/Validation").then((m) => ({ default: m.Validation })));
const Calendar = lazy(() => import("./screens/Calendar").then((m) => ({ default: m.Calendar })));
const SchedulePanel = lazy(() => import("./schedule/SchedulePanel").then((m) => ({ default: m.SchedulePanel })));

type Sheet = "compare" | "calendar" | "schedule" | "validation";
type View = { kind: "horizon" | "view3d"; siteId: string };
/** The base view: the 3D globe (start) or the polar map; the switch cross-fades (#72). */
export type Mode = "globe" | "map";
const FADE_MS = 700;
const HERO_FADE_MS = 350;
const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// #460: the rail is the step path: steps 01–06 in the order of the user's path, then the extras.
type RailItem = { id: Panel | Sheet | "sky"; label: string; icon: IconName; hint: string; step?: StepId };
const RAIL: RailItem[] = [
  { id: "sites", label: "Sites", icon: "sites", hint: "Landing sites", step: "site" },
  { id: "sky", label: "Sky", icon: "mountain", hint: "The sky from the site: horizon, Sun and Earth", step: "sky" },
  { id: "calendar", label: "Windows", icon: "sunrise", hint: "Landing windows: calendar and verdict", step: "windows" },
  { id: "compare", label: "Compare", icon: "compare", hint: "Compare sites side by side", step: "compare" },
  { id: "mission", label: "Mission", icon: "route", hint: "Mission route and alternatives", step: "mission" },
  { id: "validation", label: "NASA check", icon: "check", hint: "Our numbers against JPL Horizons and PGDA", step: "check" },
];
const RAIL_EXTRA: RailItem[] = [{ id: "schedule", label: "Schedule", icon: "calendar", hint: "Upcoming missions" }];
const two = (i: number) => String(i + 1).padStart(2, "0");
const SHEET_TITLE: Record<Sheet, string> = {
  compare: "Compare sites",
  calendar: "Landing windows",
  schedule: "Mission schedule",
  validation: "NASA check",
};
const isSheet = (id: string): id is Sheet => id === "compare" || id === "calendar" || id === "schedule" || id === "validation";

// #323: the data note folds behind the sheet title's "?".
const DATA_NOTE =
  'Sun, Earth and horizon come from real NASA data, hourly 2026-12-01 … 2028-01-01. Terrain: LOLA polar elevation maps (20 m within 5 km of a polar site, then 80 m and 240 m). Sun and Earth positions: SPICE DE440 ephemeris (JPL). A custom point is computed in your browser on the LOLA 240 m map, 60–90°S (bare sphere north of 60°S). Outside that range or without a precomputed file the value is synthetic and marked "mock". Site coordinates: longitude 0–360° east in the IAU Moon mean-Earth frame (MOON_ME).';

export function App() {
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mission, setMission] = useMission();
  // #210: the Windows panel's mission limits; the Mission plan card judges with the same ones.
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  // A plan sets the mission length: the Windows check and the plan card judge the plan's own window.
  const planDays = mission.plan?.durationDays;
  useEffect(() => {
    if (planDays == null) return;
    setLimits((l) => (l.cond.days === planDays ? l : { cond: { ...l.cond, days: planDays }, preset: null }));
  }, [planDays]);
  const schedule = useSchedule(mission, setMission);
  const [guide, setGuide] = useState(initialGuide);
  const [openPrediction, setOpenPrediction] = useState(false);
  const [tour, setTour] = useState(false); // the guide plays by itself, started from the welcome screen (#382)
  // The welcome screen: "on" over the globe, "leaving" while it fades, "off" for good (#158).
  const [intro, setIntro] = useState<"on" | "leaving" | "off">(() => (initialHero() ? "on" : "off"));
  const [picked, setPicked] = useState<string[]>(mission.plan ? [mission.plan.siteId] : ["cr1_connecting_ridge", "a_haworth"]);
  const [selected, setSelected] = useState<string | null>(mission.plan?.siteId ?? null);
  const [custom, setCustom] = useState<Site | null>(null);
  const [panel, setPanel] = useState<Panel | null>(() => (mission.plan ? "mission" : null));
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // #223: the sheets opened before the current one; the close button and Esc go back to the last.
  const [sheetBack, setSheetBack] = useState<Sheet[]>([]);
  useEffect(() => {
    if (!sheet) setSheetBack([]);
  }, [sheet]);
  const openSheet = useCallback(
    (id: Sheet) => {
      if (sheet && sheet !== id) setSheetBack((b) => [...b.filter((x) => x !== id && x !== sheet), sheet]);
      setSheet(id);
    },
    [sheet],
  );
  const closeSheet = useCallback(() => {
    setSheet(sheetBack.at(-1) ?? null);
    setSheetBack((b) => b.slice(0, -1));
  }, [sheetBack]);
  const [view, setView] = useState<View | null>(null);
  // Start on the globe; a plan link starts on the map (the plan is drawn there).
  const [mode, setMode] = useState<Mode>(() => (mission.plan ? "map" : "globe"));
  const [mapOn, setMapOn] = useState(mode === "map"); // MapLibre loads on the first switch to the map
  const [globeOn, setGlobeOn] = useState(mode === "globe"); // the globe unmounts after the fade (frees WebGL)
  const [entry, setEntry] = useState<{ siteId: string | null; n: number }>({ siteId: null, n: 0 });
  // The one shared moment for every screen, ISO UTC. It opens on the current UTC hour held inside
  // the data range (#377); a plan link keeps the landing time of the plan.
  const [atUtc, setAtUtc] = useState(() => mission.plan?.landingUtc ?? openMoment().utc);
  // The Guide shows its own moments while open; closing it gives the user's moment back (#196),
  // unless the user set another moment during the Guide (a day picked in Windows): that one stays.
  const beforeGuide = useRef<string | null>(null);
  const guideTime = useRef<string | null>(null);
  const openGuide = () => {
    if (!guide) beforeGuide.current = atUtc;
    setGuide(true);
  };
  const closeGuide = useCallback(() => {
    setGuide(false);
    setTour(false);
    const t = beforeGuide.current;
    beforeGuide.current = null;
    if (t) setAtUtc((cur) => (cur === guideTime.current ? t : cur));
  }, []);
  // A landing time set in the plan (its time field, an option made current, Back to original, another
  // scheduled mission) moves the shared moment with it (#196). A landing dragged on the strip does not:
  // the strip stays where the user looks.
  const lastLanding = useRef(mission.plan?.landingUtc ?? null);
  const dockLanding = useRef<string | null>(null);
  const landingUtc = mission.plan?.landingUtc ?? null;
  useEffect(() => {
    if (landingUtc && landingUtc !== lastLanding.current && landingUtc !== dockLanding.current) setAtUtc(landingUtc);
    lastLanding.current = landingUtc;
    dockLanding.current = null;
  }, [landingUtc]);
  // The first-visit guide: each step opens its view over the globe or the map.
  const guideStep = useCallback((step: GuideStep) => {
    setSelected(step.site);
    setPicked([step.site, step.site === "a_haworth" ? "cr1_connecting_ridge" : "a_haworth"]);
    guideTime.current = step.time;
    setAtUtc(step.time);
    if (step.screen === "horizon") {
      setSheet(null);
      setView({ kind: "horizon", siteId: step.site });
    } else {
      setView(null);
      setSheet(step.screen);
    }
  }, []);

  useEffect(() => {
    loadSites().then(setSites, (e) => setError(String(e)));
  }, []);

  const enter = useCallback(() => {
    rememberEntered();
    setIntro((i) => (i === "on" ? "leaving" : i));
  }, []);
  useEffect(() => {
    if (intro !== "leaving") return;
    const t = setTimeout(() => setIntro("off"), reducedMotion() ? 0 : HERO_FADE_MS);
    return () => clearTimeout(t);
  }, [intro]);
  const openHero = () => {
    setView(null);
    setSheet(null);
    closeGuide();
    setIntro("on");
  };

  // Esc closes the top layer: an overlay, then a side panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || intro !== "off") return;
      // A popover (the time strip's date picker) closes first, on its own.
      if (document.querySelector('[role="dialog"][aria-label="Date picker"]')) return;
      if (view) setView(null);
      else if (sheet) closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, sheet, intro, closeSheet]);

  const all = useMemo(() => (custom ? [...sites, custom] : sites), [sites, custom]);
  const byId = (id: string) => all.find((s) => s.id === id);
  // Landings of the other scheduled missions (#73) as pins on the time strip.
  const extraPins = useMemo(
    () => otherMissionPins(schedule.state, mission, (id) => all.find((s) => s.id === id)?.group),
    [schedule.state, mission, all],
  );
  // In pick order: the first pick is the default site of the Globe.
  const chosen = picked.map((id) => byId(id)).filter((s): s is Site => !!s && s.lat !== null);
  const unpick = (id: string) => setPicked((p) => p.filter((x) => x !== id));
  // A site becomes the first pick; at most 4 picks.
  const putFirst = useCallback((id: string) => setPicked((p) => [id, ...p.filter((x) => x !== id)].slice(0, 4)), []);
  const select = useCallback(
    (id: string | null) => {
      setSelected(id);
      if (id) putFirst(id);
    },
    [putFirst],
  );
  // Mission calendar (#159): the schedule's missions and the plan; light of the selected (or plan) site.
  const calItems = useMemo(() => calendarItems(schedule.state, mission), [schedule.state, mission]);
  const calSite = byId(selected ?? mission.plan?.siteId ?? "") ?? null;
  const openCalMission = (it: CalItem) => {
    const stored = schedule.state.missions.find((m) => m.id === it.id);
    if (stored && stored.id !== schedule.state.activeId) schedule.activate(stored);
    select(it.siteId);
  };
  const addCustom = (s: Site) => {
    setCustom(s);
    setPicked((p) => [...p.filter((x) => !x.startsWith("custom-")), s.id].slice(-4));
  };
  const openHorizon = useCallback((id: string) => setView({ kind: "horizon", siteId: id }), []);
  const openView = useCallback((id: string) => setView({ kind: "view3d", siteId: id }), []);
  // #287: the mode asked last, set at once. The fade timer reads it: a switch back to the globe
  // can come before React commits it and clears the timer (two timers due in one busy frame).
  const asked = useRef(mode);
  const toGlobe = useCallback(() => {
    asked.current = "globe";
    setView(null);
    setGlobeOn(true);
    setMode("globe");
  }, []);
  const toMap = useCallback((siteId: string | null) => {
    asked.current = "map";
    setMapOn(true);
    setEntry((e) => ({ siteId, n: e.n + 1 }));
    setMode("map");
  }, []);
  useEffect(() => {
    if (mode !== "map" || !globeOn) return;
    const t = setTimeout(() => asked.current === "map" && setGlobeOn(false), reducedMotion() ? 0 : FADE_MS + 100);
    return () => clearTimeout(t);
  }, [mode, globeOn]);
  const onPanel = useCallback((p: Panel | null) => setPanel(p), []);

  const rail = (id: Panel | Sheet) => {
    if (guide) closeGuide();
    setView(null);
    if (isSheet(id)) {
      if (sheet === id) closeSheet();
      else openSheet(id);
      return;
    }
    if (sheet) {
      setSheet(null);
      setPanel(id);
    } else setPanel((p) => (p === id ? null : id));
  };
  // #360: the step bar. The current step follows the open view; a step opens its view.
  const step: StepId | null =
    view?.kind === "horizon" ? "sky"
    : view ? null
    : sheet === "calendar" ? "windows"
    : sheet === "compare" ? "compare"
    : sheet === "validation" ? "check"
    : sheet ? null
    : panel === "sites" ? "site"
    : panel === "mission" ? "mission"
    : null;
  const openStep = (id: StepId) => {
    if (intro !== "off") enter();
    if (guide) closeGuide();
    if (id === "sky") {
      setSheet(null);
      setView({ kind: "horizon", siteId: selected ?? picked[0] ?? "cr1_connecting_ridge" });
      return;
    }
    setView(null);
    if (id === "windows") openSheet("calendar");
    else if (id === "compare") openSheet("compare");
    else if (id === "check") openSheet("validation");
    else {
      setSheet(null);
      setPanel(id === "site" ? "sites" : "mission");
      if (mode !== "map") toMap(null);
    }
  };
  const openStepRef = useRef(openStep);
  openStepRef.current = openStep;
  useEffect(() => {
    const fromUrl = () => {
      const id = stepFromHash(window.location.hash);
      if (id) openStepRef.current(id);
    };
    fromUrl();
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
  }, []);
  const active = (id: Panel | Sheet | "sky") => (id === "sky" ? view?.kind === "horizon" : isSheet(id) ? sheet === id : !sheet && !view && panel === id);
  const stepIx = STEPS.findIndex((s) => s.id === step);
  const proof = useProof();
  const railClick = (r: RailItem) => {
    if (r.step && !active(r.id) && stepFromHash(window.location.hash) !== r.step) history.pushState(null, "", `#step=${r.step}`);
    if (r.id === "sky") {
      if (active("sky")) setView(null);
      else openStep("sky");
    } else rail(r.id);
  };
  const railBtn = (r: RailItem) => {
    const j = r.step ? STEPS.findIndex((s) => s.id === r.step) : -1;
    const tip = r.step === "check" && proof ? `${r.hint}: ${proof.pass}/${proof.checks} checks match` : r.hint;
    return (
      <button
        key={r.id}
        type="button"
        className={`rail-btn${active(r.id) ? " is-active" : ""}${j >= 0 && stepIx > j ? " is-done" : ""}`}
        aria-pressed={active(r.id)}
        aria-current={j >= 0 && j === stepIx ? "step" : undefined}
        aria-label={r.label}
        data-tip={tip}
        onClick={() => railClick(r)}
      >
        {j >= 0 && (
          <span className="rail-num" aria-hidden="true">
            {two(j)}
          </span>
        )}
        <Icon name={r.icon} size={20} />
        <span className="rail-label" aria-hidden="true">
          {r.label}
        </span>
        {r.step === "check" && proof && (
          <span className="rail-proof" aria-hidden="true">
            {proof.pass}/{proof.checks}
          </span>
        )}
      </button>
    );
  };
  const viewSite = view ? byId(view.siteId) : undefined;

  return (
    <div className={`app${intro === "on" ? " is-intro" : ""}`}>
      <small className="build-label" title="Build of this page">
        {BUILD_LABEL}
      </small>
      {intro !== "off" && (
        <Hero
          site={byId(selected ?? picked[0] ?? "")}
          atUtc={atUtc}
          leaving={intro === "leaving"}
          solid={mode === "map"}
          onEnter={enter}
          onTour={() => {
            enter();
            setTour(true);
            openGuide();
          }}
          onPlan={() => {
            enter();
            setSheet(null);
            setPanel("mission");
            toMap(null);
          }}
        />
      )}
      {/* Under the welcome screen the navigator is out of reach: inert for keyboard and screen readers. */}
      <div className="stage" inert={intro === "on"}>
        <nav className="rail" aria-label="Main">
          <button type="button" className="rail-mark" aria-label="About Tilion" data-tip="About Tilion: the welcome screen" onClick={openHero}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M12 3a9 9 0 0 1 0 18a6.2 9 0 0 0 0-18Z" fill="currentColor" />
            </svg>
          </button>
          {RAIL.map(railBtn)}
          <span className="rail-sep" aria-hidden="true" />
          {RAIL_EXTRA.map(railBtn)}
          <button
            type="button"
            className={`rail-btn rail-help${guide ? " is-active" : ""}`}
            aria-label="How to read"
            data-tip="A short guide to the views"
            onClick={openGuide}
          >
            <Icon name="help" size={20} />
            <span className="rail-label" aria-hidden="true">
              Guide
            </span>
          </button>
          <SlideMark axis="y" selector=":scope > .rail-btn.is-active" />
        </nav>
        {guide && <Guide onStep={guideStep} onClose={closeGuide} autoplay={tour} onPrediction={() => { closeGuide(); setOpenPrediction(true); setView(null); setSheet("compare"); }} />}

        {error && (
          <p role="alert" className="app-error">
            {error}
          </p>
        )}
        {/* Under an overlay or a side panel the map is out of reach: inert for keyboard and screen readers. */}
        <div className="nav-host" inert={!!view || (!!sheet && sheet !== "schedule")}>
        {globeOn && (
          <GlobeStage
            active={mode === "globe"}
            onZoomIn={() => {
              enter();
              toMap(null);
            }}
          >
            <Suspense fallback={<p className="globe-loading">Loading the Moon…</p>}>
              <Globe
                sites={all}
                atUtc={atUtc}
                selected={picked[0] ?? null}
                onOpenHorizon={openHorizon}
                onSelect={(id) => {
                  enter();
                  select(id);
                  toMap(id);
                }}
              />
            </Suspense>
          </GlobeStage>
        )}
        <Suspense fallback={<div className="nav-loading">Loading map…</div>}>
          <Navigator
            sites={all}
            atUtc={atUtc}
            onAtUtc={setAtUtc}
            selected={selected}
            currentSiteId={selected ?? picked[0] ?? null}
            onSelect={select}
            panel={sheet ? null : panel}
            onPanel={onPanel}
            onOpenHorizon={openHorizon}
            onOpenView={openView}
            mode={mode}
            mapOn={mapOn}
            entry={entry}
            onGlobe={toGlobe}
            onEnterMap={toMap}
            onCompare={(id) => {
              setPicked((p) => (p.includes(id) ? p : [...p, id].slice(-4)));
              setView(null);
              openSheet("compare");
            }}
            onAddCustom={addCustom}
            onPlanFrom={(id) => {
              setMission((m) => planFrom(m, id, atUtc));
              setSheet(null);
              setPanel("mission");
            }}
            mission={mission}
            onMission={setMission}
            limits={limits.cond}
            left={<MissionCalendar atUtc={atUtc} onAtUtc={setAtUtc} items={calItems} site={calSite} onOpenMission={openCalMission} />}
          />
        </Suspense>
        </div>

        {sheet === "schedule" && (
          <div className="sched-dock" role="dialog" aria-label="Schedule">
            <Suspense fallback={<p className="pane-loading">Loading…</p>}>
              <SchedulePanel atUtc={atUtc} onAtUtc={setAtUtc} mission={mission} onMission={setMission} schedule={schedule} onClose={closeSheet} />
            </Suspense>
          </div>
        )}
        {sheet && sheet !== "schedule" && (
          <Layer
            kind="sheet"
            title={SHEET_TITLE[sheet]}
            closeHint={sheetBack.length ? `Back to ${SHEET_TITLE[sheetBack[sheetBack.length - 1]]}` : undefined}
            info={<Info label="About the data">{DATA_NOTE}</Info>}
            onClose={closeSheet}
          >
            {(sheet === "compare" || sheet === "calendar") && (
              <div className="pane-sites" aria-label="Sites in use">
                <span className="pane-sites-k">Sites</span>
                {chosen.map((s) => (
                  <span key={s.id} className="chip">
                    <i className={`nav-dot g-${s.group}`} aria-hidden="true" />
                    {s.name}
                    {chosen.length > 1 && (
                      <button type="button" aria-label={`Remove ${s.name}`} onClick={() => unpick(s.id)}>
                        <Icon name="close" size={13} />
                      </button>
                    )}
                  </span>
                ))}
                <button
                  type="button"
                  className="pane-add"
                  onClick={() => {
                    setSheet(null);
                    setPanel("sites");
                  }}
                >
                  <Icon name="plus" size={14} /> Add from the map
                </button>
              </div>
            )}
            <Suspense fallback={<p className="pane-loading">Loading…</p>}>
              {sheet === "compare" && <Compare sites={chosen} atUtc={atUtc} onOpenChecks={() => openSheet("validation")} limits={limits.cond} openPrediction={openPrediction} />}
              {sheet === "calendar" && <Calendar sites={chosen} atUtc={atUtc} onPick={setAtUtc} limits={limits} onLimits={setLimits} />}
              {sheet === "validation" && <Validation />}
            </Suspense>
          </Layer>
        )}

        {view?.kind === "horizon" && viewSite && (
          <Layer
            kind="overlay"
            title={`Horizon from ${viewSite.name}`}
            sub={fmtMoment(atUtc)}
            info={
              <Info label="How to read the horizon">
                The skyline is the LOLA terrain seen from 2 m above the site. Yellow is the Sun's path, blue the Earth's, over the
                period set below (next 30 d or the mission window); the disc marks the moment.
              </Info>
            }
            onClose={() => setView(null)}
          >
            {/* #207: the next Sun and Earth windows next to the intro, above the fold. */}
            <div className="ovl-top">
              <NextWindows siteId={viewSite.id} atUtc={atUtc} onPick={setAtUtc} compact />
            </div>
            <Suspense fallback={<p className="pane-loading">Loading…</p>}>
              <Horizon site={viewSite} atUtc={atUtc} missionDays={mission.plan?.durationDays}
                onAddCustom={(s) => { addCustom(s); select(s.id); openHorizon(s.id); }} />
            </Suspense>
          </Layer>
        )}
        {view?.kind === "view3d" && viewSite && (
          <Layer kind="overlay" wide title={`View from ${viewSite.name}, ${fmtMoment(atUtc)}`} onClose={() => setView(null)}>
            <Suspense fallback={<p className="pane-loading">Loading 3D…</p>}>
              <Terrain3D sites={chosen} site={viewSite} catalog={all} atUtc={atUtc} view />
            </Suspense>
          </Layer>
        )}
      </div>
      <div className="dock" inert={intro === "on"}>
      <TimeSheet
        atUtc={atUtc}
        onAtUtc={setAtUtc}
        sites={chosen}
        catalog={all}
        focusId={view?.siteId ?? selected ?? picked[0] ?? null}
        mission={mission}
        extraPins={extraPins}
        onMoveLanding={(utc) => {
          dockLanding.current = wholeHourUtc(utc);
          setMission((m) => moveLanding(m, utc));
        }}
      />
      </div>
    </div>
  );
}

/** The globe as the base view. Scrolling in past the globe's own zoom opens the polar map. */
function GlobeStage({ active, onZoomIn, children }: { active: boolean; onZoomIn: () => void; children: ReactNode }) {
  const pushes = useRef<{ sum: number; t: number }>({ sum: 0, t: 0 });
  return (
    <div
      className={`globe-stage${active ? " is-active" : ""}`}
      aria-hidden={!active}
      onWheelCapture={(e) => {
        if (!active || e.deltaY >= 0) return;
        const now = performance.now();
        const p = pushes.current;
        if (now - p.t > 1200) p.sum = 0;
        p.t = now;
        p.sum += -e.deltaY;
        if (p.sum > 1400) {
          p.sum = 0;
          onZoomIn();
        }
      }}
    >
      {children}
    </div>
  );
}

/** A panel over the map: "sheet" = right-side panel (rail), "overlay" = large centred view. */
function Layer({
  kind,
  title,
  sub,
  wide,
  closeHint,
  info,
  onClose,
  children,
}: {
  kind: "sheet" | "overlay";
  title: string;
  sub?: string;
  wide?: boolean;
  /** Where the close button leads when it is not a plain close, e.g. "Back to Compare". */
  closeHint?: string;
  /** #322: a "?" next to the title with the view's explanation. */
  info?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`layer layer-${kind}${wide ? " is-wide" : ""}`} role="dialog" aria-label={title}>
      <header className="layer-head">
        <div className="layer-titles">
          <div className="layer-title-row">
            <h2>{title}</h2>
            {info}
          </div>
          {sub && <p>{sub}</p>}
        </div>
        <button type="button" className="layer-close" aria-label="Close" title={`${closeHint ?? "Close"} (Esc)`} onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="layer-body">{children}</div>
    </section>
  );
}
