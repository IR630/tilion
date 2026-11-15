// BETA (#325): "Thermal now" map layer over the #288 horizon field (±32 km, 250 m). Flat cells, no heat from nearby slopes.
// Sunlit cell: radiative equilibrium of the absorbed flux (the 1D model stays 1-3 K below it on the polar day side).
// Shadowed cell: the 1D model (./thermal.ts) cooling curve by hours in shadow, from the equilibrium of the last lit sample.
import { litShare, type ShadowField } from "../../navigator/shadows";
import { RAMP_STOPS } from "./globeThermal";
import { ALBEDO, EMISSIVITY, SOLAR, regolithTemps } from "./thermal";

export type SunVec = [number, number, number];
const SIGMA = 5.670374419e-8;
const EPS_SIGMA = EMISSIVITY * SIGMA;
/** Lookback, hours before now, with a growing stride; the layer stops at 720 h (one month). */
export const LOOKBACK_H = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 720];
export const MAX_DARK_H = 720;
/** Cooling table rows: T0 of the lit ground before the shadow, K. */
export const T0_ROWS = [100, 120, 140, 160, 180, 200, 220, 240, 260];
/** Below this flux a cell counts as shadowed: the equilibrium of the coldest row (100 K, ~5.4 W/m2). */
export const LIT_FLUX = EPS_SIGMA * T0_ROWS[0] ** 4;
export const PAINT_MIN_K = 40;
export const PAINT_MAX_K = 250;

/** Radiative equilibrium temperature of an absorbed flux, K. */
export const teq = (flux: number) => Math.sqrt(Math.sqrt(Math.max(0, flux) / EPS_SIGMA));

/** Absorbed flux per cell, W/m2: S (1 - A) x visible disc share x max(0, sin el), flat horizontal cell. */
export function cellFlux(f: ShadowField, sun: SunVec): Float32Array {
  const sinEl = new Float32Array(f.size * f.size);
  const out = litShare(f, sun, sinEl);
  const k = SOLAR * (1 - ALBEDO);
  for (let i = 0; i < out.length; i++) out[i] = k * out[i] * Math.max(0, sinEl[i]);
  return out;
}

let table: Float32Array | null = null; // [row][hour 0..720], surface K
export let tableBuildMs = 0;

/** Per T0 row: one lunation of the flux that gives T0 (spun up 40 times by regolithTemps), then 720 h of darkness. */
export function coolTable(): Float32Array {
  if (table) return table;
  const t = performance.now();
  const lit = 709; // steps of 60 min in a synodic month: regolithTemps spins up exactly these
  const out = new Float32Array(T0_ROWS.length * (MAX_DARK_H + 1));
  T0_ROWS.forEach((T0, r) => {
    const el = Math.asin((EPS_SIGMA * T0 ** 4) / (SOLAR * (1 - ALBEDO))) * (180 / Math.PI);
    const sunEl = Array.from({ length: lit + MAX_DARK_H + 1 }, (_, i) => (i < lit ? el : -10));
    const T = regolithTemps({ sunEl, sunVisible: sunEl.map((e) => (e > 0 ? 1 : 0)), stepMin: 60 });
    for (let h = 0; h <= MAX_DARK_H; h++) out[r * (MAX_DARK_H + 1) + h] = T[lit + h];
  });
  tableBuildMs = performance.now() - t;
  return (table = out);
}

/** Surface temperature after h hours of darkness from ground in equilibrium at T0; bilinear in the table, clamped to its edges. */
export function cool(T0: number, h: number): number {
  const tb = coolTable();
  const n = MAX_DARK_H + 1;
  const fr = Math.max(0, Math.min(T0_ROWS.length - 1, (T0 - T0_ROWS[0]) / (T0_ROWS[1] - T0_ROWS[0])));
  const r = Math.min(T0_ROWS.length - 2, Math.floor(fr));
  const fh = Math.max(0, Math.min(MAX_DARK_H, h));
  const j = Math.min(MAX_DARK_H - 1, Math.floor(fh));
  const a = fr - r, b = fh - j;
  const at = (rr: number, jj: number) => tb[rr * n + jj];
  return (1 - a) * ((1 - b) * at(r, j) + b * at(r, j + 1)) + a * ((1 - b) * at(r + 1, j) + b * at(r + 1, j + 1));
}

