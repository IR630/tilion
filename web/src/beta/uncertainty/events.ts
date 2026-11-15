// BETA horizon uncertainty (#379): sunset and Earthset time band from the LOLA height error.
// Data: web/public/data/beta/uncertainty_events.json from backend/src/precompute/beta_uncertainty.py.
// Per site and body, three 0/1 hourly series (nominal mask, terrain +1σ "raised", terrain −1σ "lowered"),
// each stored as the state at hour 0 and the hour indices where it changes.
// Raised and lowered horizon masks define a time band around each event.

export type Series = { start: 0 | 1; flips: number[] };
export type BodyEvents = { nominal: Series; raised: Series; lowered: Series };
export type EventsRow = { siteId: string; sun: BodyEvents; earth: BodyEvents };
export type EventsFile = { version: 1; startUtc: string; stepMin: number; hours: number; sigma: string; note: string; sites: EventsRow[] };

const url = `${import.meta.env.BASE_URL}data/beta/uncertainty_events.json`;

let filePromise: Promise<EventsFile | null> | null = null;
export const loadEvents = () =>
  (filePromise ??= fetch(url, { signal: AbortSignal.timeout(15000) })
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json() as Promise<EventsFile>;
    })
    .catch((e) => {
      console.error(`BETA uncertainty: failed to load ${url}`, e);
      filePromise = null;
      return null;
    }));

/** State (0/1) of the series at hour index i. */
export function stateAt(s: Series, i: number): number {
  let n = 0;
  for (const f of s.flips) if (f <= i) n++;
  return (s.start + n) % 2;
}

/** First index > i where the series turns off (1 to 0), or null if it stays on to the end of the data. */
function nextOff(s: Series, i: number): number | null {
  for (const f of s.flips) if (f > i && stateAt(s, f) === 0) return f;
  return null;
}

/** Last index in (from, to] where the series turns off, or null. */
function lastOff(s: Series, from: number, to: number): number | null {
  let out: number | null = null;
  for (const f of s.flips) if (f > from && f <= to && stateAt(s, f) === 0) out = f;
  return out;
}

/**
 * Next set (Sun or Earth) at hour index i over the nominal mask, and how far it moves under the raised and
 * lowered masks, in steps. Raised terrain only hides, so its set is the last one inside the nominal lit run
 * (never later); lowered terrain only reveals, so its set is the first one at or after the nominal set (never
 * earlier). A raised set before i counts as i (under +1σ the body is already down). Null when the body is not
 * up at i, or there is no nominal set in the data.
 */
export function setSpread(b: BodyEvents, i: number, hours: number): { at: number; early: number; late: number } | null {
  if (i < 0 || i >= hours || stateAt(b.nominal, i) !== 1) return null;
  const at = nextOff(b.nominal, i);
  if (at === null) return null;
  let rise = 0;
  for (const f of b.nominal.flips) if (f <= i) rise = f;
  const raised = lastOff(b.raised, rise, at);
  const lowered = nextOff(b.lowered, at - 1) ?? hours;
  return { at, early: at - Math.max(raised ?? i, i), late: lowered - at };
}

/** "±N h" (the larger side); "(±<1 h)" when all masks set in the same hourly step; "(±>2 d)" above 48 h, where
 *  one mask bridges a short night (or opens one) and the next set moves to another lit period (#441). */
export function fmtSpread(early: number, late: number, stepMin: number): string {
  const h = (Math.max(early, late) * stepMin) / 60;
  if (h < 1) return "(±<1 h)";
  return h <= 48 ? `±${Math.round(h)} h` : "(±>2 d)";
}

const side = (steps: number, stepMin: number) => {
  const h = Math.round((steps * stepMin) / 60);
  return h > 48 ? `${h} h (${Math.round(h / 24)} d)` : `${h} h`;
};

/** Tooltip: both sides apart; why a side jumps past 48 h. */
export function spreadTip(what: string, early: number, late: number, stepMin: number): string {
  const long = (steps: number) => (steps * stepMin) / 60 > 48;
  return (
    `${what} with the terrain 1σ higher: ${side(early, stepMin)} earlier` +
    (long(early) ? " (a short night appears at +1σ)" : "") +
    `; 1σ lower: ${side(late, stepMin)} later` +
    (long(late) ? " (a short night disappears at −1σ)" : "") +
    "."
  );
}
