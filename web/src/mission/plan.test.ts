import { describe, expect, it } from "vitest";
import type { RouteOption } from "../route/route";
import {
  backToOriginal,
  editPlan,
  EMPTY_MISSION,
  FILE_FORMAT,
  fileName,
  makeCurrent,
  moveLanding,
  planFrom,
  planFromJson,
  planFromQuery,
  planToJson,
  planToQuery,
  selectOption,
  startPlan,
  wholeHourUtc,
} from "./plan";
import { DEFAULT_PLAN, type MissionPlan } from "./types";

const PLAN: MissionPlan = {
  ...DEFAULT_PLAN,
  name: "Ridge lander",
  siteId: "a_haworth",
  landingUtc: "2027-03-01T12:00:00Z",
  slipMinDays: -7,
  slipMaxDays: 21,
  radiusKm: 150,
  mode: "energy",
  durationDays: 10,
};

const option = (p: Partial<RouteOption>): RouteOption => ({
  windowH: 336, windowClipped: false, sunH: 0, earthH: 0, bothH: 0, longestDarkH: 0, longestNoCommsH: 0,
  hoursToSunset: null, hoursToEarthset: null, sunsetBeyondData: false, earthsetBeyondData: false,
  sunUpAtLanding: false, earthUpAtLanding: false, siteId: "s", landingUtc: "2027-03-04T12:00:00.000Z",
  slipDays: 3, distanceKm: 42, tags: [], ...p,
});

describe("wholeHourUtc", () => {
  it("floors to the whole hour and writes ISO UTC", () => {
    expect(wholeHourUtc("2027-03-01T12:59:59Z")).toBe("2027-03-01T12:00:00Z");
    expect(wholeHourUtc("2027-03-01T12:30:00+02:00")).toBe("2027-03-01T10:00:00Z");
    expect(wholeHourUtc("not a date")).toBeNull();
  });
});

describe("link", () => {
  it("round-trips a plan through the query string", () => {
    const q = planToQuery(PLAN);
    expect(q).toBe("?site=a_haworth&t=2027-03-01T12%3A00Z&days=10&slip=-7..21&radius=150&mode=energy&name=Ridge+lander");
    expect(planFromQuery(q)).toEqual({ plan: PLAN, warnings: [] });
  });
  it("writes radius any for Infinity and keeps waypoints", () => {
    const p = { ...PLAN, radiusKm: Infinity, waypoints: [{ name: "Rim", lat: -89.5, lonE: 222.7, note: "look" }] };
    const q = planToQuery(p);
    expect(q).toContain("radius=any");
    expect(planFromQuery(q)!.plan).toEqual(p);
  });
  it("keeps unrelated parameters and removes the plan when it is null", () => {
    expect(planToQuery(PLAN, "?tab=x&site=old")).toMatch(/^\?tab=x&site=a_haworth/);
    expect(planToQuery(null, "?tab=x&site=a&t=2027-01-01T00Z&mode=energy")).toBe("?tab=x");
    expect(planToQuery(null, "?site=a")).toBe("");
  });
  it("needs a site and a valid time", () => {
    expect(planFromQuery("")).toBeNull();
    expect(planFromQuery("?site=a_haworth")).toBeNull();
    expect(planFromQuery("?t=2027-03-01T12:00Z")).toBeNull();
    expect(planFromQuery("?site=a_haworth&t=yesterday")).toBeNull();
  });
  it("reads a time without a zone as UTC and fills defaults", () => {
    const r = planFromQuery("?site=a_haworth&t=2027-03-01T12:45")!;
    expect(r.plan).toEqual({ ...DEFAULT_PLAN, siteId: "a_haworth", landingUtc: "2027-03-01T12:00:00Z" });
  });
  it("drops bad optional values to defaults with a warning", () => {
    const r = planFromQuery("?site=a&t=2027-03-01T12:00Z&days=0&slip=30..-14&radius=-5&mode=fast&wp=%5B1%5D")!;
    expect(r.plan).toEqual({ ...DEFAULT_PLAN, siteId: "a", landingUtc: "2027-03-01T12:00:00Z" });
    expect(r.warnings).toHaveLength(5);
    expect(planFromQuery("?site=a&t=2027-03-01T12:00Z&days=1.5&slip=abc&radius=x")!.warnings).toHaveLength(3);
  });
});

describe("default radius (#230)", () => {
  it("a new plan searches 150 km, not any distance", () => {
    expect(DEFAULT_PLAN.radiusKm).toBe(150);
    expect(startPlan("a", "2027-01-15T00:00:00Z").plan?.radiusKm).toBe(150);
    expect(planFromQuery("?site=a&t=2027-03-01T12:00Z")!.plan.radiusKm).toBe(150);
  });
  it("an explicit any in a link stays any", () => {
    expect(planFromQuery("?site=a&t=2027-03-01T12:00Z&radius=any")!.plan.radiusKm).toBe(Infinity);
    expect(planFromQuery("?site=a&t=2027-03-01T12:00Z&radius=")!.plan.radiusKm).toBe(Infinity);
  });
  it("an explicit null radius in a file stays any (D-007)", () => {
    const file = { format: FILE_FORMAT, siteId: "a", landingUtc: "2027-03-01T12:00:00Z", durationDays: 14, slipMinDays: -14, slipMaxDays: 30, radiusKm: null, mode: "balanced" };
    const r = planFromJson(JSON.stringify(file));
    expect("plan" in r && r.plan.radiusKm).toBe(Infinity);
  });
});

