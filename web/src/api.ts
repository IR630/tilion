// Static data loader. Files live in web/public/data/ and ship with the page (no server, Q3/Q10).
// A custom point is computed in the browser (custom/, #31). Missing timelines use mock data
// with stub: true; missing masks are errors.
import type { HorizonMask, Site, SiteInset, SitesFile, Timeline, ValidationFile, VisibilityVariants } from "./contracts";
import { computeCustomSite, type CustomResult, isCustom } from "./custom/client";
import { mockTimeline } from "./mock";
import type { BasemapMeta, TileManifest } from "./navigator/geo";

const base = `${import.meta.env.BASE_URL}data/`;

export async function getJson<T>(path: string): Promise<T | null> {
  // The dev server answers a missing file with index.html and 200: treat bad JSON as missing.
  let status: number | string = "network error";
  try {
    const r = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
    status = r.status;
    if (!r.ok) {
      console.error(`Failed to load ${base + path}`, status);
      return null;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.error(`Failed to load ${base + path}`, status, e);
    return null;
  }
}

export async function loadSites(): Promise<Site[]> {
  const f = await getJson<SitesFile>("sites.json");
  if (!f) throw new Error("data/sites.json is missing");
  return f.sites;
}

/** Base URL of the navigator basemap images (D-005). */
export const BASEMAP_URL = `${base}basemap/`;

/** data/basemap/meta.json (D-005); null until the basemap is generated (#34). */
export async function loadBasemapMeta(): Promise<BasemapMeta | null> {
  const m = await getJson<BasemapMeta>("basemap/meta.json");
  return m && Array.isArray(m.layers) ? m : null;
}

/** Deep zooms of the basemap pyramid (#149): same origin, path /hd/ on the VPS, outside git. A
 *  local demo has no /hd/: the map keeps the git tier. */
export const HD_BASEMAP_URL = "/hd/basemap/";

export async function loadHdManifest(): Promise<TileManifest | null> {
  try {
    const r = await fetch(HD_BASEMAP_URL + "manifest.json", { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const m = (await r.json()) as TileManifest;
    return Array.isArray(m?.sets) ? m : null;
  } catch {
    return null; // no server, or index.html instead of JSON
  }
}

/** Base URL of the site inset tiles (#125): inset/<siteId>.webp + inset/<siteId>.json. */
export const INSET_URL = `${base}inset/`;

/** data/inset/<siteId>.json; null for a site without terrain or before the tiles are generated. */
export async function loadInset(siteId: string): Promise<SiteInset | null> {
  const m = await getJson<SiteInset>(`inset/${siteId}.json`);
  return m && m.siteId === siteId && Array.isArray(m.bounds) ? m : null;
}

let validation: Promise<ValidationFile | null> | null = null;
/** Cache successful NASA cross-check results; retry after a failed load. */
export function loadValidation(): Promise<ValidationFile | null> {
  validation ??= getJson<ValidationFile>("validation.json").then((f) => {
    if (!f) validation = null;
    return f;
  });
  return validation;
}

/** Custom point: mask and timeline from the Web Worker. #424: a failure rejects with the real cause
 *  ("no DEM under the site", HTTP 404 of a DEM tile), not a null that reads as "file missing". */
function loadCustom(site: Site): Promise<CustomResult> {
  return computeCustomSite(site, new URL(`${base}custom/`, location.href).href).catch((e) => {
    console.error(`custom point ${site.id}: ${e}`);
    throw new Error(String(e instanceof Error ? e.message : e).replace(/^Error: /, ""));
  });
}

export async function loadMask(site: Site): Promise<HorizonMask> {
  const m = isCustom(site)
    ? (await loadCustom(site).catch((e: Error) => { throw new Error(`Horizon mask unavailable for ${site.id}: ${e.message}`); })).mask
    : await getJson<HorizonMask>(`mask/${site.id}.json`);
  if (!m) throw new Error(`Horizon mask unavailable for ${site.id}`);
  return m;
}

const masks = new Map<string, Promise<HorizonMask | null>>();

/** #206: the mask for a terrain-clearance readout, cached per site; null when it fails (not cached then). */
export function loadMaskOnce(site: Site): Promise<HorizonMask | null> {
  let p = masks.get(site.id);
  if (!p) {
    p = loadMask(site).catch((e) => { console.error(`Horizon mask failed for ${site.id}`, e); return null; });
    masks.set(site.id, p);
    p.then((m) => m || masks.delete(site.id));
  }
  return p;
}

const timelines = new Map<string, Promise<Timeline | null>>();
const variantFiles = new Map<string, Promise<VisibilityVariants | null>>();

/** Load named terrain/height variants for a site. A custom point has no precomputed file. */
export function loadVariants(site: Site): Promise<VisibilityVariants | null> {
  if (site.id.startsWith("custom-")) return Promise.resolve(null);
  let p = variantFiles.get(site.id);
  if (!p) {
    p = getJson<VisibilityVariants>(`variants/${site.id}.json`);
    variantFiles.set(site.id, p);
    // A failed load is not cached, so the next call can retry.
    p.then((v) => { if (!v) variantFiles.delete(site.id); });
  }
  return p;
}

/** Expand flip indexes (series starts at 0) into a 0/1 array for steps i0 .. i0+n-1. */
export function expandFlips(flips: number[], i0: number, n: number): number[] {
  const out = new Array<number>(n);
  let state = 0;
  let k = 0;
  while (k < flips.length && flips[k] <= i0) (state ^= 1), k++;
  for (let j = 0; j < n; j++) {
    while (k < flips.length && flips[k] <= i0 + j) (state ^= 1), k++;
    out[j] = state;
  }
  return out;
}

/** Index of the first step at or after startUtc and the step count for `days`; null when out of range. */
export function sliceRange(
  fileStartUtc: string,
  stepMin: number,
  length: number,
  startUtc: string,
  days: number,
): { i0: number; n: number } | null {
  const stepMs = stepMin * 60000;
  const i0 = Math.ceil((Date.parse(startUtc) - Date.parse(fileStartUtc)) / stepMs);
  const n = Math.min(Math.round((days * 24 * 60) / stepMin), length - i0);
  if (!(i0 >= 0) || i0 >= length) return null;
  return { i0, n };
}

/** Range of the precomputed hourly timelines (all sites share it). */
export const DATA_START_UTC = "2026-12-01T00:00:00Z";
export { DATA_END_UTC } from "./format";

/** The whole timeline of a site (precomputed or custom), loaded once and cached; null when there is none.
 *  A failed custom point rejects with its cause (#424). */
export function loadFullTimeline(site: Site): Promise<Timeline | null> {
  let p = timelines.get(site.id);
  if (!p) {
    p = isCustom(site) ? loadCustom(site).then((r) => r.timeline) : getJson<Timeline>(`timeline/${site.id}.json`);
    timelines.set(site.id, p);
    p.then((t) => { if (!t) timelines.delete(site.id); }, () => timelines.delete(site.id));
  }
  return p;
}

/** A window of the precomputed timeline from startUtc; mock (stub: true) outside its range. */
export async function loadTimeline(site: Site, startUtc: string, days = 30): Promise<Timeline> {
  // #440: mock only for a site without a published point or a date outside the data; a failed load is an error.
  if (site.lat === null) return mockTimeline(site, startUtc, days);
  const full = await loadFullTimeline(site);
  if (!full) throw new Error(`Timeline unavailable for ${site.id}`);
  const r = sliceRange(full.startUtc, full.stepMin, full.sunEl.length, startUtc, days);
  if (!r) return mockTimeline(site, startUtc, days);
  const { i0, n } = r;
  const stepMs = full.stepMin * 60000;
  const cut = (a: number[]) => a.slice(i0, i0 + n);
  const v = await loadVariants(site);
  const same = v && v.startUtc === full.startUtc && v.stepMin === full.stepMin && v.n >= i0 + n;
  return {
    siteId: full.siteId,
    startUtc: new Date(Date.parse(full.startUtc) + i0 * stepMs).toISOString(),
    stepMin: full.stepMin,
    sunAz: cut(full.sunAz),
    sunEl: cut(full.sunEl),
    sunVisible: cut(full.sunVisible),
    earthAz: cut(full.earthAz),
    earthEl: cut(full.earthEl),
    earthVisible: cut(full.earthVisible),
    ...(full.dsnVisible ? { dsnVisible: cut(full.dsnVisible) } : {}),
    ...(same
      ? {
          variantSunLit: v.variants.map((x) => expandFlips(x.sun, i0, n)),
          variantEarthVisible: v.variants.map((x) => expandFlips(x.earth, i0, n)),
        }
      : {}),
  };
}
