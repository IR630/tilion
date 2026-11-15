import { describe, expect, it } from "vitest";
import { parseRouteJson, ROUTE_JSON_EXAMPLE, ROUTE_MAX_POINTS, routeToJson } from "./routeJson";

const errs = (text: string) => {
  const r = parseRouteJson(text);
  return "errors" in r ? r.errors : [];
};

describe("route JSON", () => {
  it("parses the example and round-trips it", () => {
    const r = parseRouteJson(ROUTE_JSON_EXAMPLE);
    expect(r).toEqual({
      points: [
        { name: "Landing", lat: -89.45, lonE: 222.7 },
        { name: "Ridge crest", lat: -89.4, lonE: 210 },
      ],
    });
    if ("points" in r) expect(parseRouteJson(routeToJson(r.points))).toEqual(r);
  });

  it("accepts lonE, a {waypoints} object and a missing name", () => {
    const r = parseRouteJson('{"waypoints": [{"lat": -85, "lonE": 0}]}');
    expect(r).toEqual({ points: [{ name: "P1", lat: -85, lonE: 0 }] });
  });

  it("rejects text that is not JSON or not a list", () => {
    expect(errs("[{")[0]).toMatch(/^Not valid JSON/);
    expect(errs('{"lat": -89}')).toEqual(['Expected a list of points: [{"name", "lat", "lon"}, …]']);
    expect(errs("[]")).toEqual(["The list is empty: add at least one point"]);
    const many = JSON.stringify(Array.from({ length: ROUTE_MAX_POINTS + 1 }, () => ({ lat: -89, lon: 0 })));
    expect(errs(many)[0]).toMatch(/at most 20/);
  });

  it("lists every bad point with a clear reason", () => {
    const e = errs(
      JSON.stringify([
        { name: "ok", lat: -89, lon: 10 },
        { name: "west", lat: -89, lon: -10 },
        { name: "north", lat: -45, lon: 10 },
        { lat: "-89", lon: 10 },
        { name: "far", lat: -89, lon: 400 },
        7,
      ]),
    );
    expect(e).toEqual([
      "Point 2 (west): lon -10 is negative: use 0–360°E (-10 → 350)",
      "Point 3 (north): lat -45 is north of 60°S: terrain covers −60…−90 only",
      'Point 4: lat must be a number, got "-89"',
      "Point 5 (far): lon 400 is outside 0–360°E",
      'Point 6: expected an object {"name", "lat", "lon"}, got 7',
    ]);
  });

  it("rejects lon 360 itself and a blank name", () => {
    expect(errs('[{"lat": -89, "lon": 360}]')[0]).toMatch(/outside 0–360°E/);
    expect(errs('[{"name": " ", "lat": -89, "lon": 1}]')[0]).toMatch(/name must be non-empty text/);
  });
});
