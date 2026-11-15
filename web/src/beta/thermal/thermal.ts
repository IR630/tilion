import type { Timeline } from "../../contracts";

// BETA: surface temperature of flat horizontal regolith, 1D heat conduction. No lander, no slopes.
export const SOLAR = 1361; // W/m2, total solar irradiance at 1 AU (Kopp & Lean 2011)
export const ALBEDO = 0.12; // Bond albedo of the Moon, ~0.12 (Hayne et al. 2017, JGR Planets, doi:10.1002/2017JE005387)
export const EMISSIVITY = 0.95; // bolometric emissivity (same source)
const SIGMA = 5.670374419e-8; // W/m2/K4, Stefan-Boltzmann
// Constant properties with thermal inertia I = sqrt(k rho c) = 55 J m-2 K-1 s-1/2, the Hayne et al. 2017 surface value.
const RHO_C = 1.2e6; // J/m3/K: rho 1500 kg/m3 x c 800 J/kg/K
const CONDUCT = (55 * 55) / RHO_C; // W/m/K
const LUNATION_S = 29.530589 * 86400; // synodic month, Meeus
const NODES = 18;
const DZ0 = 0.002; // m, first layer; layers grow x1.25 to ~0.35 m (about 8 diurnal skin depths of ~4 cm)
const GROWTH = 1.25;
const SUB_S = 450; // s, sub-step: explicit interior stays stable down to 2 mm layers (limit ~1000 s)
const SPINUP = 40; // repeats of the first lunation; the slowest mode of the 0.35 m slab dies in ~9 lunations
const T_START = 200; // K, start before spin-up

/** Surface temperature, K, at the start of every step of the timeline. The first lunation repeats to spin the layers up.
 * The Sun flux is S x sunVisible x sin(elevation) x (1 - albedo); sunVisible is used as is (limb-darkened share, D-010).
 * Interior heat flow (~0.02 W/m2) is ignored: the bottom is insulated. */
export function regolithTemps(tl: Pick<Timeline, "sunEl" | "sunVisible" | "stepMin">): number[] {
  const n = tl.sunEl.length;
  if (n === 0 || !(tl.stepMin > 0)) return [];
  const h: number[] = []; // spacing between nodes
  for (let k = 0; k < NODES - 1; k++) h.push(DZ0 * GROWTH ** k);
  const w = h.map((_, k) => (k === 0 ? h[0] / 2 : (h[k - 1] + h[k]) / 2)); // cell widths
  w.push(h[NODES - 2] / 2); // last node
  const T = new Array<number>(NODES).fill(T_START);
  const flux = new Array<number>(NODES).fill(0); // flux[k]: conduction from node k+1 into node k; flux[last] = 0 (insulated)
  const sub = Math.max(1, Math.ceil((tl.stepMin * 60) / SUB_S));
  const dt = (tl.stepMin * 60) / sub;
  const out: number[] = new Array(n);
  const spin = Math.min(n, Math.round(LUNATION_S / (tl.stepMin * 60)));
  const step = (i: number) => {
    const el = tl.sunEl[i] * (Math.PI / 180);
    const f = SOLAR * (tl.sunVisible[i] || 0) * Math.max(0, Math.sin(el)) * (1 - ALBEDO);
    for (let s = 0; s < sub; s++) {
      for (let k = 0; k < NODES - 1; k++) flux[k] = (CONDUCT * (T[k + 1] - T[k])) / h[k];
      for (let k = 1; k < NODES; k++) T[k] += (dt * (flux[k] - flux[k - 1])) / (RHO_C * w[k]);
      // Surface node: radiation linearised and implicit, so a hot noon cannot blow up.
      const c = dt / (RHO_C * w[0]);
      const t3 = EMISSIVITY * SIGMA * T[0] ** 3;
      T[0] = (T[0] + c * (f + flux[0] + 3 * t3 * T[0])) / (1 + c * 4 * t3);
    }
  };
  for (let r = 0; r < SPINUP; r++) for (let i = 0; i < spin; i++) step(i);
  for (let i = 0; i < n; i++) {
    out[i] = T[0];
    step(i);
  }
  return out;
}

export const kelvinToC = (k: number) => k - 273.15;

/** #340: the beta is flat ground; the backend model with the ground slope is the one checked against Diviner (validation group `thermal`). */
export const CHECKED_NOTE =
  "The checked model, with the ground slope, is in NASA check: Regolith surface temperature vs Diviner and Apollo.";
