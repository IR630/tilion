import { afterEach, describe, expect, it, vi } from "vitest";
import { expandFlips, loadFullTimeline, loadMask, loadTimeline, loadVariants, sliceRange } from "./api";
import type { Site, Timeline, VisibilityVariants } from "./contracts";
import { summarize } from "./summary";

const site = (id: string): Site => ({
  id, name: id, group: "ridge", status: "", kind: "point", lat: -89.4, lonE: 222.8,
  elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
});

const N = 24 * 40; // 40 days hourly from 2027-01-01
const full: Timeline = {
  siteId: "x",
  startUtc: "2027-01-01T00:00:00Z",
  stepMin: 60,
  sunAz: Array.from({ length: N }, (_, i) => i),
  sunEl: Array.from({ length: N }, (_, i) => i / 100),
  sunVisible: Array.from({ length: N }, (_, i) => (i < 100 ? 1 : 0)),
  earthAz: Array.from({ length: N }, () => 0),
  earthEl: Array.from({ length: N }, () => 5),
  earthVisible: Array.from({ length: N }, () => 1),
  dsnVisible: Array.from({ length: N }, (_, i) => i % 2),
};
const variants: VisibilityVariants = {
  siteId: "x",
  startUtc: full.startUtc,
  stepMin: 60,
  n: N,
  ref: { heightM: 2, dem: "80+240" },
  variants: [
    { heightM: 0, dem: "80+240", sun: [0, 80], earth: [0] },
    { heightM: 10, dem: "80+240", sun: [0, 120], earth: [0] },
  ],
};

function serve(files: Record<string, unknown>) {
  vi.stubGlobal("fetch", async (url: string) => {
    const key = Object.keys(files).find((k) => url.endsWith(k));
    return key ? { ok: true, json: async () => files[key] } : { ok: false, json: async () => null };
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("loadTimeline 30-day slice", () => {
  it("starts at the first step at or after startUtc and has 30 days of steps", async () => {
    serve({ "timeline/s1.json": full });
    const tl = await loadTimeline(site("s1"), "2027-01-02T00:30:00Z");
    expect(tl.stub).toBeUndefined();
    expect(tl.startUtc).toBe("2027-01-02T01:00:00.000Z");
    expect(tl.sunAz.length).toBe(30 * 24);
    expect(tl.sunAz[0]).toBe(25);
    expect(tl.sunAz.at(-1)).toBe(25 + 30 * 24 - 1);
    expect(tl.dsnVisible).toEqual(full.dsnVisible!.slice(25, 25 + 30 * 24));
  });
  it("exact start and the last full window are in range", async () => {
    serve({ "timeline/s2.json": full });
    expect((await loadTimeline(site("s2"), "2027-01-01T00:00:00Z")).sunAz[0]).toBe(0);
    const last = await loadTimeline(site("s2"), "2027-01-11T00:00:00Z");
    expect(last.stub).toBeUndefined();
    expect(last.sunAz.at(-1)).toBe(N - 1);
  });
  it("out of range or missing file -> stub", async () => {
    serve({ "timeline/s3.json": full });
    expect((await loadTimeline(site("s3"), "2026-12-31T00:00:00Z")).stub).toBe(true);
    expect((await loadTimeline(site("s3"), "2027-02-10T00:00:00Z")).stub).toBe(true);
    expect((await loadTimeline({ ...site("nolat"), lat: null }, "2027-01-02T00:00:00Z")).stub).toBe(true);
  });
  it("a failed load of a real site throws, not mock (#440)", async () => {
    serve({});
    await expect(loadTimeline(site("nofile"), "2027-01-02T00:00:00Z")).rejects.toThrow(/nofile/);
  });
  it("attaches the variant series on the same index and summarize gives min–max", async () => {
    serve({ "timeline/s4.json": full, "variants/s4.json": variants });
    const tl = await loadTimeline(site("s4"), "2027-01-01T00:00:00Z");
    expect(tl.variantSunLit?.length).toBe(2);
    expect(tl.variantSunLit?.[0].length).toBe(30 * 24);
    const m = summarize(tl, "2027-01-01T00:00:00Z");
    expect(m.hoursToSunset).toEqual({ value: 100, lo: 80, hi: 120 });
    expect(m.lightFraction.lo).toBeCloseTo(80 / 720);
    expect(m.lightFraction.hi).toBeCloseTo(120 / 720);
    expect(m.earthFraction).toEqual({ value: 1, lo: 1, hi: 1 });
  });
  it("keeps real samples through the end of December 2027", async () => {
    serve({ "timeline/dec.json": { ...full, startUtc: "2027-11-22T00:00:00Z" } });
    const tl = await loadTimeline(site("dec"), "2027-12-15T00:00:00Z");
    expect(tl.stub).toBeUndefined();
    expect(tl.sunAz).toHaveLength(17 * 24);
    expect(tl.sunAz[0]).toBe(23 * 24);
    expect(tl.sunAz.at(-1)).toBe(N - 1);
    expect(tl.earthVisible).toHaveLength(17 * 24);
  });
});

describe("load failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects a missing mask and logs its path and HTTP status", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 503 }));
    await expect(loadMask(site("broken"))).rejects.toThrow(/mask/i);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("mask/broken.json"), 503);
  });

  it.each(["network", "json"])("retries validation after a %s failure", async (kind) => {
    vi.resetModules();
    const { loadValidation } = await import("./api");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error(kind);
    vi.stubGlobal("fetch", async () => {
      if (kind === "network") throw failure;
      return { ok: true, status: 200, json: async () => { throw failure; } };
    });
    expect(await loadValidation()).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("validation.json"), kind === "json" ? 200 : "network error", failure);
    serve({ "validation.json": { generatedUtc: "2027-01-01T00:00:00Z" } });
    expect(await loadValidation()).toEqual({ generatedUtc: "2027-01-01T00:00:00Z" });
  });
});

describe("loadFullTimeline cache", () => {
  it("fetches a site file once for any number of time steps", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      return url.endsWith("timeline/c1.json") ? { ok: true, json: async () => full } : { ok: false, json: async () => null };
    });
    expect((await loadFullTimeline(site("c1")))?.sunAz.length).toBe(N);
    for (let h = 0; h < 5; h++) await loadTimeline(site("c1"), `2027-01-02T0${h}:00:00Z`);
    expect(calls.filter((u) => u.endsWith("timeline/c1.json")).length).toBe(1);
    expect(await loadFullTimeline(site("c2"))).toBeNull();
  });
});

describe("helpers", () => {
  it("expandFlips", () => {
    expect(expandFlips([2, 4], 0, 6)).toEqual([0, 0, 1, 1, 0, 0]);
    expect(expandFlips([2, 4], 3, 3)).toEqual([1, 0, 0]);
    expect(expandFlips([], 0, 2)).toEqual([0, 0]);
  });
  it("sliceRange rejects NaN dates", () => {
    expect(sliceRange("2027-01-01T00:00:00Z", 60, 10, "bad", 0.1)).toBeNull();
  });
});

describe("loadVariants (#233)", () => {
  it("does not request a file for a custom point: there is none, a 404 is console noise", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await loadVariants(site("custom--76.0128-75.1864"))).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});
