import { describe, expect, it, vi } from "vitest";
import type { Site } from "./contracts";

// #424: the worker posts String(e), the client wraps it in new Error: "Error: no DEM under the site …".
vi.mock("./custom/client", async (orig) => ({
  ...(await orig<typeof import("./custom/client")>()),
  computeCustomSite: () => Promise.reject(new Error("Error: no DEM under the site 10E -31")),
}));
const { loadFullTimeline, loadMask, loadTimeline } = await import("./api");

const custom = (id: string): Site => ({
  id, name: id, group: "ridge", status: "", kind: "point", lat: -31, lonE: 10, elevM: null, source: "", confidence: "low", terrain: "polar80", note: "",
});

describe("custom point failure keeps its cause (#424)", () => {
  it("rejects the mask and the timeline with the worker's reason, not a null", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s = custom("custom--31-10");
    await expect(loadMask(s)).rejects.toThrow("Horizon mask unavailable for custom--31-10: no DEM under the site 10E -31");
    await expect(loadFullTimeline(s)).rejects.toThrow(/^no DEM under the site 10E -31$/);
    // #440: the period slice rejects too; mock is only for lat === null or a date outside the data.
    await expect(loadTimeline(s, "2027-01-01T00:00:00Z", 1)).rejects.toThrow(/no DEM under the site/);
  });
});
