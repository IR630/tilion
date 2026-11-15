import { afterEach, describe, expect, it, vi } from "vitest";
import { loadSites } from "./api";
import type { Site } from "./contracts";
import type { GlobeMeta } from "./globe/geo";
import { loadGlobe } from "./screens/Globe";
import { loadTile } from "./screens/Terrain3D";

const site: Site = {
  id: "timeout", name: "Timeout", group: "ridge", status: "", kind: "point", lat: -89, lonE: 10,
  elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
};
const meta: GlobeMeta = {
  refRadiusKm: 1737.4,
  color: { file: "color.jpg", width: 2, height: 1 },
  height: { file: "height.bin", width: 1, height: 1, scaleM: 1, offsetM: 0, minM: 0, maxM: 0 },
  southPatch: { file: "patch.bin", size: 1, extentM: 100, latEdgeDeg: -80, scaleM: 1, offsetM: 0, minM: 0, maxM: 0 },
  sources: {},
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetch timeout", () => {
  it.each([
    ["sites.json", loadSites, 15],
    ["terrain/timeout.json", () => loadTile(site), 15],
    ["terrain/timeout.bin", () => loadTile(site), 15],
    ["globe/meta.json", loadGlobe, 60],
    ["globe/height.bin", loadGlobe, 60],
    ["globe/patch.bin", loadGlobe, 60],
    ["globe/subpoints.json", loadGlobe, 60],
  ] as const)("ends a stalled %s request after %i seconds with its path", async (path, load, seconds) => {
    vi.useFakeTimers();
    // Node's AbortSignal uses an internal timer that Vitest cannot advance.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", (url: string, options?: RequestInit) => {
      if (!url.endsWith(path)) {
        return Promise.resolve({ ok: true, json: async () => meta });
      }
      return new Promise((_, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      });
    });
    let error: unknown;
    const result = load().catch((e: unknown) => { error = e; });
    await vi.advanceTimersByTimeAsync(seconds * 1000 - 1);
    expect(error).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain(path);
    await result;
    if (path === "sites.json") {
      expect(log).toHaveBeenCalledWith(expect.stringContaining(path), "network error", expect.objectContaining({ name: "TimeoutError" }));
    }
  });
});
