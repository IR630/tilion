// Mission route (#57, #72, D-004). RouteHeader: the navigator-style "From" line and the mode chips
// in the search pill. RoutePanel: tolerances, the plan card, ranked alternatives (site × landing
// date) like route options in a map app, and the itinerary of the selected option.
import { fmtUntil as fmtUntilShared } from "../format";
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Site } from "../contracts";
import { matches } from "../navigator/geo";
import { type Metrics, type RouteOption, TAG_LABEL } from "../route/route";
import { Icon, type IconName } from "../ui/icons";
import { SlideMark } from "../ui/Slide";
import { scoreOf, whyBest } from "../route/score";
import { Itinerary } from "./Itinerary";
import { OptionParams, PlanScore, ScoreBar, ScoreKey, TraversePanel, windowCounts } from "./ScoreParts";
import type { TraverseState } from "./useTraverse";
import { WaypointList } from "./WaypointList";
import { PlanVerdict } from "./PlanVerdict";
import { DispersionPanel } from "./DispersionPanel";
import { ReplanMatrix } from "./ReplanMatrix";
import { type Conditions, DEFAULT_LIMITS } from "../landing";
import { ElevationProfile } from "../route/ElevationProfile";
import { routeKey } from "./routeMap";
import type { Routes } from "./useRoutes";
import {
  backToOriginal,
  editPlan,
  EMPTY_MISSION,
  fileName,
  makeCurrent,
  MAX_DAYS,
  openPlan,
  planFromJson,
  planToJson,
  samePlace,
  selectOption,
  SLIP_LIMIT,
  startPlan,
} from "./plan";
import { DEFAULT_RADIUS_KM, type MissionPlan, type MissionState, type Mode } from "./types";
import { ExactInput } from "../timeline/ExactInput";
import "./route-panel.css";
import { BETA } from "../beta/flags";
import { PrintBrief } from "../beta/brief/MissionBrief";
import { GEO_CAVEAT, Info } from "../ui/Info";

export const MODE_INFO: Record<Mode, { label: string; metric: string; short: string; help: string; icon: IconName }> = {
  energy: { label: "Energy", metric: "Sun", short: "sunlight", help: "Hours of sunlight in the window: solar power.", icon: "sun" },
  comms: { label: "Comms", metric: "Earth", short: "Earth in view", help: "Hours with the Earth centre above the horizon: geometric visibility.", icon: "antenna" },
  balanced: { label: "Balanced", metric: "Sun + Earth", short: "Sun and Earth", help: "Hours with both sunlight and Earth visibility: geometric overlap.", icon: "balance" },
};
/** [lat, lonE] of a site, or null without a position. */
export const planLatLon = (s: Site | undefined): [number, number] | null =>
  s && s.lat !== null && s.lonE !== null ? [s.lat, s.lonE] : null;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtH = (h: number) => `${Math.round(h)} h`;
