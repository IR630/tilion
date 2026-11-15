// BETA horizon uncertainty (#258): Sun and Earth hour shares when the LOLA terrain is 1 sigma higher or lower.
// Data: web/public/data/beta/uncertainty.json from backend/src/precompute/beta_uncertainty.py.

export type Band = { value: number; lo: number; hi: number };
export type UncertaintyRow = { siteId: string; name: string; sigmaMedianM: number; errMaxDeg: number; sun: Band; earth: Band };
export type UncertaintyFile = { version: 1; startUtc: string; endUtc: string; hours: number; sigma: string; method: string; sites: UncertaintyRow[] };

const url = `${import.meta.env.BASE_URL}data/beta/uncertainty.json`;

// Cached per page; a failed load is not cached, so the next mount tries again.
let filePromise: Promise<UncertaintyFile | null> | null = null;
export const loadUncertainty = () =>
  (filePromise ??= fetch(url, { signal: AbortSignal.timeout(15000) })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<UncertaintyFile>;
    })
    .catch((e) => {
      console.error(`BETA uncertainty: failed to load ${url}`, e);
      filePromise = null;
      return null;
    }));

const p1 = (x: number) => (x * 100).toFixed(1);

/** "93.0 % [92.6–93.4 %]"; "50.6 % (no change)" when the band is narrower than 0.05 pp. */
export function fmtBand(b: Band): string {
  if (p1(b.lo) === p1(b.hi)) return `${p1(b.value)} % (no change)`;
  return `${p1(b.value)} % [${p1(b.lo)}–${p1(b.hi)} %]`;
}

/** Largest move of the share away from the value over all sites, in percentage points, and the site name. */
export function widest(f: UncertaintyFile, body: "sun" | "earth"): { pp: number; name: string } | null {
  let best: { pp: number; name: string } | null = null;
  for (const r of f.sites) {
    const b = r[body];
    const pp = Math.max(b.hi - b.value, b.value - b.lo) * 100;
    if (!best || pp > best.pp) best = { pp, name: r.name };
  }
  return best;
}
