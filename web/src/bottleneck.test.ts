import { describe, expect, it } from "vitest";
import type { Timeline } from "./contracts";
import { bottleneck, bottleneckMetrics } from "./bottleneck";

describe("bottleneck", () => {
  it("suggests assessing relay geometry when Earth is never visible, even without Sun", () => {
    expect(bottleneck({ sunPct: 0, earthPct: 0, longestNightH: 0 })).toContain("Earth centre hidden throughout; assess relay geometry");
  });

  it("reports no sunlight when Sun is never visible", () => {
    expect(bottleneck({ sunPct: 0, earthPct: 50, longestNightH: 0 })).toContain("no sunlight in this period");
  });

  it("reports both conditions hold at 95 percent", () => {
    expect(bottleneck({ sunPct: 95, earthPct: 95, longestNightH: 0 })).toContain("both geometric conditions hold");
  });

  it("names power as the bottleneck at a 15 point difference", () => {
    expect(bottleneck({ sunPct: 51, earthPct: 66, longestNightH: 0 })).toContain("sunlight is the tighter geometric constraint");
  });

  it("names comms as the bottleneck when Earth is weaker", () => {
    expect(bottleneck({ sunPct: 80, earthPct: 60, longestNightH: 0 })).toContain("Earth visibility is the tighter geometric constraint");
  });

  it("uses raw percentages for thresholds and rounds only the display", () => {
    expect(bottleneck({ sunPct: 80.4, earthPct: 94.6, longestNightH: 0 })).toBe("Sun 80 %, Earth 95 %: both partial.");
  });

  it("names the period of the shares when given (#196)", () => {
    expect(bottleneck({ sunPct: 80.4, earthPct: 94.6, longestNightH: 0 }, "next 30 d")).toBe("Sun 80 %, Earth 95 % of next 30 d: both partial.");
  });

  it("adds the longest night at 48 hours but not below", () => {
    expect(bottleneck({ sunPct: 50, earthPct: 50, longestNightH: 48 })).toContain("Longest night 2.0 d.");
    expect(bottleneck({ sunPct: 50, earthPct: 50, longestNightH: 47.9 })).not.toContain("Longest night");
    expect(bottleneck({ sunPct: 50, earthPct: 50, longestNightH: 76.8 })).toContain("Longest night 3.2 d.");
  });
});

it("computes shares and longest night for a timeline window", () => {
  const timeline: Timeline = {
    siteId: "test", startUtc: "2026-01-01T00:00:00Z", stepMin: 60,
    sunVisible: [0, 0, 1, 1, 0, 0, 0], earthVisible: [1, 0, 1, 1, 1, 1, 1],
    sunAz: [], sunEl: [], earthAz: [], earthEl: [],
  };
  const metrics = bottleneckMetrics(timeline);
  expect(metrics.sunPct).toBeCloseTo(200 / 7);
  expect(metrics.earthPct).toBeCloseTo(600 / 7);
  expect(metrics.longestNightH).toBe(3);
});
