// Calendar heatmap: months × days per site, day colour from the real hourly timeline.
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { loadFullTimeline } from "../api";
import type { Site, Timeline } from "../contracts";
import {
  DEFAULT_LIMITS, PRESETS, explainNoWindow, findWindow, indexToUtc, judge, nextWindow, scanWindows, utcToIndex, verdictAt,
  type Conditions, type Level, type Limits, type Win,
} from "../landing";
import { longestRun, type Run } from "../summary";
import { DATA_PERIOD, fmtDuration, fmtShare } from "../format";
import "./hud.css";
import "./calendar.css";
import { SlideMark } from "../ui/Slide";
import { NextWindows } from "../timeline/NextWindows";
import { GEO_CAVEAT, Info } from "../ui/Info";

export { longestRun, type Run };


export type DayStat = { day: string; sun: number; earth: number; both: number; hours: number };
export type Kind = "both" | "sun" | "earth" | "none";

/** Hours per full UTC day with Sun (any limb), Earth (centre) and both above the terrain. Partial days drop. */
export function dailyStats(tl: Timeline): DayStat[] {
  const t0 = Date.parse(tl.startUtc);
  const stepMs = tl.stepMin * 60000;
  const h = tl.stepMin / 60;
  const byDay = new Map<string, DayStat>();
  for (let i = 0; i < tl.sunVisible.length; i++) {
    const day = new Date(t0 + i * stepMs).toISOString().slice(0, 10);
    let d = byDay.get(day);
    if (!d) byDay.set(day, (d = { day, sun: 0, earth: 0, both: 0, hours: 0 }));
    const s = tl.sunVisible[i] > 0;
    const e = tl.earthVisible[i] > 0;
    d.hours += h;
    if (s) d.sun += h;
    if (e) d.earth += h;
    if (s && e) d.both += h;
  }
  return [...byDay.values()].filter((d) => d.hours >= 24);
}

/** Dominant category of a day and its intensity (hours / day length). */
export function dayKind(d: DayStat): { kind: Kind; share: number } {
  const parts: [Kind, number][] = [
    ["both", d.both],
    ["sun", d.sun - d.both],
    ["earth", d.earth - d.both],
    ["none", d.hours - d.sun - d.earth + d.both],
  ];
  const [kind, v] = parts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return { kind, share: d.hours ? v / d.hours : 0 };
}

