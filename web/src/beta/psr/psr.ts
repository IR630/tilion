// BETA nearest cold-trap candidate (#175): data files and pure helpers.
// Data: web/public/data/beta/psr.json and psr_polygons.json from backend/src/precompute/beta_psr.py.
// A cold-trap candidate is a PGDA 69 pixel never lit in 18.6 years: permanent shadow, not ice.

export type PsrSite = {
  grid: "60m" | "240m";
  distanceKm: number;
  areaKm2: number;
  bearingDeg: number | null;
  patch: string;
  nearest: { lat: number; lonE: number };
  centroid: { lat: number; lonE: number };
};
export type PsrFile = {
  label: string;
  definition: string;
  source: string;
  grids: { id: string; file: string; coverage: string; minPatchKm2: number; patches: number; patchAreaKm2: number }[];
  sites: Record<string, PsrSite>;
};
type Ring = [number, number][];
export type PsrPolygons = {
  type: "FeatureCollection";
  features: { type: "Feature"; properties: { id: string; areaKm2: number }; geometry: { type: "Polygon"; coordinates: Ring[] } }[];
};

const base = `${import.meta.env.BASE_URL}data/beta/`;

async function getJson<T>(name: string): Promise<T | null> {
  try {
    const r = await fetch(base + name, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } catch (e) {
    console.error(`BETA cold traps: failed to load ${base + name}`, e);
    return null;
  }
}

// Cached per page; a failed load is not cached, so the next mount tries again.
let filePromise: Promise<PsrFile | null> | null = null;
export const loadPsr = () =>
  (filePromise ??= getJson<PsrFile>("psr.json").then((f) => {
    if (!f) filePromise = null;
    return f;
  }));

let polyPromise: Promise<PsrPolygons | null> | null = null;
/** Patches in map coordinates (stereographic metres / 1e6, D-005). */
export const loadPsrPolygons = () =>
  (polyPromise ??= getJson<PsrPolygons>("psr_polygons.json").then((g) => {
    if (!g) polyPromise = null;
    return g ? toMapUnits(g) : null;
  }));

export function toMapUnits(g: PsrPolygons): PsrPolygons {
  for (const f of g.features) f.geometry.coordinates = f.geometry.coordinates.map((r) => r.map(([x, y]) => [x / 1e6, y / 1e6]));
  return g;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
/** Local bearing → 8-point compass (north = away from the pole). */
export const compass = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

export const fmtKm = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);
export const fmtArea = (km2: number) => (km2 >= 10 ? `${Math.round(km2)} km²` : `${km2.toFixed(km2 < 1 ? 2 : 1)} km²`);

/** One line for the place card. */
export function psrLine(e: PsrSite): string {
  if (e.distanceKm === 0 || e.bearingDeg === null) return `Site is inside a cold-trap candidate, ${fmtArea(e.areaKm2)}`;
  return `${fmtKm(e.distanceKm)} ${compass(e.bearingDeg)}, ${fmtArea(e.areaKm2)}`;
}

export function gridNote(e: PsrSite, f: PsrFile): string {
  const g = f.grids.find((x) => x.id === e.grid);
  const min = g ? `patches ≥ ${g.minPatchKm2} km²` : "";
  return e.grid === "60m" ? `60 m grid, ${min}` : `240 m grid only here (${min}); smaller shadows not resolved`;
}

/** Diagonal hatch for the fill-pattern: blue-grey 1 px lines every 6 px, transparent between. */
export function hatch(size = 12, rgb: [number, number, number] = [143, 163, 184]): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if ((x + y) % 6 !== 0) continue;
      const i = (y * size + x) * 4;
      data.set([...rgb, 200], i);
    }
  return { width: size, height: size, data };
}
