// Horizon screen (#8): 360° panorama of the terrain mask with the Sun and Earth tracks.
// Angles in degrees. Azimuth from north to east, 0–360. The Sun and Earth discs use their
// true angular size; the vertical axis is stretched by a labelled exaggeration factor.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { loadFullTimeline, loadMask, loadTimeline } from "../api";
import type { HorizonMask, Site, Skyline, Timeline } from "../contracts";
import { SkylineLayers, SkylineLegend, useSkyline } from "./SkylineLayers";
import { sphereTimeline, stepIndex, stepUtc, terrainCaption, terrainClearance, terrainEffect } from "../summary";
import { loadFullWindow } from "../fullWindow";
import { bottleneckMetrics } from "../bottleneck";
import { earthLibration, librationCaption } from "../libration";
import { Blocker, Bottleneck } from "./Bottleneck";
import { blockerSectors } from "../blocker";
import { humanHours, moreThan, spreadHours } from "./hud";
import { earthWindow, heroVerdict } from "./horizonHero";
import { CLEARANCE_TIP, DATA_PERIOD, EXAG_TIP, fmtClearance, fmtDurationRange, sharePeriod } from "../format";
import "./hud.css";
import { DemInfo } from "./DemInfo";
import { Select } from "../ui/Select";
import { SlideMark } from "../ui/Slide";
import { LinkBudget } from "./LinkBudget";
import { EarthWindows } from "./EarthWindows";
import { BETA } from "../beta/flags";
import { EllipseBlock } from "../beta/ellipse/Ellipse";
import { IcsExport } from "../beta/ics/IcsExport";
import { MastLine } from "../beta/mast/MastLine";
import { CommsMarginLine } from "../beta/commsMargin/CommsMarginLine";
import { ThermalLine } from "../beta/thermal/ThermalLine";
import "./Horizon.css";
import { calloutOut, drawLine, gsap, hudCascade, ribbon, sequence, sweep, timeOf, useCrossfade, useFollowNumbers, useIntro } from "../motion";

import { GEO_CAVEAT, Info } from "../ui/Info";
import { EnergyPanel } from "../energy/EnergyPanel";
import { NearbyRow, useNearby } from "../mission/NearbySpot";
import { customSite } from "./PolarMap";
export const SUN_DIAMETER_DEG = 0.53;
export const EARTH_DIAMETER_DEG = 1.9;
export const EXAGGERATIONS = [1, 2, 3, 5, 10];
const PX_PER_DEG = 4; // horizontal scale: 360° → 1440 px
const MAX_PLOT_H = 480;
const PLAY_TICK_MS = 80;

/** Azimuth into [0, 360). */
export function wrapAz(az: number): number {
  const r = az % 360;
  return r < 0 ? r + 360 : r;
}

/** Terrain elevation at any azimuth, linear interpolation, wraps at 0/360. */
export function maskAt(mask: HorizonMask, az: number): number {
  const n = mask.elevDeg.length;
  const f = wrapAz(az) / mask.azStepDeg;
  const k = Math.floor(f) % n;
  const t = f - Math.floor(f);
  return mask.elevDeg[k] * (1 - t) + mask.elevDeg[(k + 1) % n] * t;
}

/** Splits a track into runs that do not cross the 0/360 seam (jump > 180°). */
export function splitAtSeam(az: number[], el: number[]): [number, number][][] {
  const runs: [number, number][][] = [];
  let run: [number, number][] = [];
  az.forEach((a, k) => {
    if (k > 0 && Math.abs(a - az[k - 1]) > 180) {
      runs.push(run);
      run = [];
    }
    run.push([wrapAz(a), el[k]]);
  });
  if (run.length) runs.push(run);
  return runs;
}

/** Azimuth copies of a disc so a disc at the seam shows on both edges. */
export function seamCopies(az: number, radiusDeg: number): number[] {
  const a = wrapAz(az);
  const out = [a];
  if (a - radiusDeg < 0) out.push(a + 360);
  if (a + radiusDeg > 360) out.push(a - 360);
  return out;
}

/** Steps from index i until the flag changes state. null = no change before the period ends. */
export function stepsToChange(flags: number[], i: number): number | null {
  const now = flags[i] > 0;
  for (let k = i + 1; k < flags.length; k++) if (flags[k] > 0 !== now) return k - i;
  return null;
}

/** Steps until the same event in a variant series: 0 when the variant is already past it, null = not in the period. */
function variantSteps(flags: number[], i: number, up: boolean): number | null {
  if (flags[i] > 0 !== up) return 0;
  return stepsToChange(flags, i);
}

/** Next sunset/sunrise in parts for a readout: "in 214 h (9 d)" or "> 30 d", and the Q8 spread over variants. */
export type NextEvent = { word: string; none: boolean; when: string; spread: string | null };

