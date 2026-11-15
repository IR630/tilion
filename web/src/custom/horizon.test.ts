// @vitest-environment node
// Acceptance #31, #100: the browser computation of a custom point against the Python precompute on
// the same DEM tiles (tests/fixtures/custom_reference.json, backend `python -m precompute.custom`).
// The browser decodes only the tiles tilesFor picks; Python decodes all of them.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { Site } from "../contracts";
import { customSite } from "../screens/PolarMap";
import { type CustomMeta, decodeDem, decodeEphem, tilesFor } from "./assets";
import {
  computeCustom,
  DEM_HALF_M,
  DEM_MIN_LAT,
  DEM_STEP_M,
  type Dem,
  type Ephem,
  eclipsedFraction,
  horizonMask,
  roundFlux,
  sunVisibleFraction,
  UNIFORM,
} from "./horizon";

type Ref = {
  id: string;
  lat: number;
  lonE: number;
  terrain: Site["terrain"];
  h0: number;
  elevDeg: number[];
  sunLitFlips: number[];
  earthFlips: number[];
  sunVisibleMean: number;
  sampleEvery: number;
  sunAz: number[];
  sunEl: number[];
  earthAz: number[];
  earthEl: number[];
};

const file = (p: string) => readFileSync(new URL(p, import.meta.url));
const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
const meta = JSON.parse(file("../../public/data/custom/meta.json").toString()) as CustomMeta;
const refs = (JSON.parse(file("../../../tests/fixtures/custom_reference.json").toString()) as { sites: Ref[] }).sites;
let ephem: Ephem;
const tileFile = (f: string) => buf(file(`../../public/data/custom/${f}`));
/** The DEM a worker builds for a point; tiles it does not fetch read 16 km high, so a ray on them shows. */
async function pointDem(lat: number, lonE: number): Promise<{ dem: Dem; mb: number; n: number }> {
  const t = tilesFor(meta, lat, lonE);
  const parts = t.map((x) => tileFile(x.file));
  const mb = parts.reduce((a, b) => a + b.byteLength, 0) / 1e6;
  return { dem: await decodeDem(parts, t, meta, 32767), mb, n: t.length };
}

beforeAll(() => {
  ephem = decodeEphem(buf(file(`../../public/data/custom/${meta.ephemFile}`)), meta);
});

/** Indexes where a 0/1 series flips, from off (as precompute.variants.flips). */
function flips(on: number[]): number[] {
  const out: number[] = [];
  let s = 0;
  on.forEach((v, i) => (v > 0 ? 1 : 0) !== s && (out.push(i), (s ^= 1)));
  return out;
}
const offs = (f: number[]) => f.filter((_, k) => k % 2 === 1); // on -> off: sunset, earthset
const share = (f: number[], n: number) => {
  let on = 0;
  for (let k = 0; k < f.length; k += 2) on += (f[k + 1] ?? n) - f[k];
  return on / n;
};
/** Largest distance (steps) from an event in one list to the nearest event in the other, both ways. */
function eventGap(a: number[], b: number[]): number {
  const near = (x: number, l: number[]) => Math.min(...l.map((y) => Math.abs(x - y)));
  if (!a.length || !b.length) return a.length || b.length ? Infinity : 0;
  return Math.max(...a.map((x) => near(x, b)), ...b.map((x) => near(x, a)));
}
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("sun flux rounding", () => {
  it("keeps a thin crescent lit and a dark Sun dark (D-010)", () => {
    expect(roundFlux(0.003)).toBe(0.01);
    expect(roundFlux(1e-9)).toBe(0.01);
    expect(roundFlux(0)).toBe(0);
    expect(roundFlux(0.014)).toBe(0.01);
    expect(roundFlux(0.5)).toBe(0.5);
  });
});

describe("Earth eclipse of the Sun (geo.eclipsed_fraction)", () => {
  it("hides all when the Earth disc covers the Sun, none when apart", () => {
    expect(eclipsedFraction(0.1, 0.26, 0.95)).toBeCloseTo(1, 9);
    expect(eclipsedFraction(1.3, 0.26, 0.95)).toBe(0);
  });
  it("gives the lens area of two equal flat discs one radius apart", () => {
    expect(eclipsedFraction(1, 1, 1, 64, UNIFORM)).toBeCloseTo((2 * Math.PI) / 3 / Math.PI - Math.sqrt(3) / 2 / Math.PI, 4);
  });
});

