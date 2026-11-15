// Custom point (#31): the browser port of the precompute. Same method and constants as
// backend/src/precompute: geo.horizon_mask, geo.sun_visible_fraction, geo.centre_visible,
// validation.topo_fast and __main__.site_timeline. Observer 2 m, 720 azimuths, ray along the
// sphere to 300 km or the DEM edge. Python reference: tests/fixtures/custom_reference.json.
import type { HorizonMask, Site, Terrain, Timeline } from "../contracts";

export const R = 1737400; // m, LOLA reference sphere
export const OBSERVER_M = 2;
export const AZ_STEP = 0.5;
export const MAX_M = 300e3;
/** In-browser DEM: LOLA 240 m, ±931 km square around the pole, in tiles (backend precompute.custom). */
export const DEM_STEP_M = 240;
export const DEM_HALF_M = 3880 * DEM_STEP_M;
/** A custom point takes terrain south of it (the DEM coverage, 60–90°S). */
export const DEM_MIN_LAT = -60;

type Vec = [number, number, number];
/** DEM grid in south polar stereographic metres: height (m) = q[row * width + col] * scaleM. */
export type Dem = { q: Int16Array; width: number; height: number; x0: number; y0: number; dx: number; dy: number; scaleM: number };
/** Selenocentric apparent vectors (km, MOON_ME, LT+S), v[6i .. 6i+5] = Sun xyz, Earth xyz at step i. */
export type Ephem = { startUtc: string; stepMin: number; n: number; v: Float32Array; sunRadiusKm: number; earthRadiusKm: number };

const D = Math.PI / 180;
const mod360 = (a: number) => ((a % 360) + 360) % 360;
const r2 = (v: number) => Math.round(v * 100) / 100;
/** Sun flux share to 0.01; any flux > 0 stays >= 0.01, so a thin crescent is still lit (D-010). */
export const roundFlux = (v: number) => (v > 0 ? Math.max(0.01, r2(v)) : 0);

export function unit(lonE: number, lat: number): Vec {
  const lo = lonE * D;
  const la = lat * D;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
}

/** Local up, east, north unit vectors (MOON_ME body-fixed). */
function frame(lonE: number, lat: number): [Vec, Vec, Vec] {
  const up = unit(lonE, lat);
  const n = Math.sqrt(up[0] * up[0] + up[1] * up[1]);
  const east: Vec = [-up[1] / n, up[0] / n, 0]; // [0, 0, 1] x up
  const north: Vec = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ];
  return [up, east, north];
}

/** Unit vector -> south polar stereographic x, y (m). */
export function toXY(px: number, py: number, pz: number): [number, number] {
  const k = (2 * R) / (1 - pz);
  return [k * py, k * px];
}

/** True when the in-browser DEM covers the point: 60–90°S (a one-pixel margin keeps the bilinear sample inside). */
export function inCustomDem(lat: number, lonE: number): boolean {
  const [x, y] = toXY(...unit(lonE, lat));
  return lat <= DEM_MIN_LAT && Math.max(Math.abs(x), Math.abs(y)) < DEM_HALF_M - DEM_STEP_M;
}

/** Bilinear sample at pixel centres, NaN outside the grid. */
export function sample(d: Dem, x: number, y: number): number {
  const c = (x - d.x0) / d.dx - 0.5;
  const r = (y - d.y0) / d.dy - 0.5;
  const c0 = Math.floor(c);
  const r0 = Math.floor(r);
  if (!(c0 >= 0 && r0 >= 0 && c0 < d.width - 1 && r0 < d.height - 1)) return NaN;
  const fc = c - c0;
  const fr = r - r0;
  const i = r0 * d.width + c0;
  const { q, scaleM: s, width: w } = d;
  return (
    q[i] * s * (1 - fc) * (1 - fr) + q[i + 1] * s * fc * (1 - fr) + q[i + w] * s * (1 - fc) * fr + q[i + w + 1] * s * fc * fr
  );
}

export function distances(first: number, maxM: number, growth = 0.005): number[] {
  const d = [first];
  while (d[d.length - 1] < maxM) d.push(d[d.length - 1] + Math.max(first, d[d.length - 1] * growth));
  return d;
}

