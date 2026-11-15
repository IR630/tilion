import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { stereoInv } from "../../format";
import { decodeField, type ShadowField, sunVector } from "../../navigator/shadows";
import { cellFlux, cool, coolTable, LIT_FLUX, LOOKBACK_H, MAX_DARK_H, paintColor, paintThermal, snapBack, T0_ROWS, tableBuildMs, temps, teq, thermalField } from "./mapThermal";
import { ALBEDO, EMISSIVITY, SOLAR, regolithTemps } from "./thermal";

const SIGMA = 5.670374419e-8;

describe("mapThermal", () => {
  it("gives the radiative equilibrium of a known flux", () => {
    expect(teq(EMISSIVITY * SIGMA * 250 ** 4)).toBeCloseTo(250, 6);
    expect(teq(0)).toBe(0);
    // A flat open cell under the Sun at 30°: S (1 - A) / 2.
    const bins = 180;
    const f: ShadowField = { size: 1, cellM: 2000, extentM: 1000, bins, offsetDeg: -8, stepDeg: 0.1, horizon: new Uint8Array(bins).fill(0) };
    const [lat, lonE] = stereoInv(0, 0);
    expect(cellFlux(f, sunVector(lat, lonE, 90, 30))[0]).toBeCloseTo((SOLAR * (1 - ALBEDO)) / 2, 1);
  });

  it("builds the cooling table once, fast enough for the first switch-on", () => {
    coolTable();
    console.log(`cooling table: ${tableBuildMs.toFixed(0)} ms`);
    expect(tableBuildMs).toBeLessThan(15000); // ~0.25 s alone; the bound only catches a runaway build under load (#340)
    expect(cool(T0_ROWS[0], 0)).toBeCloseTo(T0_ROWS[0], 0); // starts in equilibrium
  });

  it("cools monotonically with hours in shadow and stays warmer for warmer ground", () => {
    for (const T0 of [100, 150, 230, 260]) {
      let last = Infinity;
      for (const h of [0, 0.5, 1, 3, 10, 50, 200, 720]) {
        const t = cool(T0, h);
        expect(t).toBeLessThanOrEqual(last + 1e-6);
        last = t;
      }
    }
    for (const h of [1, 24, 720]) expect(cool(250, h)).toBeGreaterThan(cool(150, h));
  });

  it("matches a direct regolithTemps run within a few K (T0 = 170 K, 30 h of darkness)", () => {
    const T0 = 170;
    const el = (Math.asin((EMISSIVITY * SIGMA * T0 ** 4) / (SOLAR * (1 - ALBEDO))) * 180) / Math.PI;
    const sunEl = Array.from({ length: 709 + 31 }, (_, i) => (i < 709 ? el : -10));
    const direct = regolithTemps({ sunEl, sunVisible: sunEl.map((e) => (e > 0 ? 1 : 0)), stepMin: 60 })[709 + 30];
    expect(Math.abs(cool(T0, 30) - direct)).toBeLessThan(3);
    expect(cool(T0, 30)).toBeLessThan(T0 - 20); // it really cools
  });

  it("picks the right lookback bracket on a synthetic lit/dark sequence", () => {
    const hours = [1, 2, 4, 8];
    const lit = LIT_FLUX * 10;
    // Cell 0 lit now; cell 1 dark now, lit 4 h ago; cell 2 never lit; cell 3 lit 1 h ago.
    const now = Float32Array.from([lit, 0, 0, 0]);
    const back = [Float32Array.from([0, 0, 0, lit]), Float32Array.from([0, 0, 0, 0]), Float32Array.from([0, lit, 0, 0]), Float32Array.from([0, 0, 0, 0])];
    const asked: number[] = [];
    const T = temps(now, hours, (j) => (asked.push(j), back[j]));
    expect(T[0]).toBeCloseTo(teq(lit), 3);
    expect(T[1]).toBeCloseTo(cool(teq(lit), 3), 3); // shadow began between 2 h and 4 h ago
    expect(T[3]).toBeCloseTo(cool(teq(lit), 0.5), 3);
    expect(T[2]).toBeCloseTo(cool(T0_ROWS[0], MAX_DARK_H), 3);
    expect(asked).toEqual([0, 1, 2, 3]); // cell 2 keeps the lookback going
    asked.length = 0;
    temps(Float32Array.from([0]), hours, (j) => (asked.push(j), Float32Array.from([lit])));
    expect(asked).toEqual([0]); // stops once every cell is resolved
  });

  it("snaps long lookbacks to a grid that stays within the stride and is shared by neighbouring steps", () => {
    for (const k of [1000, 1001, 1013]) {
      let last = 0;
      for (const h of LOOKBACK_H) {
        const s = snapBack(k, h);
        expect(s).toBeGreaterThanOrEqual(h);
        expect(s).toBeLessThan(h * 1.25 + 1);
        expect(s).toBeGreaterThan(last);
        last = s;
      }
    }
    const at = (k: number) => new Set(LOOKBACK_H.map((h) => k - snapBack(k, h)));
    const a = at(1000), b = at(1001);
    expect([...b].filter((j) => a.has(j)).length).toBeGreaterThanOrEqual(10);
  });

  it("paints the expected pixel for a known temperature", () => {
    let put: ImageData | null = null;
    const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData: (img: ImageData) => (put = img) };
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    const f = { size: 3 } as ShadowField;
    paintThermal(canvas, f, new Float32Array(9).fill(40), 1);
    expect(canvas.width).toBe(3);
    const d = (put as unknown as ImageData).data;
    expect(Array.from(d.slice(16, 20))).toEqual([0x1b, 0x0c, 0x41, 180]); // centre cell, coldest stop, full alpha
    expect(paintColor(250)).toEqual([0xfc, 0xff, 0xa4]);
  });
});

const dir = "public/data";
describe.skipIf(!existsSync(`${dir}/shadow/field_pole.bin.gz`))("thermal layer on the real field", () => {
  it("repaints within the time budget and gives a plausible range", () => {
    const m = JSON.parse(readFileSync(`${dir}/shadow/field_pole.json`, "utf8"));
    const f = decodeField(m, new Uint8Array(gunzipSync(readFileSync(`${dir}/shadow/field_pole.bin.gz`))));
    coolTable();
    // Sun near the pole: low, circling once per lunation (~0.5°/h in azimuth).
    const [lat, lonE] = stereoInv(0, 0);
    const sun = (h: number) => sunVector(lat, lonE, (100 - h * 0.508 + 3600) % 360, 1.2);
    const field = (k: number) => thermalField(f, sun(-k), LOOKBACK_H.map((h) => snapBack(k, h)).map((h) => ({ h, sun: sun(h - k) })));
    let t = performance.now();
    const T = field(5000);
    const ms = performance.now() - t;
    t = performance.now();
    field(5001);
    const next = performance.now() - t;
    let lo = Infinity, hi = -Infinity;
    for (const v of T) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    console.log(`thermal repaint: first ${ms.toFixed(0)} ms, next step ${next.toFixed(0)} ms, ${lo.toFixed(0)}..${hi.toFixed(0)} K`);
    expect(lo).toBeGreaterThan(30);
    expect(hi).toBeLessThan(260);
    expect(hi - lo).toBeGreaterThan(50);
  });
});
