import { describe, expect, it } from "vitest";
import { earthLibration, librationCaption } from "./libration";

describe("earthLibration", () => {
  it("takes N from the elevation and azimuth ranges", () => {
    const az = [100, 104, 108, 104];
    const el = [2, 6, 10, 6];
    const l = earthLibration(az, el)!;
    expect(l.elDeg).toBeCloseTo(8, 6);
    expect(l.azDeg).toBeCloseTo(8 * Math.cos((6 * Math.PI) / 180), 6);
    expect(l.halfDeg).toBeCloseTo(4, 6);
  });

  it("handles the azimuth wrap at 0/360", () => {
    const l = earthLibration([358, 359, 0, 1, 2], [0, 0, 0, 0, 0])!;
    expect(l.azDeg).toBeCloseTo(4, 6);
    expect(l.halfDeg).toBeCloseTo(2, 6);
  });

  it("does not crash on empty, short or non-finite data", () => {
    expect(earthLibration([], [])).toBeNull();
    expect(earthLibration([10], [1])).toBeNull();
    expect(earthLibration([NaN, NaN], [NaN, NaN])).toBeNull();
    expect(librationCaption(null)).toBeNull();
  });

  it("gives no caption for a motionless Earth and a number for a moving one", () => {
    expect(librationCaption(earthLibration([90, 90, 90], [3, 3, 3]))).toBeNull();
    expect(librationCaption(earthLibration([90, 94], [0, 0]))).toContain("±2.0°");
  });
});
