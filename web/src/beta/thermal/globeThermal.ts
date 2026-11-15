// BETA (#290): thermal mode of the Globe. A smooth-sphere lookup table of regolith surface
// temperature by latitude and local solar time (the 1D model of ./thermal.ts), a slope correction
// of the instantaneous Sun term, and the colour ramp shared by the shader and the legend. No three.js.
import { ALBEDO, EMISSIVITY, SOLAR, regolithTemps } from "./thermal";

const D = Math.PI / 180;
const SIGMA = 5.670374419e-8;
const LUNATION_MIN = 29.530589 * 1440;
export const LUT_LAT_STEP = 5; // deg; rows -90 .. 90
export const LUT_NLAT = 180 / LUT_LAT_STEP + 1; // 37
export const LUT_NH = 72; // local-time bins, 5 deg of hour angle (~9.8 h) each
const SUBSTEPS = 4; // model steps per bin: ~2.5 h steps of the Sun flux

/** Flux to T^4: S(1-A)/(eps sigma), K^4 per unit cos(incidence). */
export const FLUX_K4 = (SOLAR * (1 - ALBEDO)) / (EMISSIVITY * SIGMA);

/** Row r = latitude -90 + 5r; column j = hour angle -180 + 5j deg (j = 36: local noon). Kelvin. */
export type Lut = { T: Float32Array; floor: Float32Array; subsolarLatDeg: number };

/** Sun elevation (deg) on a smooth sphere: latitude, subsolar latitude, hour angle (deg). */
export function sunElDeg(latDeg: number, subLatDeg: number, hourDeg: number): number {
  const s = Math.sin(latDeg * D) * Math.sin(subLatDeg * D) + Math.cos(latDeg * D) * Math.cos(subLatDeg * D) * Math.cos(hourDeg * D);
  return Math.asin(Math.max(-1, Math.min(1, s))) / D;
}

/** One synodic day per latitude through regolithTemps, from local midnight. floor[r] = night minimum of row r. */
export function buildLut(subsolarLatDeg: number): Lut {
  const n = LUT_NH * SUBSTEPS;
  const stepMin = LUNATION_MIN / n;
  const T = new Float32Array(LUT_NLAT * LUT_NH);
  const floor = new Float32Array(LUT_NLAT);
  for (let r = 0; r < LUT_NLAT; r++) {
    const lat = -90 + LUT_LAT_STEP * r;
    const sunEl = Array.from({ length: n }, (_, i) => sunElDeg(lat, subsolarLatDeg, -180 + (360 * i) / n));
    const out = regolithTemps({ sunEl, sunVisible: sunEl.map((e) => (e > 0 ? 1 : 0)), stepMin });
    let lo = Infinity;
    for (let j = 0; j < LUT_NH; j++) {
      const t = out[j * SUBSTEPS];
      T[r * LUT_NH + j] = t;
      lo = Math.min(lo, t);
    }
    floor[r] = lo;
  }
  return { T, floor, subsolarLatDeg };
}

/** LUT value at a grid node (latitude multiple of 5, hour angle multiple of 5 deg). */
export function lutAt(lut: Lut, latDeg: number, hourDeg: number): number {
  const r = Math.round((latDeg + 90) / LUT_LAT_STEP);
  const j = ((Math.round((hourDeg + 180) / (360 / LUT_NH)) % LUT_NH) + LUT_NH) % LUT_NH;
  return lut.T[r * LUT_NH + j];
}

/**
 * Slope correction: T^4 = tLut^4 + FLUX_K4 (max(0, cosTerrain) - max(0, cosSphere)), not below floorK.
 * The day side sits within a few K of radiative equilibrium, so the smooth-sphere Sun term is swapped
 * for the true slope incidence and the stored-heat excess of the LUT is kept. The shader repeats it.
 */
export function terrainT(tLut: number, cosSphere: number, cosTerrain: number, floorK: number): number {
  const t4 = tLut ** 4 + FLUX_K4 * (Math.max(0, cosTerrain) - Math.max(0, cosSphere));
  return Math.max(floorK, Math.sqrt(Math.sqrt(Math.max(0, t4))));
}

export const RAMP_MIN_K = 40;
export const RAMP_MAX_K = 400;
/** Inferno-like ramp (matplotlib inferno samples), even spacing over RAMP_MIN_K..RAMP_MAX_K. The dark end is lifted off black so cold ground shows on the black sky. */
export const RAMP_STOPS = ["#1b0c41", "#4a0c6b", "#781c6d", "#a52c60", "#cf4446", "#ed6925", "#fb9b06", "#f7d13d", "#fcffa4"];

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];

/** sRGB bytes of the ramp at T (K), clamped to the ramp ends. */
export function rampColor(T: number): [number, number, number] {
  const f = Math.max(0, Math.min(1, (T - RAMP_MIN_K) / (RAMP_MAX_K - RAMP_MIN_K))) * (RAMP_STOPS.length - 1);
  const i = Math.min(RAMP_STOPS.length - 2, Math.floor(f));
  const a = hex(RAMP_STOPS[i]);
  const b = hex(RAMP_STOPS[i + 1]);
  const t = f - i;
  return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as [number, number, number];
}

/** RGBA8 strip of n ramp texels, RAMP_MIN_K at texel 0. */
export function rampBytes(n = 256): Uint8Array {
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const c = rampColor(RAMP_MIN_K + ((RAMP_MAX_K - RAMP_MIN_K) * i) / (n - 1));
    out.set([c[0], c[1], c[2], 255], i * 4);
  }
  return out;
}

/** CSS gradient of the same stops, left = RAMP_MIN_K. */
export const rampCss = () => `linear-gradient(to right, ${RAMP_STOPS.join(", ")})`;
