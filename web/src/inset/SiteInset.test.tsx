import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadInset } from "../api";
import type { Site, SiteInset as Meta } from "../contracts";
import { stereoXY } from "../format";
import { toMap } from "../navigator/geo";
import { insetLabel, SiteInset } from "./SiteInset";
import { insetOutline, leaderLines, siteInTile, tilePixelToXY } from "./insetGeometry";

const meta: Meta = {
  siteId: "cr1_connecting_ridge",
  file: "cr1_connecting_ridge.webp",
  bounds: [-14048.38, -14958.03, -9048.38, -9958.03],
  sizePx: 512,
  sizeM: 5000,
  pixelM: 5000 / 512,
  resolutionM: 20,
  source: "LOLA 20 M",
  shading: "multi-directional hillshade",
  layout: "row 0 = ymax",
};

describe("SiteInset", () => {
  let el: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    el = document.createElement("div");
    root = createRoot(el);
  });
  afterEach(() => act(() => root.unmount()));

  it("shows the scale and DEM above the tile and no date: the hillshade is static (#155)", () => {
    act(() => root.render(<SiteInset meta={meta} siteName="Connecting ridge" />));
    const kids = [...el.querySelector("figure")!.children];
    expect(kids[0].textContent).toBe("5 × 5 KM, LOLA 20 M");
    expect(kids[0].className).toContain("hud-label");
    expect(kids[1].querySelector("img")!.getAttribute("src")).toContain("inset/cr1_connecting_ridge.webp");
    expect(kids[1].querySelector(".si-reticle")).not.toBeNull();
    expect(kids).toHaveLength(2);
    expect(el.querySelector("time")).toBeNull();
  });

  it("names the coarser DEM when the tile is not 20 m", () => {
    act(() => root.render(<SiteInset meta={{ ...meta, resolutionM: 240, source: "LOLA 240 M" }} />));
    expect(el.querySelector(".si-label")!.textContent).toBe("5 × 5 KM, LOLA 240 M");
  });

  it("formats the label", () => {
    expect(insetLabel({ sizeM: 5000, source: "LOLA 80 M" })).toBe("5 × 5 KM, LOLA 80 M");
  });
});

describe("tile orientation matches the map (D-005)", () => {
  const sites = JSON.parse(readFileSync("public/data/sites.json", "utf8")).sites as Site[];
  const site = sites.find((s) => s.id === meta.siteId)!;
  const real = JSON.parse(readFileSync(`public/data/inset/${site.id}.json`, "utf8")) as Meta;

  it("is centred on the site in stereoXY metres", () => {
    const [x, y] = stereoXY(site.lat!, site.lonE!);
    const c = siteInTile(real, x, y);
    expect(c.x).toBeCloseTo(0.5, 6);
    expect(c.y).toBeCloseTo(0.5, 6);
    const [col, row] = [real.sizePx / 2 - 0.5, real.sizePx / 2 - 0.5];
    const [px, py] = tilePixelToXY(real, col, row);
    expect(px).toBeCloseTo(x, 3);
    expect(py).toBeCloseTo(y, 3);
  });

  it("row 0 is the 0°E side (+y, up) and col 0 is -x, as boundsToCoords draws the basemap", () => {
    const [x0, y0] = tilePixelToXY(real, 0, 0);
    const [x1, y1] = tilePixelToXY(real, 511, 511);
    expect(x1).toBeGreaterThan(x0);
    expect(y0).toBeGreaterThan(y1);
  });

  it("the outline is an upright square on the MapLibre screen (map lng/lat = metres / 1e6, y down)", () => {
    // MapLibre at bearing 0: screen x = lng * s, screen y = -lat * s.
    const s = 1 / 20; // px per metre
    const o = insetOutline(real, (x, y) => ({ x: x * s, y: -y * s }));
    expect(o).toHaveLength(4);
    expect(o[0].x).toBeLessThan(o[1].x); // TL left of TR
    expect(o[0].y).toBeCloseTo(o[1].y, 9);
    expect(o[3].y).toBeGreaterThan(o[0].y); // BL below TL
    expect(o[1].x - o[0].x).toBeCloseTo(250, 3); // 5 km at 20 m/px
    const [mx, my] = toMap(site.lat!, site.lonE!);
    expect((o[0].x + o[2].x) / 2).toBeCloseTo((mx * 1e6) / 20, 3);
    expect((o[0].y + o[2].y) / 2).toBeCloseTo((-my * 1e6) / 20, 3);
  });
});

describe("overlay geometry", () => {
  const project = (x: number, y: number) => ({ x: x / 100, y: -y / 100 }); // 100 m per px
  const square = { bounds: [0, 0, 5000, 5000] as [number, number, number, number] };

  it("grows a tiny outline to the minimum size around its centre", () => {
    const far = (x: number, y: number) => ({ x: x / 1000, y: -y / 1000 }); // 5 km = 5 px
    const o = insetOutline(square, far, 20);
    expect(Math.hypot(o[1].x - o[0].x, o[1].y - o[0].y)).toBeCloseTo(20, 9);
    expect((o[0].x + o[2].x) / 2).toBeCloseTo(2.5, 9);
    expect((o[0].y + o[2].y) / 2).toBeCloseTo(-2.5, 9);
  });

  it("joins the outline to the tile with two outer tangents that do not cross", () => {
    const outline = insetOutline(square, project); // 50 px square at (0,-50)..(50,0)
    const tile = { x: 200, y: -80, w: 100, h: 100 }; // to the right, taller than the outline
    const lines = leaderLines(outline, tile);
    expect(lines).toHaveLength(2);
    for (const [a, b] of lines) {
      expect(outline).toContainEqual(a);
      expect(b.x).toBe(200); // tile corners on the near side
    }
    const [top, bottom] = lines.sort((p, q) => p[0].y - q[0].y);
    expect(top[0].y).toBeLessThan(bottom[0].y);
    expect(top[1].y).toBeLessThan(bottom[1].y);
  });

  it("gives no line when the tile overlaps the outline", () => {
    expect(leaderLines(insetOutline(square, project), { x: 10, y: -40, w: 100, h: 100 })).toEqual([]);
  });

  it("keeps one line per side when corners are collinear", () => {
    const outline = insetOutline(square, project);
    const lines = leaderLines(outline, { x: 200, y: -50, w: 50, h: 50 });
    expect(lines).toHaveLength(2);
  });
});

describe("loadInset", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("returns the meta, or null for a site without a tile", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.endsWith("inset/cr1_connecting_ridge.json") ? { ok: true, json: async () => meta } : { ok: false, json: async () => null },
    );
    expect((await loadInset("cr1_connecting_ridge"))?.source).toBe("LOLA 20 M");
    expect(await loadInset("apollo11")).toBeNull();
  });
});
