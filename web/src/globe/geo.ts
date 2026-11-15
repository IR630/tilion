// Pure geometry and data helpers for the Globe screen (#21). No three.js here: tested in jsdom.
// Scene frame: 1 unit = Moon radius (1737.4 km). MOON_ME (X, Y, Z) → scene (x, y, z) = (X, Z, −Y):
// +y = north pole, lon 0 E on +x, lon 90 E on −z. This frame matches three.js SphereGeometry UVs:
// u = 0.5 + lonE/360 (column 0 = 180 W), v = 1 at the north pole.

export const R_KM = 1737.4;
export const R_M = R_KM * 1000;

/** data/globe/meta.json — written by scripts/globe_assets.py. */
export type GlobeMeta = {
  refRadiusKm: number;
  color: { file: string; width: number; height: number };
  height: { file: string; width: number; height: number; scaleM: number; offsetM: number; minM: number; maxM: number };
  southPatch: {
    file: string;
    size: number;
    extentM: number;
    latEdgeDeg: number;
    scaleM: number;
    offsetM: number;
    minM: number;
    maxM: number;
  };
  sources: Record<string, string>;
};

/** data/globe/subpoints.json — written by backend precompute.subpoints. */
export type Subpoints = {
  startUtc: string;
  stepMin: number;
  n: number;
  sunLat: number[];
  sunLonE: number[];
  earthLat: number[];
  earthLonE: number[];
  earthDistKm: number[];
};

export type Grid = { w: number; h: number; v: Float32Array };

const D = Math.PI / 180;

/** Unit vector in the scene frame for planetocentric lat/lon (deg). */
export function lonLatToVec(lonE: number, lat: number): [number, number, number] {
  const lo = lonE * D;
  const la = lat * D;
  const X = Math.cos(la) * Math.cos(lo);
  const Y = Math.cos(la) * Math.sin(lo);
  const Z = Math.sin(la);
  return [X, Z, -Y];
}

/** Inverse of lonLatToVec: [lonE 0..360, lat]. */
export function vecToLonLat(x: number, y: number, z: number): [number, number] {
  const r = Math.hypot(x, y, z);
  const lon = ((Math.atan2(-z, x) / D) % 360 + 360) % 360;
  return [lon, Math.asin(Math.max(-1, Math.min(1, y / r))) / D];
}

/** Int16 LE → metres. */
export function decodeInt16(buf: ArrayBuffer, n: number, scale: number, offset: number): Float32Array {
  if (buf.byteLength !== n * 2) throw new Error(`globe heights: ${buf.byteLength} bytes, want ${n * 2}`);
  const v = new DataView(buf);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = v.getInt16(i * 2, true) * scale + offset;
  return out;
}

/** Bilinear sample of the global map (row 0 = 90 N, column 0 = 180 W, pixel centres), metres. */
export function sampleGlobal(g: Grid, lonE: number, lat: number): number {
  const c = ((((lonE + 180) % 360) + 360) % 360) / 360 * g.w - 0.5;
  const r = Math.min(g.h - 1, Math.max(0, ((90 - lat) / 180) * g.h - 0.5));
  const c0 = Math.floor(c);
  const r0 = Math.min(g.h - 2, Math.floor(r));
  const fc = c - c0;
  const fr = r - r0;
  const ca = ((c0 % g.w) + g.w) % g.w;
  const cb = (ca + 1) % g.w;
  const a = g.v;
  return (
    a[r0 * g.w + ca] * (1 - fc) * (1 - fr) +
    a[r0 * g.w + cb] * fc * (1 - fr) +
    a[(r0 + 1) * g.w + ca] * (1 - fc) * fr +
    a[(r0 + 1) * g.w + cb] * fc * fr
  );
}

/** South polar stereographic (m): x = r sin(lonE), y = r cos(lonE), r = 2R tan(colat/2). */
export function polarXY(lonE: number, lat: number): [number, number] {
  const r = 2 * R_M * Math.tan(((90 + lat) * D) / 2);
  return [r * Math.sin(lonE * D), r * Math.cos(lonE * D)];
}

