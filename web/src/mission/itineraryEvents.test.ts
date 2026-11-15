import { describe, expect, it } from "vitest";
import { decodeHours } from "../route/hours";
import { activeStep, fmtOffset, itinerary, STEP_LABEL } from "./itineraryEvents";

const START = "2027-01-01T00:00:00Z";
const at = (h: number) => new Date(Date.parse(START) + h * 3_600_000).toISOString().replace(".000Z", "Z");
const hrs = (codes: string) => decodeHours({ startUtc: START, stepMin: 60, n: codes.length, sites: { a: codes } });

describe("itinerary", () => {
  it("lists landing, Sun and Earth transitions in time order, and the window end", () => {
    // step: 0 1 2 3 4 5 6 7 8 9
    // code: 3 3 1 1 0 0 2 3 3 3   (window of 9 h from step 1 → steps 1..9, end at step 10)
    const h = hrs("3311002333");
    const it = itinerary(h, "a", at(1), 9 / 24)!;
    expect(it.sunUp).toBe(true);
    expect(it.earthUp).toBe(true);
    expect(it.steps.map((s) => [s.kind, s.offsetH])).toEqual([
      ["landing", 0],
      ["earthset", 1], // step 2: 3 → 1
      ["sunset", 3], // step 4: 1 → 0
      ["earthrise", 5], // step 6: 0 → 2
      ["sunrise", 6], // step 7: 2 → 3
      ["end", 9],
    ]);
    expect(it.steps[1].utc).toBe(at(2));
    expect(it.steps.at(-1)!.utc).toBe(at(10));
    expect(it.clipped).toBe(false);
    expect(it.hidden).toBe(0);
  });

  it("puts the Sun event before the Earth event of the same step", () => {
    const it = itinerary(hrs("3300"), "a", at(0), 4 / 24)!;
    expect(it.steps.map((s) => s.kind)).toEqual(["landing", "sunset", "earthset", "end"]);
  });

  it("does not count the state at landing as an event", () => {
    const it = itinerary(hrs("0000"), "a", at(0), 4 / 24)!;
    expect(it.sunUp).toBe(false);
    expect(it.earthUp).toBe(false);
    expect(it.steps.map((s) => s.kind)).toEqual(["landing", "end"]);
  });

  it("clips the window at the data end and says so", () => {
    const it = itinerary(hrs("1111"), "a", at(2), 14)!;
    expect(it.clipped).toBe(true);
    expect(it.steps.at(-1)).toEqual({ kind: "end", utc: at(4), offsetH: 2 });
  });

  it("caps the listed events and counts the rest", () => {
    const it = itinerary(hrs("1010101010"), "a", at(0), 10 / 24, 3)!;
    expect(it.steps).toHaveLength(5); // landing + 3 + end
    expect(it.hidden).toBe(9 - 3);
  });

  it("returns null for an unknown site or a landing outside the data", () => {
    const h = hrs("11");
    expect(itinerary(h, "b", at(0), 1)).toBeNull();
    expect(itinerary(h, "a", at(5), 1)).toBeNull();
    expect(itinerary(h, "a", at(-1), 1)).toBeNull();
  });

  it("formats offsets and labels", () => {
    expect(fmtOffset(0)).toBe("0 h");
    expect(fmtOffset(61)).toBe("+61 h");
    expect(STEP_LABEL.end).toBe("Window ends");
  });

  it("finds the step the moment falls in", () => {
    const steps = itinerary(hrs("3311002333"), "a", at(1), 9 / 24)!.steps;
    expect(activeStep(steps, at(1))).toBe(0);
    expect(activeStep(steps, at(3))).toBe(1);
    expect(activeStep(steps, at(4))).toBe(2);
    expect(activeStep(steps, at(10))).toBe(5);
    expect(activeStep(steps, at(0))).toBe(-1);
    expect(activeStep(steps, at(11))).toBe(-1);
  });
});