export const fmtUntil = (h: number | null, beyond: boolean) => (h === null ? "—" : fmtUntilShared(h, beyond)); // #162 one format
export const fmtSlip = (d: number) => (d === 0 ? "same day" : `${d > 0 ? "+" : "−"}${Math.abs(d)} d`);
export const fmtKm = (km: number) => (km === 0 ? "same site" : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`);
export function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}, ${hh}:00`;
}
/** "Jan 15 2027 06:00 UTC" — the navigator header format. */
export function fmtMoment(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()} ${hh}:${mm} UTC`;
}
/** "Jan 13" */
export function fmtDay(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
const fmtPts = (d: number) => (Math.abs(d) < 1 ? "same as plan" : `${d > 0 ? "+" : "−"}${Math.round(Math.abs(d))} pts vs plan`);

/** The search pill in route mode: "From <site> <time> UTC" and the mode chips, like the
 *  origin field and travel modes of a navigator. */
export function RouteHeader({
  routes,
  mission,
  onMission,
  nameOf,
}: {
  routes: Routes;
  mission: MissionState;
  onMission: Dispatch<SetStateAction<MissionState>>;
  nameOf: (id: string) => string;
}) {
  const plan = mission.plan;
  if (!plan) return null;
  const set = (patch: Partial<MissionPlan>) => onMission((m) => editPlan(m, patch));
  return (
    <section className="route-head" aria-label="Route header">
      <div className="route-head-row">
        <span className="route-head-pin" aria-hidden="true" />
        <span className="route-head-k">From</span>
        <SitePicker sites={routes.usable} value={plan.siteId} label={nameOf(plan.siteId)} onChange={(siteId) => set({ siteId })} />
        <label className="route-head-when">
          <ExactInput label="Landing time (UTC)" valueUtc={plan.landingUtc} onUtc={(landingUtc) => set({ landingUtc })} />
          <span className="route-head-utc">UTC</span>
        </label>
      </div>
      <div className="route-modes" role="group" aria-label="Ranking mode">
        {(Object.keys(MODE_INFO) as Mode[]).map((m) => (
          <button key={m} type="button" aria-pressed={plan.mode === m} title={MODE_INFO[m].help} onClick={() => set({ mode: m })}>
            <Icon name={MODE_INFO[m].icon} size={15} />
            {MODE_INFO[m].label}
          </button>
        ))}
        <SlideMark />
        <button type="button" className="route-head-close" aria-label="Close mission plan" title="Close plan" onClick={() => onMission(EMPTY_MISSION)}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </section>
  );
}

type Props = {
  sites: Site[];
  routes: Routes;
  mission: MissionState;
  onMission: Dispatch<SetStateAction<MissionState>>;
  atUtc: string;
  onAtUtc: (utc: string) => void;
  /** The current site (place card, else the globe's first pick): "Plan a mission" starts there. */
  selectedSiteId: string | null;
  onOpenHorizon: (id: string) => void;
  onOpenView: (id: string) => void;
  /** Waypoint add mode (#148): the next map click places a waypoint. */
  waypointMode?: boolean;
  onWaypointMode?: (on: boolean) => void;
  /** Traverse along the waypoints (#160): comms per leg and its score. */
  traverse?: TraverseState;
  /** #210: the Windows panel's mission limits: the plan card shows that verdict above the score. */
  limits?: Conditions;
};

export function RoutePanel({ sites, routes, mission, onMission, atUtc, onAtUtc, selectedSiteId, onOpenHorizon, onOpenView, waypointMode = false, onWaypointMode, traverse, limits = DEFAULT_LIMITS.cond }: Props) {
  const { hours, loadError, usable, result, stale } = routes;
  const [fileError, setFileError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2200);
    return () => clearTimeout(t);
  }, [notice]);

  const byId = new Map(sites.map((s) => [s.id, s]));
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  const sel = mission.selected;
  const selKey = sel ? routeKey(sel) : null;
  // A bubble clicked on the map selects a card: bring it into view.
  useEffect(() => {
    if (!selKey) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(selKey)}"]`);
    el?.scrollIntoView?.({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [selKey]);

  const plan = mission.plan;
  const openFile = async (f: File) => {
    const r = planFromJson(await f.text());
    if ("error" in r) {
      setFileError(`${f.name}: ${r.error}`);
      return;
    }
    if (hours && !hours.sites.has(r.plan.siteId)) {
      setFileError(`${f.name}: site "${r.plan.siteId}" has no hourly data in this build.`);
      return;
    }
    setFileError(null);
    onMission(openPlan(r.plan));
  };
  const fileButton = (
    <>
      <button type="button" className="rp-btn" onClick={() => fileInput.current?.click()}>
        Open mission file
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Mission file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void openFile(f);
        }}
      />
    </>
  );
  const fileAlert = fileError && (
    <p className="rp-alert" role="alert">
      {fileError}
      <button type="button" aria-label="Dismiss" onClick={() => setFileError(null)}>
        <Icon name="close" size={14} />
      </button>
    </p>
  );

  if (!plan) {
    const start = () => {
      // #195: the current site even while the hourly data loads; a site without hourly data falls back.
      const id = selectedSiteId && !selectedSiteId.startsWith("custom-") && (!hours || hours.sites.has(selectedSiteId)) ? selectedSiteId : (usable[0]?.id ?? "a_haworth");
      onMission(startPlan(id, atUtc));
    };
    return (
      <section className="rp rp-empty" aria-label="Mission route">
        <h2 className="rp-title">Mission route</h2>
        <p className="rp-lead">Set a landing site and time. If the date slips, Tilion ranks nearby sites and dates and draws them on the map.</p>
        <div className="rp-row">
          <button type="button" className="rp-btn primary" onClick={start}>
            Plan a mission
          </button>
          {fileButton}
        </div>
        {fileAlert}
      </section>
    );
  }

  const set = (patch: Partial<MissionPlan>) => onMission((m) => editPlan(m, patch));
  const info = MODE_INFO[plan.mode];
  const dataEnd = hours ? new Date(hours.startMs + hours.n * hours.stepMin * 60_000).toISOString() : null;
  const dataStart = hours ? new Date(hours.startMs).toISOString() : null;
  const pm = result?.plan ?? null;
  const fair = !!pm && !pm.windowClipped;
  const isSel = (o: RouteOption) => !!sel && sel.siteId === o.siteId && sel.landingUtc === o.landingUtc;
  const moved = !!mission.original && !samePlace(mission.original, plan);
  const planSite = byId.get(plan.siteId);
  // The itinerary follows the selected option, else the plan.
  const it = sel ? { siteId: sel.siteId, landingUtc: sel.landingUtc, what: "Selected option" } : { siteId: plan.siteId, landingUtc: plan.landingUtc, what: "Current plan" };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice("Link copied");
    } catch {
      setNotice("Copy the address bar: the link holds the plan");
    }
  };
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([planToJson(plan)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(plan);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Mission file saved");
  };

  return (
    <section className="rp" aria-label="Mission route">
      <header className="rp-head">
        <input className="rp-name" aria-label="Mission name" value={plan.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
        <Info label="How the plan is ranked">
          Ranks by the route score (0–100): power, night, comms, comms gap and sunset margin, {info.label.toLowerCase()} weights. {GEO_CAVEAT}
        </Info>
      </header>
      <Tolerances plan={plan} onChange={set} />
      {byId.get(plan.siteId)?.terrain === "none" && <p className="rp-help">Bare sphere: no terrain.</p>}

      {loadError && (
        <p className="rp-alert" role="alert">
          Hourly visibility data failed to load: {loadError}
        </p>
      )}
      {!hours && !loadError && <p className="rp-muted">Loading hourly visibility…</p>}
      {hours && !pm && !stale && (
        <p className="rp-alert" role="alert">
          {!hours.sites.has(plan.siteId) || !usable.some((s) => s.id === plan.siteId)
            ? `${nameOf(plan.siteId)} has no hourly data. Pick a site with a precomputed timeline.`
            : `The landing is outside the data (${dataStart?.slice(0, 10)} … ${dataEnd?.slice(0, 10)}).`}
        </p>
      )}

      {pm && (
        <PlanCard m={pm} mode={plan.mode} days={plan.durationDays} smooth={planSite?.terrain === "none"}>
          {planSite && <PlanVerdict site={planSite} landingUtc={plan.landingUtc} limits={limits} />}
        </PlanCard>
      )}
      {pm && planSite && <DispersionPanel site={planSite} landingUtc={plan.landingUtc} limits={limits} />}
      {moved && mission.original && (
        <p className="rp-original">
          Original: {nameOf(mission.original.siteId)}, {fmtWhen(mission.original.landingUtc)}
          <button type="button" className="rp-link" onClick={() => onMission(backToOriginal)}>
            Back to original
          </button>
        </p>
      )}
      {pm && hours && <ReplanMatrix
          hours={hours}
          sites={usable}
          plan={plan}
          limits={limits}
          nameOf={nameOf}
          onPick={(id, utc) => {
            onAtUtc(utc);
            onOpenHorizon(id);
          }}
        />}

      {pm && result && (
        <section className={`rp-options${stale ? " is-stale" : ""}`} aria-label="Route options" aria-busy={stale}>
          <h3>
            <span>
              Alternatives
              <Info label="How alternatives are ranked">
                Other landing sites and dates near the plan, best first by route score, {info.label.toLowerCase()} weights, in a {plan.durationDays}-day
                window from landing; sites with LOLA terrain. On the map each option is a line from the plan site; its label gives the route score
                (0–100) and the landing date slip from the plan. {GEO_CAVEAT}
              </Info>
            </span>
            <span className="rp-count">{result.options.length}</span>
          </h3>
          {!fair && <p className="rp-sub">The plan window is cut by the data end, so deltas are hidden.</p>}
          <ScoreKey mode={plan.mode} />
          {result.options[0] && result.options[1] && (
            <p className="sc-why" data-testid="best-why">
              <b>Best landing option:</b>{" "}
              {result.options[0].siteId === plan.siteId && result.options[0].slipDays === 0
                ? "the current plan"
                : `${nameOf(result.options[0].siteId)}, ${fmtDay(result.options[0].landingUtc)} (${fmtSlip(result.options[0].slipDays)}, ${result.options[0].distanceKm === 0 ? "same site" : `${fmtKm(result.options[0].distanceKm)} from the plan site`})`}{" "}
              — {whyBest(result.options[0], result.options[1], plan.mode)}.
            </p>
          )}
          {Number.isFinite(plan.radiusKm) && !result.options.some((o) => o.siteId !== plan.siteId) && (
            <p className="rp-alert rp-widen" role="status" data-testid="no-nearby">
              {result.options.length === 0 ? "No site and date fits the tolerances." : `No other site within ${plan.radiusKm} km: only dates at this site are listed.`}
              <button type="button" className="rp-link" onClick={() => set({ radiusKm: Infinity })}>
                Search any distance
              </button>
            </p>
          )}
          {!Number.isFinite(plan.radiusKm) && result.options.length === 0 && <p className="rp-muted">No site and date fits the tolerances. Widen the slip.</p>}
          <ol className="rp-list" ref={list}>
            {result.options.map((o, i) => (
              <OptionCard
                key={routeKey(o)}
                rank={i + 1}
                o={o}
                name={nameOf(o.siteId)}
                mode={plan.mode}
                delta={fair ? scoreOf(o, plan.mode).total - scoreOf(pm, plan.mode).total : null}
                counts={windowCounts(hours, o)}
                details={<OptionParams o={o} site={byId.get(o.siteId)} hours={hours} mode={plan.mode} />}
                selected={isSel(o)}
                isPlan={o.siteId === plan.siteId && o.slipDays === 0}
                onSelect={() => onMission((m) => selectOption(m, isSel(o) ? null : o))}
                onMakeCurrent={() => onMission((m) => makeCurrent(m, o))}
              />
            ))}
          </ol>
        </section>
      )}

      {hours && byId.get(it.siteId) && (
        <Itinerary
          key={`${it.siteId}@${it.landingUtc}`}
          hours={hours}
          site={byId.get(it.siteId) as Site}
          what={it.what}
          landingUtc={it.landingUtc}
          days={plan.durationDays}
          atUtc={atUtc}
          onAtUtc={onAtUtc}
          onOpenHorizon={onOpenHorizon}
          onOpenView={onOpenView}
        />
      )}

      {onWaypointMode && (
        <WaypointList
          waypoints={plan.waypoints ?? []}
          from={planLatLon(byId.get(plan.siteId))}
          onMission={onMission}
          addMode={waypointMode}
          onAddMode={onWaypointMode}
        />
      )}
      {onWaypointMode && traverse && <TraversePanel state={traverse} plan={plan} onMission={onMission} />}

      {/* #164: drive profile from the plan site through the waypoints; a slip at that site moves the departure. */}
      {planLatLon(byId.get(plan.siteId)) && !!plan.waypoints?.length && (
        <ElevationProfile
          points={[{ name: nameOf(plan.siteId), lat: planSite!.lat as number, lonE: planSite!.lonE as number }, ...plan.waypoints]}
          hours={hours}
          siteId={plan.siteId}
          departUtc={it.siteId === plan.siteId ? it.landingUtc : plan.landingUtc}
          atUtc={atUtc}
          onAtUtc={onAtUtc}
        />
      )}

      <footer className="rp-foot">
        <button type="button" className="rp-btn" onClick={copyLink}>
          Copy link
        </button>
        <button type="button" className="rp-btn" onClick={exportJson}>
          Export JSON
        </button>
        {fileButton}
        {BETA.brief && pm && <PrintBrief plan={plan} pm={pm} options={result?.options ?? []} mission={mission} byId={byId} limits={limits} />}
      </footer>
      {fileAlert}
      {createPortal(
        <p className="rp-toast" role="status">
          {notice && (
            <span className="rp-toast-pill" key={notice}>
              <Icon name="check" size={13} />
              {notice}
            </span>
          )}
        </p>,
        document.body,
      )}
    </section>
  );
}

function SitePicker({ sites, value, label, onChange }: { sites: Site[]; value: string; label: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  const found = sites.filter((s) => matches(s, q));
  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };
  return (
    <div className="rp-site" ref={box}>
      <button
        type="button"
        className="rp-site-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Landing site: ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{label}</span>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && (
        <div className="rp-site-pop">
          <input
            autoFocus
            type="search"
            placeholder="Search sites"
            aria-label="Search landing sites"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "Enter" && found[0]) pick(found[0].id);
            }}
          />
          <ul role="listbox" aria-label="Landing sites">
            {found.map((s) => (
              <li key={s.id} role="option" aria-selected={s.id === value} onClick={() => pick(s.id)}>
                <i className={`nav-dot g-${s.group}`} aria-hidden="true" />
                {s.name}
              </li>
            ))}
            {found.length === 0 && <li className="rp-muted">No site with hourly data matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A whole-number field that keeps the draft text while typing and commits only valid values. */
function IntField(p: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(p.value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(p.value));
  }, [p.value, focused]);
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={p.label}
      min={p.min}
      max={p.max}
      step={1}
      disabled={p.disabled}
      value={draft}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isInteger(v) && v >= p.min && v <= p.max) p.onCommit(v);
      }}
    />
  );
}

