import { describe, expect, it } from "vitest";
import type { Site } from "../contracts";
import type { DayStat } from "../route/route";
import {
  addDays,
  dayKind,
  history,
  KIND_COLOR,
  monthTicks,
  msOf,
  overlaps,
  publicMissions,
  pxPerDay,
  RANGE_DAYS,
  RANGE_END_MS,
  RANGE_START_MS,
  relativeLabel,
  slipDays,
  slipLabel,
  snapSlip,
  stripRuns,
  totalWidth,
  utcAtX,
  weekTicks,
  xOf,
} from "./layout";

const day = (sunH: number, earthH: number, bothH: number, hours = 24): DayStat => ({ dayUtc: "", hours, sunH, earthH, bothH });
const site = (id: string, status: string, p: Partial<Site> = {}): Site => ({
  id, name: id, group: "clps", status, kind: "point", lat: -85, lonE: 10, elevM: null,
  source: "", confidence: "high", terrain: "polar80", note: "", ...p,
});

describe("time ↔ x", () => {
  it("maps the data range to the full width and back", () => {
    expect(RANGE_DAYS).toBe(396);
    expect(xOf(RANGE_START_MS, 7)).toBe(0);
    expect(xOf(RANGE_END_MS, 7)).toBe(totalWidth(7));
    expect(xOf(Date.parse("2026-12-02T00:00:00Z"), 7)).toBe(7);
    expect(msOf(xOf(Date.parse("2027-05-05T12:00:00Z"), 30), 30)).toBe(Date.parse("2027-05-05T12:00:00Z"));
  });
  it("zoom: weeks is wider than months; whole range fits the viewport", () => {
    expect(pxPerDay("weeks", 800)).toBeGreaterThan(pxPerDay("months", 800));
    expect(totalWidth(pxPerDay("range", 1188))).toBeCloseTo(1188, 6);
    expect(pxPerDay("range", 100)).toBe(1); // never thinner than a pixel per day
  });
  it("a scrub position snaps to the whole hour and stays inside the data", () => {
    expect(utcAtX(7 * 10 + 7 / 24 * 5.4, 7)).toBe("2026-12-11T05:00:00Z");
    expect(utcAtX(-50, 7)).toBe("2026-12-01T00:00:00Z");
    expect(utcAtX(1e9, 7)).toBe("2027-12-31T23:00:00Z");
  });
});

describe("ticks", () => {
  it("one month header per month, the year on the first and on January", () => {
    const m = monthTicks();
    expect(m).toHaveLength(13);
    expect(m[0].label).toBe("Dec 2026");
    expect(m[1].label).toBe("Jan 2027");
    expect(m[2].label).toBe("Feb");
    expect(new Date(m[12].ms).toISOString()).toBe("2027-12-01T00:00:00.000Z");
  });
  it("week ticks fall on Mondays", () => {
    const w = weekTicks();
    expect(new Date(w[0].ms).toISOString()).toBe("2026-12-07T00:00:00.000Z");
    expect(w.every((t) => new Date(t.ms).getUTCDay() === 1)).toBe(true);
    expect(w[1].ms - w[0].ms).toBe(7 * 86_400_000);
  });
});

describe("day strip colours", () => {
  it("picks the dominant kind of a day", () => {
    expect(dayKind(day(24, 24, 24))).toBe("both");
    expect(dayKind(day(20, 4, 4))).toBe("sun");
    expect(dayKind(day(2, 20, 2))).toBe("earth");
    expect(dayKind(day(3, 3, 0))).toBe("none");
    expect(dayKind(day(0, 0, 0, 0))).toBe("none");
  });
  it("uses the Calendar palette", () => {
    expect(KIND_COLOR).toEqual({ both: "var(--fg)", sun: "var(--sun)", earth: "var(--earth)", none: "var(--ground)" });
  });
  it("merges equal neighbours into runs", () => {
    const runs = stripRuns([day(24, 24, 24), day(24, 24, 24), day(24, 0, 0), day(0, 0, 0), day(0, 0, 0, 0)]);
    expect(runs).toEqual([
      { from: 0, days: 2, kind: "both" },
      { from: 2, days: 1, kind: "sun" },
      { from: 3, days: 2, kind: "none" },
    ]);
  });
});

