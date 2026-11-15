import { describe, expect, it } from "vitest";
import { stereoInv, stereoXY } from "../format";
import { customSite } from "./PolarMap";

describe("south polar stereographic", () => {
  it("round-trips Shackleton ridge 222.6°E −89.47°", () => {
    const [x, y] = stereoXY(-89.47, 222.6);
    const [lat, lon] = stereoInv(x, y);
    expect(lat).toBeCloseTo(-89.47, 9);
    expect(lon).toBeCloseTo(222.6, 9);
  });
  it("lon 0 -> +y, lon 90 -> +x", () => {
    const [x0, y0] = stereoXY(-85, 0);
    const [x9, y9] = stereoXY(-85, 90);
    expect(x0).toBeCloseTo(0, 6);
    expect(y0).toBeGreaterThan(0);
    expect(y9).toBeCloseTo(0, 6);
    expect(x9).toBeGreaterThan(0);
  });
  it("matches 2R·tan(colat/2)", () => {
    const [, y] = stereoXY(-80, 0);
    expect(y).toBeCloseTo(2 * 1737400 * Math.tan((5 * Math.PI) / 180), 3);
  });
  it("builds custom site with terrain by the in-browser DEM: 60–90°S", () => {
    expect(customSite(-85, 10).terrain).toBe("polar240");
    expect(customSite(-70, 10).terrain).toBe("polar240");
    expect(customSite(-60, 45).terrain).toBe("polar240");
    // The DEM square reaches ~55°S at its corners, but the custom point stops at 60°S.
    expect(customSite(-59.9, 45).terrain).toBe("none");
    expect(customSite(-59.9, 0).terrain).toBe("none");
    expect(customSite(-85, 10).id).toBe("custom--85.0000-10.0000");
  });
});
