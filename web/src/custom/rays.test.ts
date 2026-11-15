// @vitest-environment node
// #330: a horizon ray that leaves the DEM coverage gives "unknown", not "visible".
import { describe, expect, it } from "vitest";
import { bodyState, type Dem, horizonMask, R } from "./horizon";

/** Flat DEM (height 0) in south polar stereographic metres, square of half-size halfM around the pole. */
function flatDem(halfM: number, step = 240, ridge?: (x: number, y: number) => number): Dem {
  const width = Math.round((2 * halfM) / step);
  const q = new Int16Array(width * width);
  if (ridge) {
    for (let r = 0; r < width; r++) {
      for (let c = 0; c < width; c++) q[r * width + c] = ridge(-halfM + (c + 0.5) * step, halfM - (r + 0.5) * step);
    }
  }
  return { q, width, height: width, x0: -halfM, y0: halfM, dx: step, dy: -step, scaleM: 1 };
}

describe("horizonMask ray completeness", () => {
  it("marks all rays complete when the DEM covers 300 km around a polar point", () => {
    const { complete } = horizonMask(flatDem(400e3), 0, -90);
    expect(complete.length).toBe(720);
    expect(complete.every(Boolean)).toBe(true);
  });

  it("marks rays incomplete where they leave the DEM before 300 km", () => {
    // Point ~100 km from the pole on the 0°E meridian (stereographic +y); the square edge is 150 km out.
    const lat = -90 + (100e3 / R) * (180 / Math.PI);
    const { complete } = horizonMask(flatDem(150e3), 0, lat);
    expect(complete.some((c) => !c)).toBe(true);
    expect(complete.some((c) => c)).toBe(false); // every ray reaches a square edge within 250 km
  });
});

describe("bodyState", () => {
  const step = 0.5;
  const complete = new Array(720).fill(true);
  const away = complete.map((_, k) => !(k >= 170 && k <= 190)); // rays near az 90° leave the DEM

  it("says unknown when the ray is incomplete and the body is above the known terrain", () => {
    expect(bodyState(90, 3, 1, away, step)).toBe("unknown");
  });

  it("says hidden when known nearer terrain already blocks the body, ray complete or not", () => {
    expect(bodyState(90, 0.5, 0, away, step)).toBe("hidden");
  });

  it("does not change a fully covered point", () => {
    expect(bodyState(90, 3, 1, complete, step)).toBe("visible");
    expect(bodyState(90, 0.5, 0, complete, step)).toBe("hidden");
    expect(bodyState(90, 3, 1, null, step)).toBe("visible"); // catalogue site: no flags
  });

  it("checks every ray under the Sun disc", () => {
    const one = complete.map((_, k) => k !== 181); // az 90.5° only
    expect(bodyState(90, 3, 1, one, step, 0.27)).toBe("unknown");
    expect(bodyState(90, 3, 1, one, step, 0)).toBe("visible"); // centre rule reads 90.0°
  });
});
