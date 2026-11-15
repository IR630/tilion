import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Site } from "../contracts";
import { decodeTile, dirFromAzEl, pickSite, Terrain3D, type TerrainTileMeta } from "./Terrain3D";

const site = (id: string, lat: number | null, terrain: Site["terrain"]): Site => ({
  id, name: id, group: "artemis", status: "", kind: "point", lat, lonE: lat === null ? null : 10,
  elevM: null, source: "", confidence: "high", terrain, note: "",
});

const close = (a: number[], b: number[]) => a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 9));

describe("Terrain3D", () => {
  it("maps azimuth from north to east into the scene frame (−Z north, +X east, +Y up)", () => {
    close(dirFromAzEl(0, 0), [0, 0, -1]);
    close(dirFromAzEl(90, 0), [1, 0, 0]);
    close(dirFromAzEl(180, 0), [0, 0, 1]);
    close(dirFromAzEl(270, 0), [-1, 0, 0]);
    close(dirFromAzEl(123, 90), [0, 1, 0]);
    const [x, y, z] = dirFromAzEl(45, 30);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 12);
    expect(y).toBeCloseTo(0.5, 12);
  });

  it("picks the first site with a polar DEM and a known point", () => {
    const s = [site("eq", -10, "none"), site("nopt", null, "polar80"), site("p240", -70, "polar240"), site("p80", -89, "polar80")];
    expect(pickSite(s)?.id).toBe("p240");
    expect(pickSite([site("eq", -10, "none")])).toBeUndefined();
  });

  it("decodes Int16 LE heights with scale and offset, rejects a wrong size", () => {
    const meta: TerrainTileMeta = {
      siteId: "x", size: 2, spacingM: 80, scaleM: 0.5, offsetM: 100, minM: 0, maxM: 0, siteHeightM: 0, dem: ["polar80"],
    };
    const buf = new ArrayBuffer(8);
    const v = new DataView(buf);
    [-200, 0, 1, 32767].forEach((q, k) => v.setInt16(k * 2, q, true));
    expect(Array.from(decodeTile(meta, buf))).toEqual([0, 100, 100.5, 100 + 32767 * 0.5]);
    expect(() => decodeTile(meta, new ArrayBuffer(6))).toThrow(/bytes/);
  });

  it("asks for a polar site when none is picked", () => {
    const html = renderToString(<Terrain3D sites={[site("eq", -10, "none")]} atUtc="2027-01-15T00:00:00Z" />);
    expect(html).toContain("Pick a site with a polar terrain model");
  });

  it("renders the 3D section with a loading state for a polar site", () => {
    const html = renderToString(<Terrain3D sites={[site("p80", -89, "polar80")]} atUtc="2027-01-15T00:00:00Z" />);
    expect(html).toContain('aria-label="3D terrain"');
    expect(html).toContain("Loading terrain");
  });
});