export function nextEventParts(
  flags: number[],
  i: number,
  stepMin: number,
  set: string,
  rise: string,
  variants: number[][] = [],
): NextEvent {
  const up = flags[i] > 0;
  const k = stepsToChange(flags, i);
  const left = ((flags.length - 1 - i) * stepMin) / 60;
  const h = (s: number) => (s * stepMin) / 60;
  let spread: string | null = null;
  if (variants.length) {
    // Q8: min–max over the variants and the value; "never in the period" is the open upper end.
    const all = [k, ...variants.map((f) => variantSteps(f, i, up))];
    const known = all.filter((s): s is number => s !== null).map(h);
    if (!known.length) spread = "0 h";
    else if (all.includes(null)) spread = fmtDurationRange(Math.min(...known), left, true);
    else spread = spreadHours(Math.min(...known), Math.max(...known)) ?? "0 h";
  }
  return { word: up ? set : rise, none: k === null, when: k === null ? moreThan(left) : `in ${humanHours(h(k))}`, spread };
}

/**
 * "Sunset in 12 h" / "Sunrise in 3 h" / "No sunset before period end (> 30 d)".
 * With variants (Q8): "Sunset in 12 h, spread 10–14 h", the spread = min–max over variants and the value.
 */
export function nextEvent(
  flags: number[],
  i: number,
  stepMin: number,
  set: string,
  rise: string,
  variants: number[][] = [],
): string {
  const e = nextEventParts(flags, i, stepMin, set, rise, variants);
  const head = e.none ? `No ${e.word.toLowerCase()} before period end (${e.when})` : `${e.word} ${e.when}`;
  return e.spread ? `${head}, spread ${e.spread}` : head;
}

/** Status line for index i. Q9: light = any part of the disc, comm = Earth centre. */
export function statusText(tl: Timeline, i: number): { now: string; next: string } {
  const v = tl.sunVisible[i];
  const sun = v > 0 ? `Sun visible (${Math.max(1, Math.round(v * 100))} % of sunlight)` : "Sun hidden";
  const earth = tl.earthVisible[i] > 0 ? "Earth in view" : "Earth hidden";
  return {
    now: `${sun}, ${earth}`,
    next: `${nextEvent(tl.sunVisible, i, tl.stepMin, "Sunset", "Sunrise", tl.variantSunLit)}; ${nextEvent(
      tl.earthVisible,
      i,
      tl.stepMin,
      "Earthset",
      "Earthrise",
      tl.variantEarthVisible,
    )}`,
  };
}

/** Elevation window of the panorama: the mask and the tracks, height capped at MAX_PLOT_H. */
export function elevationRange(mask: HorizonMask, tl: Timeline, pxPerDegY: number): [number, number] {
  const mMin = Math.min(...mask.elevDeg);
  const all = [...mask.elevDeg, ...tl.sunEl, ...tl.earthEl];
  const lo = Math.max(Math.floor(Math.min(...all) - 1), Math.floor(mMin) - 4);
  const hi = Math.min(Math.ceil(Math.max(...all) + 1), lo + Math.floor(MAX_PLOT_H / pxPerDegY));
  return [lo, Math.max(hi, lo + 2)];
}

/** Gridline step in degrees so the panorama has at most ~8 lines. */
export function gridStep(span: number): number {
  return [1, 2, 5, 10, 15, 30].find((s) => span / s <= 8) ?? 45;
}

function fmtTime(tl: Timeline, i: number): string {
  return new Date(Date.parse(tl.startUtc) + i * tl.stepMin * 60000).toISOString().slice(0, 16).replace("T", " ");
}

/** Share of the period with the body visible, %: any solar limb (Q9) or the Earth centre. */
export function visiblePercent(flags: number[]): number {
  return flags.length ? Math.round((100 * flags.filter((v) => v > 0).length) / flags.length) : 0;
}

/** Series indexes drawn as path points: one every 2 h. */
export function sampleIndexes(tl: Timeline): number[] {
  const every = Math.max(1, Math.round(120 / tl.stepMin));
  return tl.sunAz.map((_, k) => k).filter((k) => k % every === 0);
}

/**
 * SVG path through the sampled points. A new "M" starts at the 0/360 seam (azimuth jump > 180°)
 * and, with flags, at every hidden sample: a hidden point is skipped.
 */
export function pathThrough(
  samples: number[],
  az: number[],
  el: number[],
  x: (az: number) => number,
  y: (el: number) => number,
  flags?: number[],
): string {
  return samples
    .map((k, j) => {
      if (flags && !(flags[k] > 0)) return "";
      const p = samples[j - 1];
      const joined = j > 0 && Math.abs(wrapAz(az[k]) - wrapAz(az[p])) <= 180 && (!flags || flags[p] > 0);
      return `${joined ? "L" : "M"}${x(wrapAz(az[k])).toFixed(1)},${y(el[k]).toFixed(1)}`;
    })
    .join("");
}

export type Span = "mission" | "30";

