// Time dock at the bottom, full width (#58, #158): the scrubber with the site's Sun-lit and
// Earth-in-view bands, and under it the next events (right). #298: no buttons under the scale; the
// strip moves by drag, wheel and keys, T opens the date picker. #369: Earth eclipses of the focused
// site as a pin on the strip and a line under it, with a link to the GSFC check (eval case S7).
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { loadFullTimeline, loadMaskOnce } from "../api";
import { CanvasRecorder } from "../CanvasRecorder";
import type { Site } from "../contracts";
import type { MissionState } from "../mission/types";
import { hoursLoader, type Hours } from "../route/hours";
import { DatePicker, type PickerPlan } from "./DatePicker";
import { eclipseAt, eclipseLine, findEclipses, type EclipseEvent } from "./eclipse";
import { HudStrip, type ExtraPin, type HudWin } from "./HudStrip";
import { EventIcon } from "./icons";
import { DAY, fmtSlip, fmtWait, nextChange, playTick, slipBounds, slipOf, stepUtc, T1, type EventKind } from "./time";
import "./timeline.css";

const PLAY_SPEED = 6; // h/s while a recording runs (?rec=1)
const EVENT_LABEL: Record<EventKind, string> = { sunrise: "Sunrise", sunset: "Sunset", earthrise: "Earthrise", earthset: "Earthset" };

type Props = {
  atUtc: string;
  onAtUtc: (utc: string) => void;
  sites: Site[]; // picked sites, in pick order
  catalog?: Site[]; // all sites, for the focused site's name
  focusId?: string | null; // the site the user looks at (card, Horizon view); the dock shows its hours (#229)
  mission: MissionState;
  onMoveLanding: (utc: string) => void;
  extraPins?: ExtraPin[]; // other missions' landings (#73)
};

const MAP_WAIT_MS = 4000;
const ECLIPSE_COLOR = "var(--warn)";
const ECLIPSE_GROUP = '.validation .val-group[aria-label^="Earth eclipses"]';

/** Open the NASA check step (App listens to popstate) and scroll to the eclipse group once it renders. */
function toEclipseCheck(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  if (window.location.hash !== "#step=check") history.pushState(null, "", "#step=check");
  window.dispatchEvent(new PopStateEvent("popstate"));
  let tries = 0;
  const find = () => {
    const g = document.querySelector<HTMLElement>(ECLIPSE_GROUP);
    if (g) g.scrollIntoView?.({ block: "start" });
    else if (++tries < 120) requestAnimationFrame(find);
  };
  requestAnimationFrame(find);
}

