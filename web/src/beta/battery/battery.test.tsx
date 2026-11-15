import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Timeline } from "../../contracts";
import { type EnergyInput, VIPER, panelCos, slicePeriod } from "../../energy/energy";
import { BatteryLine } from "./BatteryLine";
import { RESERVE, longestDark, smallestBattery, smallestPanel, survives } from "./battery";

/** Hourly steps: `sun[i]` is the visible Sun share; the Sun stays at az 0, el 0. */
function tl(sun: number[]): Timeline {
  const f = (v: number) => sun.map(() => v);
  return {
    siteId: "t",
    startUtc: "2027-01-01T00:00:00Z",
    stepMin: 60,
    sunAz: f(0),
    sunEl: f(0),
    sunVisible: sun,
    earthAz: f(0),
    earthEl: f(0),
    earthVisible: f(0),
  };
}
const p: EnergyInput = { panelW: 300, batteryWh: 1, dayLoadW: 100, nightLoadW: 100, panel: "tracking", panelAzDeg: 0, startSoc: 1 };
// 10 h Sun (+200 W), 5 h dark (−100 W: 500 Wh deficit), 10 h Sun. Usable 80 % → 500 / 0.8 = 625 Wh.
const hand = tl([...Array(10).fill(1), ...Array(5).fill(0), ...Array(10).fill(1)]);

/** Independent judge: the largest drop from a full charge with no capacity limit, divided by
 * the usable share. With a full start the drop path does not depend on the capacity until the battery empties. */
function closedForm(t: Timeline, q: EnergyInput, reserve: number): number {
  const h = t.stepMin / 60;
  let draw = 0;
  let worst = 0;
  t.sunVisible.forEach((sun, i) => {
    const gen = q.panelW * sun * panelCos(t.sunAz[i], t.sunEl[i], q.panel, q.panelAzDeg, q.panelTiltDeg);
    draw = Math.min(0, draw + (gen - (sun > 0 ? q.dayLoadW : q.nightLoadW)) * h);
    worst = Math.max(worst, -draw);
  });
  return worst / (1 - reserve);
}

describe("smallest battery", () => {
  it("finds 625 Wh by hand: 500 Wh of night over 80 % usable", () => {
    const wh = smallestBattery(hand, p);
    expect(wh).toBeCloseTo(625, 2);
    expect(survives(hand, { ...p, batteryWh: wh })).toBe(true);
    expect(survives(hand, { ...p, batteryWh: wh * 0.95 })).toBe(false);
  });

  it("finds a battery when the starting charge equals the reserve and sunlight comes first", () => {
    const t = tl([...Array(10).fill(1), ...Array(5).fill(0)]);
    const q = { ...p, startSoc: RESERVE };
    const wh = smallestBattery(t, q);
    expect(wh).toBeCloseTo(625, 2);
    expect(survives(t, { ...q, batteryWh: wh })).toBe(true);
    expect(survives(t, { ...q, batteryWh: wh * 0.95 })).toBe(false);
    expect(smallestBattery(tl([0, 1]), q)).toBeNaN();
  });

  it("is 0 when the panel covers the load at every hour", () => {
    expect(smallestBattery(tl(Array(24).fill(1)), p)).toBe(0);
  });

  it("finds the longest spell without charge and its load energy", () => {
    expect(longestDark(hand, p)).toEqual({ hours: 5, wh: 500 });
    // A fixed panel facing south (az 180) gets nothing from the Sun at az 0: the whole day is dark, at the day load.
    expect(longestDark(hand, { ...p, panel: "fixed", panelAzDeg: 180, dayLoadW: 50 })).toEqual({ hours: 25, wh: 20 * 50 + 5 * 100 });
  });
});

