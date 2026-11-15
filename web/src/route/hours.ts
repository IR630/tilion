// Hourly Sun/Earth visibility codes (D-006) decoded for fast window queries.
// data/hours.json: {startUtc, stepMin, n, sites: {id: "0123..."}}, one char per step:
// 0 none, 1 Sun (sunVisible > 0), 2 Earth (earthVisible > 0), 3 both.

export type HoursFile = { startUtc: string; stepMin: number; n: number; sites: Record<string, string> };

/** One site: raw codes, prefix sums (pre[i] = count over steps [0, i)) and
 *  next-loss indexes (sunLoss[i] = first step >= i without Sun, n if none). */
export type SiteHours = {
  codes: Uint8Array;
  sunPre: Int32Array;
  earthPre: Int32Array;
  bothPre: Int32Array;
  sunLoss: Int32Array;
  earthLoss: Int32Array;
};

export type Hours = {
  startMs: number;
  stepMin: number;
  n: number;
  sites: Map<string, SiteHours>;
};

export const SUN = 1;
export const EARTH = 2;

/** Decode one code string. Prefix sums and next-loss indexes make window sums and
 *  "hours to sunset / Earthset" O(1). A string of the wrong length or with a character other
 *  than 0–3 throws: a damaged file must not read as darkness. */
export function decodeSite(s: string, n: number, id = "?"): SiteHours {
  if (typeof s !== "string" || s.length !== n) {
    throw new Error(`hours.json: site ${id} has ${typeof s === "string" ? s.length : typeof s} codes, expected ${n}`);
  }
  const codes = new Uint8Array(n);
  const sunPre = new Int32Array(n + 1);
  const earthPre = new Int32Array(n + 1);
  const bothPre = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = s.charCodeAt(i) - 48; // '0' = 48
    if (!(v >= 0 && v <= 3)) throw new Error(`hours.json: site ${id} has a bad code "${s[i]}" at step ${i}`);
    codes[i] = v;
    const sun = v & SUN ? 1 : 0;
    const earth = v & EARTH ? 1 : 0;
    sunPre[i + 1] = sunPre[i] + sun;
    earthPre[i + 1] = earthPre[i] + earth;
    bothPre[i + 1] = bothPre[i] + (sun & earth);
  }
  const sunLoss = new Int32Array(n);
  const earthLoss = new Int32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    sunLoss[i] = codes[i] & SUN ? (i + 1 < n ? sunLoss[i + 1] : n) : i;
    earthLoss[i] = codes[i] & EARTH ? (i + 1 < n ? earthLoss[i + 1] : n) : i;
  }
  return { codes, sunPre, earthPre, bothPre, sunLoss, earthLoss };
}

export function decodeHours(file: HoursFile): Hours {
  const startMs = Date.parse(file.startUtc);
  if (!Number.isFinite(startMs)) throw new Error(`hours.json: bad startUtc ${file.startUtc}`);
  if (!(file.stepMin > 0)) throw new Error(`hours.json: bad stepMin ${file.stepMin}`);
  if (!Number.isInteger(file.n) || file.n < 0) throw new Error(`hours.json: bad n ${file.n}`);
  const sites = new Map<string, SiteHours>();
  for (const [id, s] of Object.entries(file.sites)) sites.set(id, decodeSite(s, file.n, id));
  return { startMs, stepMin: file.stepMin, n: file.n, sites };
}

/** Encode 0/1 series into a D-006 code string (used to build hours.json from timelines). */
export function encodeCodes(sunVisible: ArrayLike<number>, earthVisible: ArrayLike<number>): string {
  let s = "";
  for (let i = 0; i < sunVisible.length; i++) {
    s += String((sunVisible[i] > 0 ? SUN : 0) | (earthVisible[i] > 0 ? EARTH : 0));
  }
  return s;
}

let cache: Promise<Hours> | null = null;

/** Fetch data/hours.json once and decode it. A failed fetch is not cached, so a retry can work. */
export function hoursLoader(fetchFn: typeof fetch = fetch): Promise<Hours> {
  if (!cache) {
    cache = fetchFn(`${import.meta.env.BASE_URL}data/hours.json`, { signal: AbortSignal.timeout(15000) })
      .then((r) => {
        if (!r.ok) throw new Error(`hours.json: HTTP ${r.status}`);
        return r.json() as Promise<HoursFile>;
      })
      .then(decodeHours);
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

/** Test hook: forget the cached file. */
export function resetHoursCache(): void {
  cache = null;
}
