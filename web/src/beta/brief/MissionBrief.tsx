// BETA printable mission brief (#326). One mount in mission/RoutePanel.tsx (footer), behind BETA.brief.
// "Print brief" calls window.print(); the sheet below is hidden on screen and is the only thing on paper
// (brief.css, @media print, A4). The sheet computes nothing new: every value comes from the same objects
// as the Mission panel (Metrics of the plan and the option cards, planFacts of PlanVerdict, the score,
// validation.json of the NASA check screen, uncertainty.json of the place card).
// The sheet includes a reproduce link, planning-aid disclaimer and criteria with values and results.
import { useEffect, useMemo, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import type { Site, ValidationFile } from "../../contracts";
import { BUILD_LABEL } from "../../buildInfo";
import { DATA_PERIOD, fmtLatLon } from "../../format";
import { type Conditions } from "../../landing";
import { VIPER } from "../../energy/energy";
import { n, planFacts, type PlanFacts, useFullTimeline } from "../../mission/PlanVerdict";
import { fmtH, fmtKm, fmtSlip, fmtUntil, fmtWhen, MODE_INFO } from "../../mission/RoutePanel";
import type { MissionState, MissionPlan } from "../../mission/types";
import type { Metrics, RouteOption } from "../../route/route";
import { scoreOf } from "../../route/score";
import { siteChecks, useValidation } from "../../screens/Validation";
import { GEO_CAVEAT } from "../../ui/Info";
import { BETA } from "../flags";
import { BetaTag } from "../BetaTag";
import { fmtBand, loadUncertainty, type UncertaintyRow } from "../uncertainty/uncertainty";
import "../beta.css";
import "./brief.css";

const TERRAIN: Record<Site["terrain"], string> = {
  polar80: "LOLA 20 + 80 + 240 m nested DEM (80–90°S)",
  polar240: "LOLA 240 m DEM (60–90°S)",
  none: "No terrain coverage: bare sphere with a flat horizon",
};

/** The option the brief shows next to the plan: the selected one, else the best-ranked option that is not the plan. */
export function briefAlternative(mission: MissionState, options: RouteOption[]): { o: RouteOption; chosen: boolean } | null {
  const plan = mission.plan;
  if (mission.selected) return { o: mission.selected, chosen: true };
  const o = options.find((x) => !(plan && x.siteId === plan.siteId && x.slipDays === 0));
  return o ? { o, chosen: false } : null;
}

function useUncertaintyRow(siteId: string): UncertaintyRow | null {
  const [row, setRow] = useState<UncertaintyRow | null>(null);
  useEffect(() => {
    if (!BETA.uncertainty) return;
    let live = true;
    loadUncertainty().then((f) => live && setRow(f?.sites.find((s) => s.siteId === siteId) ?? null));
    return () => {
      live = false;
    };
  }, [siteId]);
  return row;
}

function useFacts(site: Site | undefined, landingUtc: string | undefined, limits: Conditions): PlanFacts | null {
  const tl = useFullTimeline(site);
  return useMemo(() => (tl && landingUtc && tl.siteId === site?.id ? planFacts(tl, limits, landingUtc) : null), [tl, site, landingUtc, limits]);
}

type Props = {
  plan: MissionPlan;
  pm: Metrics;
  options: RouteOption[];
  mission: MissionState;
  byId: Map<string, Site>;
  limits: Conditions;
};

/** The footer button and the print-only sheet (a portal on body, so @media print can hide the rest of the app). */
export function PrintBrief({ plan, pm, options, mission, byId, limits }: Props) {
  const site = byId.get(plan.siteId);
  const alt = briefAlternative(mission, options);
  const altSite = alt ? byId.get(alt.o.siteId) : undefined;
  const facts = useFacts(site, plan.landingUtc, limits);
  const altFacts = useFacts(altSite, alt?.o.landingUtc, limits);
  const validation = useValidation();
  const unc = useUncertaintyRow(plan.siteId);
  const nameOf = (id: string) => byId.get(id)?.name ?? id;
  // #326 review: the link and the time are read when printing starts (button or Ctrl+P), not at render:
  // the plan link reaches the address bar in an effect after the render.
  const [stamp, setStamp] = useState(() => ({ url: window.location.href, utc: new Date().toISOString() }));
  useEffect(() => {
    const now = () => flushSync(() => setStamp({ url: window.location.href, utc: new Date().toISOString() }));
    window.addEventListener("beforeprint", now);
    return () => window.removeEventListener("beforeprint", now);
  }, []);
  const original = mission.original && (mission.original.siteId !== plan.siteId || mission.original.landingUtc !== plan.landingUtc) ? mission.original : null;
  return (
    <>
      <button type="button" className="rp-btn mb-print-btn" onClick={() => window.print()} title="Print the mission brief, or choose Save as PDF in the print dialog">
        <BetaTag />
        Print brief
      </button>
      {createPortal(
        <BriefSheet
          plan={plan}
          site={site}
          pm={pm}
          facts={facts}
          alt={alt && { ...alt, site: altSite, facts: altFacts }}
          original={original && `${nameOf(original.siteId)}, ${fmtWhen(original.landingUtc)} UTC`}
          validation={validation ?? null}
          unc={unc}
          url={stamp.url}
          generatedUtc={stamp.utc}
        />,
        document.body,
      )}
    </>
  );
}

export type SheetProps = {
  plan: MissionPlan;
  site: Site | undefined;
  pm: Metrics;
  facts: PlanFacts | null;
  alt: { o: RouteOption; chosen: boolean; site: Site | undefined; facts: PlanFacts | null } | null;
  original: string | null;
  validation: ValidationFile | null;
  unc: UncertaintyRow | null;
  url: string;
  generatedUtc: string;
};

const utc = (iso: string) => iso.slice(0, 16).replace("T", " ") + " UTC";

function Verdict({ f }: { f: PlanFacts | null }) {
  if (!f) return <p className="mb-muted">No verdict: this site has no precomputed timeline (mock data).</p>;
  return (
    <div className={`mb-verdict is-${f.level.toLowerCase().replace(" ", "-")}`} data-testid="brief-verdict">
      <p className="mb-verdict-line">
        <b className="mb-verdict-tag">{f.level}</b> <span data-testid="brief-rule">{f.rule}</span>
      </p>
      <p className="mb-note">{f.note}</p>
      {f.battery && <p className="mb-note" data-testid="brief-battery">Energy (VIPER-class): {f.battery}</p>}
    </div>
  );
}

/** Hard limits as a table: what the rule asks, what the plan gives, and the result (same Win as the verdict). */
function LimitsTable({ f }: { f: PlanFacts }) {
  const v = f.verdict;
  if (!v) return null;
  const w = v.win;
  const c = f.limits;
  const r = (ok: boolean) => <td className={ok ? "mb-pass" : "mb-fail"}>{ok ? "PASS" : "FAIL"}</td>;
  const h = (x: number) => `${n(x)} h`;
  return (
    <table className="mb-table" aria-label="Hard limits">
      <thead>
        <tr>
          <th>Limit</th>
          <th>Required</th>
          <th>This plan</th>
          <th>Result</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Sun at landing</td>
          <td>up</td>
          <td>{w.sunAtLanding ? "up" : "down"}</td>
          {r(w.sunAtLanding)}
        </tr>
        <tr>
          <td>Earth at landing</td>
          <td>in view</td>
          <td>{w.earthAtLanding ? "in view" : "hidden"}</td>
          {r(w.earthAtLanding)}
        </tr>
        <tr>
          <td>Longest night</td>
          <td>≤ {h(c.maxNightH)}</td>
          <td data-testid="brief-night">{h(w.nightH)}</td>
          {r(w.nightH <= c.maxNightH)}
        </tr>
        <tr>
          <td>Longest comm gap</td>
          <td>≤ {h(c.maxGapH)}</td>
          <td data-testid="brief-gap">{h(w.gapH)}</td>
          {r(w.gapH <= c.maxGapH)}
        </tr>
      </tbody>
    </table>
  );
}

/** The plan-card numbers, same labels and formats as PlanCard. */
function WindowHours({ m, days }: { m: Metrics; days: number }) {
  const cell = (k: string, v: number, title?: string) => (
    <div title={title}>
      <dt>{k}</dt>
      <dd data-k={k}>{fmtH(v)}</dd>
    </div>
  );
  return (
    <>
      <p className="mb-k">
        In the {fmtH(m.windowH)} window{m.windowClipped && `, cut by the data end (${fmtH(m.windowH)} of ${fmtH(days * 24)})`}
      </p>
      <dl className="mb-metrics" aria-label="Window hours">
        {cell("Sun", m.sunH)}
        {cell("Earth", m.earthH)}
        {cell("Both", m.bothH)}
        {cell("Dark", m.longestDarkH, "Longest run without Sun")}
        {cell("Earth hidden", m.longestNoCommsH, "Longest run without Earth centre visibility")}
      </dl>
    </>
  );
}

const sunAtLanding = (m: Metrics) => (m.sunUpAtLanding ? `Up, sets in ${fmtUntil(m.hoursToSunset, m.sunsetBeyondData)}` : "Down, dark landing");
const earthAtLanding = (m: Metrics) => (m.earthUpAtLanding ? `In view, sets in ${fmtUntil(m.hoursToEarthset, m.earthsetBeyondData)}` : "Hidden, centre below the terrain");

export function BriefSheet({ plan, site, pm, facts, alt, original, validation, unc, url, generatedUtc }: SheetProps) {
  const mode = MODE_INFO[plan.mode];
  const score = Math.round(scoreOf(pm, plan.mode).total);
  const end = new Date(Date.parse(plan.landingUtc) + pm.windowH * 3600_000).toISOString();
  const checks = validation && site ? siteChecks(validation, site.id) : null;
  const smooth = site?.terrain === "none";
  return (
    <article className="mb-sheet" aria-label="Mission brief">
      <header className="mb-head">
        <p className="mb-eyebrow">
          Tilion mission brief <BetaTag />
        </p>
        <h1>{plan.name || "Untitled mission"}</h1>
        <p className="mb-sub">
          {site?.name ?? plan.siteId}, landing {utc(plan.landingUtc)}, {plan.durationDays}-day surface window
        </p>
      </header>

      <section className="mb-sec mb-top">
        <div>
          <h2>Verdict</h2>
          <Verdict f={facts} />
        </div>
        <div>
          <h2>Plan</h2>
          <dl className="mb-kv">
            <dt>Site</dt>
            <dd>{site?.name ?? plan.siteId}</dd>
            <dt>Position</dt>
            <dd data-testid="brief-pos">{fmtLatLon(site?.lat ?? null, site?.lonE ?? null)}, MOON_ME</dd>
            <dt>Terrain</dt>
            <dd>{site ? TERRAIN[site.terrain] : "unknown"}</dd>
            <dt>Landing</dt>
            <dd>{utc(plan.landingUtc)}</dd>
            <dt>Window end</dt>
            <dd>{utc(end)}</dd>
            <dt>Route score</dt>
            <dd data-testid="brief-score">
              {score} / 100, {mode.label.toLowerCase()} weights (ranks options; the verdict checks limits)
            </dd>
          </dl>
        </div>
      </section>

      {smooth && (
        <p className="mb-warn" role="note">
          Smooth sphere, no terrain model. The horizon is flat here, so these numbers are not comparable with the LOLA alternatives.
        </p>
      )}

      <section className="mb-sec">
        <h2>Limits</h2>
        {facts ? <LimitsTable f={facts} /> : <p className="mb-muted">No verdict, so no limit table.</p>}
      </section>

      <section className="mb-sec">
        <h2>Sun and Earth</h2>
        <dl className="mb-kv">
          <dt>Sun at landing</dt>
          <dd data-testid="brief-sun">{sunAtLanding(pm)}</dd>
          <dt>Earth at landing</dt>
          <dd data-testid="brief-earth">{earthAtLanding(pm)}</dd>
        </dl>
        <WindowHours m={pm} days={plan.durationDays} />
        {unc && (
          <p className="mb-note" data-testid="brief-unc">
            Terrain ±1σ (LOLA error {unc.sigmaMedianM} m), {DATA_PERIOD}: Sun {fmtBand(unc.sun)}, Earth {fmtBand(unc.earth)}
          </p>
        )}
      </section>

      <section className="mb-sec">
        <h2>{alt ? (alt.chosen ? "Chosen alternative" : "Best-ranked alternative (not selected)") : "Alternative"}</h2>
        {original && <p className="mb-note">The plan was moved. Original plan: {original}.</p>}
        {alt ? (
          <div className="mb-alt" data-testid="brief-alt">
            <dl className="mb-kv">
              <dt>Site</dt>
              <dd>
                {alt.site?.name ?? alt.o.siteId}, {fmtLatLon(alt.site?.lat ?? null, alt.site?.lonE ?? null)}
              </dd>
              <dt>Landing</dt>
              <dd>
                {fmtWhen(alt.o.landingUtc)} UTC, {fmtSlip(alt.o.slipDays)}, {fmtKm(alt.o.distanceKm)}
              </dd>
              <dt>Route score</dt>
              <dd>{Math.round(scoreOf(alt.o, plan.mode).total)} / 100</dd>
              <dt>Verdict</dt>
              <dd>{alt.facts ? `${alt.facts.level}: ${alt.facts.rule}` : "no verdict (no precomputed timeline)"}</dd>
              {alt.facts?.battery && (
                <>
                  <dt>Energy</dt>
                  <dd>{alt.facts.battery}</dd>
                </>
              )}
              <dt>Sun at landing</dt>
              <dd>{sunAtLanding(alt.o)}</dd>
              <dt>Earth at landing</dt>
              <dd>{earthAtLanding(alt.o)}</dd>
            </dl>
            <WindowHours m={alt.o} days={plan.durationDays} />
          </div>
        ) : (
          <p className="mb-muted">No other site or date fits the slip and radius tolerances.</p>
        )}
      </section>

      <section className="mb-sec">
        <h2>Evidence</h2>
        {validation ? (
          <ul className="mb-list">
            <li data-testid="brief-checks">
              NASA check: {validation.summary.pass} of {validation.summary.checks} checks pass, {validation.summary.fail} fail (Horizons, PGDA 69, published
              eclipse and Apollo references; validation.json generated {utc(validation.generatedUtc)}).
            </li>
            <li>
              {checks
                ? `Checks that name ${site?.name}: ${checks.pass} pass, ${checks.fail} fail.`
                : `No check names ${site?.name ?? "this site"}; the checks above cover the method.`}
            </li>
          </ul>
        ) : (
          <p className="mb-muted">validation.json did not load: no check summary.</p>
        )}
      </section>

      <section className="mb-sec">
        <h2>Assumptions</h2>
        <ul className="mb-list">
          <li>Comms: {GEO_CAVEAT}</li>
          <li>Light: the Sun counts as up while any part of its disc is above the terrain. Hourly steps.</li>
          <li>Limits: team planning assumptions, not mission requirements. They are edited in the Windows panel.</li>
          <li>
            Energy: VIPER-class lander, panel {VIPER.panelW} W tracking the Sun, battery {VIPER.batteryWh.toLocaleString("en-US")} Wh, loads {VIPER.dayLoadW}/
            {VIPER.nightLoadW} W (NASA NTRS 20240013903, 20220013310).
          </li>
          <li>Planning aid only. Slopes, rocks and landing hazards are not assessed. This is not a landing-safety or mission-approval determination.</li>
        </ul>
      </section>

      <section className="mb-sec mb-repro">
        <h2>Reproduce</h2>
        <p className="mb-url">{url}</p>
        <p className="mb-note">
          Build {BUILD_LABEL}. Brief generated {utc(generatedUtc)}.
        </p>
      </section>

      <section className="mb-sec mb-sign" aria-label="Sign-off">
        <div>
          <span className="mb-line" />
          Prepared by
        </div>
        <div>
          <span className="mb-line" />
          Flight director
        </div>
        <div>
          <span className="mb-line" />
          Date (UTC)
        </div>
      </section>
    </article>
  );
}
