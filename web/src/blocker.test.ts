import { expect, it } from "vitest";
import type { HorizonMask, Timeline } from "./contracts";
import { blockerSectors, blockerSentence } from "./blocker";

const mask = (step = 0.5): HorizonMask => ({
  siteId: "test", terrain: "polar80", observerHeightM: 2,
  azStepDeg: step, elevDeg: Array(360 / step).fill(1),
});
const timeline = (az: number[], el = az.map(() => 0), visible = az.map(() => 0)): Timeline => ({
  siteId: "test", startUtc: "2026-12-01T00:00:00Z", stepMin: 30,
  sunAz: az, sunEl: el, sunVisible: visible, earthAz: [], earthEl: [], earthVisible: [],
});

it("counts only sphere-visible limbs hidden completely by terrain, in mask bins", () => {
  const tl = timeline([10.1, 10.4, 10.3, 10.2, 10.2], [-0.264, -0.265, -1, 1, 0], [0, 0, 0, 0.01, 0]);
  expect(blockerSectors(tl, mask())).toMatchObject([{ startAzDeg: 10, endAzDeg: 10.5, lostHours: 1 }]);
  expect(blockerSectors(tl, { ...mask(), terrain: "none" })).toEqual([]);
  expect(blockerSectors({ ...tl, stub: true }, mask())).toEqual([]);
});

it("merges empty gaps up to 2 degrees, including the 360 degree seam", () => {
  const m = mask();
  m.elevDeg[0] = 3;
  const sectors = blockerSectors(timeline([357.5, 358, 0.5, 3.5, 4]), m);
  expect(sectors).toMatchObject([
    { startAzDeg: 357.5, endAzDeg: 1, maxElevationDeg: 3, peakAzDeg: 0, lostHours: 1.5 },
    { startAzDeg: 3.5, endAzDeg: 4.5, lostHours: 1 },
  ]);
  expect(blockerSectors(timeline(Array.from({ length: 720 }, (_, i) => i / 2)), m))
    .toMatchObject([{ startAzDeg: 0, endAzDeg: 360, lostHours: 360 }]);
});

it("sorts sectors by lost hours and divides by all terrain losses", () => {
  const sectors = blockerSectors(timeline([20, 80, 80, 80]), mask(1));
  expect(sectors.map((s) => [s.startAzDeg, s.lostHours, s.share])).toEqual([[80, 1.5, 0.75], [20, 0.5, 0.25]]);
  expect(blockerSectors(timeline([], [], []), mask())).toEqual([]);
});

it("uses the horizon peak for distance and height, and omits unavailable distances", () => {
  const m = mask(1);
  m.elevDeg[133] = 4;
  const s = blockerSectors(timeline([132, 134]), m)[0];
  const data = { siteId: "test", azStepDeg: 1, distM: Array(360).fill(4200), riseM: Array(360).fill(310) };
  expect(blockerSentence(s, "next 30 d", data)).toBe(
    "Main blocker: ridge at 132–135° az, peak 4.0° elevation, 4.2 km away, 310 m above the site — costs 1 h of sunlight (100 % of terrain losses), next 30 d.",
  );
  expect(blockerSentence(s, "next 30 d", null)).toBe(
    "Main blocker: ridge at 132–135° az, peak 4.0° elevation — costs 1 h of sunlight (100 % of terrain losses), next 30 d.",
  );
});

it("calls a horizon point closer than 300 m a local slope and gives metres", () => {
  const s = blockerSectors(timeline([132]), mask(1))[0];
  const data = { siteId: "test", azStepDeg: 1, distM: Array(360).fill(120), riseM: Array(360).fill(6) };
  expect(blockerSentence(s, "next 30 d", data)).toContain("Main blocker: local slope at 132–133° az, peak 1.0° elevation, 120 m away, 6 m above the site");
});
