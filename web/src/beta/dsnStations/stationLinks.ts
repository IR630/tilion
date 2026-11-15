import type { Complex } from "./dsn";
import type { NextStation, StationRow } from "./StationPanel";

/** #383: data produced by precompute. Bits are station-specific links at each site. */
export type StationLinksFile = {
  startUtc: string; stepMin: number; n: number; thresholdDeg: number;
  complexes: Complex[]; moonElevationDeg: number[][]; sites: Record<string, string>;
};
export type StationLinks = StationLinksFile & { startMs: number; stepMs: number };

export function decodeStationLinks(f: StationLinksFile): StationLinks {
  const startMs = Date.parse(f?.startUtc);
  if (!Number.isFinite(startMs) || !Number.isFinite(f.stepMin) || f.stepMin <= 0 || !Number.isInteger(f.n) || f.n <= 0 ||
      f.thresholdDeg !== 10 || !Array.isArray(f.complexes) || f.complexes.length !== 3 ||
      f.complexes.some((c) => !c || typeof c.id !== "string" || typeof c.name !== "string") ||
      !Array.isArray(f.moonElevationDeg) || f.moonElevationDeg.length !== 3 ||
      f.moonElevationDeg.some((a) => !Array.isArray(a) || a.length !== f.n || a.some((v) => !Number.isFinite(v))) ||
      !f.sites || typeof f.sites !== "object" || Array.isArray(f.sites) ||
      Object.values(f.sites).some((v) => typeof v !== "string" || v.length !== f.n || /[^0-7]/.test(v))) {
    throw new Error("dsn_links.json: invalid station data");
  }
  return { ...f, startMs, stepMs: f.stepMin * 60000 };
}

/** Null means the site or moment is unavailable; 'none' means no later opening in the data. */
export function stationSnapshot(d: StationLinks, siteId: string, atMs: number): { rows: StationRow[]; next: NextStation } | null {
  const codes = Object.hasOwn(d.sites, siteId) ? d.sites[siteId] : undefined;
  const i = Math.floor((atMs - d.startMs) / d.stepMs);
  if (!codes || !Number.isFinite(atMs) || i < 0 || i >= d.n) return null;
  const bits = Number(codes[i]);
  const rows = d.complexes.map((c, k) => ({ name: c.name, elevationDeg: d.moonElevationDeg[k][i], link: !!(bits & (1 << k)) }));
  let previous = bits;
  for (let j = i + 1; j < d.n; j++) {
    const current = Number(codes[j]);
    const opened = current & ~previous;
    if (opened) {
      const k = d.complexes.findIndex((_, index) => !!(opened & (1 << index)));
      const hours = Math.ceil(((d.startMs + j * d.stepMs - atMs) / 3600000) * 10) / 10;
      return { rows, next: { kind: "available", station: d.complexes[k].name, hours } };
    }
    previous = current;
  }
  return { rows, next: { kind: "none" } };
}

let cache: Promise<StationLinks | null> | null = null;
export function loadStationLinks(): Promise<StationLinks | null> {
  return (cache ??= fetch(`${import.meta.env.BASE_URL}data/beta/dsn_links.json`, { signal: AbortSignal.timeout(15000) })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<StationLinksFile>; })
    .then(decodeStationLinks)
    .catch((e) => { console.error("DSN station links: failed to load", e); cache = null; return null; }));
}