/**
 * #330: longest run of ray samples without DEM (m) that still counts as a complete ray. The tiled DEM
 * has no holes (backend precompute.custom.read_dem), so a missing sample means the ray left the grid.
 * 1 km is about 4 pixels of 240 m: it lets a ray end a few pixels short of 300 km, where terrain
 * rarely sets the horizon, and fails any ray that leaves the coverage earlier.
 */
export const MAX_GAP_M = 1000;

/**
 * Terrain elevation angle (deg) per azimuth i * azStep (north to east); missing terrain counts as -90.
 * complete[k] = the ray k reached maxM inside the DEM with no gap longer than MAX_GAP_M (#330); an
 * incomplete ray gives a lower bound of the true horizon.
 */
export function horizonMask(
  dem: Dem,
  lonE: number,
  lat: number,
  hObs = OBSERVER_M,
  azStep = AZ_STEP,
  maxM = MAX_M,
): { elev: Float64Array; h0: number; complete: boolean[] } {
  const [up, east, north] = frame(lonE, lat);
  const h0 = sample(dem, ...toXY(...up));
  if (Number.isNaN(h0)) throw new Error(`no DEM under the site ${lonE}E ${lat}`);
  const ro = R + h0 + hObs;
  const d = distances(Math.abs(dem.dx) / 2, maxM);
  const cp = d.map((v) => Math.cos(v / R));
  const sp = d.map((v) => Math.sin(v / R));
  const n = Math.round(360 / azStep);
  const elev = new Float64Array(n);
  const complete: boolean[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const ca = Math.cos(k * azStep * D);
    const sa = Math.sin(k * azStep * D);
    const dir = [ca * north[0] + sa * east[0], ca * north[1] + sa * east[1], ca * north[2] + sa * east[2]];
    let best = -90;
    let gapFrom = -1; // distance where the current run without DEM starts, -1 = no run
    let ok = true;
    for (let j = 0; j < d.length; j++) {
      const p0 = cp[j] * up[0] + sp[j] * dir[0];
      const p1 = cp[j] * up[1] + sp[j] * dir[1];
      const p2 = cp[j] * up[2] + sp[j] * dir[2];
      const h = sample(dem, ...toXY(p0, p1, p2));
      if (Number.isNaN(h)) {
        if (gapFrom < 0) gapFrom = j > 0 ? d[j - 1] : 0;
        if (d[j] - gapFrom > MAX_GAP_M) ok = false;
        continue;
      }
      gapFrom = -1;
      const rq = R + h;
      const vert = rq * cp[j] - ro;
      const dist = Math.sqrt(rq * rq + ro * ro - 2 * rq * ro * cp[j]);
      const el = Math.asin(vert / dist) / D;
      if (el > best) best = el;
    }
    elev[k] = best;
    complete[k] = ok;
  }
  return { elev, h0, complete };
}

/** np.interp(a, i * step, mask, period=360). */
function maskAt(mask: ArrayLike<number>, step: number, a: number): number {
  const x = mod360(a);
  const i = Math.floor(x / step);
  const f0 = mask[i];
  return ((mask[(i + 1) % mask.length] - f0) / step) * (x - i * step) + f0;
}

/** Share of a disc (centre az/el, angular radius rad, deg) above the mask: vertical strips. */
/** Solar limb darkening at 550 nm, I(mu)/I(1) = a0 + a1 mu + a2 mu^2 (geo.SUN_LIMB, D-010). */
export const SUN_LIMB: Limb = [0.3, 0.93, -0.23];
export const UNIFORM: Limb = [1, 0, 0];
type Limb = readonly [number, number, number];

/** geo._strip_flux: flux of a unit-disc strip (half-chord Y) from its bottom to height y. */
function stripFlux(y: number, Y: number, [a0, a1, a2]: Limb): number {
  const root = Math.sqrt(Math.max(Y * Y - y * y, 0));
  const asin = Math.asin(Math.min(1, Math.max(-1, y / Y)));
  return a0 * y + a1 * 0.5 * (y * root + Y * Y * asin) + a2 * (Y * Y * y - (y * y * y) / 3);
}

