import { expect, it } from "vitest";
import { stereoInv, stereoXY } from "../format";
import { type Grid, NODATA } from "./illumGrid";
import { brighterNearby } from "./nearby";

const site = stereoInv(0, 30000);
function grids(): Grid[] {
  const sun: Grid = { id: "sun", kind: "sun", file: "", size: 5, bounds: [-2500, 27500, 2500, 32500], cellM: 1000, data: new Uint8Array(25).fill(40) };
  return [sun, { ...sun, id: "earth", kind: "earth", data: new Uint8Array(25).fill(63) }];
}

it("picks the highest Sun cell and reports its centre, gain, Earth and local north bearing", () => {
  const g = grids();
  g[0].data[7] = 80;
  g[0].data[11] = 70;
  const spot = brighterNearby(g, ...site)?.spot;
  expect(spot).toMatchObject({ sunPct: 80, gainPp: 40, earthPct: 63, compass: "N" });
  expect(spot?.distanceKm).toBeCloseTo(1, 3);
  expect(spot?.azimuthDeg).toBeCloseTo(0, 6);
  expect(stereoXY(spot!.lat, spot!.lonE)[1]).toBeCloseTo(31000, 6);
  expect(stereoXY(spot!.lat, spot!.lonE)[0]).toBeCloseTo(0, 6);
});

it("breaks a Sun tie by distance even when the farther cell is scanned first", () => {
  const g = grids();
  g[0].data[2] = g[0].data[7] = 80;
  expect(brighterNearby(g, ...site)?.spot?.distanceKm).toBeCloseTo(1, 3);
});

it("skips Sun no-data cells", () => {
  const g = grids();
  g[0].data[7] = NODATA;
  g[0].data[11] = 70;
  expect(brighterNearby(g, ...site)?.spot?.sunPct).toBe(70);
});

it("clips the search at a grid edge", () => {
  const g = grids();
  g[0].data[1] = 75;
  expect(brighterNearby(g, ...stereoInv(-2000, 32000))?.spot?.sunPct).toBe(75);
});

it("reports no brighter spot when the site cell is tied for best", () => {
  expect(brighterNearby(grids(), ...site)).toMatchObject({ radiusKm: 2, cellM: 1000, spot: null });
});

it("excludes a brighter cell outside the circular radius", () => {
  const g = grids();
  g[0].data[0] = 99;
  expect(brighterNearby(g, ...site)?.spot).toBeNull();
});

it("respects a supplied search radius", () => {
  const g = grids();
  g[0].data[7] = 80;
  expect(brighterNearby(g, ...site, 0.5)?.spot).toBeNull();
  expect(brighterNearby(g, ...site, 1.5)?.spot?.sunPct).toBe(80);
});

it("uses the finest covering grid regardless of input order", () => {
  const g = grids();
  const coarse: Grid = { ...g[0], size: 1, cellM: 5000, data: new Uint8Array([99]) };
  expect(brighterNearby([coarse, ...g], ...site)?.cellM).toBe(1000);
});

it("returns no result without a valid site cell", () => {
  const g = grids();
  expect(brighterNearby(g, -80, 0)).toBeNull();
  g[0].data[12] = NODATA;
  expect(brighterNearby(g, ...site)).toBeNull();
});

it("keeps a bright Sun cell when its Earth value is no data", () => {
  const g = grids();
  g[0].data[7] = 80;
  g[1].data[7] = NODATA;
  expect(brighterNearby(g, ...site)?.spot?.earthPct).toBeNull();
});

it("uses local east rather than map east for the compass", () => {
  const g = grids();
  g[0].data[13] = 80;
  expect(brighterNearby(g, ...site)?.spot?.compass).toBe("E");
});
