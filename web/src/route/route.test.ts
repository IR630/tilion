import { afterEach, describe, expect, it, vi } from "vitest";
import type { Site } from "../contracts";
import { decodeHours, encodeCodes, hoursLoader, resetHoursCache, type Hours } from "./hours";
import {
  DEFAULT_OPTIONS,
  MOON_RADIUS_KM,
  TAG_LABEL,
  dayStrip,
  distanceKm,
  findRoutes,
  metricsAt,
  pickDiverse,
  rankByScore,
  rankOptions,
  tieDeciders,
  type Options,
  type RouteOption,
} from "./route";

const START = "2027-01-01T00:00:00Z";
const at = (h: number) => new Date(Date.parse(START) + h * 3_600_000).toISOString();
const hrs = (sites: Record<string, string>, n?: number): Hours =>
  decodeHours({ startUtc: START, stepMin: 60, n: n ?? Object.values(sites)[0].length, sites });

const site = (id: string, lat: number | null, lonE: number | null): Site => ({
  id, name: id, group: "ridge", status: "", kind: "point", lat, lonE,
  elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
});

const opt = (p: Partial<RouteOption>): RouteOption => ({
  windowH: 336, sunH: 0, earthH: 0, bothH: 0, longestDarkH: 0, longestNoCommsH: 0,
  windowClipped: false, hoursToSunset: null, hoursToEarthset: null, sunsetBeyondData: false,
  earthsetBeyondData: false, sunUpAtLanding: false, earthUpAtLanding: false,
  siteId: "s", landingUtc: START, slipDays: 0, distanceKm: 0, tags: [], ...p,
});

describe("decode", () => {
  it("decodes codes into prefix sums", () => {
    const h = hrs({ a: "0123" });
    const s = h.sites.get("a")!;
    expect([...s.codes]).toEqual([0, 1, 2, 3]);
    expect([...s.sunPre]).toEqual([0, 0, 1, 1, 2]);
    expect([...s.earthPre]).toEqual([0, 0, 0, 1, 2]);
    expect([...s.bothPre]).toEqual([0, 0, 0, 0, 1]);
    expect([...s.sunLoss]).toEqual([0, 2, 2, 4]);
    expect([...s.earthLoss]).toEqual([0, 1, 4, 4]);
  });
  it("throws on a code string of the wrong length instead of reading it as darkness", () => {
    expect(() => hrs({ a: "0123", b: "01" }, 4)).toThrow(/site b has 2 codes, expected 4/);
    expect(() => hrs({ a: "01234" }, 4)).toThrow(/expected 4/);
  });
  it("throws on a bad character", () => {
    expect(() => hrs({ a: "01x3" })).toThrow(/bad code "x" at step 2/);
    expect(() => hrs({ a: "0149" })).toThrow(/bad code "4"/);
    expect(() => decodeHours({ startUtc: START, stepMin: 60, n: 1, sites: { a: 7 as unknown as string } })).toThrow();
  });
  it("throws on a bad step count", () => {
    expect(() => decodeHours({ startUtc: START, stepMin: 60, n: -1, sites: {} })).toThrow(/bad n/);
  });
  it("encodes timeline series in the D-006 format", () => {
    expect(encodeCodes([0, 0.5, 0, 1], [0, 0, 1, 1])).toBe("0123");
  });
});

