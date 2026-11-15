import { describe, expect, it } from "vitest";
import { decodeHours, decodeSite } from "../route/hours";
import { pinsFor } from "./HudStrip";
import {
  atTimeOfDay,
  clampCentre,
  clampSpan,
  clampUtc,
  DAY,
  dragSlip,
  edgePin,
  parseExact,
  placeLabels,
  eventsIn,
  fmtHud,
  fmtOffset,
  fmtSlip,
  fmtWait,
  HOUR,
  HUD_MAX_SPAN,
  HUD_MIN_SPAN,
  hudTicks,
  landingFor,
  LUNAR_DAY_H,
  monthGrid,
  nextChange,
  playTick,
  shares,
  slipBounds,
  slipOf,
  spanShares,
  SPEEDS,
  stepUtc,
  T0,
  windowQuality,
} from "./time";

describe("shared moment helpers", () => {
  it("steps by hours and days", () => {
    expect(stepUtc("2027-01-15T00:00:00Z", 1)).toBe("2027-01-15T01:00:00Z");
    expect(stepUtc("2027-01-15T00:00:00Z", -24)).toBe("2027-01-14T00:00:00Z");
  });
  it("clamps to the data range", () => {
    expect(stepUtc("2026-12-01T00:00:00Z", -1)).toBe("2026-12-01T00:00:00Z");
    expect(stepUtc("2027-12-31T23:00:00Z", 24)).toBe("2027-12-31T23:00:00Z");
    expect(clampUtc(Date.parse("2027-03-01T10:40:00Z"))).toBe("2027-03-01T11:00:00Z");
  });
});

describe("Play rate", () => {
  it("every speed moves by whole hours at exactly its rate", () => {
    for (const [speed] of SPEEDS) {
      const { hours, ms } = playTick(speed);
      expect(Number.isInteger(hours) && hours >= 1).toBe(true);
      expect((hours / ms) * 1000).toBeCloseTo(speed, 9);
      expect(stepUtc("2027-01-15T00:00:00Z", hours)).not.toBe("2027-01-15T00:00:00Z");
    }
  });
});

describe("HUD scale", () => {
  const at = Date.parse("2027-03-10T00:00:00Z");
  it("hour mode: minor every hour, 06/12/18 medium, day labels major", () => {
    const ticks = hudTicks(at - 2 * HOUR, at + DAY, HOUR / 30);
    expect(ticks.filter((k) => k.level === 0).length).toBeGreaterThan(10);
    expect(ticks.filter((k) => k.level === 1).map((k) => k.label)).toEqual(["06", "12", "18"]);
    expect(ticks.find((k) => k.t === at)).toEqual({ t: at, level: 2, label: "MAR 10" });
  });
  it("day mode: day numbers, month names at month starts", () => {
    const a = Date.parse("2027-02-20T00:00:00Z");
    const ticks = hudTicks(a, a + 20 * DAY, DAY / 30);
    expect(ticks.every((k) => k.t % DAY === 0)).toBe(true);
    expect(ticks.find((k) => k.label === "MAR")?.level).toBe(2);
    expect(ticks.find((k) => k.label === "21")?.level).toBe(1);
    const jan = hudTicks(Date.parse("2026-12-30T00:00:00Z"), Date.parse("2027-01-03T00:00:00Z"), DAY / 50);
    expect(jan.find((k) => k.level === 2)?.label).toBe("JAN 2027");
    expect(jan.some((k) => k.level === 0 && k.t % DAY !== 0)).toBe(true); // 6-h minors when a day is wide
  });
  it("zoom and centre stay in bounds; the readout reads like a HUD", () => {
    expect(clampSpan(1)).toBe(HUD_MIN_SPAN);
    expect(clampSpan(1e12)).toBe(HUD_MAX_SPAN);
    expect(clampCentre(0)).toBe(T0);
    expect(fmtHud(Date.parse("2027-01-15T06:00:00Z"))).toBe("JAN 15 2027 06:00 UTC");
    expect(hudTicks(-Infinity, 0, HOUR)).toEqual([]); // a bad range must not loop forever
    expect(hudTicks(0, NaN, HOUR)).toEqual([]);
  });
});

