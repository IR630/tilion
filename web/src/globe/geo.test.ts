import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  angularSepDeg,
  bodiesAt,
  decodeInt16,
  elevationDeg,
  type GlobeMeta,
  type Grid,
  latLonGrid,
  latSteps,
  lonLatToVec,
  normalMap,
  patchHeight,
  patchWeight,
  polarXY,
  R_M,
  sampleGlobal,
  samplePatch,
  type Subpoints,
  vecToLonLat,
} from "./geo";

const pub = (f: string) => resolve(__dirname, "../../public/data", f);
const json = <T,>(f: string) => JSON.parse(readFileSync(pub(f), "utf8")) as T;
const bin = (f: string) => {
  const b = readFileSync(pub(f));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const close = (a: number[], b: number[], d = 9) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], d));

const meta = json<GlobeMeta>("globe/meta.json");
const sub = json<Subpoints>("globe/subpoints.json");
const H = meta.height;
const P = meta.southPatch;
const global: Grid = { w: H.width, h: H.height, v: decodeInt16(bin(`globe/${H.file}`), H.width * H.height, H.scaleM, H.offsetM) };
const patch: Grid = { w: P.size, h: P.size, v: decodeInt16(bin(`globe/${P.file}`), P.size * P.size, P.scaleM, P.offsetM) };

describe("globe frame", () => {
  it("maps MOON_ME lon/lat to the scene: lon 0 → +x, lon 90 E → −z, north → +y", () => {
    close(lonLatToVec(0, 0), [1, 0, 0]);
    close(lonLatToVec(90, 0), [0, 0, -1]);
    close(lonLatToVec(180, 0), [-1, 0, 0]);
    close(lonLatToVec(123, 90), [0, 1, 0]);
    close(lonLatToVec(0, -90), [0, -1, 0]);
  });

  it("vecToLonLat inverts lonLatToVec, lon in 0..360", () => {
    for (const [lo, la] of [[0, 0], [45.5, -89.4], [222.83, -89.44], [359.9, 12], [181, 70]]) {
      close(vecToLonLat(...lonLatToVec(lo, la)), [lo, la], 9);
    }
  });

  it("grid UVs follow the equirectangular colour map: u = 0.5 + lonE/360, v = 0.5 + lat/180", () => {
    const g = latLonGrid([30, -30], 4, () => 1);
    // column 1 = 90 W, row 0 = 30 N
    expect(g.uvs[2]).toBeCloseTo(0.25, 9);
    expect(g.uvs[3]).toBeCloseTo(0.5 + 30 / 180, 6); // Float32
    close(Array.from(g.positions.slice(3, 6)), lonLatToVec(-90, 30), 6);
    expect(g.index.length).toBe(4 * 6);
  });
});

describe("globe heights", () => {
  it("decodes Int16 LE with scale and offset, rejects a wrong size", () => {
    const buf = new ArrayBuffer(6);
    const v = new DataView(buf);
    [-2, 0, 32767].forEach((q, k) => v.setInt16(k * 2, q, true));
    expect(Array.from(decodeInt16(buf, 3, 0.5, 10))).toEqual([9, 10, 10 + 32767 * 0.5]);
    expect(() => decodeInt16(buf, 4, 1, 0)).toThrow(/bytes/);
  });

  it("samples the global map at pixel centres and wraps across 180°", () => {
    const g: Grid = { w: 4, h: 2, v: Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]) };
    expect(sampleGlobal(g, -135, 45)).toBeCloseTo(1, 9); // column 0 centre, row 0 centre
    expect(sampleGlobal(g, 135, -45)).toBeCloseTo(8, 9);
    expect(sampleGlobal(g, 180, 45)).toBeCloseTo(2.5, 9); // between column 3 and column 0
    expect(sampleGlobal(g, -180, 45)).toBeCloseTo(sampleGlobal(g, 180, 45), 9);
  });

  it("polar stereographic: lat 80 S lies on the patch edge, lon 0 → +y, lon 90 E → +x", () => {
    const [x0, y0] = polarXY(0, -80);
    expect(x0).toBeCloseTo(0, 6);
    expect(Math.abs(y0 - P.extentM)).toBeLessThan(1000);
    const [x1, y1] = polarXY(90, -85);
    expect(x1).toBeGreaterThan(0);
    expect(y1).toBeCloseTo(0, 6);
    close(polarXY(0, -90), [0, 0], 6);
  });

  it("patch weight is 0 at the edge and 1 a degree inside", () => {
    expect(patchWeight(-80)).toBe(0);
    expect(patchWeight(-79)).toBe(0);
    expect(patchWeight(-81)).toBe(1);
    expect(patchWeight(-80.5)).toBeCloseTo(0.5, 9);
  });

  it("polar patch agrees with the global map in orientation (real data)", () => {
    // Same LOLA data at two resolutions: a flipped or rotated patch would differ by km.
    const d: number[] = [];
    for (let la = -81; la >= -88; la -= 0.5)
      for (let lo = 0; lo < 360; lo += 7.5) d.push(Math.abs(samplePatch(patch, P.extentM, ...polarXY(lo, la)) - sampleGlobal(global, lo, la)));
    d.sort((a, b) => a - b);
    expect(d[Math.floor(d.length / 2)]).toBeLessThan(300); // median, m
  });

  it("polar cap stitches with the globe body: shared edge vertices are identical", () => {
    const e = P.latEdgeDeg;
    const k = 3;
    const body = latLonGrid(latSteps(90, e, 24), 64, (lo, la) => 1 + (k * sampleGlobal(global, lo, la)) / R_M);
    const cap = latLonGrid(latSteps(e, -90, 10), 64, (lo, la) => 1 + (k * patchHeight(global, patch, P.extentM, lo, la, e)) / R_M);
    const n = 65 * 3;
    const lastBody = body.positions.slice(body.positions.length - n);
    const firstCap = cap.positions.slice(0, n);
    expect(Array.from(firstCap)).toEqual(Array.from(lastBody));
    expect(Array.from(cap.uvs.slice(0, 130))).toEqual(Array.from(body.uvs.slice(body.uvs.length - 130)));
  });

  it("normal map is flat on flat ground and tilts toward the downhill side", () => {
    const flat = normalMap({ w: 8, h: 4, v: new Float32Array(32) }, 1);
    expect(Array.from(flat.slice(0, 4))).toEqual([128, 128, 255, 255]);
    // Height rises to the east (column index): the normal leans west, red < 128.
    const v = new Float32Array(32).map((_, i) => (i % 8 < 4 ? (i % 8) * 1000 : 0));
    const nm = normalMap({ w: 8, h: 4, v }, 1);
    expect(nm[(1 * 8 + 2) * 4]).toBeLessThan(128);
  });
});

