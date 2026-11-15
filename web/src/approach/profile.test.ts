// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeDem, type CustomMeta } from "../custom/assets";
import type { Dem } from "../custom/horizon";
import { approachProfile, profilePath, profileTiles, safeSample } from "./profile";

const flat: Dem = { q: new Int16Array(16).fill(20), width: 4, height: 4, x0: -200000, y0: 200000, dx: 100000, dy: -100000, scaleM: 0.5 };
const start = { lat: -89, lon: 0 }, end = { lat: -89.1, lon: 0 };

describe("approach terrain profile", () => {
  it("samples flat terrain and computes an optional height and clearance in metres", () => {
    const p = approachProfile(flat, start, end, [100, 80]);
    expect(p[0].distanceM).toBe(0);
    expect(p.at(-1)!.distanceM).toBeCloseTo(3032.350, 0);
    p.forEach((x) => expect(x.heightM).toBeCloseTo(10, 8));
    expect(p[0].clearanceM).toBeCloseTo(90, 8);
    expect(p.at(-1)!.clearanceM).toBeCloseTo(70, 8);
  });
  it("uses the direction of the line and reports gaps instead of clamping or filling them", () => {
    const stepped = { ...flat, q: new Int16Array([0, 0, 0, 0, 0, 0, 100, 100, 0, 0, 100, 100, 0, 0, 0, 0]) };
    expect(safeSample(stepped, -50000, 50000)).toBe(0);
    expect(safeSample(stepped, 50000, 50000)).toBe(50);
    const missing = { ...flat, q: new Int16Array(flat.q) }; missing.q[5] = -32768;
    expect(safeSample(missing, -50000, 50000)).toBeNull();
    expect(safeSample(flat, 999999, 0)).toBeNull();
    const reverse = approachProfile(flat, end, start, [80, 100]);
    expect(reverse[0].trajectoryM).toBe(80);
    expect(reverse.at(-1)!.trajectoryM).toBe(100);
    expect(approachProfile(flat, { lat: -70, lon: 0 }, { lat: -70.1, lon: 0 }).every((x) => x.heightM === null)).toBe(true);
    const crossing = approachProfile(flat, start, { lat: -84, lon: 0 }, [500, 400]);
    expect(crossing.some((x) => x.heightM !== null)).toBe(true);
    expect(crossing.some((x) => x.heightM === null && x.clearanceM === null)).toBe(true);
  });
  it("follows eastward and northward paths in the south-polar projection", () => {
    const graded = { ...flat, q: new Int16Array(Array.from({ length: 16 }, (_, i) => (i % 4) * 100 + Math.floor(i / 4) * 10)) };
    const east = approachProfile(graded, { lat: -89, lon: 0 }, { lat: -89, lon: 90 });
    expect(east.at(-1)!.heightM!).toBeGreaterThan(east[0].heightM!);
    const north = approachProfile(graded, { lat: -89, lon: 0 }, { lat: -88.5, lon: 0 });
    expect(north.at(-1)!.heightM!).toBeLessThan(north[0].heightM!);
  });
  it("rejects invalid coordinates and degenerate paths", () => {
    expect(() => approachProfile(flat, start, start)).toThrow();
    expect(() => approachProfile(flat, { lat: NaN, lon: 0 }, end)).toThrow();
    expect(() => approachProfile(flat, { lat: -90, lon: 360 }, end)).toThrow();
  });
  it("loads only the required tiles and rejects terrain north of 60 S", () => {
    const meta = JSON.parse(readFileSync(new URL("../../public/data/custom/meta.json", import.meta.url), "utf8")) as CustomMeta;
    const near = profileTiles(meta, profilePath({ lat: -89.4398, lon: 222.83 }, { lat: -89.44, lon: 222.83 }));
    expect(near.length).toBeGreaterThan(0);
    expect(near.length).toBeLessThan(meta.dem.tiles * meta.dem.tiles);
    expect(profileTiles(meta, profilePath({ lat: -59, lon: 0 }, { lat: -59.1, lon: 0 }))).toHaveLength(0);
  });
  it("matches the independently generated NASA LOLA reference at CR-1", async () => {
    const meta = JSON.parse(readFileSync(new URL("../../public/data/custom/meta.json", import.meta.url), "utf8")) as CustomMeta;
    const tiles = profileTiles(meta, profilePath({ lat: -89.4398, lon: 222.83 }, { lat: -89.44, lon: 222.83 }));
    const parts = tiles.map(({ file }) => { const b = readFileSync(new URL(`../../public/data/custom/${file}`, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; });
    const dem = await decodeDem(parts, tiles, meta, -32768);
    const p = approachProfile(dem, { lat: -89.4398, lon: 222.83 }, { lat: -89.44, lon: 222.83 });
    expect(p[0].heightM).toBeCloseTo(1952.382, 0);
  });
});
