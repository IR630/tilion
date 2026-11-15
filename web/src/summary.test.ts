import { describe, expect, it } from "vitest";
import type { Timeline } from "./contracts";
import { sphereTimeline, summarize, terrainCaption, terrainEffect, windowRuns } from "./summary";

const tl = (sun: number[], earth: number[], extra: Partial<Timeline> = {}): Timeline => ({
  siteId: "t", startUtc: "2027-01-01T00:00:00Z", stepMin: 60,
  sunAz: sun.map(() => 0), sunEl: sun.map(() => 0), sunVisible: sun,
  earthAz: sun.map(() => 0), earthEl: sun.map(() => 0), earthVisible: earth, ...extra,
});

describe("windowRuns", () => {
  it("counts a night that starts at index 0 and a gap that ends at the last index", () => {
    const t = tl([0, 0, 0, 1, 0, 1, 0, 0], [1, 0, 0, 1, 0, 0, 0, 1], { stepMin: 30 });
    expect(windowRuns(t).longestNightH.value).toBe(1.5); // 3 steps of 30 min at the start
    expect(windowRuns(tl([1, 1, 0, 1, 0, 0], [1, 0, 1, 0, 0, 0])).longestCommGapH.value).toBe(3); // run to the end
  });
  it("treats a partly lit Sun as not night and no night as 0 h", () => {
    expect(windowRuns(tl([0.2, 0.2], [1, 1])).longestNightH).toEqual({ value: 0, lo: 0, hi: 0 });
  });
  it("gives min–max over the visibility variants", () => {
    const t = tl([0, 0, 1, 0, 0, 0], [1, 0, 0, 1, 0, 1], {
      variantSunLit: [[0, 0, 0, 0, 0, 0], [1, 1, 1, 0, 0, 1]],
      variantEarthVisible: [[1, 1, 1, 1, 1, 1], [1, 0, 0, 0, 0, 1]],
    });
    expect(windowRuns(t)).toEqual({
      longestNightH: { value: 3, lo: 2, hi: 6 },
      longestCommGapH: { value: 2, lo: 0, hi: 4 },
    });
  });
  it("summarize takes the runs from the full window, the other columns from the slice", () => {
    const slice = tl([1, 1], [1, 1]);
    const full = tl([1, 0, 0, 0, 1], [1, 1, 1, 1, 1]);
    const m = summarize(slice, "2027-01-01T00:00:00Z", full);
    expect(m.longestNightH.value).toBe(3);
    expect(m.lightFraction.value).toBe(1);
  });
});

describe("bare sphere vs terrain", () => {
  // 4 steps. Sun elevation: -0.2 (limb still above 0°), -0.5, 3, 3. Earth elevation: 1, -1, 1, 1.
  const t = tl([0, 0, 1, 0], [1, 0, 0, 1], {
    sunEl: [-0.2, -0.5, 3, 3],
    earthEl: [1, -1, 1, 1],
    dsnVisible: [1, 0, 0, 1],
    variantSunLit: [[1, 1, 1, 1]],
  });
  it("builds the sphere series from elevations with a flat 0° horizon and drops the spread", () => {
    const s = sphereTimeline(t);
    expect(s.sunVisible).toEqual([1, 0, 1, 1]);
    expect(s.earthVisible).toEqual([1, 0, 1, 1]);
    expect(s.variantSunLit).toBeUndefined();
    expect(s.dsnVisible).toBeUndefined(); // terrain + DSN cannot recover sphere + DSN
    expect(summarize(s, "2027-01-01T00:00:00Z").lightFraction).toEqual({ value: 0.75, lo: 0.75, hi: 0.75 });
  });
  it("takes both shares from the two series, sphere → terrain", () => {
    const e = terrainEffect(t);
    expect(e.sun).toEqual({ sphere: 0.75, terrain: 0.25 });
    expect(e.earth).toEqual({ sphere: 0.75, terrain: 0.5 });
    expect(e.both).toEqual({ sphere: 0.75, terrain: 0 });
    expect(terrainCaption(e)).toContain("Sun share from 75 % to 25 %"); // #162: shares as integer %
    expect(terrainCaption(e)).toContain("Earth share from 75 % to 50 %");
  });
});
