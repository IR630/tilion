import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Site } from "../contracts";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

// #372: a polar site needs only the finest covering grids; the coarse 65°S pair (2 MB) delayed the row by seconds.
it("loads only the finest grids that cover the site", async () => {
  const { NearbyRow, useNearby } = await import("./NearbySpot");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const grid = (id: string, kind: string, half: number) => ({ id, kind, file: `${id}.bin`, size: 1, bounds: [-half, -half, half, half], cellM: 2 * half });
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return url.endsWith("meta.json")
      ? Response.json({ grids: [grid("sun85", "sun", 500), grid("earth85", "earth", 500), grid("sun65", "sun", 5000), grid("earth65", "earth", 5000)] })
      : new Response(new Uint8Array([75]));
  });
  function Row() {
    return <NearbyRow result={useNearby({ id: "pole", lat: -90, lonE: 0 } as Site)} onOpen={() => {}} />;
  }
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () => root.render(<Row />));
    expect(el.textContent).toContain("Site is the brightest cell within 2 km");
    expect(urls.map((u) => u.split("/").pop()).sort()).toEqual(["earth85.bin", "meta.json", "sun85.bin"]);
  } finally { await act(async () => root.unmount()); }
});
