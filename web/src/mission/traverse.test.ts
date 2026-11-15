import { describe, expect, it } from "vitest";
import { driveInput, levelOf, planTraverse, ROVER_M_PER_H, type Series } from "./traverse";
import { distanceKm } from "./waypoints";

const T0 = Date.parse("2027-01-01T00:00:00Z");
const series = (sun: string, earth: string, dsn?: string): Series => ({
  startMs: T0,
  stepMin: 60,
  sun: [...sun].map(Number),
  earth: [...earth].map(Number),
  ...(dsn ? { dsn: [...dsn].map(Number) } : {}),
  terrain: true,
});
const A = { name: "Landing", lat: -89.5, lonE: 0 };
// 72 m apart along the meridian → 2 h at 36 m/h.
const B = { name: "WP1", lat: -89.5 - 0.072 / ((distanceKm(-89.5, 0, -89.6, 0) / 0.1)), lonE: 0 };

describe("traverse", () => {
  it("drives each leg at 36 m/h and reads the nearer leg end hour by hour", () => {
    const tr = planTraverse([A, B], [series("1111", "1000", "1000"), series("0000", "0111", "0011")], T0);
    expect(ROVER_M_PER_H).toBe(36);
    expect(tr.legs).toHaveLength(1);
    const leg = tr.legs[0];
    expect(leg.km).toBeCloseTo(0.072, 6);
    expect(leg.hours).toBe(2);
    // Hour 0 at A: Sun 1, Earth 1, DSN 1. Hour 1 at B: Sun 0, Earth 1, DSN 0.
    expect(leg).toMatchObject({ counted: 2, sunShare: 0.5, earthShare: 1, dsnShare: 0.5, level: "good" });
    expect(tr.input).toMatchObject({ windowH: 2, sunH: 1, earthH: 2, longestDarkH: 1, longestNoCommsH: 0, hoursToSunset: 1 });
  });

  it("chains legs in time and colours a leg by its Earth share", () => {
    const C = { ...B, name: "WP2", lat: B.lat - (A.lat - B.lat) };
    const tr = planTraverse([A, B, C], [series("1111", "1111"), series("1111", "1100"), series("1111", "0000")], T0);
    expect(tr.legs.map((l) => l.startMs - T0)).toEqual([0, 2 * 3_600_000]);
    expect(tr.legs.map((l) => l.level)).toEqual(["good", "poor"]);
    expect(tr.legs[1].dsnShare).toBeNull();
    expect(tr.hours).toBe(4);
  });

  it("waits for every timeline before it scores, and flags the data end", () => {
    const pending = planTraverse([A, B], [series("1", "1"), null], T0);
    expect(pending.input).toBeNull();
    expect(pending.legs[0].level).toBe("pending");
    const cut = planTraverse([A, B], [series("1", "1"), series("1", "1")], T0);
    expect(cut.clipped).toBe(true);
    expect(cut.legs[0].counted).toBe(1);
  });

  it("bins comms levels at 80 % and 40 %", () => {
    expect([levelOf(0.8), levelOf(0.79), levelOf(0.4), levelOf(0.39), levelOf(null)]).toEqual(["good", "partial", "partial", "poor", "pending"]);
  });

  it("counts windows and runs over the drive", () => {
    expect(driveInput([0, 1, 1, 0, 1], [1, 0, 0, 0, 1])).toEqual({
      windowH: 5, sunH: 3, earthH: 2, longestDarkH: 1, longestNoCommsH: 3, hoursToSunset: null, sunWindows: 2, commsWindows: 2,
    });
    expect(driveInput([1, 1], [1, 1]).hoursToSunset).toBe(2);
    expect(driveInput([1, 1], [1, 1], 40).hoursToSunset).toBe(42);
  });

  it("runs the sunset margin on at the last point when the Sun never sets on the drive", () => {
    // 2 h drive, then the end point stays lit 3 more hours: hours to sunset = 5, not the drive length.
    const tr = planTraverse([A, B], [series("11111111", "11111111"), series("11111000", "11111111")], T0);
    expect(tr.input?.hoursToSunset).toBe(5);
  });
});