describe("slip drag", () => {
  it("snaps to whole days", () => {
    expect(snapSlip(0, 20, 7, -14, 30)).toBe(3);
    expect(snapSlip(0, 24, 7, -14, 30)).toBe(3);
    expect(snapSlip(0, 25, 7, -14, 30)).toBe(4);
    expect(snapSlip(2, -3, 7, -14, 30)).toBe(2);
    expect(snapSlip(2, -4, 7, -14, 30)).toBe(1);
  });
  it("clamps to the allowed slip window", () => {
    expect(snapSlip(0, 1000, 7, -14, 30)).toBe(30);
    expect(snapSlip(0, -1000, 7, -14, 30)).toBe(-14);
  });
  it("counts and labels the slip", () => {
    const base = "2027-03-01T12:00:00Z";
    expect(slipDays(base, addDays(base, 3))).toBe(3);
    expect(addDays(base, -2)).toBe("2027-02-27T12:00:00Z");
    expect(slipLabel(3)).toBe("+3 d");
    expect(slipLabel(-2)).toBe("−2 d");
    expect(slipLabel(0)).toBe("on plan");
  });
});

describe("overlaps", () => {
  it("finds overlapping windows and their common span", () => {
    const o = overlaps([
      { id: "a", landingUtc: "2027-01-01T00:00:00Z", durationDays: 14 },
      { id: "b", landingUtc: "2027-01-10T00:00:00Z", durationDays: 14 },
      { id: "c", landingUtc: "2027-01-15T00:00:00Z", durationDays: 3 },
    ]);
    expect(o.map((x) => `${x.a}${x.b}`)).toEqual(["ab", "bc"]);
    expect(new Date(o[0].fromMs).toISOString()).toBe("2027-01-10T00:00:00.000Z");
    expect(new Date(o[0].toMs).toISOString()).toBe("2027-01-15T00:00:00.000Z");
  });
  it("windows that only touch do not overlap", () => {
    expect(
      overlaps([
        { id: "a", landingUtc: "2027-01-01T00:00:00Z", durationDays: 14 },
        { id: "b", landingUtc: "2027-01-15T00:00:00Z", durationDays: 14 },
      ]),
    ).toEqual([]);
  });
});

describe("relative label", () => {
  const at = "2027-01-15T00:00:00Z";
  it("future, on surface, past", () => {
    expect(relativeLabel("2027-03-17T00:00:00Z", 14, at)).toBe("in 61 d");
    expect(relativeLabel("2027-01-15T05:00:00Z", 14, at)).toBe("in 5 h");
    expect(relativeLabel("2027-01-12T00:00:00Z", 14, at)).toBe("on surface, day 4 of 14");
    expect(relativeLabel("2027-01-12T00:00:00Z", 1, at)).toBe("landed 3 d ago");
  });
});

describe("public missions", () => {
  it("only planned sites in the data range, as year-long bands; history is a count", () => {
    const sites = [
      site("viper", "planned 2027"),
      site("ce7", "planned 2027"),
      site("far", "planned 2030"),
      site("im1", "landed 2024-02-22"),
      site("ap11", "landed 1969-07-20T20:17:40Z"),
      site("c2", "crashed 2019-09-06"),
      site("ridge", "reference"),
    ];
    const p = publicMissions(sites);
    expect(p.map((x) => x.site.id)).toEqual(["viper", "ce7"]);
    expect(new Date(p[0].fromMs).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(new Date(p[0].toMs).toISOString()).toBe("2028-01-01T00:00:00.000Z");
    expect(history(sites)).toEqual({ count: 3, from: 1969, to: 2024 });
  });
});
