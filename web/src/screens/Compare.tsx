import { useEffect, useState, type ReactNode } from "react";
import { loadMaskOnce, loadTimeline } from "../api";
import { loadFullWindow } from "../fullWindow";
import type { Interval, Site, SiteSummary, Timeline, ValidationFile } from "../contracts";
import { CLEARANCE_TIP, DATA_PERIOD, fmtAbove, fmtDuration, fmtDurationRange, fmtElevation, fmtLatLon, fmtShare, fmtUntil, lowSunNote, sharePeriod, SPREAD_NOTE } from "../format";
import { mockSummary } from "../mock";
import { stepUtc, sphereTimeline, summarize, terrainCaption, terrainEffect, type SummaryRow } from "../summary";
import { GEO_CAVEAT, Info } from "../ui/Info";
import { T0, T1 } from "../timeline/time";
import { siteChecks, siteRows, useValidation } from "./Validation";
import { BETA } from "../beta/flags";
import { ThermalCompare } from "../beta/thermal/ThermalCompare";
import { SlipReport } from "../beta/slipReport/SlipReport";
import { type Conditions, DEFAULT_LIMITS } from "../landing";
import { SitePrediction } from "../learning/SitePrediction";
import "./hud.css";
import "./compare.css";

/**
 * Summary of one site at atUtc: real timeline + measured spread, mock only when the timeline is stub.
 * `sphere` = the same site over a flat 0° horizon (no spread); a site without terrain is a sphere already.
 */
export async function siteSummary(site: Site, atUtc: string, sphere = false): Promise<SummaryRow> {
  // The slice starts at the step that holds the moment: the same step as the card and Windows (#162).
  const tl = await loadTimeline(site, stepUtc(atUtc));
  if (tl.stub) return mockSummary(site, atUtc);
  const full = await loadFullWindow(site);
  if (!full) return mockSummary(site, atUtc);
  if (sphere && site.terrain !== "none") return summarize(sphereTimeline(tl), atUtc, sphereTimeline(full));
  const row = summarize(tl, atUtc, full, await loadMaskOnce(site));
  // #424: no variants/<id>.json: low == high is not a measured spread, so the row says so.
  return tl.variantSunLit?.length && tl.variantEarthVisible?.length ? row : { ...row, noSpread: true };
}

/** One caption line per site: how terrain changes the Sun and Earth share, or why there is no sphere comparison. */
export type EffectLine = { site: Site; text: string };

function useEffectLines(sites: Site[]): EffectLine[] | Error | null {
  const [state, setState] = useState<{ key: string; lines: EffectLine[] | Error } | null>(null);
  const key = sites.map((s) => s.id).join(",");
  useEffect(() => {
    let live = true;
    Promise.all(
      sites.map(async (site): Promise<EffectLine> => {
        if (site.terrain === "none") return { site, text: "no terrain model, already a bare sphere." };
        const full = await loadFullWindow(site);
        return { site, text: full ? terrainCaption(terrainEffect(full)) : "no sphere variant (no precomputed timeline)." };
      }),
    ).then((lines) => live && setState({ key, lines }), (e) => live && setState({ key, lines: new Error(String(e)) }));
    return () => {
      live = false;
    };
  }, [key]);
  return state && state.key === key ? state.lines : null;
}

