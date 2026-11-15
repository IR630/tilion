// Route score parts (#160): the per-term breakdown bar, the "how the score works" note, the full
// parameter list of an option, and the traverse section (comms per leg, JSON import/export).
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { loadFullTimeline } from "../api";
import type { Site } from "../contracts";
import { indexAt, type Metrics, type RouteOption } from "../route/route";
import type { Hours } from "../route/hours";
import { commsWindows, lightWindows, type Score, type ScoreMode, scoreOf, TERMS, WEIGHTS } from "../route/score";
import { energyMargin } from "../energy/energy";
import { fmtDuration } from "../format";
import { Icon } from "../ui/icons";
import { parseRouteJson, ROUTE_JSON_EXAMPLE, routeToJson } from "./routeJson";
import { COMMS_GOOD, COMMS_POOR, ROVER_M_PER_H } from "./traverse";
import type { TraverseState } from "./useTraverse";
import type { MissionPlan, MissionState } from "./types";
import "./score.css";

const pct = (x: number) => `${Math.round(100 * x)} %`;
const h = (x: number) => `${Math.round(x)} h`; // option parameters (the window is ≤ 60 d); drive times use fmtDuration
const LABEL = Object.fromEntries(TERMS.map((t) => [t.id, t.label]));

/** Stacked bar: one segment per term, width = its points out of 100. */
export function ScoreBar({ score }: { score: Score }) {
  const title = score.terms.map((t) => `${LABEL[t.id]} ${t.points.toFixed(1)} of ${Math.round(100 * t.weight)}`).join(", ");
  return (
    <span className="sc-bar" role="img" aria-label={`Score breakdown: ${title}`} title={title}>
      {score.terms.map((t) => (
        <i key={t.id} className={`sc-${t.id}`} style={{ width: `${t.points}%` }} />
      ))}
    </span>
  );
}

