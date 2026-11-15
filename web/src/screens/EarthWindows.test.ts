import { describe, expect, it } from "vitest";
import { selectedWindow, sharedWindows } from "./EarthWindows";

describe("Earth visibility windows", () => {
  it("selects the current or next run and clips it to the period", () => {
    expect(selectedWindow([1, 1, 0, 1, 1], 1)).toEqual([0, 2]);
    expect(selectedWindow([1, 1, 0, 1, 1], 2)).toEqual([3, 5]);
    expect(selectedWindow([0, 0], 0)).toBeNull();
  });
  it("intersects named variants including disjoint intervals", () => {
    expect(sharedWindows([0, 5], [[1, 1, 1, 1, 1], [1, 0, 1, 0, 1]])).toEqual([[0, 1], [2, 3], [4, 5]]);
    expect(sharedWindows([0, 2], [[1, 0], [0, 1]])).toEqual([]);
    expect(sharedWindows([0, 2], [])).toEqual([]);
    expect(sharedWindows([0, 2], [[1]])).toEqual([]);
    expect(sharedWindows([0, 2], [[1, NaN]])).toEqual([]);
  });
});
