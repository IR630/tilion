import { describe, expect, it } from "vitest";
import { buildLut, FLUX_K4, LUT_NH, lutAt, RAMP_STOPS, rampColor, sunElDeg, terrainT } from "./globeThermal";

const t0 = performance.now();
const lut = buildLut(0);
const buildMs = performance.now() - t0;
const row = (lat: number) => Array.from({ length: LUT_NH }, (_, j) => lutAt(lut, lat, -180 + 5 * j));

describe("globe thermal LUT", () => {
  it("builds fast enough to run on the first switch-on", () => {
    console.log(`globe thermal LUT: 37 x 72 in ${buildMs.toFixed(0)} ms`);
    expect(buildMs).toBeLessThan(15000); // ~1 s alone; a loaded machine running parallel checks took > 3 s (#340)
  });

  it("anchor: equatorial noon 380-400 K and pre-dawn 90-110 K (Diviner, Vasavada 2012)", () => {
    const eq = row(0);
    const noon = lutAt(lut, 0, 0);
    const dawn = Math.min(...eq);
    console.log(`globe thermal LUT: equator noon ${noon.toFixed(1)} K, pre-dawn ${dawn.toFixed(1)} K, pole ${lutAt(lut, -90, 0).toFixed(1)} K`);
    expect(noon).toBeGreaterThan(380);
    expect(noon).toBeLessThan(400);
    expect(dawn).toBeGreaterThan(90);
    expect(dawn).toBeLessThan(110);
    expect(lutAt(lut, 0, -90)).toBeLessThan(lutAt(lut, 0, 90)); // dawn colder than dusk: the ground stores heat
  });

  it("keeps the poles cold and the floor at the row minimum", () => {
    expect(Math.max(...row(-90))).toBeLessThan(120);
    expect(Math.max(...row(90))).toBeLessThan(120);
    expect(Math.max(...row(-85))).toBeLessThan(lutAt(lut, 0, 0) - 150);
    expect(lut.floor[18]).toBeCloseTo(Math.min(...row(0)), 3);
  });

  it("puts the Sun at the zenith at the subsolar point and on the horizon at the terminator", () => {
    expect(sunElDeg(0, 0, 0)).toBeCloseTo(90, 6);
    expect(sunElDeg(-1.5, -1.5, 0)).toBeCloseTo(90, 3); // asin near 1 loses digits
    expect(sunElDeg(0, 0, 90)).toBeCloseTo(0, 6);
    expect(sunElDeg(-90, -1.5, 37)).toBeCloseTo(1.5, 6);
  });
});

describe("terrain correction", () => {
  it("equals the LUT on level ground", () => {
    expect(terrainT(300, 0.5, 0.5, 95)).toBeCloseTo(300, 6);
    expect(terrainT(100, -0.3, -0.3, 95)).toBeCloseTo(100, 6);
  });

  it("is hotter on a Sun-facing slope and colder on the far one, never below the floor", () => {
    expect(terrainT(200, 0.1, 0.4, 95)).toBeGreaterThan(200);
    expect(terrainT(200, 0.1, 0.0, 95)).toBeLessThan(200);
    expect(terrainT(150, 0.03, -0.5, 60)).toBeGreaterThanOrEqual(60);
    // A slope facing a grazing Sun nears radiative equilibrium at its own incidence.
    const eq = (0.37 * FLUX_K4) ** 0.25;
    expect(Math.abs(terrainT(150, 0.035, 0.37, 60) - eq)).toBeLessThan(5);
  });
});

describe("thermal ramp", () => {
  const lum = ([r, g, b]: [number, number, number]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  it("grows in lightness from cold to hot", () => {
    for (let T = 40; T < 400; T += 5) expect(lum(rampColor(T + 5))).toBeGreaterThan(lum(rampColor(T)));
  });
  it("hits the end stops and clamps outside 40-400 K", () => {
    expect(rampColor(40)).toEqual(rampColor(0));
    expect(rampColor(400)).toEqual(rampColor(1000));
    expect(rampColor(400)).toEqual([0xfc, 0xff, 0xa4]);
    expect(RAMP_STOPS.length).toBeGreaterThanOrEqual(5);
  });
});

// Regime of the selected site (legend of the thermal mode).
import { readFileSync as readFs } from "node:fs";
import { siteRegime } from "./ThermalLegend";
import type { Timeline as Tl } from "../../contracts";

describe("siteRegime", () => {
  const tl = JSON.parse(readFs("public/data/timeline/a_haworth.json", "utf8")) as Tl;
  it("gives now, mean and dated extremes from the site timeline", () => {
    const r = siteRegime(tl, "2027-01-15T00:00:00Z")!;
    expect(r.min).toBeLessThan(r.mean);
    expect(r.mean).toBeLessThan(r.max);
    expect(r.now).toBeGreaterThanOrEqual(r.min);
    expect(r.now).toBeLessThanOrEqual(r.max);
    expect(r.minDay).toMatch(/^\d{4}-\d\d-\d\d$/);
    expect(r.from).toBe(tl.startUtc.slice(0, 10));
  });
  it("says nothing on mock data and no 'now' outside the data window", () => {
    expect(siteRegime({ ...tl, stub: true } as Tl, "2027-01-15T00:00:00Z")).toBeNull();
    expect(siteRegime(null, "2027-01-15T00:00:00Z")).toBeNull();
    expect(siteRegime(tl, "2035-01-01T00:00:00Z")!.now).toBeNull();
  });
});
