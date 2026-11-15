// BETA battery (#257): the smallest battery that survives the shown period, and the longest spell without charge.
//
// Both run over our lander energy model (energy.ts, #216) with the user's panel and loads; that model is not changed.
import type { Timeline } from "../../contracts";
import { type EnergyInput, panelCos, simulate } from "../../energy/energy";

/** Our assumption: 20 % of the capacity stays unused as a margin for ageing, cold and faults.
 * The floor is a planning margin; the lander still has power at it (no safe mode is modelled). */
export const RESERVE = 0.2;

/** True when the run never empties the battery and the charge stays at or above the reserve floor. */
export function survives(tl: Timeline, p: EnergyInput, reserve = RESERVE): boolean {
  const r = simulate(tl, p);
  return r.emptyAtH === null && r.minWh >= reserve * p.batteryWh;
}

/** Smallest battery (Wh) that survives `tl` with the reserve, by bisection over simulate; 0 = the panel alone covers the load, NaN = no size survives. */
export function smallestBattery(tl: Timeline, p: EnergyInput, reserve = RESERVE): number {
  if (reserve < 0 || reserve >= 1 || p.startSoc < reserve) return NaN;
  const ok = (wh: number) => survives(tl, { ...p, batteryWh: wh }, reserve);
  if (ok(1e-6)) return 0;
  let hi = 1;
  // The initial charge may equal the reserve; sunlight can still charge the battery before a deficit.
  for (let i = 0; i < 50 && !ok(hi); i++) hi *= 2;
  if (!ok(hi)) return NaN;
  let lo = 0;
  while (hi - lo > 1e-6 * hi) {
    const m = (lo + hi) / 2;
    if (ok(m)) hi = m;
    else lo = m;
  }
  return hi;
}

/** Minimum panel output with this battery and reserve over the whole period. NaN means no finite
 * panel was found: for example, the battery cannot cover a dark interval before it can recharge. */
export function smallestPanel(tl: Timeline, p: EnergyInput, reserve = RESERVE): number {
  if (reserve < 0 || reserve >= 1 || p.startSoc < reserve) return NaN;
  const ok = (panelW: number) => survives(tl, { ...p, panelW }, reserve);
  if (ok(0)) return 0;
  let hi = 1;
  // A finite bound also avoids an endless search when no sunlight can prevent a reserve breach.
  for (let i = 0; i < 50 && !ok(hi); i++) hi *= 2;
  if (!ok(hi)) return NaN;
  let lo = 0;
  while (hi - lo > 1e-6 * hi) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** Longest run of steps with no panel output (Sun hidden or behind the panel), and the load energy over it. */
export function longestDark(tl: Timeline, p: EnergyInput): { hours: number; wh: number } {
  const h = tl.stepMin / 60;
  let best = { n: 0, wh: 0 };
  let run = { n: 0, wh: 0 };
  for (let i = 0; i < tl.sunVisible.length; i++) {
    const sun = tl.sunVisible[i];
    const gen = p.panelW * sun * panelCos(tl.sunAz[i], tl.sunEl[i], p.panel, p.panelAzDeg, p.panelTiltDeg);
    if (gen > 0) {
      run = { n: 0, wh: 0 };
      continue;
    }
    run = { n: run.n + 1, wh: run.wh + (sun > 0 ? p.dayLoadW : p.nightLoadW) * h };
    if (run.n > best.n) best = run;
  }
  return { hours: best.n * h, wh: best.wh };
}

/** "840 Wh" or "1.84 kWh". */
export function fmtWh(wh: number): string {
  return wh < 1000 ? `${Math.ceil(wh)} Wh` : `${(Math.ceil(wh / 10) / 100).toFixed(2)} kWh`;
}
