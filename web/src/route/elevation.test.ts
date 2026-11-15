// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeDem, type CustomMeta } from "../custom/assets";
import type { Dem } from "../custom/horizon";
import { fmtDuration } from "../format";
import { planTraverse, ROVER_M_PER_H } from "../mission/traverse";
import { decodeHours, encodeCodes } from "./hours";
import {
  distanceAtTime,
  drivePath,
  driveTiles,
  heightAt,
  profileStats,
  sampleProfile,
  steepRuns,
  ticks,
  timeAtDistance,
  visibilityAt,
  type ProfileSample,
} from "./elevation";

const CR1 = { name: "CR-1", lat: -89.4398, lonE: 222.83 };

async function realDem(path: ReturnType<typeof drivePath>): Promise<{ meta: CustomMeta; dem: Dem }> {
  const meta = JSON.parse(readFileSync(new URL("../../public/data/custom/meta.json", import.meta.url), "utf8")) as CustomMeta;
  const tiles = driveTiles(meta, path);
  const parts = tiles.map(({ file }) => {
    const b = readFileSync(new URL(`../../public/data/custom/${file}`, import.meta.url));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });
  return { meta, dem: await decodeDem(parts, tiles, meta, -32768) };
}

describe("drive elevation profile: DEM sampling", () => {
  it("matches the LOLA 240 m source cells at a known point within one cell", async () => {
    const path = drivePath([CR1, { name: "WP1", lat: -89.42, lonE: 222.83 }]);
    const { dem } = await realDem(path);
    const s = sampleProfile(dem, path);
    const h0 = s[0].heightM as number;
    // The source cell under CR-1 and its 8 neighbours bound the bilinear value.
    const c = Math.round((path[0].x - dem.x0) / dem.dx - 0.5);
    const r = Math.round((path[0].y - dem.y0) / dem.dy - 0.5);
    const cells: number[] = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) cells.push(dem.q[(r + dr) * dem.width + c + dc] * dem.scaleM);
    expect(h0).toBeGreaterThanOrEqual(Math.min(...cells));
    expect(h0).toBeLessThanOrEqual(Math.max(...cells));
    // Independent reference of the approach profile test (NASA LOLA, CR-1).
    expect(h0).toBeCloseTo(1952.382, 0);
    expect(s.every((p) => p.heightM !== null)).toBe(true);
  });

  it("joins legs start → waypoints without repeating the turn point", () => {
    const a = { name: "A", lat: -89, lonE: 0 };
    const b = { name: "B", lat: -89.1, lonE: 0 };
    const c = { name: "C", lat: -89.1, lonE: 10 };
    const p = drivePath([a, b, c]);
    const one = drivePath([a, b]);
    const two = drivePath([b, c]);
    expect(p.length).toBe(one.length + two.length - 1);
    expect(p.at(-1)!.dM).toBeCloseTo(one.at(-1)!.dM + two.at(-1)!.dM, 6);
    expect(p.at(-1)!.leg).toBe(1);
    for (let i = 1; i < p.length; i++) expect(p[i].dM).toBeGreaterThan(p[i - 1].dM);
    expect(() => drivePath([a])).toThrow();
    expect(() => drivePath([a, { name: "far", lat: -75, lonE: 0 }])).toThrow(/300 km/);
  });

  it("marks terrain outside the DEM as a gap, not as zero height", () => {
    const empty: Dem = { q: new Int16Array(), width: 0, height: 0, x0: 0, y0: 0, dx: 1, dy: -1, scaleM: 1 };
    const s = sampleProfile(empty, drivePath([CR1, { name: "WP", lat: -89.43, lonE: 222.83 }]));
    expect(s.every((p) => p.heightM === null && Number.isNaN(p.slopeDeg))).toBe(true);
    expect(profileStats(s).known).toBe(0);
  });
});

