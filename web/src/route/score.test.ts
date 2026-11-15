import { describe, expect, it } from "vitest";
import { decodeHours } from "./hours";
import { CHECKOUT_H, commsWindows, countWindows, lightWindows, type ScoreInput, scoreOf, SURVIVAL_H, termValues, WEIGHTS, whyBest } from "./score";

const W = 336;
const base: ScoreInput = { windowH: W, sunH: 200, earthH: 150, longestDarkH: 20, longestNoCommsH: 100, hoursToSunset: 30 };
const total = (p: Partial<ScoreInput>) => scoreOf({ ...base, ...p }).total;

describe("route score", () => {
  it("weights of every mode sum to 1", () => {
    for (const w of Object.values(WEIGHTS)) expect(Object.values(w).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it("is 100 for a perfect window and 0 for a dark, silent one", () => {
    expect(scoreOf({ windowH: W, sunH: W, earthH: W, longestDarkH: 0, longestNoCommsH: 0, hoursToSunset: 500 }).total).toBeCloseTo(100, 9);
    expect(scoreOf({ windowH: W, sunH: 0, earthH: 0, longestDarkH: W, longestNoCommsH: W, hoursToSunset: null }).total).toBe(0);
    expect(scoreOf({ ...base, windowH: 0 }).total).toBe(0);
  });

  it("rises with Sun and Earth hours and with hours to sunset; falls with the longest night and gap", () => {
    expect(total({ sunH: 250 })).toBeGreaterThan(total({}));
    expect(total({ earthH: 200 })).toBeGreaterThan(total({}));
    expect(total({ hoursToSunset: 40 })).toBeGreaterThan(total({}));
    expect(total({ hoursToSunset: 40 })).toBeGreaterThan(total({ hoursToSunset: null }));
    expect(total({ longestDarkH: 10 })).toBeGreaterThan(total({}));
    expect(total({ longestNoCommsH: 50 })).toBeGreaterThan(total({}));
  });

  it("uses the thresholds: night 0 at the survival limit, margin full at the checkout time", () => {
    expect(termValues({ ...base, longestDarkH: SURVIVAL_H }).night).toBe(0);
    expect(termValues({ ...base, longestDarkH: SURVIVAL_H * 3 }).night).toBe(0);
    expect(termValues({ ...base, longestDarkH: SURVIVAL_H / 2 }).night).toBeCloseTo(0.5);
    expect(termValues({ ...base, hoursToSunset: CHECKOUT_H }).margin).toBe(1);
    expect(termValues({ ...base, hoursToSunset: CHECKOUT_H * 4 }).margin).toBe(1);
    expect(scoreOf({ ...base, longestDarkH: SURVIVAL_H + 1 }).nightOverLimit).toBe(true);
    expect(scoreOf({ ...base, longestDarkH: SURVIVAL_H }).nightOverLimit).toBe(false);
  });

  it("keeps every term in 0..1 and the points equal to weight × value × 100", () => {
    const s = scoreOf({ windowH: 10, sunH: 30, earthH: -5, longestDarkH: -1, longestNoCommsH: 99, hoursToSunset: 1e9 }, "comms");
    for (const t of s.terms) {
      expect(t.value).toBeGreaterThanOrEqual(0);
      expect(t.value).toBeLessThanOrEqual(1);
      expect(t.points).toBeCloseTo(100 * WEIGHTS.comms[t.id] * t.value, 12);
    }
  });

  it("gives each mode its own emphasis", () => {
    const sunny = { ...base, sunH: 330, longestDarkH: 0, earthH: 50, longestNoCommsH: 250 };
    const chatty = { ...base, sunH: 150, longestDarkH: 45, earthH: 330, longestNoCommsH: 0 };
    expect(scoreOf(sunny, "energy").total).toBeGreaterThan(scoreOf(chatty, "energy").total);
    expect(scoreOf(chatty, "comms").total).toBeGreaterThan(scoreOf(sunny, "comms").total);
  });

  it("explains the win by the terms that add the most points", () => {
    const best = { ...base, sunH: 300, longestDarkH: 5 };
    expect(whyBest(best, base)).toBe(
      "more sunlight (89 % vs 60 %) and a shorter longest night (5 h vs 20 h): +16 points over #2 (Power, Night)",
    );
    expect(whyBest(base, { ...base })).toMatch(/^ties with the next option/);
    expect(whyBest(base, null)).toBe("");
  });
});

describe("windows count", () => {
  it("counts separate runs, including one already on at the start", () => {
    const h = decodeHours({ startUtc: "2027-01-01T00:00:00Z", stepMin: 60, n: 10, sites: { s: "1102330211" } });
    const s = h.sites.get("s")!;
    expect(lightWindows(s, 0, 10)).toBe(3); // 11 · 3 · 11
    expect(commsWindows(s, 0, 10)).toBe(2); // 233 · 2
    expect(lightWindows(s, 1, 3)).toBe(1);
    expect(countWindows(s.codes, 1, 2, 3)).toBe(0);
    expect(countWindows(s.codes, 1, -5, 99)).toBe(3);
  });
});
