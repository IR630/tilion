import { describe, expect, it } from "vitest";
import type { Site, Timeline } from "../contracts";
import { stereoXY } from "../format";
import { boundsToCoords, COARSE_ZOOM_LIMIT, detailZoom, graticule, greatCircle, layersOf, liveState, matches, parseLatLon, metresPerPixel, onMap, scaleBar, type TileSet, tileSource, toMap, zoomLimit } from "./geo";

describe("map coordinates (D-005)", () => {
  it("pole is the origin, lon 0°E is up, lon 90°E is right", () => {
    expect(toMap(-90, 0)).toEqual([0, 0]);
    const [x0, y0] = toMap(-80, 0);
    expect(x0).toBeCloseTo(0, 9);
    expect(y0).toBeCloseTo(0.304, 3); // 2 R tan(5°) ≈ 304 km
    const [x90, y90] = toMap(-80, 90);
    expect(x90).toBeCloseTo(0.304, 3);
    expect(y90).toBeCloseTo(0, 9);
  });
  it("is stereoXY divided by 1e6", () => {
    const [x, y] = stereoXY(-89.4398, 222.83);
    expect(toMap(-89.4398, 222.83)).toEqual([x / 1e6, y / 1e6]);
  });
  it("bounds give image corners TL, TR, BR, BL", () => {
    expect(boundsToCoords([-1e6, -2e6, 3e6, 4e6])).toEqual([
      [-1, 4],
      [3, 4],
      [3, -2],
      [-1, -2],
    ]);
  });
  it("layers of a kind: coarse first", () => {
    const meta = {
      layers: [
        { id: "relief80", kind: "relief" as const, file: "a", bounds: [-1, -1, 1, 1] },
        { id: "sun65", kind: "sun" as const, file: "b", bounds: [-5, -5, 5, 5] },
        { id: "relief60", kind: "relief" as const, file: "c", bounds: [-3, -3, 3, 3] },
      ],
    };
    expect(layersOf(meta, "relief").map((l) => l.id)).toEqual(["relief60", "relief80"]);
    expect(layersOf(meta, "earth")).toEqual([]);
  });
  it("graticule: 8 latitude circles, 12 meridians, circles are closed", () => {
    const g = graticule();
    const lat = g.features.filter((f) => f.properties.kind === "lat");
    expect(lat).toHaveLength(8);
    expect(g.features.filter((f) => f.properties.kind === "lon")).toHaveLength(12);
    const c = lat[0].geometry.coordinates;
    expect(c[0][0]).toBeCloseTo(c[c.length - 1][0], 9);
    expect(c[0][1]).toBeCloseTo(c[c.length - 1][1], 9);
  });
});

describe("scale", () => {
  it("metres per pixel halve with each zoom step", () => {
    expect(metresPerPixel(0)).toBeCloseTo(703125, 0);
    expect(metresPerPixel(10) * 2).toBeCloseTo(metresPerPixel(9), 6);
  });
  it("scale bar is a 1/2/5 step that fits", () => {
    for (const z of [6, 9.3, 12, 14.7]) {
      const s = scaleBar(z, 110);
      expect(s.px).toBeLessThanOrEqual(110);
      expect(s.px).toBeGreaterThan(20);
      expect(String(s.km)).toMatch(/^(0\.0*)?[125]0*$/);
    }
    expect(scaleBar(9, 110).label).toBe("100 km");
    expect(scaleBar(14, 110).label).toBe("2 km");
  });
});

const tl = (sun: number[], earth: number[]): Timeline => ({
  siteId: "x",
  startUtc: "2027-01-01T00:00:00Z",
  stepMin: 60,
  sunAz: sun.map(() => 0),
  sunEl: sun.map((_, i) => i - 2),
  sunVisible: sun,
  earthAz: earth.map(() => 0),
  earthEl: earth.map((_, i) => 5 - i),
  earthVisible: earth,
});

describe("live state at the shared moment", () => {
  it("reads the step and the hours to the next change", () => {
    const s = liveState(tl([0, 0, 0.5, 1, 1, 0], [1, 1, 1, 0, 0, 0]), "2027-01-01T02:00:00Z")!;
    expect(s.utc).toBe("2027-01-01T02:00:00Z");
    expect(s.sunUp).toBe(true);
    expect(s.sunElDeg).toBe(0);
    expect(s.sunChangeH).toBe(3); // sunset at step 5
    expect(s.earthUp).toBe(true);
    expect(s.earthChangeH).toBe(1); // Earthset at step 3
    expect(s.leftH).toBe(3);
  });
  it("no change before the data end gives null", () => {
    const s = liveState(tl([0, 0, 0], [1, 1, 1]), "2027-01-01T00:00:00Z")!;
    expect(s.sunUp).toBe(false);
    expect(s.sunChangeH).toBeNull();
    expect(s.earthChangeH).toBeNull();
  });
  it("outside the timeline gives null", () => {
    expect(liveState(tl([1], [1]), "2026-01-01T00:00:00Z")).toBeNull();
    expect(liveState(tl([1], [1]), "2027-01-01T05:00:00Z")).toBeNull();
  });
});