export function ScoreKey({ mode }: { mode: ScoreMode }) {
  const w = WEIGHTS[mode];
  return (
    <details className="sc-how">
      <summary>How the score works</summary>
      <p>
        Score = 100 × Σ weight × term. Each term is 0–1, measured hour by hour in the window. Hourly data: hours ±1 h, score ±1
        point. Weights follow the ranking mode.
      </p>
      <table>
        <tbody>
          {TERMS.map((t) => (
            <tr key={t.id}>
              <td>
                <i className={`sc-dot sc-${t.id}`} aria-hidden="true" />
                {t.label}
              </td>
              <td className="sc-w">{Math.round(100 * w[t.id])}</td>
              <td>
                {t.what}. <span className="sc-src">{t.source}.</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Light and comms windows of an option in its window, from hours.json. */
export function windowCounts(hours: Hours | null, o: { siteId: string; landingUtc: string; windowH: number }) {
  const s = hours?.sites.get(o.siteId);
  if (!hours || !s) return null;
  const i0 = indexAt(hours, Date.parse(o.landingUtc));
  const i1 = i0 + Math.round((o.windowH * 60) / hours.stepMin);
  return { light: lightWindows(s, i0, i1), comms: commsWindows(s, i0, i1) };
}

type Extra = { dsn: number | null; elMin: number; elMax: number; energy: string | null } | null;
/** DSN share, Sun elevation range and energy margin (VIPER-class, #235) of the window, from the site timeline (loaded on demand). */
function useTimelineExtra(site: Site | undefined, landingUtc: string, windowH: number): Extra | "loading" {
  const [x, setX] = useState<Extra | "loading">("loading");
  useEffect(() => {
    if (!site) return;
    let live = true;
    loadFullTimeline(site).then((tl) => {
      if (!live) return;
      if (!tl) return setX(null);
      const i0 = Math.floor((Date.parse(landingUtc) - Date.parse(tl.startUtc)) / (tl.stepMin * 60_000));
      const i1 = Math.min(tl.sunEl.length, i0 + Math.round((windowH * 60) / tl.stepMin));
      if (!(i0 >= 0 && i1 > i0)) return setX(null);
      const el = tl.sunEl.slice(i0, i1);
      const dsn = tl.dsnVisible ? tl.dsnVisible.slice(i0, i1).reduce((a, b) => a + (b > 0 ? 1 : 0), 0) / (i1 - i0) : null;
      setX({ dsn, elMin: Math.min(...el), elMax: Math.max(...el), energy: energyMargin(tl, landingUtc, windowH / 24) });
    }, () => live && setX(null));
    return () => {
      live = false;
    };
  }, [site, landingUtc, windowH]);
  return x;
}

/** Every parameter of an option, with units and the period. */
export function OptionParams({ o, site, hours, mode }: { o: RouteOption; site: Site | undefined; hours: Hours | null; mode: ScoreMode }) {
  const s = scoreOf(o, mode);
  const n = windowCounts(hours, o);
  const x = useTimelineExtra(site, o.landingUtc, o.windowH);
  const row = (k: string, v: string, title?: string) => (
    <div title={title}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
  return (
    <>
      <dl className="sc-params" aria-label="Route parameters">
        {row("Window", `${h(o.windowH)} from landing`)}
        {row("Distance", o.distanceKm === 0 ? "same site" : `${o.distanceKm < 10 ? o.distanceKm.toFixed(1) : Math.round(o.distanceKm)} km from plan`)}
        {row("Sunlit", `${h(o.sunH)} (${pct(o.sunH / o.windowH)})`)}
        {row("Earth in view", `${h(o.earthH)} (${pct(o.earthH / o.windowH)})`, "Earth centre above the terrain horizon")}
        {row("DSN in view", x === "loading" ? "…" : x?.dsn == null ? "no data" : pct(x.dsn), "A DSN station clears the site's horizon and sees the Moon above 10°, the DSN uplink limit (DSN 810-005, module 301P); not in the score")}
        {row("Longest night", `${h(o.longestDarkH)}${s.nightOverLimit ? ", over 50 h" : ""}`)}
        {row("Longest comms gap", h(o.longestNoCommsH))}
        {row("Light windows", n ? String(n.light) : "—", "Separate runs with the Sun visible")}
        {row("Comms windows", n ? String(n.comms) : "—", "Separate runs with the Earth centre in view")}
        {row("Sun elevation", x === "loading" ? "…" : x ? `${x.elMin.toFixed(1)}…${x.elMax.toFixed(1)}°` : "no data", "Sun centre over the flat local horizon, min…max in the window")}
        {row("Energy margin", x === "loading" ? "…" : x?.energy ?? "no data", "Battery over the window, VIPER-class: panel 320 W tracking the Sun, battery 5,420 Wh, loads 174/108 W (NASA NTRS 20240013903, 20220013310). Not in the score")}
        {row("Sunset after landing", o.hoursToSunset === null ? "dark landing" : `${o.sunsetBeyondData ? "> " : ""}${h(o.hoursToSunset)}`)}
      </dl>
      <dl className="sc-terms" aria-label="Score terms">
        {s.terms.map((t) => (
          <div key={t.id}>
            <dt>
              <i className={`sc-dot sc-${t.id}`} aria-hidden="true" />
              {LABEL[t.id]}
            </dt>
            <dd>
              {t.value.toFixed(2)} × {Math.round(100 * t.weight)} = {t.points.toFixed(1)}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** The score line of the plan card. */
export function PlanScore({ m, mode }: { m: Metrics; mode: ScoreMode }) {
  const s = scoreOf(m, mode);
  return (
    <div className="sc-plan">
      <span className="sc-num">
        <b>{Math.round(s.total)}</b>
        <span>score / 100</span>
      </span>
      <ScoreBar score={s} />
      {s.nightOverLimit && <span className="sc-flag">night over 50 h</span>}
    </div>
  );
}

// ---------- Traverse ----------

export function TraversePanel({ state, plan, onMission }: { state: TraverseState; plan: MissionPlan; onMission: Dispatch<SetStateAction<MissionState>> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const tr = state.traverse;
  const apply = (t: string) => {
    const r = parseRouteJson(t);
    if ("errors" in r) {
      setErrors(r.errors);
      return;
    }
    setErrors([]);
    setOpen(false);
    onMission((m) => (m.plan ? { ...m, plan: { ...m.plan, waypoints: r.points } } : m));
  };
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([routeToJson(plan.waypoints ?? [])], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "tilion-route.json";
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const s = tr?.input ? scoreOf(tr.input, plan.mode) : null;
  return (
    <section className="tr" aria-label="Traverse">
      <h3>
        <span>Traverse</span>
        <span className="rp-count">{tr ? `${tr.km < 10 ? tr.km.toFixed(1) : Math.round(tr.km)} km` : ""}</span>
      </h3>
      <p className="rp-sub">
        Landing site → WP1 → WP2 …, from the landing time at {ROVER_M_PER_H} m/h (1 cm/s: the VIPER planning mean with stops; the profile below uses the same speed). Each hour
        reads the nearer leg end: the landing site uses its precomputed timeline, waypoints are computed in your browser from LOLA 240 m.
      </p>
      <div className="rp-row">
        <button type="button" className="rp-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          Import JSON
        </button>
        <button type="button" className="rp-btn" disabled={!plan.waypoints?.length} onClick={exportJson}>
          Export JSON
        </button>
      </div>
      {open && (
        <div className="tr-import">
          <textarea
            aria-label="Route points JSON"
            rows={5}
            spellCheck={false}
            placeholder={ROUTE_JSON_EXAMPLE}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <p className="rp-muted">
            [{"{"}"name", "lat", "lon"{"}"}, …] — lat −60…−90, lon 0–360°E. The points replace the waypoints; the route starts at the landing site.
          </p>
          <div className="rp-row">
            <button type="button" className="rp-btn primary" onClick={() => apply(text)}>
              Build route
            </button>
            <button type="button" className="rp-btn" onClick={() => file.current?.click()}>
              From file
            </button>
            <input
              ref={file}
              type="file"
              accept=".json,application/json"
              hidden
              aria-label="Route points file"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                const t = await f.text();
                setText(t);
                apply(t);
              }}
            />
          </div>
          {errors.length > 0 && (
            <div className="rp-alert" role="alert">
              <b>Route not built:</b>
              <ul>
                {errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
              <button type="button" aria-label="Dismiss" onClick={() => setErrors([])}>
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
        </div>
      )}

      {!tr && <p className="rp-muted">Add waypoints on the map or import JSON to build a traverse.</p>}
      {tr && (
        <>
          <p className="tr-legend" aria-label="Comms legend">
            Comms on a leg, Earth centre in view while driving it (display bins, not a standard): <i className="tr-sw good" /> ≥ {pct(COMMS_GOOD)} <i className="tr-sw partial" /> {pct(COMMS_POOR)}–{pct(COMMS_GOOD)}{" "}
            <i className="tr-sw poor" /> &lt; {pct(COMMS_POOR)} <i className="tr-sw pending" /> computing
          </p>
          {state.pending > 0 && <p className="rp-muted">Computing horizons: {state.pending} point(s) left…</p>}
          {state.failed.length > 0 && <p className="rp-alert">No timeline for: {state.failed.join(", ")}.</p>}
          {s && tr.input && (
            <div className="tr-score" data-testid="traverse-score">
              <div className="sc-plan">
                <span className="sc-num">
                  <b>{Math.round(s.total)}</b>
                  <span>score / 100</span>
                </span>
                <ScoreBar score={s} />
                {s.nightOverLimit && <span className="sc-flag">night over 50 h</span>}
              </div>
              <p className="rp-opt-small">
                <span>Drive {fmtDuration(tr.hours)}</span>
                <span>Sunlit {pct(tr.input.sunH / tr.input.windowH)}</span>
                <span>Earth {pct(tr.input.earthH / tr.input.windowH)}</span>
                <span>Longest night {fmtDuration(tr.input.longestDarkH)}</span>
                <span>Longest gap {fmtDuration(tr.input.longestNoCommsH)}</span>
                <span>{tr.input.sunWindows} light / {tr.input.commsWindows} comms windows</span>
              </p>
            </div>
          )}
          {tr.clipped && <p className="rp-alert">The drive runs past the data end (Dec 2027): later hours are not counted.</p>}
          {tr.noTerrain.length > 0 && <p className="rp-muted">No LOLA terrain (bare sphere) at: {tr.noTerrain.join(", ")}.</p>}
          <ol className="tr-legs" aria-label="Traverse legs">
            {tr.legs.map((l, i) => (
              <li key={i} className={`tr-leg ${l.level}`} data-level={l.level} data-testid="traverse-leg">
                <i className={`tr-sw ${l.level}`} aria-hidden="true" />
                <span className="tr-leg-name">
                  {l.from} → {l.to}
                </span>
                <span className="tr-leg-facts">
                  {l.km < 10 ? l.km.toFixed(2) : Math.round(l.km)} km, {fmtDuration(l.hours)}
                  {l.earthShare !== null && `, Earth ${pct(l.earthShare)}`}
                  {l.dsnShare !== null && `, DSN ${pct(l.dsnShare)}`}
                  {l.sunShare !== null && `, Sun ${pct(l.sunShare)}`}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