describe("drive elevation profile: slope", () => {
  // A ramp DEM in stereographic metres: height = 0.1 × y (10 % grade towards +y).
  const ramp: Dem = (() => {
    const w = 200, dx = 100;
    const q = new Int16Array(w * w);
    const x0 = -10000, y0 = 10000;
    for (let r = 0; r < w; r++) for (let c = 0; c < w; c++) q[r * w + c] = Math.round((0.1 * (y0 - (r + 0.5) * dx)) / 0.5);
    return { q, width: w, height: w, x0, y0, dx, dy: -dx, scaleM: 0.5 };
  })();

  it("gives atan(rise / run) along the track", () => {
    // Along lonE = 0 the stereographic y grows away from the pole: the track climbs the ramp head-on.
    const path = drivePath([{ name: "S", lat: -89.9, lonE: 0 }, { name: "E", lat: -89.8, lonE: 0 }]);
    const s = sampleProfile(ramp, path);
    const mid = s.slice(2, -2);
    const want = (Math.atan(0.1) * 180) / Math.PI; // 5.71°
    // Stereographic scale at 89.8–89.9° S differs from 1 by < 1e-5.
    mid.forEach((p) => expect(p.slopeDeg).toBeCloseTo(want, 1));
    expect(s.at(-1)!.heightM! - s[0].heightM!).toBeGreaterThan(0);
    const st = profileStats(s);
    expect(st.climbM).toBeCloseTo(s.at(-1)!.heightM! - s[0].heightM!, 6);
    expect(st.descentM).toBe(0);
    expect(st.maxSlopeDeg).toBeCloseTo(want, 1);
  });

  it("finds runs steeper than the limit", () => {
    const mk = (slopes: number[]): ProfileSample[] =>
      slopes.map((slopeDeg, i) => ({ dM: i * 100, x: 0, y: 0, lat: -89, leg: 0, heightM: 0, slopeDeg }));
    expect(steepRuns(mk([5, 16, 18, 10, 20, NaN, 30]), 15)).toEqual([
      [100, 200],
      [400, 400],
      [600, 600],
    ]);
    expect(steepRuns(mk([5, 6]), 15)).toEqual([]);
    expect(heightAt(mk([1, 1, 1]), 150)).toBe(0);
  });
});

describe("drive elevation profile: timeline", () => {
  it("maps time to distance at a constant speed and clamps at both ends", () => {
    const t0 = Date.parse("2027-01-15T00:00:00Z");
    expect(timeAtDistance(t0, 1000, 500) - t0).toBe(2 * 3_600_000);
    expect(distanceAtTime(t0, t0 + 3_600_000, 500, 10_000)).toBe(500);
    expect(distanceAtTime(t0, t0 - 1, 500, 10_000)).toBe(0);
    expect(distanceAtTime(t0, t0 + 1e9, 500, 10_000)).toBe(10_000);
  });

  // #195: the profile said "16.6 d" and the traverse "3979 h" for one 143 km drive (0.36 km/h
  // against 36 m/h). Both read one rover speed and one duration format.
  it("gives the same drive time as the traverse, in the shared duration format", () => {
    const tr = planTraverse(
      [
        { name: "site", lat: -89.44, lonE: 222.8 },
        { name: "WP1", lat: -88.0, lonE: 120.0 },
      ],
      [null, null],
      0,
    );
    expect(tr.km).toBeGreaterThan(50);
    const profileH = timeAtDistance(0, tr.km * 1000) / 3_600_000;
    expect(fmtDuration(profileH)).toBe(fmtDuration(tr.hours));
    expect(ROVER_M_PER_H).toBe(36); // 1 cm/s VIPER planning mean with stops
  });

  it("reads Sun and Earth of the site from the hourly codes", () => {
    const hours = decodeHours({ startUtc: "2027-01-15T00:00:00Z", stepMin: 60, n: 3, sites: { s: encodeCodes([1, 0, 1], [0, 1, 1]) } });
    const t0 = Date.parse("2027-01-15T00:00:00Z");
    expect(visibilityAt(hours, "s", t0 + 30 * 60_000)).toEqual({ sun: true, earth: false });
    expect(visibilityAt(hours, "s", t0 + 3_600_000)).toEqual({ sun: false, earth: true });
    expect(visibilityAt(hours, "s", t0 + 3 * 3_600_000)).toBeNull();
    expect(visibilityAt(hours, "other", t0)).toBeNull();
  });

  it("picks round axis ticks", () => {
    expect(ticks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks(1903, 2011, 4)).toEqual([1950, 2000]);
    expect(ticks(1903, 2011, 8)).toEqual([1920, 1940, 1960, 1980, 2000]);
  });
});
