// Lander energy on the site screen (#216): battery charge curve over the shown period, the moment
// the battery runs empty, and a verdict. Inputs start at VIPER-class values (energy.ts, sources there).
import { useState } from "react";
import type { Timeline } from "../contracts";
import { type EnergyInput, SOURCES, VIPER, energyVerdict, simulate, utcAt } from "./energy";
import "./energy.css";
import { BETA } from "../beta/flags";
import { BatteryLine } from "../beta/battery/BatteryLine";

type NumKey = "panelW" | "batteryWh" | "dayLoadW" | "nightLoadW" | "panelAzDeg" | "panelTiltDeg";
/** Panel choices (#332). Vertical modes are the model before #332; "deck" is a preset: flat, tilt 0°. */
type Mount = "tracking" | "fixed" | "deck" | "tilted";
const FIELDS: [NumKey, string, string][] = [
  ["panelW", "Panel, W", "Panel output with the full Sun on it. VIPER: 320 W per panel (NASA NTRS 20240013903)."],
  ["batteryWh", "Battery, Wh", "Nominal capacity before the selected reserve. VIPER: 5,420 Wh at start of life, 0 °C (NASA NTRS 20240013903)."],
  ["dayLoadW", "Load in Sun, W", "Load while the Sun is visible. 174 W: standby phase of the VIPER-derived rover (NASA NTRS 20220013310, Table 5.1)."],
  ["nightLoadW", "Load in dark, W", "Survival load. 108 W = 5,420 Wh / 50 h: VIPER survives 50 h in low-power mode (NASA NTRS 20240013903). Our derivation, an upper bound."],
];
const DEFAULTS = Object.fromEntries(
  (["panelW", "batteryWh", "dayLoadW", "nightLoadW", "panelAzDeg", "panelTiltDeg"] as NumKey[]).map((k) => [k, String(VIPER[k])]),
) as Record<NumKey, string>;
const W = 600;
const H = 110;

