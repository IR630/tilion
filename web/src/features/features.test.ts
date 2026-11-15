import { describe, expect, it } from "vitest";
import { distanceKm } from "../mission/waypoints";
import { chooseLabels, circleLatLon, diameterPx, type Feature, fold, placeLabels, searchFeatures } from "./features";

const f = (id: string, name: string, diameterKm: number, lat = -85, lonE = 0): Feature => ({
  id,
  name,
  type: "crater",
  lat,
  lonE,
  diameterKm,
  url: `https://planetarynames.wr.usgs.gov/Feature/${id}`,
});
const LIST = [f("1", "Schrödinger", 316), f("2", "Shackleton", 21), f("3", "Shoemaker", 52), f("4", "Mons Malapert", 70), f("5", "Malapert", 72), f("6", "Amundsen A", 5)];

describe("feature search", () => {
  it("ignores case and diacritics", () => {
    expect(fold("Schrödinger")).toBe("schrodinger");
    expect(searchFeatures(LIST, "schrod").map((x) => x.id)).toEqual(["1"]);
  });
  it("ranks name starts, then word starts, then any match; bigger first", () => {
    expect(searchFeatures(LIST, "malap").map((x) => x.name)).toEqual(["Malapert", "Mons Malapert"]);
    expect(searchFeatures(LIST, "sh").map((x) => x.name)).toEqual(["Shoemaker", "Shackleton"]);
    expect(searchFeatures(LIST, "a").length).toBeGreaterThan(0);
    expect(searchFeatures(LIST, "  ")).toEqual([]);
    expect(searchFeatures(LIST, "a", 2)).toHaveLength(2);
  });
});

describe("label placement", () => {
  it("keeps the first of two overlapping labels and drops the second", () => {
    const boxes = [
      { x: 100, y: 100, w: 80, h: 14 },
      { x: 120, y: 104, w: 80, h: 14 },
      { x: 300, y: 100, w: 80, h: 14 },
    ];
    expect(placeLabels(boxes)).toEqual([0, 2]);
  });
  it("respects obstacles and the cap", () => {
    const boxes = [0, 1, 2, 3].map((i) => ({ x: i * 200, y: 0, w: 50, h: 14 }));
    expect(placeLabels(boxes, [{ x: 0, y: 0, w: 20, h: 20 }])).toEqual([1, 2, 3]);
    expect(placeLabels(boxes, [], 2)).toEqual([0, 1]);
  });
  it("labels big features first and small ones only at a closer zoom", () => {
    expect(diameterPx(20, 11)).toBeGreaterThan(diameterPx(20, 9) * 3.9);
    // All features at one screen point: only the biggest can win.
    const at = () => ({ x: 50, y: 50 });
    expect(chooseLabels(LIST, 9, at, { w: 100, h: 100 }).map((c) => c.f.name)).toEqual(["Schrödinger"]);
    // Spread apart: a far zoom shows only the big ones, a near zoom shows the small crater too.
    const spread = (x: Feature) => ({ x: Number(x.id) * 150, y: 50 });
    const far = chooseLabels(LIST, 7, spread, { w: 2000, h: 100 }).map((c) => c.f.id);
    const near = chooseLabels(LIST, 13, spread, { w: 2000, h: 100 }).map((c) => c.f.id);
    expect(far).toEqual(["1"]);
    expect(near).toContain("6");
  });
  it("tries the forced (selected) feature first and skips the ones outside the view", () => {
    const at = () => ({ x: 50, y: 50 });
    expect(chooseLabels(LIST, 9, at, { w: 100, h: 100 }, [], "6").map((c) => c.f.id)).toEqual(["6"]);
    expect(chooseLabels(LIST, 13, () => ({ x: -500, y: 0 }), { w: 100, h: 100 })).toEqual([]);
    // A site marker on top of it does not hide the selected feature, but hides the others.
    const site = [{ x: 50, y: 60, w: 300, h: 40 }];
    expect(chooseLabels(LIST, 13, at, { w: 100, h: 100 }, site, "2").map((c) => c.f.id)).toEqual(["2"]);
    expect(chooseLabels(LIST, 13, at, { w: 100, h: 100 }, site)).toEqual([]);
  });
});

describe("crater ring", () => {
  it("lies at the radius from the centre, also over the pole", () => {
    for (const [lat, lon, r] of [[-85, 40, 30], [-89.67, 129.78, 10.5]]) {
      const ring = circleLatLon(lat, lon, r, 24);
      expect(ring).toHaveLength(25);
      for (const [a, b] of ring) expect(distanceKm(lat, lon, a, b)).toBeCloseTo(r, 6);
    }
  });
});
