import { useEffect, useState } from "react";
import { loadFullTimeline } from "../../api";
import type { Site, Timeline } from "../../contracts";
import { stepIndex } from "../../summary";
import { keepUnits } from "../../format";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { CHECKED_NOTE, kelvinToC, regolithTemps } from "./thermal";

export const COLD_K = 100; // K: colder than the equatorial pre-dawn minimum (Vasavada et al. 2012)
const COLORS = ["var(--sun)", "var(--earth)", "var(--warn)", "var(--fg)"];
const W = 640;
const H = 170;
const PAD_L = 34;
const PAD_B = 18;
const PAD_T = 6;

export type ThermalStats = {
  now: number | null;
  min: number;
  mean: number;
  max: number;
  coldShare: number;
  daily: number[]; // 24 h means for the chart
  startMs: number;
  dayMs: number;
  nowDay: number;
};

/** Temperature statistics of one site over its whole timeline. Null on mock or empty data. */
export function thermalStats(tl: Timeline | null, atUtc: string): ThermalStats | null {
  if (!tl || tl.stub) return null;
  const T = regolithTemps(tl);
  if (T.length === 0) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let cold = 0;
  for (const t of T) {
    min = Math.min(min, t);
    max = Math.max(max, t);
    sum += t;
    if (t < COLD_K) cold++;
  }
  const perDay = Math.max(1, Math.round(1440 / tl.stepMin));
  const daily: number[] = [];
  for (let i = 0; i < T.length; i += perDay) {
    const part = T.slice(i, i + perDay);
    daily.push(part.reduce((a, b) => a + b, 0) / part.length);
  }
  const i = stepIndex(tl, atUtc);
  const now = Number.isFinite(T[i]) ? T[i] : null;
  return { now, min, mean: sum / T.length, max, coldShare: cold / T.length, daily, startMs: Date.parse(tl.startUtc), dayMs: perDay * tl.stepMin * 60000, nowDay: i / perDay };
}

const k = (v: number | null) => (v === null ? "—" : `${Math.round(v)}\u00a0K`);
const c = (v: number | null) => (v === null ? "" : keepUnits(`${Math.round(kelvinToC(v))} °C`));

/** BETA (#290): regolith temperature statistics of the compared sites and one chart of daily means over the data window. */
export function ThermalCompare({ sites, atUtc }: { sites: Site[]; atUtc: string }) {
  const ids = sites.map((s) => s.id).join(",");
  const [tls, setTls] = useState<{ ids: string; tls: (Timeline | null)[] } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(sites.map((s) => loadFullTimeline(s).catch(() => null))).then((r) => live && setTls({ ids, tls: r }));
    return () => {
      live = false;
    };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!tls || tls.ids !== ids) return null;
  const stats = tls.tls.map((tl) => thermalStats(tl, atUtc));
  const real = stats.filter((s): s is ThermalStats => !!s);
  if (real.length === 0) return null;
  const lo = Math.floor(Math.min(...real.map((s) => Math.min(...s.daily))) / 20) * 20;
  const hi = Math.ceil(Math.max(...real.map((s) => Math.max(...s.daily))) / 20) * 20;
  const days = Math.max(...real.map((s) => s.daily.length));
  const x = (d: number) => PAD_L + (d / Math.max(1, days - 1)) * (W - PAD_L - 4);
  const y = (t: number) => PAD_T + (1 - (t - lo) / Math.max(1, hi - lo)) * (H - PAD_T - PAD_B);
  const months: { d: number; label: string }[] = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(real[0].startMs + d * real[0].dayMs);
    if (date.getUTCDate() === 1 && date.getUTCMonth() % 2 === 0) months.push({ d, label: date.toISOString().slice(0, 7) });
  }
  const nowDay = real[0].nowDay;
  return (
    <section className="thermal-compare" aria-label="Regolith temperature of the compared sites">
      <h3>
        <BetaTag /> Regolith surface temperature
      </h3>
      <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>Now</th>
            <th>Coldest</th>
            <th>Mean</th>
            <th>Hottest</th>
            <th title={`Share of hours with the surface below ${COLD_K} K over the whole data window.`}>Below {COLD_K}&nbsp;K</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s, i) => {
            const st = stats[i];
            return (
              <tr key={s.id}>
                <td>
                  <i className="thermal-swatch" style={{ background: COLORS[i % COLORS.length] }} aria-hidden="true" /> {keepUnits(s.name)}
                </td>
                {st ? (
                  <>
                    <td>
                      {k(st.now)} <small>{c(st.now)}</small>
                    </td>
                    <td>
                      {k(st.min)} <small>{c(st.min)}</small>
                    </td>
                    <td>
                      {k(st.mean)} <small>{c(st.mean)}</small>
                    </td>
                    <td>
                      {k(st.max)} <small>{c(st.max)}</small>
                    </td>
                    <td>{Math.round(st.coldShare * 100)}&nbsp;%</td>
                  </>
                ) : (
                  <td colSpan={5}>— no terrain timeline for this site</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Daily mean regolith temperature over the data window" className="thermal-chart">
        {[lo, (lo + hi) / 2, hi].map((t) => (
          <g key={t}>
            <line x1={PAD_L} x2={W - 4} y1={y(t)} y2={y(t)} className="thermal-grid" />
            <text x={PAD_L - 4} y={y(t) + 3} textAnchor="end">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {months.map((m) => (
          <text key={m.d} x={x(m.d)} y={H - 4} textAnchor="middle">
            {m.label}
          </text>
        ))}
        {stats.map((st, i) =>
          st ? (
            <polyline
              key={sites[i].id}
              fill="none"
              stroke={COLORS[i % COLORS.length]}
              strokeWidth="1.3"
              points={st.daily.map((t, d) => `${x(d).toFixed(1)},${y(t).toFixed(1)}`).join(" ")}
            />
          ) : null,
        )}
        {nowDay >= 0 && nowDay <= days - 1 && <line x1={x(nowDay)} x2={x(nowDay)} y1={PAD_T} y2={H - PAD_B} className="thermal-now" />}
      </svg>
      <p className="compare-hint">
        Daily mean, K, over the whole data window; the dashed line is the selected moment. 1D heat model of flat regolith with the real
        terrain shadows of each site horizon. No light from nearby slopes. This is not the lander temperature. {CHECKED_NOTE}
      </p>
    </section>
  );
}