it("combines Earth and a horizon that varies across the Sun", () => {
  const mask = Array.from({ length: 720 }, (_, i) => i === 20 ? 0 : i === 21 ? 0.3 : i === 19 ? -0.3 : 0);
  const actual = sunVisibleFraction(10, 0, 0.01, mask, 0.5, 10, -1, 1);
  let total = 0;
  let visible = 0;
  for (let i = 0; i < 1000; i++) for (let j = 0; j < 1000; j++) {
    const x = (i + 0.5) / 500 - 1;
    const y = (j + 0.5) / 500 - 1;
    const r2 = x * x + y * y;
    if (r2 >= 1) continue;
    const mu = Math.sqrt(1 - r2);
    const weight = 0.3 + 0.93 * mu - 0.23 * mu * mu;
    total += weight;
    if (y > 0.6 * x && x * x + (y + 100) ** 2 > 100 ** 2) visible += weight;
  }
  expect(actual).toBeCloseTo(visible / total, 2);
});

describe("computeCustom applies the Earth eclipse (D-010)", () => {
  // Bare-sphere site at 0°N 0°E: up = +x, north = +z. The Sun sits at el 30°, az 0 in both steps.
  // Step 0: the Earth is in front of the Sun (same direction). Step 1: the Earth is 30° higher.
  const dirAt = (elDeg: number, km: number) => [Math.sin(elDeg * (Math.PI / 180)) * km, 0, Math.cos(elDeg * (Math.PI / 180)) * km];
  const ephem2: Ephem = {
    startUtc: "2027-02-20T00:00:00Z",
    stepMin: 60,
    n: 2,
    v: Float32Array.from([...dirAt(30, 1.496e8), ...dirAt(30, 384400), ...dirAt(30, 1.496e8), ...dirAt(60, 384400)]),
    sunRadiusKm: 695700,
    earthRadiusKm: 6378.137,
  };
  it("shows a dark Sun in eclipse and a lit Sun when the bodies are apart", () => {
    const { timeline } = computeCustom({ ...customSite(0, 0), id: "eclipse-probe" }, null, ephem2);
    expect(timeline.sunEl[0]).toBeCloseTo(30, 0);
    expect(timeline.sunVisible[0]).toBe(0);
    expect(timeline.sunVisible[1]).toBeGreaterThan(0.99);
  });
  it("does not count the same terrain and Earth shadow twice", () => {
    const observerKm = (1737400 + 2) / 1000;
    const earthDistance = 384400;
    const ephemOverlap: Ephem = {
      startUtc: "2027-02-20T00:00:00Z",
      stepMin: 60,
      n: 1,
      v: Float32Array.from([
        observerKm, 0, 149600000,
        observerKm - Math.sin(Math.PI / 180) * earthDistance, 0, Math.cos(Math.PI / 180) * earthDistance,
      ]),
      sunRadiusKm: 149600000 * Math.sin(0.01 * Math.PI / 180),
      earthRadiusKm: earthDistance * Math.sin(Math.PI / 180) / 1.01,
    };
    const { timeline } = computeCustom({ ...customSite(0, 0), id: "overlap-probe" }, null, ephemOverlap);
    expect(timeline.sunVisible[0]).toBeCloseTo(0.5, 2);
  });
});

describe("custom point assets", () => {
  it("cover the DEM square the UI assumes and the timeline grid", () => {
    expect(meta.dem.dx).toBe(DEM_STEP_M);
    expect(meta.dem.x0).toBe(-DEM_HALF_M);
    expect(meta.dem.y0).toBe(DEM_HALF_M);
    expect(meta.dem.width * meta.dem.dx).toBe(2 * DEM_HALF_M);
    expect(meta.dem.tiles * meta.dem.tilePx).toBe(meta.dem.width);
    expect(meta.dem.minLat).toBe(DEM_MIN_LAT);
    expect(meta.startUtc).toBe("2026-12-01T00:00:00Z");
    expect(meta.stepMin).toBe(60);
  });
});

describe("custom point tiles", () => {
  it("fetch a ~300 km circle: the pole, 70°S and the 60°S edge", () => {
    const n = (lat: number, lonE: number) => tilesFor(meta, lat, lonE).length;
    // 2 × 302 km rays over 93 km tiles: about 7 × 7 tiles less the corners of the circle.
    for (const [lat, lonE] of [[-90, 0], [-70, 120], [-60.1, 45], [-60.1, 0]]) {
      expect(n(lat, lonE)).toBeGreaterThan(20);
      expect(n(lat, lonE)).toBeLessThan(60);
    }
    // At the pole the circle is centred: the 4 tiles around it and none at the square corners.
    const pole = tilesFor(meta, -90, 0).map((t) => t.file);
    expect(pole).toEqual(expect.arrayContaining(["dem240/9-9.bin", "dem240/9-10.bin", "dem240/10-9.bin", "dem240/10-10.bin"]));
    expect(pole).not.toContain("dem240/0-0.bin");
  });
});