/**
 * Temperature per cell from the flux now and the lookback fluxes (hours[j] ascending, flux of sample j from getFlux(j)).
 * A shadowed cell takes the first lit sample: shadow began between the previous sample and it (midpoint).
 * getFlux is called only while some cell is still unresolved. Cells never lit in the lookback: coldest row at 720 h.
 */
export function temps(now: Float32Array, hours: number[], getFlux: (j: number) => Float32Array): Float32Array {
  const T = new Float32Array(now.length);
  let open: number[] = [];
  for (let i = 0; i < now.length; i++) {
    if (now[i] >= LIT_FLUX) T[i] = teq(now[i]);
    else open.push(i);
  }
  let prev = 0;
  for (let j = 0; j < hours.length && open.length; j++) {
    const flux = getFlux(j);
    const next: number[] = [];
    for (const i of open) {
      if (flux[i] >= LIT_FLUX) T[i] = cool(teq(flux[i]), (prev + hours[j]) / 2);
      else next.push(i);
    }
    open = next;
    prev = hours[j];
  }
  const cold = cool(T0_ROWS[0], MAX_DARK_H);
  for (const i of open) T[i] = cold;
  return T;
}

// Flux maps by Sun vector (one field only). The caller snaps long lookbacks to a grid, so a time step reuses most of them.
const cache = new Map<string, Float32Array>();
const CACHE_MAX = 48; // 48 x 256 KB
function fluxCached(f: ShadowField, sun: SunVec): Float32Array {
  const key = sun.join(",");
  let v = cache.get(key);
  if (v) cache.delete(key);
  else v = cellFlux(f, sun);
  cache.set(key, v);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return v;
}

/** Hours to look back for stride hour h at timeline step k: from 8 h on, the sample snaps to a grid of 2^floor(log2(h/4)) h. */
export function snapBack(k: number, h: number): number {
  const g = h < 8 ? 1 : 2 ** Math.floor(Math.log2(h / 4));
  return k - Math.floor((k - h) / g) * g;
}

/** Temperature field at the moment: Sun now and the lookback Sun vectors (ascending hours). */
export function thermalField(f: ShadowField, now: SunVec, back: { h: number; sun: SunVec }[]): Float32Array {
  return temps(fluxCached(f, now), back.map((b) => b.h), (j) => fluxCached(f, back[j].sun));
}

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const STOPS = RAMP_STOPS.map(hex);

/** sRGB of the globe ramp stops stretched over PAINT_MIN_K..PAINT_MAX_K. */
export function paintColor(T: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, (T - PAINT_MIN_K) / (PAINT_MAX_K - PAINT_MIN_K))) * (STOPS.length - 1);
  const i = Math.min(STOPS.length - 2, Math.floor(x));
  const t = x - i;
  return [0, 1, 2].map((k) => Math.round(STOPS[i][k] + (STOPS[i + 1][k] - STOPS[i][k]) * t)) as [number, number, number];
}

/** Paint the temperature field onto a size x size canvas; the outer `fade` cells fade out. Alpha 0.7 keeps the relief readable. */
export function paintThermal(canvas: HTMLCanvasElement, f: ShadowField, T: Float32Array, fade = 10) {
  canvas.width = f.size;
  canvas.height = f.size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(f.size, f.size);
  for (let r = 0; r < f.size; r++) {
    for (let c = 0; c < f.size; c++) {
      const i = r * f.size + c;
      const edge = Math.min(1, (Math.min(r, c, f.size - 1 - r, f.size - 1 - c) + 0.5) / fade);
      const [R, G, B] = paintColor(T[i]);
      img.data.set([R, G, B, Math.round(edge * 180)], i * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
}