describe("metricsAt", () => {
  // 1 day window = 24 h. Hours: 0-3 both, 4-9 Sun only, 10-19 none, 20-23 Earth only, then both.
  const series = "3333" + "111111" + "0000000000" + "2222" + "3".repeat(24);
  const h = hrs({ a: series });

  it("sums Sun, Earth and both hours in the window", () => {
    const m = metricsAt(h, "a", START, 1)!;
    expect(m).toMatchObject({ windowH: 24, sunH: 10, earthH: 8, bothH: 4 });
  });
  it("finds the longest dark and no-comms runs inside the window only", () => {
    const m = metricsAt(h, "a", START, 1)!;
    expect(m.longestDarkH).toBe(14); // hours 10..23
    expect(m.longestNoCommsH).toBe(16); // hours 4..19
  });
  it("counts hours to sunset and Earthset from landing", () => {
    const m = metricsAt(h, "a", START, 1)!;
    expect(m.sunUpAtLanding).toBe(true);
    expect(m.hoursToSunset).toBe(10);
    expect(m.hoursToEarthset).toBe(4);
  });
  it("gives null hours to sunset when the Sun is down at landing", () => {
    const m = metricsAt(h, "a", at(12), 1)!;
    expect(m.sunUpAtLanding).toBe(false);
    expect(m.hoursToSunset).toBeNull();
    expect(m.earthUpAtLanding).toBe(false);
    expect(m.hoursToEarthset).toBeNull();
  });
  it("searches the sunset past the window end; never lost = hours to the data end, flagged", () => {
    const m = metricsAt(h, "a", at(4), 0.25)!;
    expect(m.hoursToSunset).toBe(6); // window 6 h, sunset at 10
    expect(m.sunsetBeyondData).toBe(false);
    const late = metricsAt(h, "a", at(24), 1)!;
    expect(late.hoursToSunset).toBe(24); // Sun up to the data end: a lower bound
    expect(late.sunsetBeyondData).toBe(true);
    expect(late.earthsetBeyondData).toBe(true);
    expect(metricsAt(h, "a", START, 1)!.earthsetBeyondData).toBe(false);
  });
  it("never flags a sunset beyond the data when the Sun is down", () => {
    const m = metricsAt(hrs({ a: "0000" }), "a", START, 1)!;
    expect(m.sunsetBeyondData).toBe(false);
    expect(m.earthsetBeyondData).toBe(false);
  });
  it("clips the window at the data end and flags it", () => {
    const m = metricsAt(h, "a", at(40), 1)!;
    expect(m.windowH).toBe(8);
    expect(m.windowClipped).toBe(true);
    expect(m.bothH).toBe(8);
    expect(metricsAt(h, "a", at(24), 1)!.windowClipped).toBe(false);
  });
  it("uses the step that contains a landing between grid points", () => {
    expect(metricsAt(h, "a", "2027-01-01T03:59:00Z", 1)!.hoursToEarthset).toBe(1);
  });
  it("returns null for an unknown site or a landing outside the data", () => {
    expect(metricsAt(h, "x", START, 1)).toBeNull();
    expect(metricsAt(h, "a", at(-1), 1)).toBeNull();
    expect(metricsAt(h, "a", at(48), 1)).toBeNull();
  });
});

describe("dayStrip", () => {
  it("gives per-day sums and clips days outside the data", () => {
    const h = hrs({ a: "1".repeat(24) + "3".repeat(12) });
    const d = dayStrip(h, "a", at(-24), 4);
    expect(d.map((x) => [x.hours, x.sunH, x.earthH, x.bothH])).toEqual([
      [0, 0, 0, 0],
      [24, 24, 0, 0],
      [12, 12, 12, 12],
      [0, 0, 0, 0],
    ]);
    expect(d[1].dayUtc).toBe(START.replace("Z", ".000Z"));
  });
});

describe("distanceKm", () => {
  it("uses a great circle on the lunar sphere", () => {
    expect(distanceKm(-90, 0, 0, 123)).toBeCloseTo((Math.PI / 2) * MOON_RADIUS_KM, 6);
    expect(distanceKm(-89, 0, -89, 180)).toBeCloseTo((2 * Math.PI / 180) * MOON_RADIUS_KM, 6);
    expect(distanceKm(-85, 10, -85, 10)).toBe(0);
  });
});

describe("rankOptions", () => {
  it("sorts by the primary metric of each mode", () => {
    const a = opt({ siteId: "a", sunH: 300, earthH: 100, bothH: 90 });
    const b = opt({ siteId: "b", sunH: 200, earthH: 300, bothH: 150 });
    const c = opt({ siteId: "c", sunH: 250, earthH: 200, bothH: 180 });
    const ids = (mode: Options["mode"]) => rankOptions([a, b, c], mode).map((o) => o.siteId);
    expect(ids("energy")).toEqual(["a", "c", "b"]);
    expect(ids("comms")).toEqual(["b", "c", "a"]);
    expect(ids("balanced")).toEqual(["c", "b", "a"]);
  });
  it("treats values within 1 % as equal: smaller |slip| wins, then smaller distance", () => {
    const far = opt({ siteId: "far", sunH: 300, slipDays: 0, distanceKm: 50 });
    const slipped = opt({ siteId: "slip", sunH: 302, slipDays: -3 }); // 300 >= 302 * 0.99
    const near = opt({ siteId: "near", sunH: 299, slipDays: 0, distanceKm: 10 });
    const worse = opt({ siteId: "worse", sunH: 280, slipDays: 0, distanceKm: 0 });
    expect(rankOptions([worse, slipped, far, near], "energy").map((o) => o.siteId)).toEqual([
      "near", "far", "slip", "worse",
    ]);
  });
  it("does not tie values more than 1 % apart", () => {
    const hi = opt({ siteId: "hi", earthH: 100, slipDays: 20 });
    const lo = opt({ siteId: "lo", earthH: 98.9, slipDays: 0 });
    expect(rankOptions([lo, hi], "comms").map((o) => o.siteId)).toEqual(["hi", "lo"]);
  });
});

