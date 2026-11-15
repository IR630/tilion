import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NasaLinks } from "./NasaLinks";

describe("NasaLinks", () => {
  let el: HTMLDivElement;
  let root: Root;
  const site = { lat: -89.5, lonE: 137.4, elevM: 1200 };
  const atUtc = "2027-01-15T18:00:00Z";
  const link = (name: string) => [...el.querySelectorAll("a")].find((a) => a.textContent === name);

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    el = document.createElement("div");
    root = createRoot(el);
  });
  afterEach(() => act(() => root.unmount()));

  it("updates the maps for a new site and Horizons for the selected UTC day", () => {
    act(() => root.render(<NasaLinks site={site} atUtc={atUtc} />));
    const maps = [link("QuickMap")!.href, link("Moon Trek")!.href];
    const horizons = link("Horizons: Sun az/el")!.href;
    expect(el.querySelectorAll('a[target="_blank"][rel="noopener noreferrer"]')).toHaveLength(3);
    expect(el.textContent).toContain("Horizons gives elevation above a flat horizon; Tilion adds LOLA terrain.");

    act(() => root.render(<NasaLinks site={site} atUtc="2027-01-16T03:00:00Z" />));
    expect([link("QuickMap")!.href, link("Moon Trek")!.href]).toEqual(maps);
    expect(link("Horizons: Sun az/el")!.href).not.toBe(horizons);
    expect(decodeURIComponent(link("Horizons: Sun az/el")!.href)).toContain("2027-01-16");

    act(() => root.render(<NasaLinks site={{ lat: -85, lonE: 25, elevM: 800 }} atUtc={atUtc} />));
    expect(link("QuickMap")!.href).not.toBe(maps[0]);
    expect(link("Moon Trek")!.href).not.toBe(maps[1]);
    expect(decodeURIComponent(link("Horizons: Sun az/el")!.href)).toContain("25,-85,0.8");
  });

  it("builds Horizons for a site with no elevation (height 0)", () => {
    act(() => root.render(<NasaLinks site={{ ...site, elevM: null }} atUtc={atUtc} />));
    expect(decodeURIComponent(link("Horizons: Sun az/el")!.href)).toContain("137.4,-89.5,0");
  });

  it("explains missing coordinates without opening an unrelated map", () => {
    act(() => root.render(<NasaLinks site={{ ...site, lat: null }} atUtc={atUtc} />));
    expect(el.querySelectorAll("a")).toHaveLength(0);
    expect(el.textContent).toContain("Site coordinates are unavailable.");
  });

  it("keeps maps available when the selected date is invalid", () => {
    act(() => root.render(<NasaLinks site={site} atUtc="invalid" />));
    expect(el.querySelectorAll("a")).toHaveLength(2);
    expect(link("Horizons: Sun az/el")).toBeUndefined();
    expect(el.textContent).toContain("Horizons needs a valid UTC date.");
  });
});