describe("JSON file", () => {
  it("round-trips a plan with the format tag and null for any distance", () => {
    const p = { ...PLAN, radiusKm: Infinity, waypoints: [{ name: "Rim", lat: -89.5, lonE: 222.7 }] };
    const text = planToJson(p);
    expect(JSON.parse(text)).toMatchObject({ format: FILE_FORMAT, radiusKm: null, siteId: "a_haworth" });
    expect(planFromJson(text)).toEqual({ plan: p });
    expect(planFromJson(planToJson(PLAN))).toEqual({ plan: PLAN });
  });
  it("names the export file after site and time", () => {
    expect(fileName(PLAN)).toBe("tilion-mission-a-haworth-2027-03-01-12h.json");
  });
  it("rejects a non-JSON file, a foreign format and an array", () => {
    expect(planFromJson("{oops")).toEqual({ error: "The file is not valid JSON." });
    expect(planFromJson('{"format":"other/1"}')).toMatchObject({ error: expect.stringContaining('expected "tilion-mission/1"') });
    expect(planFromJson("[]")).toMatchObject({ error: expect.stringContaining("not a mission") });
    expect(planFromJson("null")).toMatchObject({ error: expect.stringContaining("not a mission") });
  });
  it("lists every bad field", () => {
    const bad = {
      format: FILE_FORMAT, siteId: "", landingUtc: "2027-03-01", durationDays: 0, slipMinDays: 5, slipMaxDays: -5,
      radiusKm: -1, mode: "fast", waypoints: [{ name: "x", lat: 0, lonE: 400 }],
    };
    const r = planFromJson(JSON.stringify(bad));
    expect("error" in r).toBe(true);
    const e = (r as { error: string }).error;
    for (const k of ["siteId", "landingUtc", "durationDays", "slipMinDays is greater", "radiusKm", "mode", "lonE"]) {
      expect(e).toContain(k);
    }
  });
  it("rejects fractional days", () => {
    const r = planFromJson(planToJson(PLAN).replace('"durationDays": 10', '"durationDays": 1.5'));
    expect(r).toMatchObject({ error: expect.stringContaining("durationDays") });
  });
});

describe("state", () => {
  it("starts a plan with the default tolerances, floored to the hour", () => {
    const s = startPlan("a_haworth", "2027-01-15T07:30:00Z");
    expect(s.plan).toEqual({ ...DEFAULT_PLAN, siteId: "a_haworth", landingUtc: "2027-01-15T07:00:00Z" });
    expect(s.original).toBe(s.plan);
    expect(s.selected).toBeNull();
  });
  it("moveLanding moves the current plan, keeps the original and clears the selection", () => {
    const s0 = selectOption(startPlan("a", "2027-01-15T00:00:00Z"), option({}));
    const s1 = moveLanding(s0, "2027-01-20T05:40:00.000Z");
    expect(s1.plan!.landingUtc).toBe("2027-01-20T05:00:00Z");
    expect(s1.original!.landingUtc).toBe("2027-01-15T00:00:00Z");
    expect(s1.selected).toBeNull();
  });
  it("moveLanding ignores a missing plan, a bad time and the same hour", () => {
    expect(moveLanding(EMPTY_MISSION, "2027-01-20T00:00:00Z")).toBe(EMPTY_MISSION);
    const s = startPlan("a", "2027-01-15T00:00:00Z");
    expect(moveLanding(s, "nope")).toBe(s);
    expect(moveLanding(s, "2027-01-15T00:20:00Z")).toBe(s);
  });
  it("makeCurrent takes site and date of the option; back to original restores it", () => {
    const s0 = startPlan("a", "2027-01-15T00:00:00Z");
    const s1 = makeCurrent(s0, option({ siteId: "b", landingUtc: "2027-01-18T00:00:00.000Z" }));
    expect(s1.plan).toMatchObject({ siteId: "b", landingUtc: "2027-01-18T00:00:00Z", mode: "balanced" });
    expect(s1.original).toBe(s0.plan);
    expect(s1.selected).toBeNull();
    const s2 = makeCurrent(s1, option({ siteId: "c" }));
    expect(s2.original).toBe(s0.plan);
    expect(backToOriginal(s2).plan).toBe(s0.plan);
  });
  it("planFrom starts a new original at the site and keeps the tolerances", () => {
    const s0 = editPlan(startPlan("a", "2027-01-15T00:00:00Z"), { mode: "comms", radiusKm: 50 });
    const s1 = planFrom(s0, "b", "2027-02-01T03:00:00Z");
    expect(s1.plan).toMatchObject({ siteId: "b", landingUtc: "2027-02-01T03:00:00Z", mode: "comms", radiusKm: 50 });
    expect(s1.original).toBe(s1.plan);
    expect(planFrom(EMPTY_MISSION, "b", "2027-02-01T03:00:00Z").plan!.mode).toBe("balanced");
  });
  it("editPlan clears the selection and keeps the original", () => {
    const s0 = selectOption(startPlan("a", "2027-01-15T00:00:00Z"), option({}));
    const s1 = editPlan(s0, { mode: "comms" });
    expect(s1.plan!.mode).toBe("comms");
    expect(s1.original!.mode).toBe("balanced");
    expect(s1.selected).toBeNull();
    expect(editPlan(EMPTY_MISSION, { mode: "comms" })).toBe(EMPTY_MISSION);
  });
});