describe("rankByScore", () => {
  it("puts the higher route score first and ties scores within 1 point by |slip|", () => {
    const lit = opt({ siteId: "lit", sunH: 336, earthH: 200, longestNoCommsH: 100, hoursToSunset: 336, slipDays: 9 });
    const dark = opt({ siteId: "dark", sunH: 100, earthH: 336, longestDarkH: 120, hoursToSunset: null });
    const twin = opt({ siteId: "twin", sunH: 335, earthH: 200, longestNoCommsH: 100, hoursToSunset: 336, slipDays: 1 });
    expect(rankByScore([dark, lit, twin], "balanced").map((o) => o.siteId)).toEqual(["twin", "lit", "dark"]);
    expect(rankByScore([lit, dark], "comms").map((o) => o.siteId)).toEqual(["lit", "dark"]);
  });
});

// #204: four of five options said "score 100" on the map. The terms are shares capped at 1, so a
// window with Sun and Earth all the time scores 100 at every good site. The tie-breaker must show.
describe("tieDeciders", () => {
  const full = { sunH: 336, earthH: 336, hoursToSunset: 400 };
  it("names the slip, then the distance, as what ranks options that tie on score", () => {
    const a = opt({ ...full, siteId: "a", slipDays: -9, distanceKm: 30 });
    const b = opt({ ...full, siteId: "b", slipDays: -11, distanceKm: 10 });
    const c = opt({ ...full, siteId: "c", slipDays: 11, distanceKm: 20 });
    const d = opt({ siteId: "d", sunH: 100, earthH: 100, longestDarkH: 120, longestNoCommsH: 200 });
    const ranked = rankByScore([d, c, b, a], "balanced");
    expect(ranked.map((o) => o.siteId)).toEqual(["a", "b", "c", "d"]);
    expect(tieDeciders(ranked, "balanced")).toEqual(["slip", "slip", "distance", null]);
  });
  it("gives no decider without a tie", () => {
    expect(tieDeciders([opt({ ...full }), opt({ sunH: 100 })], "balanced")).toEqual([null, null]);
  });
});

describe("pickDiverse", () => {
  const ranked = [
    opt({ siteId: "a", slipDays: 1 }), opt({ siteId: "a", slipDays: 2 }), opt({ siteId: "a", slipDays: 3 }),
    opt({ siteId: "b", slipDays: 1 }), opt({ siteId: "b", slipDays: 2 }), opt({ siteId: "c", slipDays: 1 }),
    opt({ siteId: "p", slipDays: 5 }), opt({ siteId: "p", slipDays: 6 }),
  ];
  it("keeps at most 2 dates per site", () => {
    const k = (o: RouteOption) => `${o.siteId}${o.slipDays}`;
    expect(pickDiverse(ranked, "a", 4).map(k)).toEqual(["a1", "a2", "b1", "b2"]);
  });
  it("always keeps the best date of the plan site", () => {
    const k = (o: RouteOption) => `${o.siteId}${o.slipDays}`;
    expect(pickDiverse(ranked, "p", 4).map(k)).toEqual(["a1", "a2", "b1", "p5"]);
    expect(pickDiverse(ranked, "p", 10).map(k)).toEqual(["a1", "a2", "b1", "b2", "c1", "p5", "p6"]);
  });
});