export function dayLabel(d: DayStat): string {
  return `Sun ${Math.round(d.sun)} h, Earth ${Math.round(d.earth)} h, both ${Math.round(d.both)} h`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utcLabel = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

const RANK: Record<Level, number> = { OK: 2, MARGINAL: 1, FAIL: 0 };

/** #363: why a window fails, as in a replan matrix: P = power (Sun at landing or night), C = comm (Earth at landing or gap). */
export type Cause = "P" | "C";
export function causes(w: Win, c: Conditions): Cause[] {
  const out: Cause[] = [];
  if (!w.sunAtLanding || w.nightH > c.maxNightH) out.push("P");
  if (!w.earthAtLanding || w.gapH > c.maxGapH) out.push("C");
  return out;
}

const share = (v: number, limit: number) => (limit > 0 ? v / limit : v > 0 ? Infinity : 0);

/** Share of the tighter limit (night or comm gap) left unused, 0…1; 0 for a failing window. */
export function margin(w: Win, c: Conditions): number {
  if (causes(w, c).length) return 0;
  return Math.max(0, 1 - Math.max(share(w.nightH, c.maxNightH), share(w.gapH, c.maxGapH)));
}

export type DayVerdict = { level: Level; margin: number; causes: Cause[] };

/**
 * Landing verdict per UTC day: the best landing hour of that day (OK > MARGINAL > FAIL, then the larger margin,
 * then the fewer fail causes). A day without a full mission window inside the data has no entry.
 */
export function dayVerdicts(tl: Timeline, ws: Win[], cond: Conditions): Map<string, DayVerdict> {
  const out = new Map<string, DayVerdict>();
  ws.forEach((w, i) => {
    const day = indexToUtc(tl, i).slice(0, 10);
    const v = { level: judge(w, cond).level, margin: margin(w, cond), causes: causes(w, cond) };
    const had = out.get(day);
    const better =
      !had ||
      RANK[v.level] > RANK[had.level] ||
      (v.level === had.level && (v.margin > had.margin || (v.level === "FAIL" && v.causes.length < had.causes.length)));
    if (better) out.set(day, v);
  });
  return out;
}

export function dayLevels(tl: Timeline, ws: Win[], cond: Conditions): Map<string, Level> {
  return new Map([...dayVerdicts(tl, ws, cond)].map(([d, v]) => [d, v.level]));
}

export const BEST_DAYS = 30;
/** #435: what the count means; Mission replan counts one hour per day over 31 days, so it can differ. */
export const LAND_DAYS_LABEL = `Days with any passing landing hour, next ${BEST_DAYS} d`;
export const LAND_DAYS_TIP =
  `A UTC day counts if at least one hourly landing start in it passes; "of" = days with data. ` +
  `Mission replan counts one start per day at the plan's hour, day 0 to +30.`;

/** The landing hour with the largest margin in the next BEST_DAYS days from `from`; -1 when none passes. */
export function bestLanding(tl: Timeline, ws: Win[], cond: Conditions, from: number): number {
  const end = Math.min(ws.length, Math.max(0, from) + Math.round((BEST_DAYS * 24 * 60) / tl.stepMin));
  let best = -1;
  for (let i = Math.max(0, from); i < end; i++) {
    if (judge(ws[i], cond).level === "FAIL") continue;
    if (best < 0 || margin(ws[i], cond) > margin(ws[best], cond)) best = i;
  }
  return best;
}

/** #363: the answer first: the best landing of the next 30 days, its margin, and three numbers. */
function BestLanding({
  tl,
  ws,
  cond,
  atUtc,
  days,
  onPick,
}: {
  tl: Timeline;
  ws: Win[];
  cond: Conditions;
  atUtc: string;
  days: Map<string, DayVerdict>;
  onPick: (t: string) => void;
}) {
  const best = bestLanding(tl, ws, cond, utcToIndex(tl, atUtc));
  const w = best >= 0 ? ws[best] : null;
  const from = Date.parse(`${atUtc.slice(0, 10)}T00:00:00Z`);
  let fit = 0;
  let good = 0;
  for (let k = 0; k < BEST_DAYS; k++) {
    const v = days.get(new Date(from + k * 86_400_000).toISOString().slice(0, 10));
    if (!v) continue;
    fit++;
    if (v.level !== "FAIL") good++;
  }
  const night = w ? share(w.nightH, cond.maxNightH) : 0;
  const gap = w ? share(w.gapH, cond.maxGapH) : 0;
  const left = !w
    ? ""
    : w.nightH === 0 && w.gapH === 0
      ? "no night and no comm gap in the window"
      : night >= gap
        ? `margin ${num(cond.maxNightH - w.nightH)} h to the night limit`
        : `margin ${num(cond.maxGapH - w.gapH)} h to the comm-gap limit`;
  const kpi = (label: string, v: number | null, limit: number) => (
    <div>
      <dt className="hud-label">{label}</dt>
      <dd>
        {v === null ? "—" : num(v)}
        <span className="hud-unit"> of {num(limit)} h</span>
      </dd>
    </div>
  );
  return (
    <div className="calendar-best" aria-label="Best landing">
      <p className="calendar-best-line">
        {w ? (
          <>
            Best landing: <strong>{utcLabel(indexToUtc(tl, best))}</strong>, {left}.{" "}
            <button type="button" onClick={() => onPick(indexToUtc(tl, best))}>Go to it</button>
          </>
        ) : (
          <>No suitable landing in the next {BEST_DAYS} d.</>
        )}
      </p>
      <dl className="calendar-kpis">
        <div>
          <dt className="hud-label" title={LAND_DAYS_TIP}>{LAND_DAYS_LABEL}</dt>
          <dd>
            {good}
            <span className="hud-unit"> of {fit}</span>
          </dd>
        </div>
        {kpi("Longest night, best window", w ? w.nightH : null, cond.maxNightH)}
        {kpi("Longest comm gap, best window", w ? w.gapH : null, cond.maxGapH)}
      </dl>
    </div>
  );
}

const num = (x: number) => String(Math.round(x * 10) / 10);

/** Headline of one site: the verdict for a landing at `atUtc` and the nearest suitable landing. */
function LandingVerdict({
  tl,
  ws,
  cond,
  atUtc,
  onPick,
}: {
  tl: Timeline;
  ws: Win[];
  cond: Conditions;
  atUtc: string;
  onPick: (t: string) => void;
}) {
  const at = utcToIndex(tl, atUtc);
  const here = verdictAt(tl, ws, cond, atUtc);
  const nearest = findWindow(ws, cond, at);
  const level: Level | "NONE" = here ? here.level : "NONE";
  const goText = (i: number) => utcLabel(indexToUtc(tl, i));
  let reason: string;
  if (here) reason = here.reason;
  else if (at < 0) reason = "This date is before the precomputed range.";
  else reason = `A ${cond.days} d mission from this date does not fit the precomputed range.`;
  return (
    <div className="landing-verdict" aria-label="Landing window verdict">
      <p className={`landing-level landing-${level.toLowerCase()}`}>
        <strong>{level === "NONE" ? "NO DATA" : level}</strong> <span>{reason}</span>
      </p>
      {nearest >= 0 && nearest !== at && (
        <p className="landing-nearest">
          <span className="hud-label">Nearest suitable landing</span> <strong>{goText(nearest)}</strong>{" "}
          <span className="landing-tag">{judge(ws[nearest], cond).level}</span>{" "}
          <button type="button" onClick={() => onPick(indexToUtc(tl, nearest))}>Go to it</button>
        </p>
      )}
      {nearest >= 0 && nearest === at && <p className="landing-nearest">This landing hour is the nearest suitable one.</p>}
      {nearest < 0 && <p className="landing-none">{explainNoWindow(tl, ws, cond).reason}</p>}
    </div>
  );
}

/** Number input that keeps the raw text while typing; commits only a valid number, clamped. */
function NumberField({ text, value, min, max, step, onCommit }: { text: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void }) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => setRaw((r) => (Number(r) === value ? r : String(value))), [value]);
  return (
    <label>
      {text}{" "}
      <input
        type="number" min={min} max={max} step={step} value={raw}
        onChange={(e) => {
          setRaw(e.target.value);
          const v = e.target.valueAsNumber;
          if (Number.isFinite(v)) onCommit(Math.min(max, Math.max(min, v)));
        }}
        onBlur={() => setRaw(String(value))}
      />
    </label>
  );
}