describe("pins", () => {
  // none, Sun, both, Earth, none: sunrise at 1, earthrise at 2, sunset at 3, earthset at 4
  const codes = Uint8Array.from([0, 1, 3, 2, 0]);
  it("finds rise and set events from the hourly codes", () => {
    expect(eventsIn(codes, 0, 4)).toEqual([
      { i: 1, kind: "sunrise" },
      { i: 2, kind: "earthrise" },
      { i: 3, kind: "sunset" },
      { i: 4, kind: "earthset" },
    ]);
    expect(eventsIn(codes, 2, 3)).toEqual([{ i: 3, kind: "sunset" }]);
  });
  it("next change of the Sun or Earth bit, null beyond the data", () => {
    expect(nextChange(codes, 1, 1)).toBe(3);
    expect(nextChange(codes, 0, 2)).toBe(2);
    expect(nextChange(Uint8Array.from([1, 1, 1]), 0, 1)).toBeNull();
    expect([fmtWait(224), fmtWait(300), fmtWait(5, true)]).toEqual(["9.3 d", "12.5 d", "> 5 h"]);
    expect([fmtOffset(12 * HOUR), fmtOffset(-76 * HOUR), fmtOffset(48 * HOUR)]).toEqual(["+12 h", "−3 d 4 h", "+2 d"]);
  });
  it("pins of the plan: events, landing and window end; off-span pins pick the landing first", () => {
    const hours = decodeHours({ startUtc: "2026-12-01T00:00:00Z", stepMin: 60, n: 5, sites: { a: "01320" } });
    const landing = T0 + HOUR;
    const win = { landing, original: landing, durationDays: 14, bounds: [-14, 30] as [number, number], slip: 0 };
    const pins = pinsFor(hours, hours.sites.get("a"), T0, T0 + 5 * HOUR, win, landing);
    expect(pins.map((q) => q.kind)).toEqual(["sunrise", "landing", "earthrise", "sunset", "earthset", "end"]);
    const p = [
      { t: 1, kind: "sunset" as const },
      { t: 5, kind: "landing" as const },
      { t: 100, kind: "earthrise" as const },
      { t: 120, kind: "end" as const },
    ];
    expect(edgePin(p, 10, 50, -1)?.kind).toBe("landing");
    expect(edgePin(p, 10, 50, 1)?.kind).toBe("end");
    expect(edgePin(p.slice(0, 1), 10, 50, 1)).toBeNull();
  });
});

describe("date picker", () => {
  it("rates a window by its Sun + Earth share", () => {
    expect(windowQuality({ windowH: 100, sunH: 80, earthH: 60, bothH: 55 })).toEqual({ kind: "both", bothShare: 0.55 });
    expect(windowQuality({ windowH: 100, sunH: 90, earthH: 20, bothH: 10 }).kind).toBe("sun");
    expect(windowQuality({ windowH: 100, sunH: 20, earthH: 70, bothH: 10 }).kind).toBe("earth");
    expect(windowQuality({ windowH: 100, sunH: 30, earthH: 30, bothH: 10 }).kind).toBe("poor");
  });
  it("month grid starts on Monday", () => {
    const g = monthGrid(2027, 2); // March 2027 starts on a Monday
    expect(g[0]).toBe(Date.UTC(2027, 2, 1));
    expect(g).toHaveLength(31);
    const f = monthGrid(2027, 1); // February 2027 starts on a Monday too; April on a Thursday
    expect(f).toHaveLength(28);
    expect(monthGrid(2027, 3).slice(0, 4)).toEqual([null, null, null, Date.UTC(2027, 3, 1)]);
  });
});

