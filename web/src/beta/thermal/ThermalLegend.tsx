import { useMemo, useState } from "react";
import type { Timeline } from "../../contracts";
import { stepIndex } from "../../summary";
import { RAMP_MAX_K, RAMP_MIN_K, rampCss } from "./globeThermal";
import { CHECKED_NOTE, kelvinToC, regolithTemps } from "./thermal";
import "../beta.css";

const TICKS = [40, 100, 200, 300, 400];

/** Thermal regime of one site from its timeline: now, mean and the extremes with their dates. Null on mock or empty data. */
export function siteRegime(tl: Timeline | null, atUtc: string) {
  if (!tl || tl.stub) return null;
  const T = regolithTemps(tl);
  if (T.length === 0) return null;
  let lo = 0, hi = 0, sum = 0;
  T.forEach((t, i) => {
    if (t < T[lo]) lo = i;
    if (t > T[hi]) hi = i;
    sum += t;
  });
  const day = (i: number) => new Date(Date.parse(tl.startUtc) + i * tl.stepMin * 60000).toISOString().slice(0, 10);
  const now = T[stepIndex(tl, atUtc)];
  return { now: Number.isFinite(now) ? now : null, mean: sum / T.length, min: T[lo], minDay: day(lo), max: T[hi], maxDay: day(hi), from: day(0), to: day(T.length - 1) };
}

const kc = (v: number) => `${Math.round(v)} K (${Math.round(kelvinToC(v))} °C)`;

/** BETA (#290): colour bar of the Globe thermal mode, the same stops as the shader, and the regime of the selected site. */
export function ThermalLegend({ siteName, tl, atUtc }: { siteName?: string; tl?: Timeline | null; atUtc?: string }) {
  const r = useMemo(() => (atUtc ? siteRegime(tl ?? null, atUtc) : null), [tl, atUtc]);
  // #437: on a narrow screen the open legend squeezes the globe, so it starts folded there; the user can still open it.
  const [startOpen] = useState(() => !(typeof window !== "undefined" && window.matchMedia?.("(max-width: 760px)").matches));
  return (
    <details open={startOpen} className="thermal-legend" aria-label="Thermal colour scale">
      <summary>Temperature scale and site</summary>
      <div className="thermal-legend-bar" style={{ background: rampCss() }} />
      <div className="thermal-legend-ticks">
        {TICKS.map((t) => (
          <span key={t} style={{ left: `${((t - RAMP_MIN_K) / (RAMP_MAX_K - RAMP_MIN_K)) * 100}%` }}>
            {t === RAMP_MAX_K ? `${t} K` : t}
          </span>
        ))}
      </div>
      <p>
        Regolith surface temperature, 1D model. Slopes from the globe DEM change the Sun angle; cast shadows and light from
        nearby slopes are not modelled. Not the lander temperature. {CHECKED_NOTE}
      </p>
      {r && (
        <dl className="thermal-site" aria-label="Thermal regime of the selected site">
          <dt>{siteName ?? "Selected site"}</dt>
          <dd>Now: {r.now === null ? "outside the data window" : kc(r.now)}</dd>
          <dd>Coldest: {kc(r.min)} on {r.minDay}</dd>
          <dd>Hottest: {kc(r.max)} on {r.maxDay}</dd>
          <dd>Mean: {kc(r.mean)}, {r.from} to {r.to}</dd>
          <dd>Flat ground at the site, with the real terrain shadows of its horizon.</dd>
        </dl>
      )}
    </details>
  );
}