describe("findRoutes", () => {
  // 5 days hourly. Plan site "p" is dark; "q" (close) has Sun from day 2; "r" (far) is always lit.
  const D = 24;
  const h = hrs({
    p: "0".repeat(5 * D),
    q: "0".repeat(2 * D) + "3".repeat(3 * D),
    r: "1".repeat(5 * D),
    nocoord: "3".repeat(5 * D),
  });
  const sites = [site("p", -89, 0), site("q", -88.9, 0), site("r", -85, 90), site("nocoord", null, null), site("nodata", -89, 1)];
  const plan = { siteId: "p", landingUtc: at(D + 6) }; // day 1, 06:00
  const base: Options = { ...DEFAULT_OPTIONS, slipMinDays: -1, slipMaxDays: 2, windowDays: 1, mode: "energy" };

  it("returns plan metrics and ranked, tagged options", () => {
    const { plan: p, options } = findRoutes(h, sites, plan, base);
    expect(p).toMatchObject({ siteId: "p", slipDays: 0, sunH: 0, tags: ["on-plan"] });
    // 24 h of Sun: r at every slip, q at slips 1 and 2. In that tie group |slip| decides,
    // then distance (q is closer than r). r1 and r2 drop out: max 2 dates per site.
    expect(options.map((o) => `${o.siteId}${o.slipDays}`)).toEqual(["r0", "q1", "r-1", "q2", "p0", "p-1"]);
    expect(options.map((o) => o.tags)).toEqual([["best", "no-slip"], ["nearest"], [], ["nearest"], ["on-plan"], []]);
    expect(options.some((o) => o.siteId === "nocoord" || o.siteId === "nodata")).toBe(false);
  });
  it("labels the nearest tag as relative to the options shown", () => {
    expect(TAG_LABEL.nearest).toBe("nearest of those shown");
  });
  it("flags a plan window cut by the data end; options keep full windows", () => {
    const late = { siteId: "p", landingUtc: at(4 * D + 6) }; // 18 h left in the data
    const { plan: p, options } = findRoutes(h, sites, late, { ...base, slipMinDays: -3, slipMaxDays: 0 });
    expect(p).toMatchObject({ windowH: 18, windowClipped: true });
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) expect(o).toMatchObject({ windowH: 24, windowClipped: false });
  });
  it("uses the same time of day for every slip", () => {
    const { options } = findRoutes(h, sites, plan, base, 20);
    for (const o of options) expect(o.landingUtc.slice(11, 13)).toBe("06");
  });
  it("discards candidates whose window leaves the data", () => {
    const { options } = findRoutes(h, sites, plan, { ...base, slipMinDays: -5, slipMaxDays: 9 }, 50);
    // Landing = day (1 + slip) 06:00; window 24 h; data 120 h → only slips -1..2 fit.
    const slips = options.map((o) => o.slipDays);
    expect(Math.min(...slips)).toBe(-1);
    expect(Math.max(...slips)).toBe(2);
  });
  it("filters sites by the search radius", () => {
    const { options } = findRoutes(h, sites, plan, { ...base, radiusKm: 10 }, 20);
    expect(new Set(options.map((o) => o.siteId))).toEqual(new Set(["p", "q"]));
    expect(options.every((o) => o.distanceKm <= 10)).toBe(true);
  });
  it("ranks by Earth hours in comms mode", () => {
    const { options } = findRoutes(h, sites, plan, { ...base, mode: "comms" });
    expect(options[0]).toMatchObject({ siteId: "q", slipDays: 1, earthH: 24 });
  });
  it("ranks by the route score when asked (#160)", () => {
    const { options } = findRoutes(h, sites, plan, { ...base, mode: "balanced", rank: "score" });
    // q at slip 1/2 has Sun and Earth all day; r has Sun only: q wins on comms.
    expect(options[0]).toMatchObject({ siteId: "q", slipDays: 1 });
  });
  it("returns no plan for an unknown site, a site without data or a landing outside the data", () => {
    expect(findRoutes(h, sites, { siteId: "zz", landingUtc: START }, base).plan).toBeNull();
    expect(findRoutes(h, sites, { siteId: "nodata", landingUtc: START }, base).plan).toBeNull();
    expect(findRoutes(h, sites, { siteId: "p", landingUtc: at(-5) }, base)).toEqual({ plan: null, options: [] });
  });
});

describe("hoursLoader", () => {
  afterEach(() => resetHoursCache());
  it("fetches hours.json once and decodes it", async () => {
    const body = { startUtc: START, stepMin: 60, n: 2, sites: { a: "31" } };
    const f = vi.fn(async () => new Response(JSON.stringify(body)));
    const [x, y] = await Promise.all([hoursLoader(f), hoursLoader(f)]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown[])[0])).toMatch(/data\/hours\.json$/);
    expect(x).toBe(y);
    expect(x.sites.get("a")!.sunPre[2]).toBe(2);
  });
  it("does not cache a failed fetch", async () => {
    const bad = vi.fn(async () => new Response("", { status: 404 }));
    await expect(hoursLoader(bad)).rejects.toThrow("404");
    const good = vi.fn(async () => new Response(JSON.stringify({ startUtc: START, stepMin: 60, n: 1, sites: {} })));
    await expect(hoursLoader(good)).resolves.toMatchObject({ n: 1 });
  });
});