// Elevations to 0.1°: DE440 + LOLA 20–80 m horizon is good to about 0.1° (#155).
const signedDeg = (v: number, d = 1) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}°`;

export function Horizon({ site, atUtc, missionDays, onAddCustom }: { site: Site; atUtc: string; missionDays?: number; onAddCustom?: (s: Site) => void }) {
  const [mask, setMask] = useState<HorizonMask | null>(null);
  const [tl, setTl] = useState<Timeline | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exag, setExag] = useState(5);
  const [spanPick, setSpanPick] = useState<Span | null>(null);
  const span: Span = spanPick ?? (missionDays ? "mission" : "30");
  const days = span === "mission" && missionDays ? missionDays : 30;
  const [sphere, setSphere] = useState(false);
  const [effect, setEffect] = useState<{ siteId: string; text: string } | null>(null);

  // The site the shown mask and timeline belong to. A new site or moment keeps the view until its
  // data arrives (#126) instead of a blank reload.
  const [shownSite, setShownSite] = useState(site);
  const root = useRef<HTMLElement>(null);
  // #126 primitives (brackets, sweep, ribbon); no word bursts (#155).
  useIntro(root, !!mask && !!tl, horizonIntro, { screen: "horizon" });
  useFollowNumbers(root, HORIZON_NUMBERS, 0.3);
  const nearby = useNearby(onAddCustom ? shownSite : null);
  const skyline = useSkyline(shownSite);
  useEffect(() => {
    let live = true;
    setI(0);
    setPlaying(false);
    setError(null);
    Promise.all([loadMask(site), loadTimeline(site, stepUtc(atUtc), days)]).then(
      ([m, t]) => live && (setMask(m), setTl(t), setShownSite(site)),
      (e) => live && setError(String(e)),
    );
    return () => {
      live = false;
    };
  }, [site, atUtc, days]);

  // Caption: how terrain changes the Sun and Earth share over the whole precomputed window.
  useEffect(() => {
    let live = true;
    const done = (text: string) => live && setEffect({ siteId: site.id, text });
    if (site.terrain === "none") done("No terrain model for this site: it is already a bare sphere.");
    else
      loadFullTimeline(site).then(
        (full) => done(full ? terrainCaption(terrainEffect(full)) : "No sphere variant: no precomputed timeline for this site."),
        (e: Error) => done(`No sphere variant: timeline failed to load (${e.message}).`),
      );
    return () => {
      live = false;
    };
  }, [site]);

  // #206: time to sunset / Earthset is searched to the data end in the whole window (as Compare, the
  // place card and the dock), not only inside the period on the panorama.
  const [fullW, setFullW] = useState<{ siteId: string; tl: Timeline | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadFullWindow(site).then(
      (t) => live && setFullW({ siteId: site.id, tl: t }),
      () => live && setFullW({ siteId: site.id, tl: null }),
    );
    return () => {
      live = false;
    };
  }, [site]);
  const fullTl = fullW?.siteId === shownSite.id ? fullW.tl : null;
  const fullFlat = useMemo(() => (fullTl ? sphereTimeline(fullTl) : null), [fullTl]);

  // Bare sphere: flat 0° mask and the Sun/Earth flags recomputed for it. Switching needs no reload.
  const flat = useMemo(() => (mask ? { ...mask, terrain: "none" as const, elevDeg: mask.elevDeg.map(() => 0) } : null), [mask]);
  const flatTl = useMemo(() => (tl ? sphereTimeline(tl) : null), [tl]);

  const last = tl ? tl.sunAz.length - 1 : 0;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setI((k) => {
        if (k >= last) {
          setPlaying(false);
          return k;
        }
        return k + 1;
      });
    }, PLAY_TICK_MS);
    return () => clearInterval(id);
  }, [playing, last]);

  if (error) return <p role="alert">{error}</p>;
  if (!mask || !tl) return <p>Loading…</p>;

  const shownMask = sphere && flat ? flat : mask;
  const shownTl = sphere && flatTl ? flatTl : tl;
  const shownSkyline = !sphere && skyline?.siteId === mask.siteId ? skyline : null;
  const sunFrac = shownTl.sunVisible[i];
  const earthUp = shownTl.earthVisible[i] > 0;
  // The events read the whole window at the moment on the slider; the period slice only when it is missing (mock).
  const evFull = sphere ? fullFlat : fullTl;
  const j = evFull ? stepIndex(evFull, new Date(Date.parse(tl.startUtc) + i * tl.stepMin * 60000).toISOString()) : -1;
  const ev = evFull && j >= 0 && j < evFull.sunVisible.length ? { t: evFull, k: j } : { t: shownTl, k: i };
  const sunNext = nextEventParts(ev.t.sunVisible, ev.k, ev.t.stepMin, "Sunset", "Sunrise", ev.t.variantSunLit);
  const earthNext = nextEventParts(ev.t.earthVisible, ev.k, ev.t.stepMin, "Earthset", "Earthrise", ev.t.variantEarthVisible);
  const hero = { verdict: heroVerdict(shownTl.sunEl[i], sunFrac, sunNext, terrainClearance(shownMask, shownTl.sunAz[i], shownTl.sunEl[i])), win: earthWindow(ev.t.earthVisible, ev.k, ev.t.stepMin) };
  const evEnd = ev.t === shownTl ? "not in the period" : `not before the data end (${DATA_PERIOD})`;
  // #424: near the data end the slice is shorter than `days`: say "12 d of data", not "30 d".
  const spanText = tl.stub ? `${days}\u00a0d` : sharePeriod(tl.startUtc, days, "\u00a0");
  const period = span === "mission" ? `the mission window (${spanText})` : `next ${spanText}`;
  // Libration caption: N from the Earth track of the shown window. Not on the bare sphere, a mock or a site without relief.
  const libration = !sphere && !tl.stub && mask.terrain !== "none" ? librationCaption(earthLibration(tl.earthAz, tl.earthEl)) : null;
  const sunClear = terrainClearance(shownMask, shownTl.sunAz[i], shownTl.sunEl[i]);
  const earthClear = terrainClearance(shownMask, shownTl.earthAz[i], shownTl.earthEl[i]);
  const eventTile = (e: NextEvent, body: "sun" | "earth") => (
    <div className="hud-tile">
      <span className="hud-label">{e.word}</span> <span className={`hud-value${e.none ? "" : ` hud-${body}`}`}>{e.when}</span>{" "}
      <span className="hud-foot">
        {e.spread ? `spread ${e.spread}` : e.none ? evEnd : ""}
      </span>
    </div>
  );

  return (
    <section ref={root} aria-label="Horizon panorama" className="horizon hud-screen">
      <div className="hud-title">
        <h2>
          {shownSite.name} — horizon from {mask.observerHeightM} m
        </h2>
        <span className="hud-label">{sphere ? "Bare sphere, flat 0° horizon" : `Terrain ${mask.terrain === "none" ? "none" : "LOLA"}`}</span>
      </div>
      {tl.stub && (
        <p className="stub horizon-stub">
          Mock data: the Sun and Earth tracks are synthetic, not an ephemeris.
        </p>
      )}
      {!sphere && shownSite.terrain !== "none" && (!tl.variantSunLit?.length || !tl.variantEarthVisible?.length) && (
        <p className="stub">spread unavailable: terrain and observer-height variants are missing or incompatible.</p>
      )}
      <div className="horizon-hero" aria-label="Horizon summary">
        <p className="horizon-verdict">{hero.verdict}</p>
        <div className="horizon-kpis">
          <div className="horizon-kpi">
            <span className="hud-label">Sun elevation now</span>
            <span className={`hud-value${sunFrac > 0 ? " hud-sun" : ""}`}>{signedDeg(shownTl.sunEl[i])}</span>
            <span className="hud-foot">{sunFrac > 0 ? `${Math.max(1, Math.round(sunFrac * 100))} % of sunlight` : "Sun hidden"}</span>
          </div>
          <div className="horizon-kpi">
            <span className="hud-label">{sunNext.word}</span>
            <span className={`hud-value${sunNext.none ? "" : " hud-sun"}`}>{sunNext.when}</span>
            <span className="hud-foot">{sunNext.none ? evEnd : (sunNext.spread ? `spread ${sunNext.spread}` : "")}</span>
          </div>
          <div className="horizon-kpi">
            <span className="hud-label">Next Earth window</span>
            <span className={`hud-value${hero.win.value === "none" ? "" : " hud-earth"}`}>{hero.win.value}</span>
            <span className="hud-foot">{hero.win.foot}</span>
          </div>
        </div>
      </div>
      <Bottleneck metrics={bottleneckMetrics(shownTl)} period={period} />
      {/* #436: the next sunset/sunrise is the KPI above, not repeated here. */}
      <div className="hud-tiles horizon-readouts" role="status">
        <div className="hud-tile horizon-sun-tile">
          <SunReticle mask={shownMask} tl={shownTl} i={i} />
          <div>
            <span className="hud-label">Sun</span>{" "}
            <span className={`hud-value${sunFrac > 0 ? " hud-sun" : ""}`}>
              {sunFrac > 0 ? "visible" : "hidden"}
              {sunFrac > 0 && <small>{Math.max(1, Math.round(sunFrac * 100))} % of sunlight</small>}
            </span>{" "}
            <span className="hud-foot horizon-clear" title={CLEARANCE_TIP}>
              az {wrapAz(shownTl.sunAz[i]).toFixed(1)}°, {fmtClearance(sunClear, shownTl.sunEl[i], sunFrac > 0)}
            </span>
          </div>
        </div>
        <div className="hud-tile horizon-earth-tile">
          <span className="hud-label">Earth</span>{" "}
          <span className={`hud-value${earthUp ? " hud-earth" : ""}`}>{earthUp ? "in view" : "hidden"}</span>{" "}
          <span className="hud-foot horizon-clear" title={CLEARANCE_TIP}>
            az {wrapAz(shownTl.earthAz[i]).toFixed(1)}°, {fmtClearance(earthClear, shownTl.earthEl[i])}
          </span>
          <Info className="is-corner" label="What Earth in view means">
            {GEO_CAVEAT}
          </Info>
        </div>
        {eventTile(earthNext, "earth")}
      </div>
      <div className="hud-frame horizon-frame">
        <div className="hud-corners">
          <span>
            <span>Elevation, °</span>
            <label title={EXAG_TIP}>
              <span>Relief height</span>
              <Select label="Vertical exaggeration" value={exag} options={EXAGGERATIONS.map((x) => ({ value: x, label: `×${x}` }))} onChange={setExag} />
            </label>
          </span>
          {/* #334: in the header row, so the legend under the chart keeps its height (#210 fit at 1440×900). */}
          {shownSkyline && <SkylineLegend skyline={shownSkyline} />}
        </div>
        <Panorama mask={shownMask} tl={shownTl} i={i} exag={exag} skyline={shownSkyline} />
        <div className="hud-corners horizon-period-legend">
          <span>
            <span>
              <i className="hud-key hud-key-dot" />
              Sun visible {visiblePercent(shownTl.sunVisible)} % of {period}
            </span>
            <span>
              <i className="hud-key hud-key-earth" />
              Earth visible {visiblePercent(shownTl.earthVisible)} % of {period}
              {libration && (
                <Info label="Why the Earth track loops">
                  <span aria-label="Earth libration">
                    {libration} The thin blue line is the Earth track: {period}.
                  </span>
                </Info>
              )}
            </span>
            <span>Dot = 2 h: filled visible, hollow hidden</span>
          </span>
          <span>
            ⌀ Sun <b>{SUN_DIAMETER_DEG}°</b> Earth <b>{EARTH_DIAMETER_DEG}°</b> true size
          </span>
        </div>
      </div>
      <div className="hud-bar horizon-controls">
        <button type="button" onClick={() => (i >= last ? (setI(0), setPlaying(true)) : setPlaying((p) => !p))}>
          {playing ? "Pause" : "Play"}
        </button>
        <label className="horizon-time">
          <span>Time {fmtTime(tl, i)} UTC</span>
          <input
            type="range"
            aria-label="Time"
            min={0}
            max={last}
            value={i}
            onChange={(e) => {
              setPlaying(false);
              setI(+e.target.value);
            }}
          />
        </label>
        <span className="hud-seg horizon-span" role="group" aria-label="Period shown on the panorama">
          <span className="hud-label">Period</span>
          {(["mission", "30"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={span === v}
              disabled={v === "mission" && !missionDays}
              title={v === "mission" && !missionDays ? "No mission plan" : undefined}
              onClick={() => setSpanPick(v)}
            >
              {v === "mission" ? `Mission window${missionDays ? ` (${missionDays} d)` : ""}` : "Next 30 d"}
            </button>
          ))}
          <SlideMark />
        </span>
        <span className="hud-seg horizon-surface" role="group" aria-label="Surface model">
          <span className="hud-label">Surface</span>
          <label>
            <input type="radio" name="horizon-surface" checked={!sphere} onChange={() => setSphere(false)} /> Terrain (LOLA)
          </label>
          <label title="Flat 0° horizon: the trivial answer without relief">
            <input type="radio" name="horizon-surface" checked={sphere} onChange={() => setSphere(true)} /> Bare sphere
          </label>
        </span>
      </div>
      <p className="horizon-effect" aria-label="Terrain effect">
        {effect?.siteId === site.id ? effect.text : "…"}
      </p>
      {/* #251: the blocker and the nearby spot sit under the chart, so the chart fits 1440×900 (#210). */}
      <Blocker period={period} timeline={shownTl} mask={shownMask} />
      {onAddCustom && <NearbyRow result={nearby} onOpen={(spot) => onAddCustom(customSite(spot.lat, spot.lonE))} />}
      {BETA.mast && !sphere && <MastLine site={shownSite} tl={tl} />}
      {BETA.commsMargin && !sphere && <CommsMarginLine site={shownSite} />}
      {BETA.thermal && !sphere && <ThermalLine tl={tl} fullTl={fullTl} i={i} period={period} />}
      {BETA.ics && !sphere && <IcsExport site={shownSite} tl={tl} fullTl={fullTl} />}
      <details className="hud-notes">
        <summary>How to read</summary>
        <p>
          Sun light = any part of the disc above the terrain. Earth in view = the Earth centre above the terrain (geometry). Spread =
          min–max over observer height 0/2/10 m and the LOLA DEM variants. The discs have their true angular size; only
          the vertical axis is stretched.
        </p>
      </details>
      <EnergyPanel tl={shownTl} period={period} />
      {!sphere && <EarthWindows site={shownSite} tl={tl} mask={mask} index={i} />}
      {BETA.ellipse && !sphere && <EllipseBlock siteId={shownSite.id} />}
      <LinkBudget />
      <details className="hud-notes">
        <summary>Terrain data: DEM source and limits</summary>
        <DemInfo site={shownSite} mask={mask} view={shownMask} tl={shownTl} i={i} />
      </details>
    </section>
  );
}

const HORIZON_NUMBERS = ".hud-value, .hud-foot, .horizon-period-legend, .horizon-callout text";

/** Horizon entry (#126): brackets, grid, relief sweep, Sun/Earth ribbons, 2 h dots, callouts. */
function horizonIntro(tl: gsap.core.Timeline, root: HTMLElement, ctx: { whip: boolean }) {
  const times = hudCascade(tl, root, { numbers: HORIZON_NUMBERS, whip: ctx.whip });
  const svg = root.querySelector(".horizon-panorama");
  const put = (a: gsap.core.Animation | null, at: number) => a && tl.add(a, at);
  if (!svg) return;
  const f = timeOf(times, svg);
  put(sequence(svg.querySelectorAll(".horizon-grid, .horizon-tick"), { amount: 0.3, duration: 0.2 }), f + 0.05);
  put(sweep(svg.querySelector(".horizon-relief"), { duration: 0.7, scan: true }), f + 0.05);
  const sweepT = { duration: 0.65, ease: "power1.inOut" };
  put(drawLine(svg.querySelectorAll(".horizon-period-track, .horizon-visible-track"), sweepT), f + 0.15);
  put(ribbon(svg.querySelector(".horizon-sun-track"), { cls: "motion-ribbon-sun", width: 5, duration: 0.65 }), f + 0.15);
  put(ribbon(svg.querySelector(".horizon-earth-track"), { cls: "motion-ribbon-earth", width: 3, duration: 0.65 }), f + 0.2);
  put(sequence(svg.querySelectorAll(".horizon-sun-point"), { amount: 0.5, duration: 0.15, scale: 1.8 }), f + 0.18);
  put(sequence(svg.querySelectorAll(".horizon-earth-point"), { amount: 0.5, duration: 0.15 }), f + 0.23);
  put(sequence(svg.querySelectorAll("ellipse, .horizon-caret-sun, .horizon-caret-earth"), { amount: 0.1, duration: 0.3, scale: 0.2 }), f + 0.3);
  put(calloutOut(svg.querySelectorAll(".horizon-callout")), f + 0.3);
}

const M = { left: 40, right: 12, top: 12, bottom: 40 };

/** Callout: a square around the body and a leader line to its az/el readout. */
function Callout({
  cx,
  cy,
  side,
  dir,
  text,
  cls,
  W,
  H,
}: {
  cx: number;
  cy: number;
  side: number;
  dir: 1 | -1;
  text: string;
  cls: string;
  W: number;
  H: number;
}) {
  const h = side / 2;
  const tw = text.length * 8.4;
  // The leader goes up and away from the body; it turns down near the top edge, and back inside near the side edges.
  let dx = dir;
  if (cx + dx * (h + 40 + tw) > W) dx = -1;
  if (cx + dx * (h + 40 + tw) < 0) dx = 1;
  const up = cy - h - 34 > 6 ? -1 : 1;
  const x0 = cx + dx * h;
  const y0 = cy + up * h;
  const x1 = x0 + dx * 26;
  const y1 = Math.min(H - 4, Math.max(14, y0 + up * 26));
  const x2 = x1 + dx * tw;
  return (
    <g className={`horizon-callout ${cls}`} data-dir={dx}>
      <rect x={cx - h} y={cy - h} width={side} height={side} />
      <rect x={cx - h - 1.5} y={cy - h - 1.5} width={3} height={3} className="horizon-callout-dot" />
      <polyline points={`${x0},${y0} ${x1},${y1} ${x2},${y1}`} />
      <text x={dx > 0 ? x1 + 2 : x2 + 2} y={y1 - 4}>
        {text}
      </text>
    </g>
  );
}

function Panorama({ mask, tl, i, exag, skyline }: { mask: HorizonMask; tl: Timeline; i: number; exag: number; skyline: Skyline | null }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svgRef = useRef<SVGSVGElement>(null);
  useCrossfade(svgRef, ".horizon-ground, .horizon-ridge, .horizon-period-track, .horizon-visible-track");
  const pxY = PX_PER_DEG * exag;
  const [lo, hi] = useMemo(() => elevationRange(mask, tl, pxY), [mask, tl, pxY]);
  const W = 360 * PX_PER_DEG;
  const H = (hi - lo) * pxY;
  const x = (az: number) => az * PX_PER_DEG;
  const y = (el: number) => (hi - el) * pxY;

  const pts = mask.elevDeg.map((e, k) => `${x(k * mask.azStepDeg)},${y(e)}`);
  pts.push(`${x(360)},${y(mask.elevDeg[0])}`); // close the seam at 360°
  const groundPts = `0,${H + 2} ${pts.join(" ")} ${W},${H + 2}`;

  const samples = sampleIndexes(tl);
  const trackPath = (az: number[], el: number[], flags?: number[]) => pathThrough(samples, az, el, x, y, flags);
  const sunPath = trackPath(tl.sunAz, tl.sunEl);
  const earthPath = trackPath(tl.earthAz, tl.earthEl);
  const points = (body: "sun" | "earth", az: number[], el: number[], flags: number[]) =>
    samples.map((k) => (
      <circle
        key={k}
        cx={x(wrapAz(az[k]))}
        cy={y(el[k])}
        r={body === "sun" ? 2.2 : 1.4}
        className={`horizon-path-point horizon-${body}-point`}
        data-visible={flags[k] > 0}
        aria-label={`${body === "sun" ? "Sun" : "Earth"} ${flags[k] > 0 ? "visible" : "hidden"}, ${fmtTime(tl, k)} UTC`}
      />
    ));

  const step = gridStep(hi - lo);
  const grid: number[] = [];
  for (let e = Math.ceil(lo / step) * step; e <= hi; e += step) grid.push(e);
  const minor: number[] = [];
  for (let e = Math.ceil(lo); e <= hi; e++) if (e % step) minor.push(e);

  const disc = (az: number, el: number, dDeg: number, cls: string) =>
    seamCopies(az, dDeg / 2).map((a) => (
      <ellipse key={`${cls}${a}`} cx={x(a)} cy={y(el)} rx={(dDeg / 2) * PX_PER_DEG} ry={(dDeg / 2) * pxY} className={cls} />
    ));

  const sAz = wrapAz(tl.sunAz[i]);
  const sEl = tl.sunEl[i];
  const eAz = wrapAz(tl.earthAz[i]);
  const eEl = tl.earthEl[i];
  const ticks = Array.from({ length: 73 }, (_, k) => k * 5);
  const caret = (az: number, cls: string) => (
    <polygon points={`${x(az)},${H + 2} ${x(az) - 5},${H + 10} ${x(az) + 5},${H + 10}`} className={cls} />
  );
  const clampY = (v: number) => Math.min(H - 2, Math.max(2, v));
  // #280: the azimuth sector where the terrain hides the Sun most (same sector as the Blocker line under the chart).
  const block = useMemo(() => blockerSectors(tl, mask)[0], [tl, mask]);
  const blockSpans = !block
    ? []
    : block.startAzDeg < block.endAzDeg
      ? [[block.startAzDeg, block.endAzDeg]]
      : [[block.startAzDeg, 360], [0, block.endAzDeg]];

  return (
    <svg
      ref={svgRef}
      className="horizon-panorama"
      viewBox={`${-M.left} ${-M.top} ${W + M.left + M.right} ${H + M.top + M.bottom}`}
      width="100%"
      role="img"
      aria-label={`Horizon mask with Sun and Earth tracks. ${fmtTime(tl, i)} UTC: ${statusText(tl, i).now}`}
    >
      <defs>
        <clipPath id={`plot${uid}`}>
          <rect x={0} y={0} width={W} height={H} />
        </clipPath>
        <clipPath id={`ground${uid}`}>
          <polygon points={groundPts} />
        </clipPath>
      </defs>
      <rect x={0} y={0} width={W} height={H} className="horizon-sky" />
      {grid.map((e) => (
        <g key={e}>
          <line x1={0} x2={W} y1={y(e)} y2={y(e)} className={e === 0 ? "horizon-grid horizon-zero" : "horizon-grid"} />
          <line x1={-6} x2={0} y1={y(e)} y2={y(e)} className="horizon-tick" />
          <text x={-9} y={y(e) + 4} textAnchor="end" className="horizon-axis">
            {e}°
          </text>
        </g>
      ))}
      {minor.map((e) => (
        <line key={e} x1={-3} x2={0} y1={y(e)} y2={y(e)} className="horizon-tick" />
      ))}
      <line x1={0} x2={0} y1={0} y2={H} className="horizon-tick" />
      {Array.from({ length: 13 }, (_, k) => k * 30).map((a) => (
        <line key={a} x1={x(a)} x2={x(a)} y1={0} y2={H} className="horizon-grid horizon-az" />
      ))}
      {blockSpans.map(([a, b]) => (
        <rect key={a} x={x(a)} y={0} width={x(b) - x(a)} height={H} className="horizon-blocker-band" />
      ))}
      {block && (
        <text x={x(blockSpans[0][0]) + 4} y={H - 6} className="horizon-axis horizon-blocker-label">
          MAIN BLOCKER: {Math.round(block.lostHours)}&nbsp;h of Sun lost
        </text>
      )}
      <g clipPath={`url(#plot${uid})`}>
        {disc(eAz, eEl, EARTH_DIAMETER_DEG, "horizon-earth")}
        {disc(sAz, sEl, SUN_DIAMETER_DEG, "horizon-sun")}
        <g className="horizon-relief">
          <polygon points={groundPts} className="horizon-ground" />
          {skyline && <SkylineLayers skyline={skyline} x={x} y={y} H={H} />}
          <polyline points={pts.join(" ")} className="horizon-ridge" />
        </g>
        <path d={sunPath} className="horizon-sun-track horizon-period-track" />
        <path d={earthPath} className="horizon-earth-track horizon-period-track" />
        <path d={trackPath(tl.earthAz, tl.earthEl, tl.earthVisible)} className="horizon-visible-track horizon-earth-visible-track" />
        <path d={trackPath(tl.sunAz, tl.sunEl, tl.sunVisible)} className="horizon-visible-track horizon-sun-visible-track" />
        {points("earth", tl.earthAz, tl.earthEl, tl.earthVisible)}
        {points("sun", tl.sunAz, tl.sunEl, tl.sunVisible)}
        <g clipPath={`url(#ground${uid})`}>
          {disc(eAz, eEl, EARTH_DIAMETER_DEG, "horizon-earth-hidden")}
          {disc(sAz, sEl, SUN_DIAMETER_DEG, "horizon-sun-hidden")}
        </g>
      </g>
      <Callout
        cx={x(eAz)}
        cy={clampY(y(eEl))}
        side={14}
        dir={-1}
        W={W}
        H={H}
        text={`EARTH ${eAz.toFixed(1)}° ${signedDeg(eEl, 1)}`}
        cls="horizon-callout-earth"
      />
      <Callout
        cx={x(sAz)}
        cy={clampY(y(sEl))}
        side={18}
        dir={1}
        W={W}
        H={H}
        text={`SUN ${sAz.toFixed(1)}° ${signedDeg(sEl)}`}
        cls="horizon-callout-sun"
      />
      <line x1={0} x2={W} y1={H} y2={H} className="horizon-tick" />
      {ticks.map((a) => (
        <line
          key={a}
          x1={x(a)}
          x2={x(a)}
          y1={H}
          y2={H + (a % 30 ? (a % 10 ? 3 : 6) : 9)}
          className="horizon-tick"
        />
      ))}
      {Array.from({ length: 13 }, (_, k) => k * 30).map((a) => (
        <text key={a} x={x(a)} y={H + 26} textAnchor="middle" className={a % 90 ? "horizon-axis" : "horizon-axis horizon-cardinal"}>
          {a % 90 ? String(a).padStart(3, "0") : "NESWN"[a / 90]}
        </text>
      ))}
      {caret(eAz, "horizon-caret-earth")}
      {caret(sAz, "horizon-caret-sun")}
    </svg>
  );
}

