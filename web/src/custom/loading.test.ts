// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import type { CustomReply, CustomRequest } from "./worker";
import { customSite } from "../screens/PolarMap";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each(["meta.json", "ephem.bin"])("retries a custom point after %s fails once", async (failedFile) => {
  const ctx = { onmessage: (_: MessageEvent<CustomRequest>) => {}, postMessage: (_: CustomReply) => {} };
  vi.stubGlobal("self", ctx);
  await import("./worker");
  vi.stubGlobal("Worker", class {
    onmessage = (_: MessageEvent<CustomReply>) => {};
    postMessage(data: CustomRequest) {
      ctx.postMessage = (reply) => this.onmessage({ data: reply } as MessageEvent<CustomReply>);
      ctx.onmessage({ data } as MessageEvent<CustomRequest>);
    }
  });
  let failed = false;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith(failedFile) && !failed) { failed = true; throw new Error("offline"); }
    if (url.endsWith("meta.json")) return Response.json({
      startUtc: "2027-01-01T00:00:00Z", stepMin: 60, n: 1, frame: "MOON_ME", abcorr: "LT+S",
      ephemFile: "ephem.bin", sunRadiusKm: 695700, earthRadiusKm: 6378,
    });
    return new Response(new Float32Array([1e8, 0, 0, 300000, 0, 0]).buffer);
  });
  const { computeCustomSite } = await import("./client");
  const site = customSite(-30, 10);
  await expect(computeCustomSite(site, "https://test/custom/")).rejects.toThrow("offline");
  const result = await computeCustomSite(site, "https://test/custom/");
  expect(result.timeline.sunEl).toHaveLength(1);
  expect(result.timeline.siteId).toBe(site.id);
  expect((await computeCustomSite(customSite(-31, 10), "https://test/custom/")).timeline.sunEl).toHaveLength(1);
});
