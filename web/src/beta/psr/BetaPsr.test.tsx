import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Site } from "../../contracts";
import { BetaPsr } from "./BetaPsr";
import { compass, fmtArea, fmtKm, hatch, type PsrFile, psrLine, toMapUnits } from "./psr";

const FILE: PsrFile = {
  label: "cold-trap candidate (PGDA 69, never lit in 18.6 yr)",
  definition: "PGDA 69 AVGVISIB pixel = 0",
  source: "https://pgda.gsfc.nasa.gov/products/69",
  grids: [{ id: "60m", file: "AVGVISIB_85S_060M_201608.TIF", coverage: "85-90 S", minPatchKm2: 0.1, patches: 2467, patchAreaKm2: 9306 }],
  sites: {
    shackleton_rim: {
      grid: "60m",
      distanceKm: 2.44,
      areaKm2: 234.41,
      bearingDeg: 246.3,
      patch: "60m-1405",
      nearest: { lat: -89.803, lonE: 182.0 },
      centroid: { lat: -89.6455, lonE: 128.2 },
    },
  },
};
const site = (id: string, lat: number | null): Site => ({ id, name: id, lat, lonE: lat === null ? null : 204 }) as unknown as Site;

describe("BETA cold-trap helpers", () => {
  it("formats the card line with distance, compass and area", () => {
    expect(psrLine(FILE.sites.shackleton_rim)).toBe("2.4 km SW, 234 km²");
    expect(fmtKm(0.76)).toBe("760 m");
    expect(fmtArea(0.14)).toBe("0.14 km²");
    expect(fmtArea(3.76)).toBe("3.8 km²");
    expect(compass(359)).toBe("N");
    expect(psrLine({ ...FILE.sites.shackleton_rim, distanceKm: 0, bearingDeg: null })).toContain("inside");
  });

  it("converts metres to map units and builds a tiling hatch", () => {
    const g = toMapUnits({
      type: "FeatureCollection",
      features: [{ type: "Feature", properties: { id: "a", areaKm2: 1 }, geometry: { type: "Polygon", coordinates: [[[1000, -2000], [0, 0]]] } }],
    });
    expect(g.features[0].geometry.coordinates[0][0]).toEqual([0.001, -0.002]);
    const h = hatch();
    expect(h.data.length).toBe(h.width * h.height * 4);
  });
});

describe("BetaPsr in the place card", () => {
  let el: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(FILE))));
    document.body.innerHTML = '<article class="place-card" aria-label="Place card"><dl class="place-facts"></dl><div class="nasa"></div></article>';
    el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("puts one labelled BETA line after the facts list, not called ice", async () => {
    await act(async () => root.render(<BetaPsr map={null} site={site("shackleton_rim", -89.78)} />));
    await act(async () => {});
    const card = document.querySelector(".place-card .beta-psr-card")!;
    expect(card).not.toBeNull();
    expect(card.parentElement!.previousElementSibling!.className).toBe("place-facts");
    expect(card.querySelector(".beta-tag")!.textContent).toBe("Beta");
    expect(card.querySelector('[data-testid="psr-line"]')!.textContent).toBe("2.4 km SW, 234 km²");
    expect(card.textContent).toContain("cold-trap candidate (PGDA 69, never lit in 18.6 yr)");
    expect(card.textContent).toContain("Not detected ice");
    // No map instance yet (globe): the map button says why it is off, and no layer chip shows.
    expect(card.querySelector("button")!.disabled).toBe(true);
    expect(el.querySelector(".beta-psr-chip")).toBeNull();
  });

  it("says when a site is outside the polar maps and removes the line on close", async () => {
    await act(async () => root.render(<BetaPsr map={null} site={site("chandrayaan3_far", -40)} />));
    await act(async () => {});
    expect(document.querySelector(".beta-psr-card")!.textContent).toContain("Outside the PGDA 69 polar maps");
    // A custom pin inside the polar maps has no precomputed value: say so, not "outside".
    await act(async () => root.render(<BetaPsr map={null} site={site("custom--89.5000-120.0000", -89.5)} />));
    expect(document.querySelector(".beta-psr-card")!.textContent).toContain("Precomputed for the listed sites only");
    expect(document.querySelector(".beta-psr-card")!.textContent).not.toContain("Outside");
    await act(async () => root.render(<BetaPsr map={null} site={null} />));
    expect(document.querySelector(".beta-psr-slot")).toBeNull();
  });
});