describe("smallest panel", () => {
  it("finds a panel that survives and fails at 95 % with the selected battery", () => {
    // Recharge during two sunny hours must cover the later 5 h dark spell and preserve 20 %.
    const t = tl([0, 0, 1, 1, 0, 0, 0, 0, 0]);
    const q = { ...p, batteryWh: 800 };
    const watts = smallestPanel(t, q);
    expect(watts).toBeCloseTo(130, 2);
    expect(survives(t, { ...q, panelW: watts })).toBe(true);
    expect(survives(t, { ...q, panelW: watts * 0.95 })).toBe(false);
  });

  it("reports impossible when the initial dark interval exceeds the usable battery", () => {
    expect(smallestPanel(tl([0, 0, 0, 1]), { ...p, batteryWh: 200 })).toBeNaN();
    expect(smallestPanel(hand, { ...p, batteryWh: 1000, nightLoadW: 0, dayLoadW: 0 })).toBe(0);
  });

  it("uses the selected reserve for both sizing calculations", () => {
    expect(smallestBattery(hand, p, 0.5)).toBeCloseTo(1000, 2);
    expect(smallestPanel(hand, { ...p, batteryWh: 400 }, 0.5)).toBeNaN();
    expect(smallestBattery(hand, p, 1)).toBeNaN();
  });
});

describe("real timelines (web/public/data)", () => {
  const load = (id: string) => JSON.parse(readFileSync(`public/data/timeline/${id}.json`, "utf8")) as Timeline;
  const cases: [string, string, EnergyInput][] = [
    ["cr1_connecting_ridge", "tracking", VIPER],
    ["a_mons_mouton", "tracking", VIPER],
    ["a_mons_mouton", "fixed north", { ...VIPER, panel: "fixed", panelAzDeg: 0 }],
    ["a_mons_mouton", "horizontal deck", { ...VIPER, panel: "fixed", panelTiltDeg: 0 }],
    ["chandrayaan3", "tilted 45° north", { ...VIPER, panel: "fixed", panelAzDeg: 0, panelTiltDeg: 45 }],
    ["apollo11", "tracking", VIPER],
  ];
  it.each(cases)("%s, %s panel: survives at the found size, fails 5 %% below, matches the closed form", (id, _, q) => {
    const t = slicePeriod(load(id), "2027-06-01T00:00:00Z", 30)!;
    const wh = smallestBattery(t, q);
    expect(wh).toBeGreaterThan(0);
    expect(survives(t, { ...q, batteryWh: wh })).toBe(true);
    expect(survives(t, { ...q, batteryWh: wh * 0.95 })).toBe(false);
    expect(Math.abs(wh / closedForm(t, q, RESERVE) - 1)).toBeLessThan(1e-5);
  });

  it("gives a lunar night at Apollo 11: half a synodic month (354.4 h) less the Sun disc rise and set", () => {
    // Synodic month 29.530589 d (Meeus, Astronomical Algorithms); at the equator the 0.53° disc rises in ~1 h.
    const night = longestDark(load("apollo11"), VIPER);
    expect(night.hours).toBeGreaterThanOrEqual(349);
    expect(night.hours).toBeLessThanOrEqual(355);
    expect(night.wh).toBe(night.hours * VIPER.nightLoadW);
  });
});

describe("battery line", () => {
  it("shows the size, the reserve and the dark spell with the BETA tag", () => {
    const html = renderToString(<BatteryLine tl={hand} input={p} period="next 1 d" />);
    expect(html).toContain("Smallest battery that survives next 1 d: 625 Wh with a 20 % reserve");
    expect(html).toContain("Longest spell without charge: 5 h, the load takes 500 Wh");
    expect(html).toContain("No panel size found up to 2^50 W");
    expect(html).toContain("Reserve floor, %");
    expect(html).toContain("BETA");
  });
  it("says no battery is needed when the panel covers the load", () => {
    const html = renderToString(<BatteryLine tl={tl(Array(24).fill(1))} input={p} period="next 1 d" />);
    expect(html).toContain("No battery needed for next 1 d");
    expect(html).not.toContain("Longest spell");
  });
  it("renders nothing on mock data", () => {
    expect(renderToString(<BatteryLine tl={{ ...hand, stub: true }} input={p} period="next 1 d" />)).toBe("");
  });
});