/** Bilinear sample of the polar patch (row 0 = +y, column 0 = −x, pixel centres), clamped at edges. */
export function samplePatch(g: Grid, extentM: number, x: number, y: number): number {
  const clamp = (v: number, hi: number) => Math.min(hi, Math.max(0, v));
  const c = clamp(((x + extentM) / (2 * extentM)) * g.w - 0.5, g.w - 1);
  const r = clamp(((extentM - y) / (2 * extentM)) * g.h - 0.5, g.h - 1);
  const c0 = Math.min(g.w - 2, Math.floor(c));
  const r0 = Math.min(g.h - 2, Math.floor(r));
  const fc = c - c0;
  const fr = r - r0;
  const a = g.v;
  return (
    a[r0 * g.w + c0] * (1 - fc) * (1 - fr) +
    a[r0 * g.w + c0 + 1] * fc * (1 - fr) +
    a[(r0 + 1) * g.w + c0] * (1 - fc) * fr +
    a[(r0 + 1) * g.w + c0 + 1] * fc * fr
  );
}

/** Patch weight: 0 at the patch edge (latEdge), 1 from `feather` degrees inside it. Smoothstep. */
export function patchWeight(lat: number, latEdge = -80, feather = 1): number {
  const t = Math.min(1, Math.max(0, (latEdge - lat) / feather));
  return t * t * (3 - 2 * t);
}

/** Polar-patch height: 80 m DEM blended into the global map near the edge (no step at the seam). */
export function patchHeight(global: Grid, patch: Grid, extentM: number, lonE: number, lat: number, latEdge = -80) {
  const w = patchWeight(lat, latEdge);
  const g = sampleGlobal(global, lonE, lat);
  if (w === 0) return g;
  const [x, y] = polarXY(lonE, lat);
  return g + w * (samplePatch(patch, extentM, x, y) - g);
}

/**
 * Tangent-space normal map (RGBA8) of the global heights at exaggeration k, rows bottom-up
 * (DataTexture row 0 = v 0 = south). Red = east slope, green = north slope (three.js convention).
 */
export function normalMap(g: Grid, k: number): Uint8Array {
  const { w, h, v } = g;
  const out = new Uint8Array(w * h * 4);
  const dx0 = (2 * Math.PI * R_M) / w; // east step at the equator, m
  const dy = (Math.PI * R_M) / h; // north step, m
  for (let r = 0; r < h; r++) {
    const lat = 90 - ((r + 0.5) / h) * 180;
    const dx = dx0 * Math.max(0.05, Math.cos(lat * D));
    const rn = Math.max(0, r - 1);
    const rs = Math.min(h - 1, r + 1);
    const dyr = dy * (rs - rn);
    const row = h - 1 - r;
    for (let c = 0; c < w; c++) {
      const ce = (c + 1) % w;
      const cw = (c - 1 + w) % w;
      const gx = (k * (v[r * w + ce] - v[r * w + cw])) / (2 * dx);
      const gy = (k * (v[rn * w + c] - v[rs * w + c])) / dyr;
      const len = Math.sqrt(gx * gx + gy * gy + 1);
      const o = (row * w + c) * 4;
      out[o] = Math.round((-gx / len) * 127.5 + 127.5);
      out[o + 1] = Math.round((-gy / len) * 127.5 + 127.5);
      out[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[o + 3] = 255;
    }
  }
  return out;
}

export type BodiesAt = {
  sun: [number, number]; // lonE, lat
  earth: [number, number];
  earthDistKm: number;
  utc: string; // the hour used
  clamped: boolean; // atUtc is outside the precomputed range
};

/** Nearest precomputed hour for atUtc; outside the range the nearest end, marked clamped. */
export function bodiesAt(s: Subpoints, atUtc: string): BodiesAt {
  const t0 = Date.parse(s.startUtc);
  const raw = Math.round((Date.parse(atUtc) - t0) / (s.stepMin * 60000));
  const i = Number.isFinite(raw) ? Math.min(s.n - 1, Math.max(0, raw)) : 0;
  return {
    sun: [s.sunLonE[i], s.sunLat[i]],
    earth: [s.earthLonE[i], s.earthLat[i]],
    earthDistKm: s.earthDistKm[i],
    utc: new Date(t0 + i * s.stepMin * 60000).toISOString().slice(0, 16),
    clamped: i !== raw,
  };
}

/** Great-circle angle between two lon/lat points, degrees. */
export function angularSepDeg(a: [number, number], b: [number, number]): number {
  const [ax, ay, az] = lonLatToVec(a[0], a[1]);
  const [bx, by, bz] = lonLatToVec(b[0], b[1]);
  return Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by + az * bz))) / D;
}