/** 1:1 reticle around the Sun: 3° field, so the disc and the terrain edge are readable. */
function SunReticle({ mask, tl, i }: { mask: HorizonMask; tl: Timeline; i: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const S = 64;
  const field = 3;
  const k = S / field;
  const az0 = tl.sunAz[i];
  const el0 = tl.sunEl[i];
  const x = (da: number) => S / 2 + da * k;
  const y = (el: number) => S / 2 - (el - el0) * k;
  const pts: string[] = [];
  for (let da = -field / 2; da <= field / 2 + 1e-9; da += 0.05) pts.push(`${x(da)},${y(maskAt(mask, az0 + da))}`);
  const ground = `0,${S} ${pts.join(" ")} ${S},${S}`;
  const r = (SUN_DIAMETER_DEG / 2) * k;
  const c = S / 2;
  return (
    <svg
      className="horizon-reticle"
      viewBox={`0 0 ${S} ${S}`}
      width={S}
      height={S}
      role="img"
      aria-label="Sun close-up, 1:1 scale"
    >
      <title>{`Sun close-up 1:1, ${field}° field, az ${wrapAz(az0).toFixed(1)}° el ${el0.toFixed(1)}°`}</title>
      <defs>
        <clipPath id={`cu${uid}`}>
          <polygon points={ground} />
        </clipPath>
      </defs>
      <circle cx={c} cy={c} r={r} className="horizon-sun" />
      <polygon points={ground} className="horizon-ground" />
      <polyline points={pts.join(" ")} className="horizon-ridge" />
      <circle cx={c} cy={c} r={r} className="horizon-sun-hidden" clipPath={`url(#cu${uid})`} />
      <path
        className="horizon-reticle-lines"
        d={`M${c},2V${c - r - 4}M${c},${c + r + 4}V${S - 2}M2,${c}H${c - r - 4}M${c + r + 4},${c}H${S - 2}`}
      />
    </svg>
  );
}
