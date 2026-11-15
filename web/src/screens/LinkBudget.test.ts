import { describe, expect, it } from "vitest";
import { calculateBudget, type Profile } from "./LinkBudget";

// Free-space link equation; values below are a hand-calculated SI example.
const example: Profile = { powerW: 1, frequencyGHz: 1, distanceKm: 1, txGain: 0, rxGain: 0, losses: 0, noiseK: 290, rate: 1000000, required: 10 };
describe("link budget", () => {
  it("uses SI units for free-space loss and thermal noise", () => {
    const r = calculateBudget(example)!;
    expect(r.fspl).toBeCloseTo(92.45, 1);
    expect(r.ebn0).toBeCloseTo(51.53, 1);
    expect(r.margin).toBeCloseTo(41.53, 1);
  });
  it("rejects missing and physically invalid inputs", () => {
    for (const p of [{ ...example, rate: 0 }, { ...example, frequencyGHz: NaN }, { ...example, distanceKm: -1 }, { ...example, losses: -1 }]) expect(calculateBudget(p)).toBeNull();
  });
  it("applies gains, losses and required threshold in dB", () => {
    const r = calculateBudget({ ...example, txGain: 10, losses: 3, required: 12 })!;
    expect(r.margin - calculateBudget(example)!.margin).toBeCloseTo(5);
  });
});
