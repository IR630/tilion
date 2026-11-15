// Lander energy (#216): battery charge hour by hour from a site timeline.
//
//   power(t)  = panelW × sunVisible(t) × cos(incidence on the panel) − load(t)
//   load(t)   = dayLoadW while any part of the Sun is visible, else nightLoadW
//   charge(t + step) = clamp(charge(t) + power(t) × step, 0, batteryWh)
//
// sunVisible already holds the terrain horizon and Earth eclipses (D-010). The panel has a tilt from
// the horizontal (#332; default 90° = vertical): "tracking" turns to the Sun azimuth, "fixed" faces
// one azimuth. cos(incidence) = sin(tilt) × cos(sunEl) × cos(sunAz − panelAz) + cos(tilt) × sin(sunEl),
// with cos(sunAz − panelAz) = 1 for "tracking", and 0 when the Sun is behind the panel.
//
// Tilted panel formula adapted from Smart1po/lunex@e14ab5a2bd6732466a757fe9e94aa43075e06a38,
// src/lib/power.ts (panelCos, "fixed" case), MIT License (THIRD_PARTY_NOTICES.md).
import type { Timeline } from "../contracts";

export type PanelMode = "tracking" | "fixed";
export type EnergyInput = {
  panelW: number; // panel output with the full Sun on it at normal incidence
  batteryWh: number;
  dayLoadW: number;
  nightLoadW: number;
  panel: PanelMode;
  panelAzDeg: number; // fixed panel: azimuth its face looks to, from north to east
  panelTiltDeg?: number; // panel tilt from the horizontal: 0 = flat deck, 90 = vertical (the default)
  startSoc: number; // charge at the start of the period, 0..1
};

/**
 * VIPER-class defaults. Panel 320 W per panel and battery 5,420 Wh at start of life: NASA NTRS
 * 20240013903 (Bluethmann 2024, "VIPER Rover Overview"), which also gives "50 hours survival in low
 * power mode" — so the night load 108 W = 5,420 Wh / 50 h (our derivation, an upper bound). Day load
 * 174 W = "Standby Phase" total power of the VIPER-derived rover in NASA NTRS 20220013310, Table 5.1.
 */
export const VIPER: EnergyInput = {
  panelW: 320,
  batteryWh: 5420,
  dayLoadW: 174,
  nightLoadW: 108,
  panel: "tracking",
  panelAzDeg: 0,
  panelTiltDeg: 90,
  startSoc: 1,
};
export const SOURCES = {
  viper: "https://ntrs.nasa.gov/citations/20240013903",
  loads: "https://ntrs.nasa.gov/citations/20220013310",
};

/** Cosine of the Sun's incidence angle on the panel, 0 when the Sun is behind it. Tilt from the
 * horizontal: 90 = vertical (the default), 0 = flat deck (cos = sin(sunEl), azimuth has no effect). */
export function panelCos(sunAz: number, sunEl: number, panel: PanelMode, panelAzDeg: number, tiltDeg = 90): number {
  const d = Math.PI / 180;
  // Exact sin and cos at 90°: a vertical panel gives the same numbers as before #332, bit for bit.
  const st = tiltDeg === 90 ? 1 : Math.sin(tiltDeg * d);
  const ct = tiltDeg === 90 ? 0 : Math.cos(tiltDeg * d);
  const toward = panel === "tracking" ? 1 : Math.cos((sunAz - panelAzDeg) * d);
  const c = st * Math.cos(sunEl * d) * toward + (ct === 0 ? 0 : ct * Math.sin(sunEl * d));
  return c > 0 ? c : 0;
}

export type EnergyRun = {
  /** Charge (Wh) at the start of each step and after the last one: length = steps + 1. */
  wh: number[];
  /** Hours from the period start to the first empty battery; null = it never empties. */
  emptyAtH: number | null;
  /** Hours with an empty battery and the load not met. */
  deadH: number;
  /** Lowest charge (Wh) and the step where it occurs. */
  minWh: number;
  minAt: number;
};

export function simulate(tl: Timeline, p: EnergyInput): EnergyRun {
  const h = tl.stepMin / 60;
  let e = Math.min(1, Math.max(0, p.startSoc)) * p.batteryWh;
  const wh = [e];
  let emptyAtH: number | null = e <= 0 ? 0 : null;
  let deadH = 0;
  let minWh = e;
  let minAt = 0;
  for (let i = 0; i < tl.sunVisible.length; i++) {
    const sun = tl.sunVisible[i];
    const gen = p.panelW * sun * panelCos(tl.sunAz[i], tl.sunEl[i], p.panel, p.panelAzDeg, p.panelTiltDeg);
    const net = gen - (sun > 0 ? p.dayLoadW : p.nightLoadW);
    const next = e + net * h;
    if (next < 0) {
      const toEmpty = e / -net; // hours of this step until the battery is empty
      emptyAtH ??= i * h + toEmpty;
      deadH += h - toEmpty;
    }
    e = Math.min(p.batteryWh, Math.max(0, next));
    wh.push(e);
    if (e < minWh) [minWh, minAt] = [e, i + 1];
  }
  return { wh, emptyAtH, deadH, minWh, minAt };
}

/** UTC text of a moment `hours` after the timeline start. */
export function utcAt(tl: Timeline, hours: number): string {
  return new Date(Date.parse(tl.startUtc) + hours * 3600000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** One-line verdict of a run over `period` (text such as "next 30 d"). */
export function verdictText(tl: Timeline, run: EnergyRun, batteryWh: number, period: string): string {
  if (run.emptyAtH !== null)
    return `Battery empty at ${utcAt(tl, run.emptyAtH)}; no power for ${Math.round(run.deadH)} h of ${period}.`;
  if (run.minWh >= batteryWh) return `Survives ${period}: the battery stays full.`;
  const pct = Math.round((100 * run.minWh) / batteryWh);
  return `Survives ${period}: lowest charge ${pct}\u00a0% at ${utcAt(tl, (run.minAt * tl.stepMin) / 60)}.`;
}

/** The part of a timeline from startUtc for `days` days; null when the data does not cover it. */
export function slicePeriod(tl: Timeline, startUtc: string, days: number): Timeline | null {
  const i0 = Math.floor((Date.parse(startUtc) - Date.parse(tl.startUtc)) / (tl.stepMin * 60000));
  const n = Math.round((days * 1440) / tl.stepMin);
  if (!(i0 >= 0) || i0 + n > tl.sunVisible.length) return null;
  const cut = (a: number[]) => a.slice(i0, i0 + n);
  const start = new Date(Date.parse(tl.startUtc) + i0 * tl.stepMin * 60000).toISOString();
  return { ...tl, startUtc: start, sunAz: cut(tl.sunAz), sunEl: cut(tl.sunEl), sunVisible: cut(tl.sunVisible) };
}

/** The verdict shown to the user; null on mock data (stub), like the Windows verdict: one rule for every screen. */
export function energyVerdict(tl: Timeline, run: EnergyRun, batteryWh: number, period: string): string | null {
  return tl.stub ? null : verdictText(tl, run, batteryWh, period);
}

/** Energy margin of a mission from `startUtc` for `days` days, VIPER-class defaults: short text; null on mock data or no coverage. */
export function energyMargin(tl: Timeline, startUtc: string, days: number): string | null {
  const part = slicePeriod(tl, startUtc, days);
  if (!part || tl.stub) return null;
  const run = simulate(part, VIPER);
  if (run.emptyAtH !== null) return `battery empty after ${Math.round(run.emptyAtH)} h`;
  return `lowest charge ${Math.round((100 * run.minWh) / VIPER.batteryWh)}\u00a0%`;
}