function MissionConditions({ cond, preset, onChange }: { cond: Conditions; preset: string | null; onChange: (c: Conditions, preset: string | null) => void }) {
  const field = (key: keyof Conditions, text: string, min: number, max: number, step: number) => (
    <NumberField text={text} value={cond[key]} min={min} max={max} step={step} onCommit={(v) => onChange({ ...cond, [key]: v }, null)} />
  );
  return (
    <fieldset className="landing-conditions hud-bar">
      <legend className="sr-only">Mission and limits (planning values, editable)</legend>
      <span className="hud-seg landing-presets">
        <span className="hud-label">Mission</span>
        {PRESETS.map((p) => (
          <button
            type="button" key={p.id} aria-pressed={preset === p.id}
            onClick={() => onChange({ days: p.days, maxNightH: p.maxNightH, maxGapH: p.maxGapH }, p.id)}
          >
            {p.label}
          </button>
        ))}
        <SlideMark />
      </span>
      <span className="hud-label">
        Limits
        {/* #210, #323: the disclaimer folds behind "?" (the text stays in the DOM): on a phone it took the whole sheet. */}
        <Info label="What the calendar checks">
          {GEO_CAVEAT} Mission limits are editable planning assumptions, not NASA mission requirements. Site slope and science value are
          not calculated. This is not a landing safety assessment: engines, guidance and sensors are not modelled.
        </Info>
      </span>
      {field("days", "Duration, days", 1, 30, 0.5)}
      {field("maxNightH", "Max night, h", 0, 720, 1)}
      {field("maxGapH", "Max comm gap, h", 0, 720, 1)}
    </fieldset>
  );
}

