import { MOON_R, stereoInv, stereoXY } from "../format";
import { cellOf, type Grid, NODATA, sample } from "./illumGrid";
import { azimuthDeg, distanceKm } from "./waypoints";

export type NearbySpot = {
  lat: number; lonE: number; sunPct: number; gainPp: number; earthPct: number | null;
  distanceKm: number; azimuthDeg: number; compass: string;
};
export type Nearby = { cellM: number; radiusKm: number; spot: NearbySpot | null };

/** Finest covering Sun grid only. null means the site's own cell has no data or coverage. */
export function brighterNearby(grids: Grid[], lat: number, lonE: number, radiusKm = 2): Nearby | null {
  const g = grids.filter((g) => g.kind === "sun" && cellOf(g, lat, lonE)).sort((a, b) => a.cellM - b.cellM)[0];
  if (!g) return null;
  const rc = cellOf(g, lat, lonE)!;
  const own = g.data[rc[0] * g.size + rc[1]];
  if (own === NODATA) return null;
  const [x, y] = stereoXY(lat, lonE);
  // Bound projected distance by the largest stereographic scale in this grid, then test on the sphere.
  const reach = radiusKm * 1000 * (1 + Math.max(...g.bounds.map(Math.abs)) ** 2 / (2 * MOON_R ** 2));
  const c0 = Math.max(0, Math.floor((x - reach - g.bounds[0]) / g.cellM));
  const c1 = Math.min(g.size - 1, Math.floor((x + reach - g.bounds[0]) / g.cellM));
  const r0 = Math.max(0, Math.floor((g.bounds[3] - y - reach) / g.cellM));
  const r1 = Math.min(g.size - 1, Math.floor((g.bounds[3] - y + reach) / g.cellM));
  let spot: NearbySpot | null = null;
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) {
      const sunPct = g.data[row * g.size + col];
      if (sunPct === NODATA || sunPct <= own || (spot && sunPct < spot.sunPct)) continue;
      const [a, b] = stereoInv(g.bounds[0] + (col + 0.5) * g.cellM, g.bounds[3] - (row + 0.5) * g.cellM);
      const km = distanceKm(lat, lonE, a, b);
      if (km > radiusKm || (spot && sunPct === spot.sunPct && km >= spot.distanceKm)) continue;
      const az = azimuthDeg(lat, lonE, a, b);
      spot = {
        lat: a, lonE: b, sunPct, gainPp: sunPct - own,
        earthPct: sample(grids.filter((e) => e.cellM === g.cellM), "earth", a, b)?.pct ?? null,
        distanceKm: km, azimuthDeg: az, compass: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(az / 45) % 8],
      };
    }
  }
  return { cellM: g.cellM, radiusKm, spot };
}
