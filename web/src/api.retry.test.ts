import { afterEach, describe, expect, it, vi } from "vitest";
import { loadFullTimeline, loadVariants } from "./api";
import type { Site } from "./contracts";

const site = (id: string): Site => ({
  id, name: id, group: "ridge", status: "", kind: "point", lat: -89, lonE: 10,
  elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("failed load is not cached", () => {
  it.each([
    ["timeline", (s: Site) => loadFullTimeline(s)],
    ["variants", (s: Site) => loadVariants(s)],
  ] as const)("asks the network again for %s after one failure", async (name, load) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const body = { siteId: `retry-${name}` };
    let calls = 0;
    vi.stubGlobal("fetch", () => {
      calls++;
      return Promise.resolve(calls === 1 ? { ok: false, status: 503 } : { ok: true, status: 200, json: async () => body });
    });
    const s = site(`retry-${name}`);
    expect(await load(s)).toBeNull();
    expect(await load(s)).toEqual(body);
    expect(calls).toBe(2);
    expect(await load(s)).toEqual(body);
    expect(calls).toBe(2);
  });
});
