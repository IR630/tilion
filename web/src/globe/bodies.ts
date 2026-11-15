// Sun and Earth on the Globe (#157): directions at any moment and the Earth's spin. Pure maths, no
// three.js: tested in jsdom. Scene frame as in ./geo.ts: MOON_ME (X, Y, Z) → (X, Z, −Y).
import { lonLatToVec, R_KM, type Subpoints } from "./geo";

export type Vec3 = [number, number, number];

const D = Math.PI / 180;
const DAY_MS = 86400000;
const J2000_MS = Date.UTC(2000, 0, 1, 12); // JD 2451545.0 (UTC ≈ TT: 69 s = 0.3° of Earth spin)

const norm = (v: Vec3): Vec3 => {
  const r = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / r, v[1] / r, v[2] / r];
};
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export type Dirs = {
  sun: Vec3; // unit, scene frame, from the Moon centre
  earth: Vec3;
  earthDistKm: number;
  clamped: boolean; // the moment is outside the precomputed range: the nearest end
};

/**
 * Sun and Earth directions at a moment (ms since epoch): the hourly SPICE points (subpoints.json,
 * MOON_ME, LT+S) interpolated linearly in time and renormalised. At a whole hour it is the SPICE
 * point itself; between hours the error is < 0.001° (the Sun moves 0.5°/h across the sky).
 */
