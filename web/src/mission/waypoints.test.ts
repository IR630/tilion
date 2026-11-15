import { describe, expect, it } from "vitest";
import { stereoXY } from "../format";
import { cellOf, type Grid, NODATA, sample } from "./illumGrid";
import { openPlan, planFromJson, planFromQuery, planToJson, planToQuery } from "./plan";
import { DEFAULT_PLAN, type MissionPlan, type MissionState } from "./types";
import { addWaypoint, azimuthDeg, distanceKm, moveWaypoint, R_KM, removeWaypoint, renameWaypoint, waypointLabel } from "./waypoints";

const plan: MissionPlan = { ...DEFAULT_PLAN, siteId: "shackleton_rim", landingUtc: "2027-03-01T12:00:00Z" };
const base: MissionState = openPlan(plan);

describe("distance and azimuth on R = 1737.4 km", () => {
  it("gives zero for the same point and a quarter circle pole to equator", () => {
    expect(distanceKm(-89, 10, -89, 10)).toBe(0);
    expect(distanceKm(-90, 0, 0, 123)).toBeCloseTo((Math.PI / 2) * R_KM, 6);
  });
  it("measures one degree of latitude as R·π/180", () => {
    expect(distanceKm(-85, 40, -86, 40)).toBeCloseTo((R_KM * Math.PI) / 180, 6);
  });
  it("is symmetric and works across 0°E", () => {
    const a = distanceKm(-85, 359.5, -85, 0.5);
    expect(a).toBeCloseTo(distanceKm(-85, 0.5, -85, 359.5), 9);
    expect(a).toBeCloseTo(2 * R_KM * Math.asin(Math.cos((85 * Math.PI) / 180) * Math.sin((0.5 * Math.PI) / 180)), 6);
  });
  it("points north (0°) toward a lower southern latitude on the same meridian and south (180°) to the pole side", () => {
    expect(azimuthDeg(-86, 40, -85, 40)).toBeCloseTo(0, 6);
    expect(azimuthDeg(-85, 40, -86, 40)).toBeCloseTo(180, 6);
  });
  it("points east (90°) along the equator and stays in 0–360", () => {
    expect(azimuthDeg(0, 10, 0, 20)).toBeCloseTo(90, 6);
    expect(azimuthDeg(0, 20, 0, 10)).toBeCloseTo(270, 6);
    for (const [a, b, c, d] of [[-89.8, 204, -89.67, 129.78], [-85, 10, -86, 300]]) {
      const z = azimuthDeg(a, b, c, d);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThan(360);
    }
  });
  it("formats the map label", () => {
    expect(waypointLabel(0, { name: "Shackleton", lat: -85, lonE: 40 }, [-86, 40])).toBe("WP1: SHACKLETON, 30.3 KM");
    expect(waypointLabel(2, { name: "x", lat: -85, lonE: 40 }, null)).toBe("WP3: X");
  });
});

describe("waypoint transitions", () => {
  const a = { name: "A", lat: -85, lonE: 10 };
  const b = { name: "B", lat: -86, lonE: 370 };
  it("adds only to an existing plan, wraps longitude and names a nameless point", () => {
    expect(addWaypoint({ plan: null, original: null, selected: null }, a).plan).toBeNull();
    const s = addWaypoint(addWaypoint(base, a), { ...b, name: " " });
    expect(s.plan?.waypoints).toEqual([a, { name: "86.00°S 10.0°E", lat: -86, lonE: 10 }]);
    expect(s.original).toBe(base.original);
  });
  it("removes, reorders and renames", () => {
    let s = addWaypoint(addWaypoint(base, a), b);
    s = moveWaypoint(s, 1, -1);
    expect(s.plan?.waypoints?.map((w) => w.name)).toEqual(["B", "A"]);
    expect(moveWaypoint(s, 0, -1)).toBe(s);
    expect(moveWaypoint(s, 1, 1)).toBe(s);
    s = renameWaypoint(s, 1, "  Ice target ");
    expect(s.plan?.waypoints?.[1].name).toBe("Ice target");
    expect(renameWaypoint(s, 1, "")).toBe(s);
    s = removeWaypoint(removeWaypoint(s, 0), 0);
    expect(s.plan?.waypoints).toBeUndefined();
  });
  it("round-trips through the link and the JSON file", () => {
    const s = addWaypoint(addWaypoint(base, a), { name: "Shackleton · rim & ice", lat: -89.67, lonE: 129.78 });
    const p = s.plan as MissionPlan;
    const q = planFromQuery(planToQuery(p, "?guide=0"));
    expect(q?.warnings).toEqual([]);
    expect(q?.plan.waypoints).toEqual(p.waypoints);
    const f = planFromJson(planToJson(p));
    expect("plan" in f && f.plan.waypoints).toEqual(p.waypoints);
    expect(planToQuery(removeWaypoint(removeWaypoint(s, 0), 0).plan)).not.toContain("wp=");
  });
});

describe("PGDA 69 numeric grid sampling", () => {
  // A 4×4 grid of 1 km cells centred on the pole; value = row * 10 + col; one no-data cell.
  const data = new Uint8Array(16).map((_, i) => Math.floor(i / 4) * 10 + (i % 4));
  data[0] = NODATA;
  const g: Grid = { id: "sun85", kind: "sun", file: "", size: 4, bounds: [-2000, -2000, 2000, 2000], cellM: 1000, data };
  const coarse: Grid = { ...g, id: "sun65", cellM: 2000, size: 2, data: new Uint8Array([77, 77, 77, 77]) };
  it("puts row 0 on the +y (0°E) side and column 0 on −x", () => {
    // 1.5 km from the pole toward 0°E is +y: top row; toward 270°E is −x: first column.
    const lat = -90 + (1500 / (1737400 * Math.PI)) * 180;
    expect(stereoXY(lat, 0)[1]).toBeCloseTo(1500, 0);
    expect(cellOf(g, lat, 0)).toEqual([0, 2]);
    expect(cellOf(g, lat, 270)).toEqual([2, 0]);
    expect(cellOf(g, lat, 180)).toEqual([3, 2]);
    expect(cellOf(g, -80, 0)).toBeNull();
  });
  it("takes the finest grid and falls back to the coarse one on no data", () => {
    const lat = -90 + (1500 / (1737400 * Math.PI)) * 180;
    expect(sample([coarse, g], "sun", lat, 180)).toEqual({ pct: 32, cellM: 1000 });
    expect(sample([coarse, g], "sun", lat, 315)).toEqual({ pct: 77, cellM: 2000 }); // cell [0,0] = no data
    expect(sample([coarse, g], "earth", lat, 180)).toBeNull();
  });
});