describe.each(refs.map((r) => [r.id, r] as const))("custom point at %s vs Python", (_, ref) => {
  const site = { ...customSite(ref.lat, ref.lonE), id: ref.id };
  let out: ReturnType<typeof computeCustom>;
  let dem: Dem;
  beforeAll(async () => {
    if (ref.terrain !== "none") {
      const p = await pointDem(ref.lat, ref.lonE);
      dem = p.dem;
      console.info(`${ref.id}: ${p.n} tiles, ${p.mb.toFixed(2)} MB fetched`);
    }
    out = computeCustom(site, ref.terrain !== "none" ? dem : null, ephem);
  });

  it("takes the same terrain (DEM 240 m or bare sphere)", () => {
    expect(site.terrain).toBe(ref.terrain);
    expect(out.mask.terrain).toBe(ref.terrain);
    expect(out.timeline.stub).toBeUndefined();
  });

  it("mask: max |Δ| ≤ 0.05°", () => {
    const m = ref.terrain === "none" ? { elev: new Float64Array(720), h0: 0 } : horizonMask(dem, ref.lonE, ref.lat);
    const d = Math.max(...ref.elevDeg.map((v, i) => Math.abs(m.elev[i] - v)));
    console.info(`${ref.id}: mask max |Δ| ${d.toExponential(1)}°, h0 ${m.h0.toFixed(1)} m`);
    expect(m.elev.length).toBe(720);
    expect(d).toBeLessThanOrEqual(0.05);
    expect(m.h0).toBeCloseTo(ref.h0, 2);
  });

  it("marks rays that leave the DEM (#330): none near the pole, some at 62°S", () => {
    if (ref.terrain === "none") return expect(out.complete).toBeNull();
    const bad = (out.complete ?? []).filter((c) => !c).length;
    console.info(`${ref.id}: ${bad} of 720 rays incomplete`);
    if (ref.id === "edge_62s") expect(bad).toBeGreaterThan(0);
    if (ref.lat <= -80) expect(bad).toBe(0);
  });

  it("Sun and Earth az/el: max |Δ| ≤ 0.01° (float32 vectors vs SPICE per observer)", () => {
    const tl = out.timeline;
    let d = 0;
    ref.sunEl.forEach((_, k) => {
      const i = k * ref.sampleEvery;
      d = Math.max(d, Math.abs(tl.sunEl[i] - ref.sunEl[k]), Math.abs(tl.earthEl[i] - ref.earthEl[k]));
      d = Math.max(d, angDiff(tl.sunAz[i], ref.sunAz[k]), angDiff(tl.earthAz[i], ref.earthAz[k]));
    });
    console.info(`${ref.id}: Sun/Earth az/el max |Δ| ${d.toFixed(4)}° (${ref.sunEl.length} samples)`);
    expect(d).toBeLessThanOrEqual(0.01);
  });

  it("sunsets and earthsets ≤ 1 h, lit share ≤ 0.5 pp", () => {
    const tl = out.timeline;
    const n = tl.sunVisible.length;
    const sun = flips(tl.sunVisible);
    const earth = flips(tl.earthVisible);
    const h = tl.stepMin / 60;
    const sunsetH = eventGap(offs(sun), offs(ref.sunLitFlips)) * h;
    const earthsetH = eventGap(offs(earth), offs(ref.earthFlips)) * h;
    const litPp = Math.abs(share(sun, n) - share(ref.sunLitFlips, n)) * 100;
    const meanPp = Math.abs(tl.sunVisible.reduce((a, b) => a + b, 0) / n - ref.sunVisibleMean) * 100;
    console.info(
      `${ref.id}: sunsets ${offs(sun).length}/${offs(ref.sunLitFlips).length} max ${sunsetH} h, ` +
        `earthsets ${offs(earth).length}/${offs(ref.earthFlips).length} max ${earthsetH} h, ` +
        `lit share Δ ${litPp.toFixed(3)} pp, mean disc Δ ${meanPp.toFixed(3)} pp`,
    );
    expect(n).toBe(meta.n);
    expect(sunsetH).toBeLessThanOrEqual(1);
    expect(earthsetH).toBeLessThanOrEqual(1);
    expect(litPp).toBeLessThanOrEqual(0.5);
    expect(meanPp).toBeLessThanOrEqual(0.5);
  });
});