function useSummaries(sites: Site[], atUtc: string, sphere: boolean): SummaryRow[] | Error | null {
  const [rows, setRows] = useState<{ key: string; rows: SummaryRow[] | Error } | null>(null);
  const ids = sites.map((s) => s.id).join(",");
  const key = `${sphere ? "sphere" : "terrain"}|${atUtc}|${ids}`;
  useEffect(() => {
    let live = true;
    Promise.all(sites.map((s) => siteSummary(s, atUtc, sphere))).then(
      (r) => live && setRows({ key, rows: r }), (e) => live && setRows({ key, rows: new Error(String(e)) }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  // Same sites at a new moment: keep the last rows until the new ones arrive (no flicker on Play).
  return rows && rows.key.endsWith(`|${ids}`) ? rows.rows : null;
}

export const MIN_SLIP_DAYS = -14;
export const MAX_SLIP_DAYS = 30;
export const SYNODIC_HOURS = 29.530589 * 24;

export function clampSlip(d: number): number {
  return Math.min(MAX_SLIP_DAYS, Math.max(MIN_SLIP_DAYS, d));
}

/** True when the moment lies outside the precomputed data: there only mock numbers exist (#423). */
export const outsideData = (atUtc: string) => !(Date.parse(atUtc) >= T0 && Date.parse(atUtc) <= T1);

/** Shift an ISO UTC timestamp by whole days. */
export function shiftUtc(atUtc: string, days: number): string {
  const t = new Date(Date.parse(atUtc) + days * 86400000);
  return t.toISOString().replace(/\.\d+Z$/, "Z");
}

export type ColumnKey = "sunEl" | "sunset" | "light" | "night" | "earthset" | "earth" | "dsn" | "gap";

/** Scalar used to rank a column: higher is better (a shorter night or gap is better, so it is negated). A body that is not visible now ranks lowest. */
export function metric(m: SiteSummary, k: ColumnKey): number {
  switch (k) {
    case "sunEl":
      return (m as SummaryRow).sunClearDeg ?? m.sunElDeg;
    case "sunset":
      return m.hoursToSunset?.value ?? -Infinity;
    case "light":
      return m.lightFraction.value;
    case "night":
      return -m.longestNightH.value;
    case "earthset":
      return m.hoursToEarthset?.value ?? -Infinity;
    case "earth":
      return m.earthFraction.value;
    case "dsn":
      return m.dsnFraction ?? -Infinity;
    case "gap":
      return -m.longestCommGapH.value;
  }
}

/** Indexes of the best real rows for a column (ties all win). Empty when fewer than 2 real rows. */
export function bestRows(rows: SiteSummary[], k: ColumnKey): number[] {
  if (rows.filter((r) => !r.stub).length < 2) return [];
  const vals = rows.map((r) => (r.stub ? -Infinity : metric(r, k)));
  const top = Math.max(...vals);
  return vals.flatMap((v, i) => (v === top && Number.isFinite(v) ? [i] : []));
}

/** Signed difference "shifted − original" as text, or "—" when either value is not visible. */
export function fmtDeltaHours(a: Interval | null, b: Interval | null): string {
  if (!a || !b) return "—";
  return signed(b.value - a.value, 0, "h"); // hourly samples: whole hours (#155)
}
export function lightDeltaHours(a: SiteSummary, b: SiteSummary): number {
  return (b.lightFraction.value - a.lightFraction.value) * SYNODIC_HOURS;
}
function signed(x: number, digits: number, unit: string): string {
  const r = Number(x.toFixed(digits));
  const s = r > 0 ? "+" : r < 0 ? "−" : "±";
  return `${s}${Math.abs(r).toFixed(digits)} ${unit}`;
}
export function fmtLightDelta(a: SiteSummary, b: SiteSummary): string {
  return `${signed(lightDeltaHours(a, b), 0, "h")} of light`;
}

const WINDOW_NOTE =
  `Whole precomputed window of the site (${DATA_PERIOD}), not 30 days. Does not depend on the date or the slip. Shorter is better. Mock rows cover 30 days of synthetic data.`;
const NIGHT_TITLE = `Longest continuous time with the Sun fully below the terrain horizon. ${WINDOW_NOTE}`;
const GAP_TITLE = `Longest continuous time without direct line of sight to the Earth centre. ${WINDOW_NOTE}`;

const pct = (x: number) => Math.round(x * 100);

/**
 * A cell: the value large, the Q8 spread small after it. Null = the body is not visible now.
 * `leftH` = hours to the data end: a time to an event that reaches it reads "> …" (no event in the data).
 */
function Value({ v, unit, leftH }: { v: Interval | null; unit: "h" | "%"; leftH?: number }) {
  if (v === null) return <span className="cmp-v cmp-none">not visible</span>;
  const beyond = (h: number) => leftH !== undefined && h >= leftH;
  const spread =
    unit === "%"
      ? pct(v.lo) === pct(v.hi)
        ? null
        : `${pct(v.lo)}–${pct(v.hi)} %`
      : fmtDurationRange(v.lo, v.hi, beyond(v.hi));
  return (
    <>
      <span className="cmp-v">{unit === "%" ? fmtShare(v.value) : fmtUntil(v.value, beyond(v.value))}</span>
      {spread && (
        <>
          {" "}
          <span className="cmp-spread" title={SPREAD_NOTE}>
            {spread}
          </span>
        </>
      )}
    </>
  );
}

/** One line: which site leads on light and on Earth view at this moment. */
export function compareVerdict(sites: Site[], rows: SiteSummary[]): string {
  if (rows.length < 2) return "Pick 2–4 sites to compare.";
  const realCount = rows.filter((r) => !r.stub).length;
  if (realCount < 2) return "Pick at least 2 sites with precomputed data to compare.";
  const light = bestRows(rows, "light");
  const earth = bestRows(rows, "earth");
  const name = (ix: number[]) => ix.map((i) => sites[i].name).join(" and ");
  if (light.length === realCount && earth.length === realCount) return "No site leads: light and Earth view are equal.";
  // #363: one winner and why, in one number: its Sun lead over the next best real site.
  if (light.length === 1 && earth.length === 1 && light[0] === earth[0]) {
    const w = light[0];
    const lead = (k: "lightFraction" | "earthFraction") => {
      const others = rows.flatMap((r, i) => (i === w || r.stub ? [] : [{ i, v: r[k].value }]));
      const next = others.reduce((a, b) => (b.v > a.v ? b : a));
      return { pp: Math.round((rows[w][k].value - next.v) * 100), next: sites[next.i].name };
    };
    const sun = lead("lightFraction");
    const [k, what] = sun.pp > 0 ? (["lightFraction", "Sun"] as const) : (["earthFraction", "Earth in view"] as const);
    const by = sun.pp > 0 ? sun : lead("earthFraction");
    return `Winner: ${sites[w].name} — ${what} ${fmtShare(rows[w][k].value)} of the next ${sharePeriod(rows[w].atUtc)}, +${by.pp} pp over ${by.next}.`;
  }
  if (name(light) === name(earth)) return `${name(light)} lead together on light and on Earth view.`;
  return `No single winner: ${name(light)} has the most light; ${name(earth)} has the most Earth view.`;
}

/** "NASA check 8/9": checks of this site against NASA references that pass / all; opens the NASA check screen. */
function CheckBadge({ v, siteId, onOpen }: { v: ValidationFile; siteId: string; onOpen?: () => void }) {
  const c = siteChecks(v, siteId);
  if (!c) return null;
  const failed = siteRows(v, siteId)
    .filter((r) => r.pass === false)
    .map((r) => `${r.check} (${r.source})`);
  const title =
    `${c.pass} of ${c.pass + c.fail} checks of this site against NASA references (JPL Horizons, LOLA/PGDA products, published papers) pass.` +
    (failed.length ? ` Not passed: ${failed.join("; ")}.` : "") +
    " Click to open the NASA check screen with every number.";
  return (
    <button type="button" className={`compare-badge ${c.fail ? "val-fail" : "val-pass"}`} title={title} aria-label={title} onClick={onOpen}>
      {c.pass} of {c.pass + c.fail} NASA checks pass
    </button>
  );
}

/** Time to an event only when the event is inside the data; "> …" (no event before the data end) gives no delta. */
function inData(r: SummaryRow, k: "hoursToSunset" | "hoursToEarthset"): Interval | null {
  const v = r[k];
  return v && r.leftH !== undefined && v.value >= r.leftH ? null : v;
}

/** #435: the "Date slip delta" cell for sunset or Earthset. A body down at one date has no hours to subtract,
 *  so the cell says what changed, with the same mark as "What the slip changes" (slipReport eventLine). */
export function fmtEventDelta(a: SummaryRow, b: SummaryRow, k: "hoursToSunset" | "hoursToEarthset"): string {
  const body = k === "hoursToSunset" ? "Sun" : "Earth";
  if (!a[k] && !b[k]) return `${body} down at both (same)`;
  if (!a[k]) return `${body} down → up (better)`;
  if (!b[k]) return `${body} up → down (worse)`;
  return fmtDeltaHours(inData(a, k), inData(b, k));
}

// #197: a short plain label; the grid detail and the source are in the tooltip.
const terrainLabel = (s: Site) => (s.terrain === "polar80" ? "Terrain: 20 m detail" : "Terrain: 240 m detail");
const terrainTip = (s: Site) =>
  s.terrain === "polar80"
    ? "Terrain model: NASA LOLA laser-altimeter elevation, 20 m grid within 5 km of the site, 80 m to 80°S, 240 m beyond (PGDA 90, Barker et al. 2021)."
    : "Terrain model: NASA LOLA laser-altimeter elevation, 240 m grid, 60–90°S (PGDA 90).";
const BEST_TIP = "Best value in this column among the compared sites.";
const utc = (t: string) => t.slice(0, 16).replace("T", " ");

/** `limits` = the Windows panel mission limits (App state), used by the slip report beta. */
export function Compare({ sites, atUtc, onOpenChecks, limits = DEFAULT_LIMITS.cond, openPrediction = false }: { sites: Site[]; atUtc: string; onOpenChecks?: () => void; limits?: Conditions; openPrediction?: boolean }) {
  const [slip, setSlip] = useState(0);
  const [predictionOpen, setPredictionOpen] = useState(openPrediction);
  const [revealedKey, setRevealedKey] = useState("");
  const slippedUtc = shiftUtc(atUtc, slip);
  const predictionKey = `${slippedUtc}|${sites.slice(0, 2).map((s) => s.id).join("|")}`;
  const [sphere, setSphere] = useState(false);
  const baseResult = useSummaries(sites, atUtc, sphere);
  const shiftedResult = useSummaries(sites, slippedUtc, sphere);
  const effectsResult = useEffectLines(sites);
  const error = [baseResult, shiftedResult, effectsResult].find((r) => r instanceof Error);
  const base = baseResult instanceof Error ? null : baseResult;
  const shifted = shiftedResult instanceof Error ? null : shiftedResult;
  const effects = effectsResult instanceof Error ? null : effectsResult;
  const now = slip === 0 ? base : shifted;
  const validation = useValidation();
  const step = (d: number) => setSlip((v) => clampSlip(v + d));
  // #423: a slip that would leave the data is off; a moment already outside shows "outside data", not mock numbers.
  const slipBlocked = (d: number) => outsideData(shiftUtc(atUtc, clampSlip(slip + d)));
  const slipTitle = (d: number) => (slipBlocked(d) ? "Outside data range" : undefined);
  const outside = outsideData(slippedUtc);
  // #424: near the data end the shares count fewer days than 30: the labels say how many.
  const per = sharePeriod(now?.find((r) => !r.stub)?.atUtc ?? "");
  const cols: { key: ColumnKey; label: string; title?: string; show: (m: SummaryRow) => ReactNode }[] = [
    {
      key: "sunEl",
      label: "Sun above terrain",
      title: `Sun above terrain now. ${CLEARANCE_TIP} Bare sphere and sites without terrain: above level only.`,
      show: (m) => {
        // #196: 0.3° next to "sunset in 61 d" needs one line; the full sentence is the tooltip.
        const note = m.hoursToSunset && lowSunNote(m.sunElDeg, m.hoursToSunset.value, m.leftH !== undefined && m.hoursToSunset.value >= m.leftH);
        // #440: a site with terrain but no clearance: the mask failed; do not show the level angle as "above terrain".
        const noClear = m.sunClearDeg === null && sites.find((s) => s.id === m.siteId)?.terrain !== "none";
        return (
          <>
            {noClear ? (
              <span className="cmp-v" title="Terrain horizon unavailable">—</span>
            ) : (
              <>
                <span className="cmp-v">{fmtElevation(m.sunClearDeg ?? m.sunElDeg)}</span>
                <span className="cmp-spread">{m.sunClearDeg != null ? fmtAbove(m.sunElDeg, "level") : "above level"}</span>
              </>
            )}
            {note && (
              <span className="cmp-low" title={note}>
                low, circles the horizon
              </span>
            )}
          </>
        );
      },
    },
    {
      key: "sunset",
      label: "To sunset",
      title: `Time to sunset. From the moment to the first hour with the whole Sun behind terrain, searched to the end of the data (${DATA_PERIOD}).`,
      show: (m) => <Value v={m.hoursToSunset} unit="h" leftH={m.leftH} />,
    },
    {
      key: "light",
      label: `Sun lit, % ${per}`,
      title: `Sun lit, next ${per}. Sun above terrain (any limb), % of hours over the next ${per}`,
      show: (m) => <Value v={m.lightFraction} unit="%" />,
    },
    { key: "night", label: "Longest night, all data", title: `Longest night over all data (${DATA_PERIOD}), not the 30 days of Sun above terrain. ${NIGHT_TITLE}`, show: (m) => <Value v={m.longestNightH} unit="h" /> },
    {
      key: "earthset",
      label: "To Earthset",
      title: `Time to Earthset. From the moment to the first hour with the Earth centre behind terrain, searched to the end of the data (${DATA_PERIOD}).`,
      show: (m) => <Value v={m.hoursToEarthset} unit="h" leftH={m.leftH} />,
    },
    {
      key: "earth",
      label: `Earth in view, % ${per}`,
      title: `Earth centre in view, next ${per}. Earth centre above terrain, % of hours over the next ${per}`,
      show: (m) => <Value v={m.earthFraction} unit="%" />,
    },
    {
      key: "dsn",
      label: `Earth + DSN, % ${per}`,
      title: `Earth + DSN, % of hours, next ${per}. Goldstone, Madrid or Canberra clears the site's terrain horizon and the same station sees the Moon centre above 10°, the DSN uplink limit (DSN 810-005, module 301P). Hourly samples; no station scheduling or link budget. — = DSN data unavailable (mock or derived sphere).`,
      show: (m) => (m.dsnFraction === undefined ? "—" : <span className="cmp-v">{pct(m.dsnFraction)} %</span>),
    },
    {
      key: "gap",
      label: "Longest Earth gap",
      title: `Longest Earth visibility gap, ${DATA_PERIOD}. ${GAP_TITLE}`,
      show: (m) => <Value v={m.longestCommGapH} unit="h" />,
    },
  ];
  const best = Object.fromEntries(cols.map((c) => [c.key, now ? bestRows(now, c.key) : []])) as Record<
    ColumnKey,
    number[]
  >;
  return (
    <section className="compare hud-screen" aria-label="Date slip comparison">
      <details open={predictionOpen} onToggle={(e) => { setPredictionOpen(e.currentTarget.open); if (e.currentTarget.open) setSphere(false); else setRevealedKey(""); }} className="hud-notes">
        <summary>Try a prediction</summary>
        {predictionOpen && <SitePrediction sites={sites} atUtc={slippedUtc} onReveal={() => setRevealedKey(predictionKey)} />}
      </details>
      <div hidden={predictionOpen && revealedKey !== predictionKey}>
      {error instanceof Error && <p role="alert">Comparison failed to load: {error.message}</p>}
      {sites.length < 2 && <p role="note">Pick 2–4 sites to compare.</p>}
      {now && sites.length >= 2 && (() => {
        // #363: the answer first, the table below.
        const v = compareVerdict(sites, now);
        const win = v.startsWith("Winner: ");
        return (
          <p className={`hud-verdict compare-winner${win ? " is-win" : ""}`}>
            {win ? (
              <>
                <span className="compare-winner-k">Winner</span> {v.slice(8)}
              </>
            ) : (
              v
            )}
          </p>
        );
      })()}
      <div className="hud-bar">
        <span className="hud-seg compare-slip" role="group" aria-label="Date slip">
          <span className="hud-label">Slip</span>
          <button onClick={() => step(-7)} disabled={slip <= MIN_SLIP_DAYS || slipBlocked(-7)} title={slipTitle(-7)} aria-label="Slip −7 days">−7 d</button>
          <button onClick={() => step(-1)} disabled={slip <= MIN_SLIP_DAYS || slipBlocked(-1)} title={slipTitle(-1)} aria-label="Slip −1 day">−1 d</button>
          <output aria-label="Date slip value">
            {slip === 0 ? "No slip" : `${slip > 0 ? "+" : "−"}${Math.abs(slip)} d`}, {utc(slippedUtc)} UTC
          </output>
          <button onClick={() => step(1)} disabled={slip >= MAX_SLIP_DAYS || slipBlocked(1)} title={slipTitle(1)} aria-label="Slip +1 day">+1 d</button>
          <button onClick={() => step(7)} disabled={slip >= MAX_SLIP_DAYS || slipBlocked(7)} title={slipTitle(7)} aria-label="Slip +7 days">+7 d</button>
          <button onClick={() => setSlip(0)} disabled={slip === 0}>Reset</button>
        </span>
        <span className="hud-seg compare-surface" role="group" aria-label="Surface model">
          <span className="hud-label">Surface</span>
          <label>
            <input type="radio" name="compare-surface" checked={!sphere} onChange={() => setSphere(false)} /> Terrain (LOLA)
          </label>
          <label title="Flat 0° horizon: the trivial answer without relief">
            <input type="radio" name="compare-surface" checked={sphere} onChange={() => setSphere(true)} /> Bare sphere
          </label>
          <Info label="What Earth and DSN mean here">
            {GEO_CAVEAT} Earth + DSN requires Goldstone, Madrid or Canberra (NASA Deep Space Network) to clear the site's horizon and see the Moon centre
            above 10°, the uplink limit in{" "}
            <a href="https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301P.pdf">DSN 810-005, module 301P</a>. The DSN is
            oversubscribed (<a href="https://oig.nasa.gov/docs/IG-23-016.pdf">NASA OIG IG-23-016</a>). Mock values are synthetic.
            Bare sphere ignores terrain. — means no DSN data.
          </Info>
          {sphere && <span className="compare-hint">The sphere has one answer, so there is no spread.</span>}
        </span>
      </div>
      <div className="hud-frame compare-frame">
        {/* #401: on a phone the table is wider than the sheet; say so (the scrollbar is below the fold). */}
        <p className="compare-scroll-hint hud-label">Swipe the table sideways for all columns →</p>
        <div className="compare-scroll">
        <table aria-label="Site comparison">
          <thead>
            <tr>
              <th>Site</th>
              {cols.map((c) => (
                <th key={c.key} title={c.title}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sites.map((s, i) => (
              <tr key={s.id}>
                <td className="cmp-site">
                  <span className="cmp-name">{s.name}</span>
                  <span className="cmp-meta">
                    {fmtLatLon(s.lat, s.lonE)}
                    {s.terrain === "none" ? (
                      <span className="compare-badge" title="No polar terrain model for this site">
                        sphere only — no terrain
                      </span>
                    ) : (
                      <span className="compare-terrain" title={terrainTip(s)}>{terrainLabel(s)}</span>
                    )}
                    {validation && <CheckBadge v={validation} siteId={s.id} onOpen={onOpenChecks} />}
                    {now?.[i]?.stub && (
                      <span className="compare-badge compare-mock" title="No precomputed timeline for this date: synthetic values">
                        mock
                      </span>
                    )}
                    {now?.[i]?.noSpread && (
                      <span className="compare-badge" title="Terrain and observer-height variants are missing for this site: the values have no measured spread">
                        no spread
                      </span>
                    )}
                  </span>
                </td>
                {cols.map((c) => (
                  <td key={c.key} className={best[c.key].includes(i) ? "compare-best" : undefined}>
                    {!now ? "…" : now[i].stub && outside ? <span className="cmp-v cmp-none">outside data</span> : c.show(now[i])}
                    {best[c.key].includes(i) && <span className="compare-star" title={BEST_TIP}> ★</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="hud-corners">
          <span>
            <span title={BEST_TIP}>★ best of these sites</span>
            <span title={SPREAD_NOTE}>Small grey = range over observer height 0/2/10 m and DEM</span>
          </span>
        </div>
      </div>
      {slip !== 0 && base && now && (
        <table aria-label="Date slip delta" className="compare-delta">
          <caption className="hud-label">
            Change vs original date ({utc(atUtc)} UTC), slip {slip > 0 ? "+" : "−"}
            {Math.abs(slip)} d
          </caption>
          <thead>
            <tr>
              <th>Site</th>
              <th>Light</th>
              <th>Time to sunset</th>
              <th>Time to Earthset</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s, i) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{base[i].stub || now[i].stub ? "—" : fmtLightDelta(base[i], now[i])}</td>
                <td>{base[i].stub || now[i].stub ? "—" : fmtEventDelta(base[i], now[i], "hoursToSunset")}</td>
                <td>{base[i].stub || now[i].stub ? "—" : fmtEventDelta(base[i], now[i], "hoursToEarthset")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {BETA.slipReport && slip !== 0 && base && now && <SlipReport sites={sites} base={base} now={now} atUtc={atUtc} slippedUtc={slippedUtc} slip={slip} sphere={sphere} limits={limits} />}
      {BETA.thermal && !sphere && <ThermalCompare sites={sites} atUtc={slippedUtc} />}
      <details className="hud-notes">
        <summary>How to read the terrain effect</summary>
        <p className="compare-hint">
          Slip range {MIN_SLIP_DAYS} … +{MAX_SLIP_DAYS} days. Each value has a measured spread (low–high) over observer
          height 0/2/10 m × LOLA 20+80+240 / 80+240 / 240 m. Longest night and comm gap use the whole precomputed window
          ({DATA_PERIOD}), not the date. Time to sunset and Earthset is searched to the end of the data.
        </p>
        <ul className="compare-hint compare-effect" aria-label="Terrain effect">
          {(effects ?? []).map((l) => (
            <li key={l.site.id}>
              {l.site.name}: {l.text}
            </li>
          ))}
        </ul>
      </details>
      </div>
    </section>
  );
}