function Tolerances({ plan, onChange }: { plan: MissionPlan; onChange: (p: Partial<MissionPlan>) => void }) {
  const [open, setOpen] = useState(false);
  const any = !Number.isFinite(plan.radiusKm);
  const sign = (d: number) => (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0");
  return (
    <div className="rp-tol">
      <button type="button" className="rp-tol-sum" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>
          Slip {sign(plan.slipMinDays)}…{sign(plan.slipMaxDays)} d, {any ? "any distance" : `≤ ${plan.radiusKm} km`},{" "}
          {plan.durationDays}-day window
        </span>
        <span className="rp-tol-edit">{open ? "Done" : "Edit"}</span>
      </button>
      {open && (
        <div className="rp-tol-grid" role="group" aria-label="Tolerances">
          <span className="rp-k">Slip, days</span>
          <span className="rp-pair">
            <IntField label="Earliest slip, days" value={plan.slipMinDays} min={-SLIP_LIMIT} max={plan.slipMaxDays} onCommit={(v) => onChange({ slipMinDays: v })} />
            <span>to</span>
            <IntField label="Latest slip, days" value={plan.slipMaxDays} min={plan.slipMinDays} max={SLIP_LIMIT} onCommit={(v) => onChange({ slipMaxDays: v })} />
          </span>
          <span className="rp-k">Radius, km</span>
          <span className="rp-pair">
            <IntField
              label="Search radius, km"
              value={any ? DEFAULT_RADIUS_KM : plan.radiusKm}
              min={1}
              max={2000}
              disabled={any}
              onCommit={(v) => onChange({ radiusKm: v })}
            />
            <label className="rp-check">
              <input type="checkbox" checked={any} onChange={(e) => onChange({ radiusKm: e.target.checked ? Infinity : DEFAULT_RADIUS_KM })} />
              Any
            </label>
          </span>
          <span className="rp-k">Window, days</span>
          <span className="rp-pair">
            <IntField label="Surface window, days" value={plan.durationDays} min={1} max={MAX_DAYS} onCommit={(v) => onChange({ durationDays: v })} />
          </span>
        </div>
      )}
    </div>
  );
}

export function PlanCard({ m, mode, days, smooth, children }: { m: Metrics; mode: Mode; days: number; smooth: boolean; children?: ReactNode }) {
  const cell = (k: string, v: number, key = false, title?: string) => (
    <div className={key ? "is-key" : ""} title={title}>
      <dt>{k}</dt>
      <dd>{fmtH(v)}</dd>
    </div>
  );
  return (
    <section className="rp-plan" aria-label="Plan metrics">
      <p className="rp-eyebrow">Current plan at landing</p>
      {smooth && (
        <p className="rp-smooth" role="note">
          Smooth sphere — no terrain model. The horizon is flat here, so these numbers are not comparable with the LOLA
          alternatives.
        </p>
      )}
      <div className="rp-landing">
        <div className={`rp-tile sun${m.sunUpAtLanding ? " on" : ""}`}>
          <span className="rp-tile-k">Sun</span>
          <b>{m.sunUpAtLanding ? "Up" : "Down"}</b>
          <span>{m.sunUpAtLanding ? <>sets in {fmtUntil(m.hoursToSunset, m.sunsetBeyondData)}</> : "dark landing"}</span>
        </div>
        <div className={`rp-tile earth${m.earthUpAtLanding ? " on" : ""}`}>
          <span className="rp-tile-k">Earth</span>
          <b>{m.earthUpAtLanding ? "In view" : "Hidden"}</b>
          <span>{m.earthUpAtLanding ? <>sets in {fmtUntil(m.hoursToEarthset, m.earthsetBeyondData)}</> : "centre hidden"}</span>
        </div>
      </div>
      {/* #230: the verdict (PASS/FAIL and its rule) comes first; the score is a smaller second line. */}
      {children}
      <PlanScore m={m} mode={mode} />
      <p className="rp-eyebrow rp-eyebrow-2">
        In the {fmtH(m.windowH)} window
        {m.windowClipped && <b className="rp-warn">, cut by the data end ({fmtH(m.windowH)} of {fmtH(days * 24)})</b>}
      </p>
      <dl className="rp-metrics">
        {cell("Sun", m.sunH, mode === "energy")}
        {cell("Earth", m.earthH, mode === "comms")}
        {cell("Both", m.bothH, mode === "balanced")}
        {cell("Dark", m.longestDarkH, false, "Longest run without Sun")}
        {cell("Earth hidden", m.longestNoCommsH, false, "Longest run without Earth centre visibility")}
      </dl>
    </section>
  );
}

function OptionCard(p: {
  rank: number;
  o: RouteOption;
  name: string;
  mode: Mode;
  delta: number | null;
  counts: { light: number; comms: number } | null;
  details: ReactNode;
  selected: boolean;
  isPlan: boolean;
  onSelect: () => void;
  onMakeCurrent: () => void;
}) {
  const { o, mode } = p;
  const sc = scoreOf(o, mode);
  const share = (x: number) => `${Math.round((100 * x) / o.windowH)} %`;
  return (
    <li className={`rp-opt${p.selected ? " is-selected" : ""}`} data-site={o.siteId} data-key={routeKey(o)}>
      <button type="button" className="rp-opt-main" aria-pressed={p.selected} onClick={p.onSelect}>
        <span className="rp-opt-swatch" aria-hidden="true" />
        <span className="rp-opt-body">
          <span className="rp-opt-key">
            <b data-testid="option-score">{Math.round(sc.total)}</b>
            <span className="rp-opt-key-k">score / 100</span>
            {sc.nightOverLimit && <span className="sc-flag">night &gt; 50 h</span>}
            {p.delta !== null && !p.isPlan && (
              <span className={`rp-delta${p.delta >= 1 ? " up" : p.delta <= -1 ? " down" : ""}`}>{fmtPts(p.delta)}</span>
            )}
          </span>
          <ScoreBar score={sc} />
          <span className="rp-opt-name">
            <span className="sr-only">Option {p.rank}: </span>
            {p.name}
          </span>
          <span className="rp-opt-when">
            <span>{fmtDay(o.landingUtc)}</span>
            <span>{fmtSlip(o.slipDays)}</span>
            <span>{fmtKm(o.distanceKm)}</span>
          </span>
          <span className="rp-opt-small">
            <span title="Sunlit share of the mission window">Mission window: Sun {share(o.sunH)}</span>
            <span title="Earth centre in view, share of the mission window">Earth {share(o.earthH)}</span>
            <span title="Longest run without Sun">Night {fmtH(o.longestDarkH)}</span>
            <span title="Longest run without Earth centre visibility">Gap {fmtH(o.longestNoCommsH)}</span>
            {p.counts && (
              <span title="Separate light / comms windows in the window">
                {p.counts.light} light, {p.counts.comms} comms windows
              </span>
            )}
          </span>
          {o.tags.length > 0 && (
            <span className="rp-tags">
              {o.tags.map((t) => (
                <span key={t} className={`rp-tag t-${t}`}>
                  {TAG_LABEL[t]}
                </span>
              ))}
            </span>
          )}
        </span>
      </button>
      {p.selected && (
        <div className="rp-opt-more">
          <span className="rp-opt-small">
            <span>Landing {fmtWhen(o.landingUtc)} UTC</span>
          </span>
          {p.details}
          <div className="rp-opt-actions">
            <button type="button" className="rp-btn primary" onClick={p.onMakeCurrent} disabled={p.isPlan}>
              {p.isPlan ? "This is the plan" : "Make current"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