export function dirsAt(s: Subpoints, ms: number): Dirs {
  const step = s.stepMin * 60000;
  const raw = (ms - Date.parse(s.startUtc)) / step;
  const f = Number.isFinite(raw) ? Math.min(s.n - 1, Math.max(0, raw)) : 0;
  const i = Math.min(s.n - 2, Math.floor(f));
  const t = f - i;
  const lerp = (a: Vec3, b: Vec3): Vec3 => norm([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  const v = (lon: number[], lat: number[], k: number) => lonLatToVec(lon[k], lat[k]);
  return {
    sun: lerp(v(s.sunLonE, s.sunLat, i), v(s.sunLonE, s.sunLat, i + 1)),
    earth: lerp(v(s.earthLonE, s.earthLat, i), v(s.earthLonE, s.earthLat, i + 1)),
    earthDistKm: s.earthDistKm[i] + (s.earthDistKm[i + 1] - s.earthDistKm[i]) * t,
    clamped: f !== raw,
  };
}

/** Local frame of a site on the R sphere (scene frame): up, east, north. As precompute.ephem.frame. */
export function siteFrame(lonE: number, lat: number): { up: Vec3; east: Vec3; north: Vec3 } {
  const up = lonLatToVec(lonE, lat);
  const east = lonLatToVec(lonE + 90, 0);
  return { up, east, north: cross(up, east) };
}

/**
 * Azimuth (deg from north to east, 0..360) and elevation (deg above the level horizon, no terrain)
 * of a body seen from a site at height hM over the R sphere. distKm = Infinity: no parallax.
 * The same geometry as precompute.ephem.topo, which writes timeline sunAz/sunEl/earthAz/earthEl.
 */
export function siteAzEl(site: [number, number], dir: Vec3, distKm = Infinity, hM = 0): { az: number; el: number } {
  const { up, east, north } = siteFrame(site[0], site[1]);
  const r = R_KM + hM / 1000;
  const v: Vec3 = Number.isFinite(distKm)
    ? [dir[0] * distKm - up[0] * r, dir[1] * distKm - up[1] * r, dir[2] * distKm - up[2] * r]
    : dir;
  const n = Math.hypot(v[0], v[1], v[2]);
  return {
    az: ((Math.atan2(dot(v, east), dot(v, north)) / D) % 360 + 360) % 360,
    el: Math.asin(Math.max(-1, Math.min(1, dot(v, up) / n))) / D,
  };
}

/**
 * J2000 → MOON_ME rotation (rows): the IAU WGCCRE 2009 Moon model, Archinal et al. 2011,
 * Celest. Mech. Dyn. Astr. 109, 101, table 2 (it approximates the mean Earth/polar axis frame).
 * bodies.test.ts checks it against SPICE: the Sun from it lands within 0.1° of subpoints.json.
 */
export function j2000ToMoon(ms: number): [Vec3, Vec3, Vec3] {
  const d = (ms - J2000_MS) / DAY_MS;
  const T = d / 36525;
  const E = [
    125.045 - 0.0529921 * d, 250.089 - 0.1059842 * d, 260.008 + 13.0120009 * d, 176.625 + 13.3407154 * d,
    357.529 + 0.9856003 * d, 311.589 + 26.4057084 * d, 134.963 + 13.064993 * d, 276.617 + 0.3287146 * d,
    34.226 + 1.7484877 * d, 15.134 - 0.1589763 * d, 119.743 + 0.0036096 * d, 239.961 + 0.1643573 * d,
    25.053 + 12.9590088 * d,
  ].map((x) => x * D);
  const sn = (k: number) => Math.sin(E[k - 1]);
  const cs = (k: number) => Math.cos(E[k - 1]);
  const ra =
    269.9949 + 0.0031 * T - 3.8787 * sn(1) - 0.1204 * sn(2) + 0.07 * sn(3) - 0.0172 * sn(4) + 0.0072 * sn(6) -
    0.0052 * sn(10) + 0.0043 * sn(13);
  const dec =
    66.5392 + 0.013 * T + 1.5419 * cs(1) + 0.0239 * cs(2) - 0.0278 * cs(3) + 0.0068 * cs(4) - 0.0029 * cs(6) +
    0.0009 * cs(7) + 0.0008 * cs(10) - 0.0009 * cs(13);
  const w =
    38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.561 * sn(1) + 0.1208 * sn(2) - 0.0642 * sn(3) + 0.0158 * sn(4) +
    0.0252 * sn(5) - 0.0066 * sn(6) - 0.0047 * sn(7) - 0.0046 * sn(8) + 0.0028 * sn(9) + 0.0052 * sn(10) +
    0.004 * sn(11) + 0.0019 * sn(12) - 0.0044 * sn(13);
  // Body axes in J2000: z = pole (ra, dec); x = node + W along the body equator.
  const a = ra * D;
  const b = dec * D;
  const W = w * D;
  const z: Vec3 = [Math.cos(b) * Math.cos(a), Math.cos(b) * Math.sin(a), Math.sin(b)];
  const node: Vec3 = [-Math.sin(a), Math.cos(a), 0]; // ascending node of the body equator on the J2000 equator
  const q = cross(z, node);
  const x: Vec3 = [0, 1, 2].map((k) => node[k] * Math.cos(W) + q[k] * Math.sin(W)) as Vec3;
  return [x, cross(z, x), z];
}

/** MOON_ME vector → scene frame. */
const meToScene = (v: Vec3): Vec3 => [v[0], v[2], -v[1]];
const apply = (m: [Vec3, Vec3, Vec3], v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/**
 * Earth's spin on the Globe: its north pole and the lon 0 axis in the scene frame. GMST (IAU 1982,
 * Meeus "Astronomical Algorithms" eq. 12.4, UTC for UT1) about the J2000 pole; precession since J2000 (~0.4°) and nutation are left out.
 */
export function earthAxes(ms: number): { pole: Vec3; prime: Vec3 } {
  const d = (ms - J2000_MS) / DAY_MS;
  const gmst = (280.46061837 + 360.98564736629 * d) * D;
  const m = j2000ToMoon(ms);
  return {
    pole: meToScene(apply(m, [0, 0, 1])),
    prime: meToScene(apply(m, [Math.cos(gmst), Math.sin(gmst), 0])),
  };
}

/**
 * Geocentric Sun direction in J2000 (Astronomical Almanac, section C "Low-precision formulas for the
 * Sun", ~0.01°; the
 * ecliptic of date is brought back to J2000 by the general precession in longitude).
 */
export function sunJ2000(ms: number): Vec3 {
  const n = (ms - J2000_MS) / DAY_MS;
  const g = (357.528 + 0.9856003 * n) * D;
  const lam = (280.46 + 0.9856474 * n + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g) - (0.0139697 * n) / 365.25) * D;
  const eps = 23.4392911 * D;
  return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
}

/** Sun direction from the Moon centre (scene frame) by the IAU model alone: a check of j2000ToMoon. */
export function sunFromMoonIau(ms: number, earth: Vec3, earthDistKm: number): Vec3 {
  const AU_KM = 149597870.7;
  const g = meToScene(apply(j2000ToMoon(ms), sunJ2000(ms)));
  // Sun from the Moon = Sun from the Earth + Earth from the Moon.
  return norm([g[0] * AU_KM + earth[0] * earthDistKm, g[1] * AU_KM + earth[1] * earthDistKm, g[2] * AU_KM + earth[2] * earthDistKm]);
}

/** Angle between two unit vectors, deg. */
export function sepDeg(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / D;
}

/**
 * Time animation from the shown moment to a new one: the hourly path, not a chord, so the Sun goes
 * round the Moon. Duration grows with the step; a step over 30 days starts 30 days before the target.
 */
export function tween(fromMs: number, toMs: number, reduced: boolean): { from: number; durMs: number } {
  const span = 30 * DAY_MS;
  const from = Math.abs(toMs - fromMs) > span ? toMs - Math.sign(toMs - fromMs) * span : fromMs;
  const days = Math.abs(toMs - from) / DAY_MS;
  return { from, durMs: reduced || !Number.isFinite(days) ? 0 : Math.min(1400, 350 + 300 * Math.log2(1 + days)) };
}

/** Ease-out cubic, 0..1. */
export const easeOut = (t: number) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
