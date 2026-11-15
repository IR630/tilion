import { describe, expect, it } from "vitest";
import { CALLOUT_AT, along, calloutText, declutter, placeCallouts, routeFeatures, routeKey } from "./routeMap";

const FROM: [number, number] = [-86.8, 338.3];
const A: [number, number] = [-85.4, 31.5];
const B: [number, number] = [-89.4, 222.7];

describe("route callouts", () => {
  it("keys an option by site and landing moment", () => {
    expect(routeKey({ siteId: "a", landingUtc: "2027-01-13T00:00:00Z" })).toBe("a@2027-01-13T00:00:00Z");
  });

  it("puts each bubble past the middle of its own line", () => {
    const c = placeCallouts(FROM, [
      { key: "a", to: A },
      { key: "b", to: B },
    ]);
    expect(c.map((x) => x.stack)).toEqual([0, 0]);
    expect(c.every((x) => !x.onOrigin)).toBe(true);
    expect(c[0].at).toEqual(along(FROM, A, CALLOUT_AT));
    // Between the ends in latitude for a line that does not cross the pole region.
    expect(c[0].at[0]).toBeGreaterThan(Math.min(FROM[0], A[0]) - 1);
    expect(c[0].at).not.toEqual(c[1].at);
  });

  it("stacks bubbles of two dates at one site, in list order", () => {
    const c = placeCallouts(FROM, [
      { key: "a1", to: A },
      { key: "b", to: B },
      { key: "a2", to: A },
    ]);
    expect(c.map((x) => [x.key, x.stack])).toEqual([
      ["a1", 0],
      ["b", 0],
      ["a2", 1],
    ]);
    expect(c[2].at).toEqual(c[0].at);
  });

  it("puts options at the plan site on the origin, stacked", () => {
    const c = placeCallouts(FROM, [
      { key: "here1", to: FROM },
      { key: "a", to: A },
      { key: "here2", to: [...FROM] as [number, number] },
    ]);
    expect(c[0]).toEqual({ key: "here1", at: FROM, stack: 0, onOrigin: true });
    expect(c[2]).toMatchObject({ at: FROM, stack: 1, onOrigin: true });
  });

  it("draws one line per option away from the plan site, the selected one last", () => {
    const fc = routeFeatures(
      FROM,
      [
        { key: "a", to: A, selected: true },
        { key: "here", to: FROM, selected: false },
        { key: "b", to: B, selected: false },
      ],
      (lat, lon) => [lat, lon],
    );
    expect(fc.features.map((f) => f.properties)).toEqual([
      { key: "b", sel: 0 },
      { key: "a", sel: 1 },
    ]);
    const line = fc.features[1].geometry.coordinates;
    expect(line[0][0]).toBeCloseTo(FROM[0], 9);
    expect(line.at(-1)![0]).toBeCloseTo(A[0], 9);
    expect(line.at(-1)![1]).toBeCloseTo(A[1], 9);
  });
});

describe("declutter", () => {
  it("leaves apart bubbles in place", () => {
    expect(declutter([{ x: 0, y: 100, w: 80, h: 24 }, { x: 200, y: 100, w: 80, h: 24 }])).toEqual([0, 0]);
  });
  it("lifts a bubble that overlaps a placed one above it, with a gap", () => {
    const lift = declutter([{ x: 0, y: 100, w: 80, h: 24 }, { x: 10, y: 105, w: 80, h: 24 }]);
    expect(lift[0]).toBe(0);
    // Placed box spans y 76..100; the second bottom must sit at 76 − 4 = 72 → lift 105 − 72.
    expect(lift[1]).toBe(33);
  });
  it("keeps the first in priority order in place and stacks three at one point", () => {
    const b = { x: 0, y: 100, w: 80, h: 24 };
    const lift = declutter([b, b, b], [2, 0, 1]);
    expect(lift[2]).toBe(0);
    expect(lift[0]).toBe(28);
    expect(lift[1]).toBe(56);
  });
  // #204: the selected site name is placed before every bubble; a bubble over it moves up.
  it("lifts a bubble off a fixed rect", () => {
    const lift = declutter([{ x: 0, y: 100, w: 80, h: 24 }], [0], 4, [{ l: 20, r: 120, t: 90, b: 104 }]);
    expect(lift[0]).toBe(100 - (90 - 4));
  });
  // #397: a stack that would rise above the map top (under the status strip) goes under the anchor.
  it("puts a bubble under its anchor when the space above runs out", () => {
    const strip = { l: -100, r: 100, t: 0, b: 90 };
    const lift = declutter([{ x: 0, y: 100, w: 80, h: 24, down: -60 }], [0], 4, [strip], 0);
    expect(lift[0]).toBe(-60);
    const b = { x: 0, y: 100, w: 80, h: 24, down: -60 };
    const two = declutter([b, b], [0, 1], 4, [strip], 0);
    expect(two[0]).toBe(-60); // spans y 136..160
    expect(two[1]).toBe(100 - 24 - (160 + 4)); // the next one below it, 4 px apart
  });
});

// #195: a bare "100 PTS −5 D" on the map was unexplained. The bubble names both numbers.
describe("route bubble text", () => {
  it("says the route score and the landing date slip", () => {
    expect(calloutText(99.6, -5)).toEqual({ rank: "", metric: "score 100", slip: "slip −5 d", tie: "" });
    expect(calloutText(42, 3)).toMatchObject({ metric: "score 42", slip: "slip +3 d" });
    expect(calloutText(87, 0)).toMatchObject({ metric: "score 87", slip: "same day" });
  });
  // #204: tied scores (100 at every good polar window) show the rank and what decides it.
  it("gives the rank and, on a score tie, the deciding slip or distance", () => {
    expect(calloutText(100, -9, 1, "slip")).toEqual({
      rank: "#1",
      metric: "score 100",
      slip: "slip −9 d",
      tie: "score ties a neighbour; the smaller date slip ranks it",
    });
    expect(calloutText(100, -11, 3, "distance", 42.4)).toMatchObject({ rank: "#3", slip: "slip −11 d, 42 km" });
    expect(calloutText(70, 0, 2, null).tie).toBe("");
  });
});
