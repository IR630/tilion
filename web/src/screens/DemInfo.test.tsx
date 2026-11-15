import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { HorizonMask, Site, Timeline } from "../contracts";
import { DemInfo, horizonToward, sunDirectionText } from "./DemInfo";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 1° step; az 359 → 3°, az 0 → 1°, az 120 → 2°, others 0°.
const mask: HorizonMask = {
  siteId: "t",
  observerHeightM: 2,
  terrain: "polar80",
  azStepDeg: 1,
  elevDeg: Array.from({ length: 360 }, (_, k) => (k === 359 ? 3 : k === 0 ? 1 : k === 120 ? 2 : 0)),
};

function site(terrain: Site["terrain"], lat: number | null = -89): Site {
  return {
    id: "t", name: "Test", group: "ridge", status: "", kind: "point", lat, lonE: lat === null ? null : 10,
    elevM: null, source: "", confidence: "high", terrain, note: "",
  };
}

function tl(sunAz: number, sunEl: number, sunVisible: number, stub = false): Timeline {
  return {
    siteId: "t", startUtc: "2027-01-01T00:00:00Z", stepMin: 60,
    sunAz: [sunAz], sunEl: [sunEl], sunVisible: [sunVisible],
    earthAz: [0], earthEl: [0], earthVisible: [0], stub,
  };
}

function render(node: React.ReactNode): HTMLElement {
  const el = document.createElement("div");
  act(() => createRoot(el).render(node));
  return el;
}

describe("horizonToward", () => {
  it("uses the mask value at the Sun azimuth", () => {
    expect(horizonToward(mask, 120)).toBe(2);
    expect(horizonToward(mask, 120.5)).toBeCloseTo(1);
  });

  it("interpolates across the 0/360 seam", () => {
    expect(horizonToward(mask, 359.5)).toBeCloseTo(2);
    expect(horizonToward(mask, -0.5)).toBeCloseTo(2);
    expect(horizonToward(mask, 360)).toBe(1);
  });

  it("returns null where the mask has no DEM (-90°), never a flat 0°", () => {
    const holed = { ...mask, elevDeg: mask.elevDeg.map((e, k) => (k === 200 ? -90 : e)) };
    expect(horizonToward(holed, 200)).toBeNull();
    expect(horizonToward(holed, 199.5)).toBeNull();
    expect(sunDirectionText(holed, tl(200, 1, 1), 0)).toContain("no DEM data in this direction");
  });
});

describe("sunDirectionText", () => {
  it("states horizon and Sun at the Sun azimuth and the disc verdict from the timeline", () => {
    expect(sunDirectionText(mask, tl(120, 1.2, 0), 0)).toBe("Toward the Sun (az 120°): horizon 2.0°, Sun 1.2° → disc hidden");
    expect(sunDirectionText(mask, tl(359.5, 2.1, 0.4), 0)).toBe(
      "Toward the Sun (az 0°): horizon 2.0°, Sun 2.1° → disc partly visible (40 % of sunlight)",
    );
    expect(sunDirectionText(mask, tl(60, 3, 1), 0)).toContain("horizon 0.0°, Sun 3.0° → disc fully visible");
  });
});

describe("DemInfo", () => {
  it("shows source, resolution and observer height from the mask", () => {
    const el = render(<DemInfo site={site("polar80")} mask={mask} view={mask} tl={tl(120, 1.2, 0)} i={0} />);
    const text = el.textContent ?? "";
    expect(text).toContain("LOLA polar DEM (NASA PGDA 90)");
    expect(text).toContain("20 m within 5 km of the site, 80 m to the 80°S edge, 240 m beyond");
    expect(text).toContain("2 m above the ground");
    expect(text).toContain("Inside LOLA 80–90°S coverage");
    expect(text).toContain("not a landing-safety assessment");
    expect(el.querySelector('[aria-label="Horizon toward the Sun"]')?.textContent).toContain("horizon 2.0°, Sun 1.2° → disc hidden");
  });

  it("shows the 240 m grid for a polar240 mask", () => {
    const m = { ...mask, terrain: "polar240" as const };
    const text = render(<DemInfo site={site("polar240", -69)} mask={m} view={m} tl={tl(120, 1, 0)} i={0} />).textContent;
    expect(text).toContain("Resolution240 m");
    expect(text).toContain("Inside LOLA 60–90°S coverage");
  });

  it("labels a site without terrain as a bare sphere, outside coverage", () => {
    const flat = { ...mask, terrain: "none" as const, elevDeg: mask.elevDeg.map(() => 0) };
    const text = render(<DemInfo site={site("none", 0.7)} mask={flat} view={flat} tl={tl(90, 5, 1)} i={0} />).textContent;
    expect(text).toContain("No terrain model");
    expect(text).toContain("No terrain — outside LOLA 60–90°S coverage; bare sphere (flat 0° horizon)");
    expect(text).not.toContain("LOLA polar DEM");
  });

  it("labels a site with no published point", () => {
    const flat = { ...mask, terrain: "none" as const, elevDeg: mask.elevDeg.map(() => 0) };
    const text = render(<DemInfo site={site("none", null)} mask={flat} view={flat} tl={tl(90, 5, 1)} i={0} />).textContent;
    expect(text).toContain("no published point");
  });

  it("keeps the real DEM source when only the timeline is synthetic", () => {
    const flat = { ...mask, terrain: "none" as const, elevDeg: mask.elevDeg.map(() => 0) };
    const el = render(<DemInfo site={site("polar80")} mask={mask} view={flat} tl={tl(120, 1.2, 1, true)} i={0} />);
    expect(el.textContent).toContain("LOLA polar DEM (NASA PGDA 90)");
    expect(el.textContent).not.toContain("synthetic mask");
    expect(el.textContent).toContain("20 m within 5 km");
    expect(el.querySelector('[aria-label="Horizon toward the Sun"]')?.textContent).toBe(
      "Toward the Sun (az 120°): horizon 0.0°, Sun 1.2° → disc fully visible (bare sphere comparison)",
    );
  });

  // #330: custom point whose rays toward az 60-70° leave the DEM coverage (1° mask step).
  const rays = Array.from({ length: 360 }, (_, k) => !(k >= 60 && k <= 70));
  const m240 = { ...mask, terrain: "polar240" as const };

  it("says Sun visibility unknown on an incomplete ray when the Sun clears the known terrain", () => {
    const el = render(<DemInfo site={site("polar240", -61)} mask={m240} view={m240} tl={tl(65, 3, 1)} i={0} complete={rays} />);
    const sun = el.querySelector('[aria-label="Horizon toward the Sun"]')?.textContent ?? "";
    expect(sun).toContain("visibility unknown");
    expect(sun).not.toContain("fully visible");
    expect(el.querySelector('[aria-label="Incomplete terrain"]')?.textContent).toContain("11 of 360 horizon rays leave the DEM coverage");
  });

  it("keeps a Sun hidden by known terrain hidden on an incomplete ray", () => {
    expect(sunDirectionText(m240, tl(65, -1, 0), 0, rays)).toContain("disc hidden");
  });

  it("shows no warning when all rays are complete", () => {
    const el = render(<DemInfo site={site("polar240", -85)} mask={m240} view={m240} tl={tl(65, 3, 1)} i={0} complete={rays.map(() => true)} />);
    expect(el.querySelector('[aria-label="Incomplete terrain"]')).toBeNull();
    expect(el.querySelector('[aria-label="Horizon toward the Sun"]')?.textContent).toContain("disc fully visible");
  });
});