/** Runs [start, end) of steps with the Sun hidden, for the night bands. */
function darkRuns(sun: number[]): [number, number][] {
  const out: [number, number][] = [];
  sun.forEach((v, i) => {
    if (v > 0) return;
    const last = out[out.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  });
  return out;
}

export function EnergyPanel({ tl, period }: { tl: Timeline; period: string }) {
  const [text, setText] = useState(DEFAULTS);
  const [mount, setMount] = useState<Mount>(VIPER.panel);
  const num = Object.fromEntries(Object.entries(text).map(([k, v]) => [k, v.trim() ? Number(v) : NaN])) as Record<NumKey, number>;
  const ok =
    Object.values(num).every(Number.isFinite) && num.panelW >= 0 && num.batteryWh > 0 && num.dayLoadW >= 0 && num.nightLoadW >= 0 &&
    (mount !== "tilted" || (num.panelTiltDeg >= 0 && num.panelTiltDeg <= 90));
  const panel = mount === "tracking" ? "tracking" : "fixed";
  const tilt = mount === "deck" ? 0 : mount === "tilted" ? num.panelTiltDeg : 90;
  const input: EnergyInput = { ...VIPER, ...num, panel, panelTiltDeg: tilt };
  const run = ok ? simulate(tl, input) : null; // ~720 steps for 30 days: cheap on every render
  const n = tl.sunVisible.length;
  const hours = n * (tl.stepMin / 60);
  const x = (stepH: number) => (stepH / hours) * W;
  const verdict = run
    ? (energyVerdict(tl, run, input.batteryWh, period) ?? "No verdict on mock data: the Sun track is synthetic.")
    : "Not calculated: panel, loads, azimuth and tilt must be numbers; battery > 0; panel and loads ≥ 0; tilt 0 to 90°.";
  return (
    <section className="energy hud-frame" aria-label="Lander energy">
      <h3 className="hud-label">Lander energy: battery charge, {period}</h3>
      <p className={`energy-verdict ${run && !tl.stub && run.emptyAtH !== null ? "energy-bad" : ""}`} aria-live="polite">
        {verdict}
      </p>
      {BETA.battery && run && <BatteryLine tl={tl} input={input} period={period} />}
      {run && (
        <svg className="energy-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Battery charge over the period, 0 to 100 %">
          {darkRuns(tl.sunVisible).map(([a, b]) => (
            <rect key={a} className="energy-night" x={x((a * tl.stepMin) / 60)} y={0} width={x(((b - a) * tl.stepMin) / 60)} height={H} />
          ))}
          <polyline
            className="energy-soc"
            points={run.wh.map((e, i) => `${x((i * tl.stepMin) / 60).toFixed(1)},${(H - (H * e) / input.batteryWh).toFixed(1)}`).join(" ")}
          />
          {run.emptyAtH !== null && <line className="energy-empty" x1={x(run.emptyAtH)} x2={x(run.emptyAtH)} y1={0} y2={H} />}
        </svg>
      )}
      <div className="energy-axis hud-foot">
        <span>{utcAt(tl, 0)}</span>
        <span>Top 100&nbsp;%, bottom 0&nbsp;%, grey = Sun hidden</span>
        <span>{utcAt(tl, hours)}</span>
      </div>
      <div className="energy-inputs">
        {FIELDS.map(([k, label, tip]) => (
          <label key={k} title={tip}>
            <span className="hud-label">{label}</span>
            <input type="number" step="any" value={text[k]} onChange={(e) => setText({ ...text, [k]: e.target.value })} />
          </label>
        ))}
        <label title="Tracking: a vertical panel turns to the Sun azimuth (assumed by default). Fixed: faces one azimuth. Horizontal deck: flat on the lander top, the low polar Sun hits it at a grazing angle. Tilted: any tilt from 0° (flat) to 90° (vertical).">
          <span className="hud-label">Panel</span>
          <select value={mount} onChange={(e) => setMount(e.target.value as Mount)}>
            <option value="tracking">vertical, tracks the Sun</option>
            <option value="fixed">vertical, fixed</option>
            <option value="deck">horizontal deck</option>
            <option value="tilted">tilted, fixed</option>
          </select>
        </label>
        {mount === "tilted" && (
          <label title="Panel tilt from the horizontal: 0° = flat deck, 90° = vertical.">
            <span className="hud-label">Tilt, °</span>
            <input type="number" step="any" value={text.panelTiltDeg} onChange={(e) => setText({ ...text, panelTiltDeg: e.target.value })} />
          </label>
        )}
        {(mount === "fixed" || mount === "tilted") && (
          <label title="Azimuth the panel face looks to, from north to east.">
            <span className="hud-label">Faces az, °</span>
            <input type="number" step="any" value={text.panelAzDeg} onChange={(e) => setText({ ...text, panelAzDeg: e.target.value })} />
          </label>
        )}
        <button type="button" onClick={() => (setText(DEFAULTS), setMount(VIPER.panel))} title="VIPER: NASA NTRS 20240013903 and 20220013310">
          VIPER-class defaults
        </button>
      </div>
      <details className="hud-notes">
        <summary>Model and sources</summary>
        <p>
          Each hour: power = panel W × visible share of the Sun × cos(angle of the Sun on the panel) − load. For a panel
          tilted t from the horizontal: cos = sin(t) × cos(Sun elevation) × cos(Sun azimuth − panel azimuth) + cos(t) × sin(Sun
          elevation), 0 when the Sun is behind the panel; a tracking panel has the azimuth term 1. The
          visible share already includes the terrain horizon and the Earth eclipses. Load = "in Sun" while any part of
          the Sun is visible, else "in dark". The charge starts full and stays between 0 and the capacity.
        </p>
        <p>
          Not modelled: temperature and heaters, panel degradation and dust, battery ageing and depth-of-discharge limits,
          rover motion and terrain slope under the panel. Use it to compare sites and dates, not to size a power system.
        </p>
        <p>
          Defaults: <a href={SOURCES.viper} target="_blank" rel="noreferrer">VIPER Rover Overview, NASA NTRS 20240013903</a> (panel
          320 W, battery 5,420 Wh, 50 h low-power survival);{" "}
          <a href={SOURCES.loads} target="_blank" rel="noreferrer">NASA NTRS 20220013310, Table 5.1</a> (standby load 174 W).
        </p>
      </details>
    </section>
  );
}