function SiteCalendar({ site, atUtc, cond, onPick }: { site: Site; atUtc: string; cond: Conditions; onPick: (t: string) => void }) {
  const [tl, setTl] = useState<Timeline | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<DayStat | null>(null);
  useEffect(() => {
    let live = true;
    setTl(undefined);
    setError(null);
    loadFullTimeline(site).then((t) => live && setTl(t), (e) => { if (live) { setError(String(e)); setTl(null); } });
    return () => {
      live = false;
    };
  }, [site]);
  const stats = useMemo(() => {
    if (!tl) return null;
    const months = new Map<string, DayStat[]>();
    for (const d of dailyStats(tl)) {
      const m = d.day.slice(0, 7);
      if (!months.has(m)) months.set(m, []);
      months.get(m)!.push(d);
    }
    return {
      months,
      dark: longestRun(tl, (i) => tl.sunVisible[i] <= 0),
      comm: longestRun(tl, (i) => tl.sunVisible[i] > 0 && tl.earthVisible[i] > 0),
    };
  }, [tl]);
  const ws = useMemo(() => (tl ? scanWindows(tl, cond.days) : []), [tl, cond.days]);
  // Mock data gives no landing verdict: the grid shows only the Sun and Earth hours.
  const days = useMemo(() => (tl && !tl.stub ? dayVerdicts(tl, ws, cond) : new Map<string, DayVerdict>()), [tl, ws, cond]);

  if (tl === undefined) return <p>Loading {site.name}…</p>;
  if (tl === null || !stats)
    return (
      <section className="calendar-site" aria-label={`Calendar ${site.name}`}>
        <h3>{site.name}</h3>
        {error ? <p role="alert">Timeline failed to load: {error}</p> : <p className="stub">No precomputed timeline for this site: no calendar.</p>}
      </section>
    );

  const { months, dark, comm } = stats;
  const today = atUtc.slice(0, 10);
  const at = utcToIndex(tl, atUtc);
  const here = verdictAt(tl, ws, cond, atUtc);
  const nearest = tl.stub ? -1 : findWindow(ws, cond, at);
  const nearestDay = nearest >= 0 ? indexToUtc(tl, nearest).slice(0, 10) : null;
  const next = tl.stub ? -1 : nextWindow(ws, cond, at);
  const share = (x: number | undefined) => (x === undefined ? "—" : fmtShare(x));
  const run = (label: string, r: Run) => (
    <div>
      <dt title={`Over the whole precomputed window, ${DATA_PERIOD}; not only this mission.`}>{label}</dt>
      <dd>
        {r ? fmtDuration(r.hours) : "none"}
        <span>{r ? `, ${r.startUtc} → ${r.endUtc} UTC` : " in range"}</span>
      </dd>
    </div>
  );
  const CAUSE_WORD: Record<Cause, string> = { P: "power: night or Sun at landing", C: "comm: gap or Earth at landing" };
  const levelWord = (v: DayVerdict | undefined) =>
    !v
      ? "window does not fit the data"
      : v.level === "FAIL"
        ? `no landing (${v.causes.map((c) => CAUSE_WORD[c]).join("; ")})`
        : `${v.level === "OK" ? "can land" : "marginal"}, ${Math.round(v.margin * 100)} % of the tighter limit left`;

  return (
    <section className="calendar-site" aria-label={`Calendar ${site.name}`}>
      <h3>{site.name}</h3>
      {site.terrain === "none" && <p className="stub">Bare sphere: no terrain.</p>}
      {tl.stub ? (
        <p className="stub">Mock data: synthetic visibility.</p>
      ) : (
        <>
          <BestLanding tl={tl} ws={ws} cond={cond} atUtc={atUtc} days={days} onPick={onPick} />
          <LandingVerdict tl={tl} ws={ws} cond={cond} atUtc={atUtc} onPick={onPick} />
        </>
      )}
      <NextWindows siteId={site.id} atUtc={atUtc} onPick={onPick} compact />
      <div className="hud-frame calendar-frame">
        <div className="calendar-grid" role="grid" aria-label={`Days ${site.name}`} onMouseLeave={() => setHover(null)}>
          {[...months].map(([m, list]) => {
            return (
              <div className="calendar-row" role="row" key={m}>
                <span className="calendar-month" role="rowheader">
                  {MONTHS[+m.slice(5) - 1]} {m.slice(0, 4)}
                </span>
                {list.map((d) => {
                  const { kind } = dayKind(d);
                  const v = days.get(d.day);
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      key={d.day}
                      data-kind={kind}
                      data-level={v?.level ?? "none"}
                      data-cause={v?.causes.join("") || undefined}
                      style={v && v.level !== "FAIL" ? ({ "--m": v.margin.toFixed(2) } as CSSProperties) : undefined}
                      className={`calendar-day${d.day === today ? " calendar-at" : ""}${d.day === nearestDay ? " calendar-nearest" : ""}`}
                      aria-label={`${d.day}: ${dayLabel(d)}`}
                      aria-selected={d.day === today}
                      title={`${d.day}: ${dayLabel(d)} — ${levelWord(v)}`}
                      onMouseEnter={() => setHover(d)}
                      onFocus={() => setHover(d)}
                      onClick={() => onPick(`${d.day}T00:00:00Z`)}
                    >
                      {v?.level === "FAIL" && <b aria-hidden="true">{v.causes.join("")}</b>}
                      <i className="calendar-tick-sun" style={{ width: `${(100 * d.sun) / d.hours}%` }} />
                      <i className="calendar-tick-earth" style={{ width: `${(100 * d.earth) / d.hours}%` }} />
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="hud-corners">
          <CalendarLegend days={cond.days} />
          <span className="calendar-hover" aria-live="polite">
            {hover
              ? `${hover.day}: ${dayLabel(hover)} — ${levelWord(days.get(hover.day))}`
              : "Hover a day for hours; click it to set the time."}
          </span>
        </div>
      </div>
      <dl className="calendar-runs">
        <div>
          <dt>This window</dt>
          <dd>
            Sun lit {share(here?.win.sunShare)}, Earth in view {share(here?.win.earthShare)}
            <span> (share of the {cond.days} d mission window from {utcLabel(atUtc)})</span>
          </dd>
        </div>
        {run("Longest dark period", dark)}
        {run("Longest Sun + Earth window", comm)}
        {next >= 0 && (
          <div>
            <dt>Next separate window</dt>
            <dd>
              {utcLabel(indexToUtc(tl, next))}{" "}
              <button type="button" onClick={() => onPick(indexToUtc(tl, next))}>Next window</button>
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}

function CalendarLegend({ days }: { days: number }) {
  return (
    <ul className="calendar-legend">
      <li><i className="calendar-key-ok" /> can land ({days} d mission), brighter = more margin</li>
      <li><i className="calendar-key-marginal" /> marginal</li>
      <li><i className="calendar-key-p">P</i> no: power</li>
      <li><i className="calendar-key-c">C</i> no: comm</li>
      <li><i className="calendar-key-sun" /> Sun hours</li>
      <li><i className="calendar-key-earth" /> Earth hours</li>
      <li><i className="calendar-key-near" /> nearest suitable</li>
    </ul>
  );
}

/** #210: the mission limits live in the app: the Mission plan card judges with the same ones. */
export function Calendar(p: { sites: Site[]; atUtc: string; onPick: (t: string) => void; limits?: Limits; onLimits?: (l: Limits) => void }) {
  const { sites, atUtc, onPick } = p;
  const [own, setOwn] = useState<Limits>(DEFAULT_LIMITS);
  const { cond, preset } = p.limits ?? own;
  const onLimits = p.onLimits ?? setOwn;
  return (
    <section className="calendar hud-screen" aria-label="Visibility calendar">
      <MissionConditions cond={cond} preset={preset} onChange={(c, p) => onLimits({ cond: c, preset: p })} />
      {sites.length === 0 && <p>Pick a site with a known point.</p>}
      {sites.slice(0, 4).map((s) => (
        <SiteCalendar key={s.id} site={s} atUtc={atUtc} cond={cond} onPick={onPick} />
      ))}
      <details className="hud-notes">
        <summary>How to read</summary>
        <p>
          One cell = one UTC day, judged by its best landing hour against the limits above. Light = can land: the
          brighter, the more of the tighter limit (night or comm gap) is left. Grey = marginal. A letter = no landing
          and why: P = power (night too long or Sun below the horizon at landing), C = comm (comm gap too long or Earth
          below the horizon at landing). The red bar = Sun hours, the blue
          bar = Earth hours of that day. Sun lit = any part of the disc above the terrain; Earth in view = the Earth centre
          above the terrain (geometry only). Mission limits are planning
          values: edit them above.
        </p>
      </details>
    </section>
  );
}
