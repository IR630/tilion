// Mission itinerary (#72): the "turn-by-turn" list of a landing window. Landing, then every
// Sun and Earth transition inside the window in time order, then the window end.
// Pure function over the hourly codes of hours.json (D-006): a transition at step i means the
// state at step i differs from the state at step i − 1.
import { EARTH, SUN, type Hours } from "../route/hours";
import { indexAt } from "../route/route";

export type StepKind = "landing" | "sunrise" | "sunset" | "earthrise" | "earthset" | "end";

export type ItineraryStep = {
  kind: StepKind;
  utc: string; // ISO UTC of the step start
  offsetH: number; // hours from landing
};

export type Itinerary = {
  steps: ItineraryStep[]; // landing, events (at most maxEvents), end
  sunUp: boolean; // at landing
  earthUp: boolean; // at landing
  hidden: number; // events in the window not listed (over maxEvents)
  clipped: boolean; // the data ends inside the window: "end" is the data end
};

export const STEP_LABEL: Record<StepKind, string> = {
  landing: "Landing",
  sunrise: "Sunrise",
  sunset: "Sunset",
  earthrise: "Earthrise",
  earthset: "Earthset",
  end: "Window ends",
};

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

/** Itinerary of the window [landing, landing + windowDays) at one site; null when the site has
 *  no codes or the landing is outside the data. Sun events come before Earth events of the same step. */
export function itinerary(hours: Hours, siteId: string, landingUtc: string, windowDays: number, maxEvents = 40): Itinerary | null {
  const s = hours.sites.get(siteId);
  const i0 = indexAt(hours, Date.parse(landingUtc));
  if (!s || !(i0 >= 0 && i0 < hours.n)) return null;
  const stepMs = hours.stepMin * 60_000;
  const want = Math.round((windowDays * 24 * 60) / hours.stepMin);
  const i1 = Math.min(i0 + want, hours.n);
  const at = (i: number): ItineraryStep["utc"] => iso(hours.startMs + i * stepMs);
  const off = (i: number) => ((i - i0) * hours.stepMin) / 60;

  const steps: ItineraryStep[] = [{ kind: "landing", utc: at(i0), offsetH: 0 }];
  let hidden = 0;
  const push = (kind: StepKind, i: number) => {
    if (steps.length - 1 < maxEvents) steps.push({ kind, utc: at(i), offsetH: off(i) });
    else hidden++;
  };
  for (let i = i0 + 1; i < i1; i++) {
    const a = s.codes[i - 1];
    const b = s.codes[i];
    if (a === b) continue;
    if ((a ^ b) & SUN) push(b & SUN ? "sunrise" : "sunset", i);
    if ((a ^ b) & EARTH) push(b & EARTH ? "earthrise" : "earthset", i);
  }
  steps.push({ kind: "end", utc: at(i1), offsetH: off(i1) });
  return {
    steps,
    sunUp: (s.codes[i0] & SUN) !== 0,
    earthUp: (s.codes[i0] & EARTH) !== 0,
    hidden,
    clipped: i0 + want > hours.n,
  };
}

/** "+61 h" from landing; "0 h" for the landing itself. */
export function fmtOffset(h: number): string {
  return h === 0 ? "0 h" : `+${Math.round(h)} h`;
}

/** Index of the step the moment falls in: the last step at or before atUtc; −1 before landing
 *  or after the window end. */
export function activeStep(steps: ItineraryStep[], atUtc: string): number {
  const t = Date.parse(atUtc);
  if (steps.length === 0 || t < Date.parse(steps[0].utc) || t > Date.parse(steps[steps.length - 1].utc)) return -1;
  let k = 0;
  for (let j = 0; j < steps.length; j++) if (Date.parse(steps[j].utc) <= t) k = j;
  return k;
}
