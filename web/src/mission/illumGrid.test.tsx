import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

it.each(["meta", "grid"])("reports a failed PGDA %s load and allows a retry", async (failedFile) => {
  const { WaypointList } = await import("./WaypointList");
  const { loadIllumGrids } = await import("./illumGrid");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let failed = false;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.endsWith(failedFile === "meta" ? "meta.json" : "sun.bin") && !failed) {
      failed = true;
      return new Response(null, { status: 503 });
    }
    return url.endsWith("meta.json")
      ? Response.json({ grids: [{ id: "sun", kind: "sun", file: "sun.bin", size: 1, bounds: [-500, -500, 500, 500], cellM: 1000 }] })
      : new Response(new Uint8Array([75]));
  });
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () => root.render(<WaypointList waypoints={[{ name: "Pole", lat: -90, lonE: 0 }]}
      from={null} onMission={() => {}} addMode={false} onAddMode={() => {}} />));
    expect(el.textContent).toContain("grids failed to load");
    expect(el.querySelector(".wp-nodata")).toBeNull();
    expect((await loadIllumGrids())[0].data[0]).toBe(75);
  } finally { await act(async () => root.unmount()); }
});
