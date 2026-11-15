// BETA dsnStations (#259): which DSN complex sees the Moon above 10°, hour by hour.
// Data: web/public/data/beta/dsn_stations.json from backend/src/precompute/beta_dsn_stations.py.
// codes: one char per hour, a bit mask "0".."7": bit 0 Goldstone, bit 1 Madrid, bit 2 Canberra.
// Earth in view at the site AND codes != "0" is the timeline's dsnVisible (backend test).

export type Complex = { id: string; name: string; dss: string; dss34: string };
export type DsnFile = { startUtc: string; stepMin: number; n: number; thresholdDeg: number; complexes: Complex[]; codes: string };
export type Dsn = { startMs: number; stepMs: number; n: number; complexes: Complex[]; codes: Uint8Array };

/** Lane colours, top to bottom (Goldstone, Madrid, Canberra); CSS variables of dsn.css. */
export const LANE_VARS = ["--dsn-g", "--dsn-m", "--dsn-c"];

export const TITLE =
  "DSN complex that sees the Moon above 10°, the DSN uplink limit (DSN 810-005, module 301P). " +
  "Geometry of the 70 m antennas DSS-14, DSS-63, DSS-43; the 34 m K-band (26 GHz) antennas of the same complexes stand within 10 km. " +
  "Bright where the Earth is in view at the site. No DSN schedule.";

export function decodeDsn(f: DsnFile): Dsn {
  const startMs = Date.parse(f.startUtc);
  if (!Number.isFinite(startMs) || typeof f.codes !== "string" || f.codes.length !== f.n || f.complexes?.length !== 3) {
    throw new Error("dsn_stations.json: bad header or codes length");
  }
  const codes = new Uint8Array(f.n);
  for (let i = 0; i < f.n; i++) {
    const v = f.codes.charCodeAt(i) - 48;
    if (!(v >= 0 && v <= 7)) throw new Error(`dsn_stations.json: bad code "${f.codes[i]}" at step ${i}`);
    codes[i] = v;
  }
  return { startMs, stepMs: f.stepMin * 60_000, n: f.n, complexes: f.complexes, codes };
}

let cache: Promise<Dsn | null> | null = null;
/** Cached per page; a failed load is not cached, so the next mount tries again. */
export function loadDsn(): Promise<Dsn | null> {
  return (cache ??= fetch(`${import.meta.env.BASE_URL}data/beta/dsn_stations.json`, { signal: AbortSignal.timeout(15000) })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<DsnFile>;
    })
    .then(decodeDsn)
    .catch((e) => {
      console.error("BETA DSN stations: failed to load", e);
      cache = null;
      return null;
    }));
}

/** Complexes in view in the hour that holds ms (none outside the data). */
export function complexesAt(d: Dsn, ms: number): Complex[] {
  const i = Math.floor((ms - d.startMs) / d.stepMs);
  if (i < 0 || i >= d.n) return [];
  return d.complexes.filter((_, k) => (d.codes[i] >> k) & 1);
}

/** Complexes over [startMs, endMs) in the order they first see the Moon, and the hours that no complex sees it. */
export function viaComplexes(d: Dsn, startMs: number, endMs: number): { order: Complex[]; gapH: number } | null {
  const i0 = Math.max(0, Math.floor((startMs - d.startMs) / d.stepMs));
  const i1 = Math.min(d.n, Math.ceil((endMs - d.startMs) / d.stepMs));
  if (i1 <= i0) return null;
  const order: number[] = [];
  let gapH = 0;
  for (let i = i0; i < i1; i++) {
    const c = d.codes[i];
    if (!c) gapH += d.stepMs / 3_600_000;
    for (let k = 0; k < 3; k++) if ((c >> k) & 1 && !order.includes(k)) order.push(k);
  }
  return { order: order.map((k) => d.complexes[k]), gapH };
}

/** Row text: "via Madrid, Canberra, 3 h without DSN". */
export function viaText(v: { order: Complex[]; gapH: number }): string {
  if (!v.order.length) return "no DSN complex sees the Moon";
  const names = v.order.map((c) => c.name).join(", ");
  return `via ${names}${v.gapH ? `, ${v.gapH}\u00a0h without DSN` : ""}`;
}