describe("sub-solar and sub-Earth points (subpoints.json, SPICE)", () => {
  const sites = json<{ sites: { id: string; lat: number | null; lonE: number | null }[] }>("sites.json").sites;

  it("picks the hour of the moment and clamps outside the range", () => {
    const a = bodiesAt(sub, "2027-01-15T00:20:00Z");
    expect(a.utc).toBe("2027-01-15T00:00");
    expect(a.clamped).toBe(false);
    const i = (Date.parse("2027-01-15T00:00:00Z") - Date.parse(sub.startUtc)) / 3600000;
    expect(a.sun).toEqual([sub.sunLonE[i], sub.sunLat[i]]);
    expect(bodiesAt(sub, "2020-01-01T00:00:00Z")).toMatchObject({ clamped: true, utc: "2026-12-01T00:00" });
    expect(bodiesAt(sub, "2030-01-01T00:00:00Z").clamped).toBe(true);
    expect(sub.n).toBe(sub.sunLat.length);
  });

  it("the globe light gives the SPICE Sun and Earth elevations of real sites within 0.1°", () => {
    // Independent SPICE output: per-site topocentric timelines (backend precompute, spkcpo).
    let worstSun = 0;
    let worstEarth = 0;
    let n = 0;
    for (const id of ["a_haworth", "cr1_connecting_ridge", "apollo11", "a_malapert_massif"]) {
      const s = sites.find((x) => x.id === id);
      const tl = json<{ startUtc: string; sunEl: number[]; earthEl: number[] }>(`timeline/${id}.json`);
      expect(tl.startUtc).toBe(sub.startUtc);
      for (let i = 0; i < tl.sunEl.length; i += 997) {
        const at = bodiesAt(sub, new Date(Date.parse(sub.startUtc) + i * 3600000).toISOString());
        const site: [number, number] = [s!.lonE!, s!.lat!];
        // The scene light direction, read back from the scene vector.
        const sunDir = vecToLonLat(...lonLatToVec(...at.sun));
        worstSun = Math.max(worstSun, Math.abs(elevationDeg(site, sunDir) - tl.sunEl[i]));
        worstEarth = Math.max(worstEarth, Math.abs(elevationDeg(site, at.earth, at.earthDistKm) - tl.earthEl[i]));
        n++;
      }
    }
    expect(n).toBeGreaterThan(30);
    expect(worstSun).toBeLessThan(0.1);
    expect(worstEarth).toBeLessThan(0.1);
  });

  it("angular separation and elevation agree: elevation = 90° − separation for the Sun", () => {
    expect(angularSepDeg([10, 0], [100, 0])).toBeCloseTo(90, 9);
    expect(elevationDeg([0, -90], [37, 0])).toBeCloseTo(0, 9);
    expect(elevationDeg([0, 0], [0, 0], 384400)).toBeCloseTo(90, 9);
    // Earth parallax: 90° from the sub-Earth point the Earth centre is asin(R/D) ≈ 0.26° below the horizon.
    expect(elevationDeg([90, 0], [0, 0], 384400)).toBeCloseTo(-(Math.asin(1737.4 / 384400) * 180) / Math.PI, 3);
  });
});