const site = (p: Partial<Site>): Site => ({
  id: "a_haworth",
  name: "Haworth (HW02)",
  group: "artemis",
  status: "Artemis III candidate",
  kind: "point",
  lat: -87.4,
  lonE: 355,
  elevM: null,
  source: "",
  confidence: "high",
  terrain: "polar80",
  note: "",
  ...p,
});

describe("site list", () => {
  it("search matches name, status, id and group, case-insensitive", () => {
    expect(matches(site({}), "hawor")).toBe(true);
    expect(matches(site({}), "ARTEMIS III")).toBe(true);
    expect(matches(site({}), "ridge", "Illuminated ridges")).toBe(true);
    expect(matches(site({}), "shackleton")).toBe(false);
    expect(matches(site({}), "  ")).toBe(true);
  });
  it("only known points south of 60°S go on the map", () => {
    expect(onMap(site({}))).toBe(true);
    expect(onMap(site({ lat: 0.67, lonE: 23.47 }))).toBe(false);
    expect(onMap(site({ lat: null, lonE: null }))).toBe(false);
  });
});

describe("greatCircle", () => {
  it("starts and ends at the given points and stays on the arc", () => {
    const pts = greatCircle([-89, 0], [-89, 180], 8);
    expect(pts).toHaveLength(9);
    expect(pts[0][0]).toBeCloseTo(-89, 9);
    expect(pts[8][0]).toBeCloseTo(-89, 9);
    expect(pts[8][1]).toBeCloseTo(180, 6);
    expect(pts[4][0]).toBeCloseTo(-90, 6); // the arc between opposite meridians crosses the pole
  });
  it("gives two points for the same place", () => {
    expect(greatCircle([-85, 10], [-85, 10])).toEqual([[-85, 10], [-85, 10]]);
  });
});

describe("basemap tile sets (#149)", () => {
  const set = (id: string, minzoom: number, maxzoom: number): TileSet => ({
    id,
    layer: "relief",
    url: "relief/{z}/{x}/{y}.webp",
    minzoom,
    maxzoom,
    bounds: [-304000, -304000, 304000, 304000],
    resolutionM: 20,
    source: "LOLA",
  });
  it("turns metre bounds into map lng/lat and keeps the {z}/{x}/{y} template", () => {
    const s = tileSource(set("a", 15, 16), "https://host/hd/basemap/", 256);
    expect(s.bounds).toEqual([-0.304, -0.304, 0.304, 0.304]);
    expect(s.tiles).toEqual(["https://host/hd/basemap/relief/{z}/{x}/{y}.webp"]);
    expect([s.minzoom, s.maxzoom, s.tileSize]).toEqual([15, 16, 256]);
  });
  it("allows zoom to the deepest tile level: 256 px tiles at zoom z serve map zoom z - 1", () => {
    expect(detailZoom([set("a", 7, 12), set("b", 17, 18)])).toBe(17);
    expect(metresPerPixel(17)).toBeCloseTo(5.36, 2); // LOLA 5 m patches
  });
});

describe("coordinate search (#232)", () => {
  it("reads signed decimal lat, lon", () => {
    expect(parseLatLon("-89.5, 120")).toEqual([-89.5, 120]);
  });
  it("reads S/N and E/W letters", () => {
    expect(parseLatLon("89.5S 120E")).toEqual([-89.5, 120]);
  });
  it("turns west or negative longitude into 0–360°E", () => {
    expect(parseLatLon("-85, -60")).toEqual([-85, 300]);
  });
  it("rejects names and out-of-range values", () => {
    expect(parseLatLon("Haworth")).toBeNull();
    expect(parseLatLon("-95, 10")).toBeNull();
  });
});

describe("zoomLimit (#464)", () => {
  const set = (id: string, resolutionM: number, b: number, layer: "relief" | "photo" = "relief"): TileSet => ({
    id, layer, url: "", minzoom: 7, maxzoom: 16, bounds: [-b, -b, b, b], resolutionM, source: "",
  });
  const sets = [set("r240", 240, 931200), set("r80", 80, 304000), set("p100", 100, 931100, "photo")];
  it("allows the detail zoom inside a finer relief set", () => {
    expect(zoomLimit(sets, [0.1, -0.2], 17)).toBe(17);
    expect(zoomLimit(sets, [0.304, 0.304], 15.5)).toBe(15.5);
  });
  it("caps at 12.5 where only the 240 m relief (or photo) covers the centre", () => {
    expect(zoomLimit(sets, [0.5, 0], 17)).toBe(COARSE_ZOOM_LIMIT);
    expect(zoomLimit(sets, [0, -0.31], 17)).toBe(12.5);
    expect(zoomLimit([set("r240", 240, 931200)], [0, 0], 17)).toBe(12.5);
  });
  it("never goes below the coarse cap", () => {
    expect(zoomLimit(sets, [0, 0], 10)).toBe(12.5);
  });
});