export function TimeSheet({ atUtc, onAtUtc, sites, catalog, mission, onMoveLanding, extraPins, focusId }: Props) {
  const [picker, setPicker] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [span, setSpan] = useState(3 * DAY);
  const [hours, setHours] = useState<Hours | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // hours.json waits until the map reports data-ready="1", so the map's first paint comes first (#113).
  // No map on screen: load at once. Map never ready (no WebGL, error): load after MAP_WAIT_MS anyway.
  useEffect(() => {
    let live = true;
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      hoursLoader().then(
        (h) => live && setHours(h),
        (e) => live && setLoadError(String(e)),
      );
    };
    const map = document.querySelector<HTMLElement>(".nav-map");
    if (!map || map.dataset.ready === "1") load();
    const watch = new MutationObserver(() => map?.dataset.ready === "1" && load());
    if (map) watch.observe(map, { attributes: true, attributeFilter: ["data-ready"] });
    const fallback = window.setTimeout(load, MAP_WAIT_MS);
    return () => {
      live = false;
      watch.disconnect();
      clearTimeout(fallback);
    };
  }, []);

  const t = Date.parse(atUtc);
  const tick = playTick(PLAY_SPEED);
  useEffect(() => {
    if (!playing) return;
    if (t >= T1) {
      setPlaying(false);
      return;
    }
    // One step per tick; steps are whole hours (clampUtc rounds), so a fractional step would stall.
    const id = setTimeout(() => onAtUtc(stepUtc(atUtc, tick.hours)), tick.ms);
    return () => clearTimeout(id);
  }, [playing, atUtc, t, onAtUtc, tick.hours, tick.ms]);

  const { plan, original, selected } = mission;
  const base = original ?? plan;
  // #229: the focused site, not the plan's: the card and the dock must name the same site.
  const siteId = focusId ?? sites[0]?.id ?? plan?.siteId ?? null;
  const site = siteId ? ((catalog ?? sites).find((s) => s.id === siteId) ?? sites.find((s) => s.id === siteId)) : undefined;
  const siteHours = siteId ? hours?.sites.get(siteId) : undefined;

  // #369: eclipses of the focused site, from its timeline and mask. They load after hours.json,
  // so the map and the strip come first; the files are cached and shared with the other screens.
  const [eclipses, setEclipses] = useState<{ id: string; list: EclipseEvent[] } | null>(null);
  useEffect(() => {
    if (!hours || !site) return;
    let live = true;
    Promise.all([loadFullTimeline(site), loadMaskOnce(site)]).then(
      ([tl, mask]) => live && setEclipses({ id: site.id, list: findEclipses(tl, mask) }),
      () => live && setEclipses({ id: site.id, list: [] }),
    );
    return () => {
      live = false;
    };
  }, [hours, site]);
  const siteEclipses = useMemo(() => (eclipses && eclipses.id === siteId ? eclipses.list : []), [eclipses, siteId]);
  const eclipse = eclipseAt(siteEclipses, t);
  const pins = useMemo<ExtraPin[] | undefined>(
    () =>
      siteEclipses.length
        ? [...(extraPins ?? []), ...siteEclipses.map((e) => ({ utc: new Date(e.peakMs).toISOString(), label: eclipseLine(e), color: ECLIPSE_COLOR }))]
        : extraPins,
    [extraPins, siteEclipses],
  );

  const win = useMemo<HudWin | null>(() => {
    if (!plan || !base) return null;
    return {
      landing: Date.parse(plan.landingUtc),
      original: Date.parse(base.landingUtc),
      durationDays: plan.durationDays,
      bounds: slipBounds(base.landingUtc, plan.durationDays, plan.slipMinDays, plan.slipMaxDays),
      slip: slipOf(plan.landingUtc, base.landingUtc),
    };
  }, [plan, base]);
  const pickerPlan = useMemo<PickerPlan | null>(
    () => (plan && base && win ? { landingUtc: plan.landingUtc, originalUtc: base.landingUtc, durationDays: plan.durationDays, bounds: win.bounds } : null),
    [plan, base, win],
  );
  const option = useMemo(
    () => (selected && plan ? { utc: selected.landingUtc, label: `Option ${fmtSlip(slipOf(selected.landingUtc, plan.landingUtc))}` } : null),
    [selected, plan],
  );

  // Next Sun and Earth events from the moment, soonest first.
  const next = useMemo(() => {
    if (!hours || !siteHours) return [];
    const i = Math.floor((t - hours.startMs) / (hours.stepMin * 60_000));
    if (i < 0 || i >= hours.n) return [];
    const stepH = hours.stepMin / 60;
    return ([1, 2] as const)
      .map((bit) => {
        const up = (siteHours.codes[i] & bit) !== 0;
        const j = nextChange(siteHours.codes, i, bit);
        const kind: EventKind = bit === 1 ? (up ? "sunset" : "sunrise") : up ? "earthset" : "earthrise";
        return { kind, h: ((j ?? hours.n - 1) - i) * stepH, beyond: j === null }; // beyond: to the last step, as the card (#162)
      })
      .sort((x, y) => x.h - y.h);
  }, [hours, siteHours, t]);

  // #207: T opens the date picker from anywhere but a text field; the picker focuses its input.
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== "t" && e.key !== "T") || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const dock = root.current;
      if (!dock || (dock.checkVisibility && !dock.checkVisibility({ visibilityProperty: true } as CheckVisibilityOptions))) return;
      e.preventDefault();
      setPicker(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <section ref={root} className="hud" aria-label="Time sheet">
      {picker && (
        <DatePicker
          hours={hours}
          siteId={siteId}
          siteName={site?.name ?? siteId ?? "No site picked"}
          atUtc={atUtc}
          plan={pickerPlan}
          onPick={onMoveLanding}
          onAtUtc={onAtUtc}
          onClose={() => setPicker(false)}
        />
      )}

      <div className="hud-band">
        <div className="hud-legend" title={site ? `Hours of ${site.name}, LOLA terrain horizon, observer 2 m` : undefined}>
          <span className="hud-legend-site">{site ? site.name : "No site picked"}</span>
          <span className="hud-legend-k k-sun">
            <i aria-hidden="true" /> <span>Sun<span className="k-long">-lit</span></span>
          </span>
          <span className="hud-legend-k k-earth">
            <i aria-hidden="true" /> <span>Earth<span className="k-long"> in view</span></span>
          </span>
          {/* #313: names the T key; #461: also a button that opens the same date picker. */}
          <button type="button" className="hud-legend-hint" aria-keyshortcuts="T" aria-haspopup="dialog" onClick={() => setPicker(true)}>
            <kbd>T</kbd> set date
          </button>
        </div>
        <div className="hud-track">
          {/* #461: the exact moment over the playhead (the fixed centre index), above the scale. */}
          <span className="hud-now" aria-hidden="true">
            {atUtc.slice(0, 16).replace("T", " ")} UTC
          </span>
          <HudStrip
            hours={hours}
            siteId={siteId}
            atUtc={atUtc}
            onAtUtc={onAtUtc}
            spanMs={span}
            onSpan={setSpan}
            playMs={playing ? tick.ms : null}
            win={win}
            option={option}
            extraPins={pins}
            onMoveLanding={onMoveLanding}
          />
        </div>
      </div>
      <div className="hud-row">
        {eclipse && (
          <p className="hud-eclipse" aria-label="Earth eclipse">
            <i aria-hidden="true" />
            <span className="hud-eclipse-text">{eclipseLine(eclipse)}</span>
            <a href="#step=check" onClick={toEclipseCheck} title="Eclipse contacts vs the NASA GSFC catalogue (case S7)">
              NASA check S7
            </a>
          </p>
        )}
        <time className="sr-only" dateTime={atUtc} aria-label="Current moment">
          {atUtc.slice(0, 16).replace("T", " ")} UTC
        </time>
        <span className="hud-rec">
          <CanvasRecorder onStart={() => setPlaying(true)} onStop={() => setPlaying(false)} />
        </span>
        <div className="hud-right" aria-label="Next events">
          {loadError ? (
            <span className="hud-err" role="alert">
              Sun and Earth hours did not load
            </span>
          ) : (
            next.map((e, k) => (
              <span key={e.kind} className={`hud-next${k === 0 ? " is-first" : ""} k-${e.kind}`}>
                <EventIcon kind={e.kind} />
                {EVENT_LABEL[e.kind]} in <b>{fmtWait(e.h, e.beyond)}</b>
              </span>
            ))
          )}
        </div>
      </div>

    </section>
  );
}
