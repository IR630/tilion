import { describe, expect, it } from "vitest";
import { DATA_PERIOD, fmtDuration, fmtDurationPair, fmtDurationRange, fmtElevation, fmtHours, fmtLatLon, fmtPercent, fmtShare, fmtUntil, keepUnits, lowSunNote, polarXY, sharePeriod } from "./format";
import { DATA_END_UTC, DATA_START_UTC } from "./api";
import { mockSummary, mockTimeline } from "./mock";
import type { Site } from "./contracts";

const ridge: Site = {
  id: "cr1",
  name: "ridge",
  group: "ridge",
  status: "",
  kind: "point",
  lat: -89.4398,
  lonE: 222.83,
  elevM: null,
  source: "",
  confidence: "high",
  terrain: "polar80",
  note: "",
};

describe("format", () => {
  it("shows the spread of every time", () => {
    expect(fmtHours({ value: 12.34, lo: 11, hi: 13.1 })).toBe("12.3 h (11.0–13.1)");
    expect(fmtHours(null)).toBe("not visible");
    expect(fmtPercent({ value: 0.884, lo: 0.85, hi: 0.9 })).toBe("88 % (85–90)");
  });
  it("uses 0–360°E longitude", () => {
    expect(fmtLatLon(-89.475, -137.44)).toBe("89.4750°S 222.5600°E");
    expect(fmtLatLon(null, null)).toBe("region only");
  });
  it("places lon 0 towards +y and lon 90 towards +x on the polar map", () => {
    const [x0, y0] = polarXY(-80, 0);
    const [x90, y90] = polarXY(-80, 90);
    expect([x0, y0].map((v) => +v.toFixed(6))).toEqual([0, 10]);
    expect([x90, y90].map((v) => +v.toFixed(6))).toEqual([10, 0]);
  });
});

describe("mock data", () => {
  it("is marked as stub so the UI can say so", () => {
    expect(mockTimeline(ridge, "2027-01-01T00:00:00Z").stub).toBe(true);
    expect(mockSummary(ridge, "2027-01-01T00:00:00Z").stub).toBe(true);
  });
  it("keeps array lengths equal", () => {
    const t = mockTimeline(ridge, "2027-01-01T00:00:00Z", 2, 60);
    expect(new Set([t.sunAz, t.sunEl, t.sunVisible, t.earthAz, t.earthEl, t.earthVisible].map((a) => a.length))).toEqual(
      new Set([48]),
    );
  });
});

describe("one precision (#162)", () => {
  it("Sun elevation to 0.1° with a true minus", () => {
    expect([fmtElevation(0.33), fmtElevation(0.39), fmtElevation(-0.26), fmtElevation(-0.04)]).toEqual(["0.3°", "0.4°", "−0.3°", "0.0°"]);
  });
  it("durations: whole hours under 48 h, days with one decimal from 48 h", () => {
    expect([fmtDuration(19), fmtDuration(47), fmtDuration(48), fmtDuration(110), fmtDuration(1469)]).toEqual(["19 h", "47 h", "2.0 d", "4.6 d", "61.2 d"]);
    expect(fmtUntil(8436, true)).toBe("> 351.5 d");
  });
  it("spread in one unit when it can, null when both ends read the same", () => {
    expect(fmtDurationRange(76, 1393)).toBe("3.2–58.0 d");
    expect(fmtDurationRange(19, 1469)).toBe("19 h – 61.2 d");
    expect(fmtDurationRange(19, 8436, true)).toBe("19 h – > 351.5 d");
    expect(fmtDurationRange(321, 322)).toBeNull();
    expect(fmtDurationRange(9336, 9336, true)).toBeNull();
    expect(fmtShare(0.555)).toBe("56 %");
  });
  it("the period label matches the data range", () => {
    expect(DATA_PERIOD).toBe("Dec 2026 – Dec 2027");
    expect(DATA_START_UTC.slice(0, 7)).toBe("2026-12");
    expect(DATA_END_UTC).toBe("2028-01-01T00:00:00Z"); // last step 2028-01-01 00:00: December 2027 is the last whole month
  });
});

describe("one unit per pair (#436)", () => {
  it("days when either side is ≥ 48 h, else hours as fmtDuration", () => {
    expect(fmtDurationPair(213.6, 46)).toEqual(["8.9 d", "1.9 d"]);
    expect(fmtDurationPair(47, 48)).toEqual(["2.0 d", "2.0 d"]);
    expect(fmtDurationPair(46, 9.5)).toEqual(["46 h", "9.5 h"]);
    expect(fmtDurationPair(110, 1469)).toEqual([fmtDuration(110), fmtDuration(1469)]);
  });
});

describe("low Sun note (#196)", () => {
  it("explains a low Sun with a far sunset, and only then", () => {
    expect(lowSunNote(0.3, 61.2 * 24)).toBe("Sun circles low along the horizon; stays above terrain for 61.2 d");
    expect(lowSunNote(-0.2, 100, true)).toBe("Sun circles low along the horizon; stays above terrain for > 4.2 d");
    expect(lowSunNote(2.5, 1000)).toBeNull(); // not low
    expect(lowSunNote(0.3, 30)).toBeNull(); // sets soon: no contradiction
    expect(lowSunNote(0.3, null)).toBeNull(); // not lit
    expect(lowSunNote(null, 100)).toBeNull();
  });
});

// #399 A line break between a number and its unit reads as "2 / m"; a hyphen is not a minus.
describe("keepUnits", () => {
  it("joins a number to its unit and writes a true minus", () => {
    expect(keepUnits("Shackleton–de Gerlache ridge (C1, 2 m)")).toBe("Shackleton–de Gerlache ridge (C1, 2\u00a0m)");
    expect(keepUnits("-192 °C")).toBe("\u2212192\u00a0°C");
    expect(keepUnits("-1.0 pp")).toBe("\u22121.0\u00a0pp");
    expect(keepUnits("57 %")).toBe("57\u00a0%");
  });
  it("leaves words, ranges and dates alone", () => {
    expect(keepUnits("Haworth 2 mountains")).toBe("Haworth 2 mountains");
    expect(keepUnits("Dec 2026 – Dec 2027")).toBe("Dec 2026 – Dec 2027");
    expect(keepUnits("2027-01-15")).toBe("2027-01-15");
  });
});

describe("share period at the data end (#424)", () => {
  it("says how many days of data a share counts when the data ends before 30 d", () => {
    expect(sharePeriod("2027-01-15T00:00:00Z")).toBe("30 d");
    expect(sharePeriod("2027-12-20T00:00:00Z")).toBe("12 d of data");
    expect(sharePeriod("2027-12-31T18:00:00Z", 30, "\u00a0")).toBe("6\u00a0h of data");
    expect(sharePeriod("2027-12-01T00:00:00Z", 45)).toBe("31 d of data");
  });
});