/** geo.visible_fraction: share of the disc flux above the mask (limb = UNIFORM gives the area share). */
export function visibleFraction(
  az: number,
  el: number,
  rad: number,
  mask: ArrayLike<number>,
  step: number,
  strips = 15,
  limb: Limb = UNIFORM,
): number {
  const c = Math.cos(Math.min(89, Math.max(-89, el)) * D);
  let num = 0;
  let den = 0;
  for (let s = 0; s < strips; s++) {
    const x = ((s + 0.5) / strips) * 2 - 1;
    const Y = Math.sqrt(1 - x * x);
    const hz = maskAt(mask, step, az + (x * rad) / c);
    const t = Math.min(Y, Math.max(-Y, (hz - el) / rad));
    const top = stripFlux(Y, Y, limb);
    num += top - stripFlux(t, Y, limb);
    den += top - stripFlux(-Y, Y, limb);
  }
  return num / den;
}

/** geo.sep_deg: great-circle angle between two az/el directions (deg). */
export function sepDeg(a1: number, e1: number, a2: number, e2: number): number {
  const c = Math.sin(e1 * D) * Math.sin(e2 * D) + Math.cos(e1 * D) * Math.cos(e2 * D) * Math.cos((a1 - a2) * D);
  return Math.acos(Math.min(1, Math.max(-1, c))) / D;
}

/** geo.EARTH_SHADOW_SCALE: Earth radius with the opaque air layer, Danjon rule of the NASA GSFC catalogue (D-010). */
export const EARTH_SHADOW_SCALE = 1.01;
export const shadowRadius = (earthRad: number) => Math.asin(EARTH_SHADOW_SCALE * Math.sin(earthRad * D)) / D;

/** geo.sun_visible_fraction: solar flux above the mask and outside Earth's shadow. */
export function sunVisibleFraction(
  az: number, el: number, rad: number, mask: ArrayLike<number>, step: number,
  earthAz: number, earthEl: number, earthRad: number, strips = 15,
): number {
  const da = (earthAz - az) * D;
  const se = el * D;
  const ee = earthEl * D;
  const dx = Math.cos(ee) * Math.sin(da);
  const dy = Math.cos(se) * Math.sin(ee) - Math.sin(se) * Math.cos(ee) * Math.cos(da);
  const sinSep = Math.hypot(dx, dy);
  const sep = sepDeg(az, el, earthAz, earthEl) * D;
  const scale = sinSep > 1e-12 ? sep / sinSep : 1;
  const ex = dx * scale / D / rad;
  const ey = dy * scale / D / rad;
  const er = earthRad / rad;
  const overlaps = sep <= (rad + earthRad) * D;
  const c = Math.cos(Math.min(89, Math.max(-89, el)) * D);
  let num = 0;
  let den = 0;
  for (let s = 0; s < strips; s++) {
    const x = ((s + 0.5) / strips) * 2 - 1;
    const Y = Math.sqrt(1 - x * x);
    const bottom = Math.min(Y, Math.max(-Y, (maskAt(mask, step, az + x * rad / c) - el) / rad));
    const top = stripFlux(Y, Y, SUN_LIMB);
    const width = overlaps ? Math.sqrt(Math.max(er * er - (x - ex) ** 2, 0)) : 0;
    const low = Math.min(Y, Math.max(bottom, ey - width));
    const high = Math.min(Y, Math.max(bottom, ey + width));
    num += top - stripFlux(bottom, Y, SUN_LIMB) - (stripFlux(high, Y, SUN_LIMB) - stripFlux(low, Y, SUN_LIMB));
    den += top - stripFlux(-Y, Y, SUN_LIMB);
  }
  return Math.min(1, Math.max(0, num / den));
}

/** geo.eclipsed_fraction: share of the limb-darkened Sun flux behind the Earth disc (angles in deg). */
export function eclipsedFraction(sep: number, sunRad: number, earthRad: number, rings = 64, limb: Limb = SUN_LIMB): number {
  const [a0, a1, a2] = limb;
  let num = 0;
  let den = 0;
  for (let k = 0; k < rings; k++) {
    const r = (k + 0.5) / rings;
    const mu = Math.sqrt(1 - r * r);
    const w = (a0 + a1 * mu + a2 * mu * mu) * r;
    const rho = r * sunRad;
    const c = (sep * sep + rho * rho - earthRad * earthRad) / (2 * Math.max(sep, 1e-12) * rho);
    num += (Math.acos(Math.min(1, Math.max(-1, c))) / Math.PI) * w;
    den += w;
  }
  return num / den;
}