describe("colours", () => {
  it("splits hours into both, Sun only, Earth only and none", () => {
    expect(shares(18, 10, 6, 24)).toEqual({ both: 0.25, sun: 0.5, earth: 1 / 6, none: 1 - 0.25 - 0.5 - 1 / 6 });
    expect(shares(0, 0, 0, 0)).toEqual({ both: 0, sun: 0, earth: 0, none: 0 });
  });
  it("aggregates a span of hourly codes from prefix sums", () => {
    const s = decodeSite("0123" + "3333", 8); // none, Sun, Earth, both, then 4 × both
    expect(spanShares(s, 0, 4)).toEqual({ both: 0.25, sun: 0.25, earth: 0.25, none: 0.25 });
    expect(spanShares(s, 4, 8).both).toBe(1);
    expect(spanShares(s, -5, 100).both).toBe(5 / 8); // clipped to the data
  });
});

describe("mission window drag", () => {
  const orig = "2027-03-10T06:00:00Z";
  it("snaps to whole days and clamps to the slip window", () => {
    const b: [number, number] = [-14, 30];
    expect(dragSlip(0, 99, HOUR, b)).toBe(4); // 99 h → 4.1 d → 4
    expect(dragSlip(0, 11, HOUR, b)).toBe(0); // under half a day
    expect(dragSlip(3, -2000, HOUR, b)).toBe(-14);
    expect(dragSlip(0, 5000, HOUR, b)).toBe(30);
  });
  it("cuts the slip window so the whole surface window stays inside the data", () => {
    expect(slipBounds(orig, 14, -14, 30)).toEqual([-14, 30]);
    expect(slipBounds("2026-12-05T00:00:00Z", 14, -14, 30)).toEqual([-4, 30]);
    expect(slipBounds("2027-12-01T00:00:00Z", 14, -14, 30)).toEqual([-14, 17]);
  });
  it("keeps the time of day and labels the slip", () => {
    expect(landingFor(orig, 3)).toBe("2027-03-13T06:00:00Z");
    expect(slipOf("2027-03-13T06:00:00Z", orig)).toBe(3);
    expect([fmtSlip(3), fmtSlip(-2), fmtSlip(0)]).toEqual(["+3 d", "−2 d", "0 d"]);
    expect(atTimeOfDay(Date.parse("2027-04-02T17:00:00Z"), orig)).toBe("2027-04-02T06:00:00Z");
    expect(atTimeOfDay(Date.parse("2027-04-02T17:00:00Z"), null)).toBe("2027-04-02T00:00:00Z");
  });
});

describe("parseExact", () => {
  it("reads 24 h UTC text and rounds to the hour", () => {
    expect(parseExact("2027-01-15 18:40")).toBe("2027-01-15T19:00:00Z");
    expect(parseExact("2027-01-15T06:00 UTC")).toBe("2027-01-15T06:00:00Z");
  });
  it("rejects AM/PM, impossible dates and times outside the data", () => {
    expect(parseExact("2027-01-15 6:00 PM")).toBeNull();
    expect(parseExact("2027-02-30 06:00")).toBeNull();
    expect(parseExact("2026-11-30 23:00")).toBeNull();
  });
});

describe("scale labels and steps (#158)", () => {
  it("never overlaps two labels or an edge span; majors win", () => {
    const items = [
      { x: 10, w: 30, level: 1 }, // cut by the left edge span
      { x: 60, w: 40, level: 1 },
      { x: 80, w: 40, level: 2 }, // a major on top of the medium at 60
      { x: 200, w: 40, level: 1 },
      { x: 290, w: 30, level: 1 }, // cut by the right edge span
    ];
    const show = placeLabels(items, [
      [-Infinity, 0],
      [300, Infinity],
    ]);
    expect(show).toEqual([false, false, true, true, false]);
    const kept = items.filter((_, k) => show[k]);
    for (let i = 1; i < kept.length; i++) expect(kept[i].x - kept[i].w / 2).toBeGreaterThan(kept[i - 1].x + kept[i - 1].w / 2);
  });

  it("a lunar day is one synodic month in whole hours", () => {
    expect(LUNAR_DAY_H).toBe(Math.round(29.530589 * 24));
    expect(stepUtc("2027-01-15T00:00:00Z", LUNAR_DAY_H)).toBe("2027-02-13T13:00:00Z");
  });
});