/**
 * Elevation (deg) of a body above the local horizon of a site on the R sphere, no terrain.
 * body = sub-body point (lonE, lat); distKm = centre-to-centre distance (Infinity: no parallax).
 */
export function elevationDeg(site: [number, number], body: [number, number], distKm = Infinity): number {
  const u = lonLatToVec(site[0], site[1]);
  const b = lonLatToVec(body[0], body[1]);
  if (!Number.isFinite(distKm)) return 90 - angularSepDeg(site, body);
  const v = b.map((x, k) => x * distKm - u[k] * R_KM);
  const up = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  return Math.asin(Math.max(-1, Math.min(1, up / Math.hypot(v[0], v[1], v[2])))) / D;
}

export type GridMesh = { positions: Float32Array; uvs: Float32Array; index: Uint32Array; nLon: number; nLat: number };

/**
 * Lat/lon grid mesh: one row per latitude in `lats` (north to south), nLon + 1 columns from 180 W
 * to 180 E (the last column repeats the first for the texture seam). Radius r(lonE, lat) in Moon
 * radii. UVs match the equirectangular colour map. The globe body and the polar cap share the
 * edge row (same lats value, same nLon), so their edge vertices are identical: no crack.
 */
export function latLonGrid(lats: number[], nLon: number, r: (lonE: number, lat: number) => number): GridMesh {
  const nLat = lats.length;
  const cols = nLon + 1;
  const positions = new Float32Array(nLat * cols * 3);
  const uvs = new Float32Array(nLat * cols * 2);
  const lons = Array.from({ length: cols }, (_, j) => -180 + (360 * j) / nLon);
  const cosLon = lons.map((l) => Math.cos(l * D));
  const sinLon = lons.map((l) => Math.sin(l * D));
  for (let i = 0; i < nLat; i++) {
    const lat = lats[i];
    const cl = Math.cos(lat * D);
    const sl = Math.sin(lat * D);
    for (let j = 0; j < cols; j++) {
      const k = i * cols + j;
      const rr = r(lons[j], lat);
      // = lonLatToVec(lons[j], lat) * rr, unrolled: ~200k vertices per build
      positions[k * 3] = cl * cosLon[j] * rr;
      positions[k * 3 + 1] = sl * rr;
      positions[k * 3 + 2] = -cl * sinLon[j] * rr;
      uvs[k * 2] = j / nLon;
      uvs[k * 2 + 1] = 0.5 + lat / 180;
    }
  }
  const index = new Uint32Array((nLat - 1) * nLon * 6);
  let o = 0;
  for (let i = 0; i < nLat - 1; i++) {
    for (let j = 0; j < nLon; j++) {
      const a = i * cols + j;
      const b = a + cols;
      // Counter-clockwise seen from outside (north row i, south row i + 1, east = j + 1).
      index.set([a, b, a + 1, a + 1, b, b + 1], o);
      o += 6;
    }
  }
  return { positions, uvs, index, nLon, nLat };
}

/** n + 1 latitudes from `from` to `to`, both ends included. */
export function latSteps(from: number, to: number, n: number): number[] {
  return Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
}