/** 1 where the body centre is above the mask + margin (Q9: communication = centre). */
export function centreVisible(az: number, el: number, mask: ArrayLike<number>, step: number, margin = 0): number {
  return el > maskAt(mask, step, az) + margin ? 1 : 0;
}

export type BodyState = "visible" | "hidden" | "unknown";

/**
 * #330: Sun or Earth state at one moment. visible = timeline flag (> 0 = above the known terrain).
 * Missing terrain can only raise the horizon: a body the known terrain hides stays "hidden". A body
 * above the known terrain is "unknown" when a ray under it (az ± halfWidth deg) is incomplete.
 * complete = null (catalogue site, no flags) keeps the flag as it is.
 */
export function bodyState(
  az: number,
  el: number,
  visible: number,
  complete: ArrayLike<boolean> | null | undefined,
  step: number,
  halfWidth = 0,
): BodyState {
  if (!(visible > 0)) return "hidden";
  if (!complete) return "visible";
  const n = complete.length;
  const w = halfWidth / Math.cos(Math.min(89, Math.abs(el)) * D);
  const lo = Math.floor((az - w) / step);
  const hi = Math.ceil((az + w) / step);
  for (let k = lo; k <= hi; k++) if (!complete[((k % n) + n) % n]) return "unknown";
  return "visible";
}

/** az, el, angular radius (deg) of body b (0 Sun, 1 Earth) at step i from the selenocentric vectors. */
function topo(e: Ephem, i: number, b: 0 | 1, f: [Vec, Vec, Vec], robsKm: number, radiusKm: number): [number, number, number] {
  const [up, east, north] = f;
  const o = 6 * i + 3 * b;
  const v = [e.v[o] - up[0] * robsKm, e.v[o + 1] - up[1] * robsKm, e.v[o + 2] - up[2] * robsKm];
  const dot = (u: Vec) => v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  const dist = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return [mod360(Math.atan2(dot(east), dot(north)) / D), Math.asin(dot(up) / dist) / D, Math.asin(radiusKm / dist) / D];
}

/**
 * Contract HorizonMask and Timeline of a custom point; terrain "none" = bare sphere (zero mask).
 * complete = per-azimuth ray completeness (#330), outside the contract; null without terrain.
 */
export function computeCustom(
  site: Site,
  dem: Dem | null,
  e: Ephem,
): { mask: HorizonMask; timeline: Timeline; complete: boolean[] | null } {
  const lat = site.lat as number;
  const lonE = site.lonE as number;
  let raw: Float64Array = new Float64Array(Math.round(360 / AZ_STEP));
  let h0 = 0;
  let complete: boolean[] | null = null;
  let terrain: Terrain = "none";
  if (site.terrain !== "none") {
    if (!dem) throw new Error("custom point: DEM not loaded");
    ({ elev: raw, h0, complete } = horizonMask(dem, lonE, lat));
    terrain = "polar240";
  }
  // As the precompute: the timeline reads the mask rounded to 0.01 deg.
  const elevDeg = Array.from(raw, r2);
  const f = frame(lonE, lat);
  const robs = (R + h0 + OBSERVER_M) / 1000;
  const tl: Timeline = {
    siteId: site.id,
    startUtc: e.startUtc,
    stepMin: e.stepMin,
    sunAz: [],
    sunEl: [],
    sunVisible: [],
    earthAz: [],
    earthEl: [],
    earthVisible: [],
  };
  for (let i = 0; i < e.n; i++) {
    const [saz, sel, srad] = topo(e, i, 0, f, robs, e.sunRadiusKm);
    const [eaz, eel, erad] = topo(e, i, 1, f, robs, e.earthRadiusKm);
    tl.sunAz.push(r2(saz));
    tl.sunEl.push(r2(sel));
    tl.sunVisible.push(roundFlux(sunVisibleFraction(saz, sel, srad, elevDeg, AZ_STEP, eaz, eel, shadowRadius(erad))));
    tl.earthAz.push(r2(eaz));
    tl.earthEl.push(r2(eel));
    tl.earthVisible.push(centreVisible(eaz, eel, elevDeg, AZ_STEP));
  }
  const mask: HorizonMask = { siteId: site.id, observerHeightM: OBSERVER_M, terrain, azStepDeg: AZ_STEP, elevDeg };
  return { mask, timeline: tl, complete };
}
