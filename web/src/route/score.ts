// Route score (#160): one 0–100 number per option (landing site × date, later a traverse), built
// from measured hourly visibility terms. Each term is 0..1 with an explicit threshold; the score
// is the weighted sum × 100. Pure functions; the UI shows the per-term breakdown.
//
//   score = 100 × (wP·P + wN·N + wC·C + wG·G + wM·M)
//
//   P  Power          sunlit share of the window            sunH / windowH
//   N  Night survival battery margin left after the longest  1 − min(1, longestDarkH / 50 h)
//                     night (constant survival load)
//   C  Comms          Earth-in-view share of the window      earthH / windowH
//   G  Blackout       longest comms gap as a window share     1 − longestNoCommsH / windowH
//   M  Sunset margin  Sun after touchdown for checkout and    min(1, hoursToSunset / 48 h); 0 = dark landing
//                     first charge
//
// Sources and assumptions:
//   50 h  VIPER survives about 50 h of continuous shadow in minimal power mode; "Safe Havens" are
//         spots with < 50 h shadow (NASA NTRS 20220008301, SpaceOps 2022 VIPER planning;
//         NTRS 20230004239, Ennico 2023). Mission assumption: a VIPER-class battery.
//   48 h  Mission assumption: touchdown, panel deployment, checkout and the first charge take up to
//         2 Earth days of Sun. Not a published constant.
//   Earth = Earth centre above the LOLA terrain horizon (geometric DTE opportunity, Q9). No DSN
//         schedule or link budget; DSN in view is shown beside the score, not in it.
// Data: hourly steps (D-006), so every hour count is ±1 h and the score is ±1 point.

import { EARTH, SUN, type SiteHours } from "./hours";

export type TermId = "power" | "night" | "comms" | "blackout" | "margin";
export type ScoreMode = "energy" | "comms" | "balanced";

/** Thresholds of the terms. */
export const SURVIVAL_H = 50;
export const CHECKOUT_H = 48;

export const TERMS: { id: TermId; label: string; what: string; source: string }[] = [
  { id: "power", label: "Power", what: "Sunlit share of the window", source: "solar power only while the Sun is visible" },
  { id: "night", label: "Night", what: `Battery margin after the longest night: 1 − night / ${SURVIVAL_H} h`, source: `assumption: a VIPER-class battery, which survives ≈ ${SURVIVAL_H} h of shadow (NASA NTRS 20220008301)` },
  { id: "comms", label: "Comms", what: "Earth-in-view share of the window", source: "Earth centre above the terrain horizon, geometric only" },
  { id: "blackout", label: "Blackout", what: "1 − longest comms gap / window", source: "one long gap is worse than several short ones with the same total" },
  { id: "margin", label: "Sunset margin", what: `Sun after touchdown: hours to sunset / ${CHECKOUT_H} h`, source: `assumption: checkout and first charge need ${CHECKOUT_H} h of Sun` },
];

/** Weights per ranking mode; each row sums to 1. "balanced" is the default and goes on the slide. */
export const WEIGHTS: Record<ScoreMode, Record<TermId, number>> = {
  balanced: { power: 0.3, night: 0.25, comms: 0.2, blackout: 0.15, margin: 0.1 },
  energy: { power: 0.45, night: 0.35, comms: 0.05, blackout: 0.05, margin: 0.1 },
  comms: { power: 0.1, night: 0.1, comms: 0.4, blackout: 0.3, margin: 0.1 },
};

/** What the score reads. route.ts Metrics fits it. */
export type ScoreInput = {
  windowH: number;
  sunH: number;
  earthH: number;
  longestDarkH: number;
  longestNoCommsH: number;
  hoursToSunset: number | null; // null = Sun down at touchdown
};

export type Term = { id: TermId; value: number; weight: number; points: number };
export type Score = {
  total: number; // 0..100, not rounded
  terms: Term[];
  /** The longest night is longer than the survival limit. */
  nightOverLimit: boolean;
};

const clamp01 = (x: number) => (x > 1 ? 1 : x > 0 ? x : 0);

/** Term values 0..1. A zero-length window gives zeros. */
export function termValues(m: ScoreInput): Record<TermId, number> {
  const w = m.windowH;
  if (!(w > 0)) return { power: 0, night: 0, comms: 0, blackout: 0, margin: 0 };
  return {
    power: clamp01(m.sunH / w),
    night: 1 - clamp01(m.longestDarkH / SURVIVAL_H),
    comms: clamp01(m.earthH / w),
    blackout: 1 - clamp01(m.longestNoCommsH / w),
    margin: m.hoursToSunset === null ? 0 : clamp01(m.hoursToSunset / CHECKOUT_H),
  };
}

export function scoreOf(m: ScoreInput, mode: ScoreMode = "balanced"): Score {
  const v = termValues(m);
  const w = WEIGHTS[mode];
  const terms = TERMS.map(({ id }) => ({ id, value: v[id], weight: w[id], points: 100 * w[id] * v[id] }));
  return { total: terms.reduce((s, t) => s + t.points, 0), terms, nightOverLimit: m.longestDarkH > SURVIVAL_H };
}

/** Number of separate runs of a visibility bit over steps [from, to): "light windows", "comms windows".
 *  A run that is already on at `from` counts. */
export function countWindows(codes: Uint8Array, bit: number, from: number, to: number): number {
  let n = 0;
  let on = false;
  for (let i = Math.max(0, from); i < Math.min(codes.length, to); i++) {
    const v = (codes[i] & bit) !== 0;
    if (v && !on) n++;
    on = v;
  }
  return n;
}

export const lightWindows = (s: SiteHours, from: number, to: number) => countWindows(s.codes, SUN, from, to);
export const commsWindows = (s: SiteHours, from: number, to: number) => countWindows(s.codes, EARTH, from, to);

const LABEL = Object.fromEntries(TERMS.map((t) => [t.id, t.label])) as Record<TermId, string>;

/** Why the best option beats the runner-up: the terms that add the most points, in words.
 *  Returns "" when there is no runner-up. */
export function whyBest(best: ScoreInput, next: ScoreInput | null, mode: ScoreMode = "balanced"): string {
  if (!next) return "";
  const a = scoreOf(best, mode);
  const b = scoreOf(next, mode);
  const lead = a.terms
    .map((t, i) => ({ id: t.id, d: t.points - b.terms[i].points }))
    .filter((x) => x.d >= 0.5)
    .sort((x, y) => y.d - x.d)
    .slice(0, 2);
  if (a.total - b.total < 1 || lead.length === 0) return "ties with the next option on score; the smaller date slip and distance decide";
  const say = (id: TermId) => {
    const pct = (h: number, w: number) => `${Math.round((100 * h) / w)} %`;
    switch (id) {
      case "power":
        return `more sunlight (${pct(best.sunH, best.windowH)} vs ${pct(next.sunH, next.windowH)})`;
      case "night":
        return `a shorter longest night (${Math.round(best.longestDarkH)} h vs ${Math.round(next.longestDarkH)} h)`;
      case "comms":
        return `more Earth in view (${pct(best.earthH, best.windowH)} vs ${pct(next.earthH, next.windowH)})`;
      case "blackout":
        return `a shorter comms gap (${Math.round(best.longestNoCommsH)} h vs ${Math.round(next.longestNoCommsH)} h)`;
      case "margin": {
        const h = (x: number | null) => (x === null ? "dark landing" : `${Math.round(x)} h`);
        return `more Sun after touchdown (${h(best.hoursToSunset)} vs ${h(next.hoursToSunset)})`;
      }
    }
  };
  return `${lead.map((x) => say(x.id)).join(" and ")}: +${Math.round(a.total - b.total)} points over #2 (${lead.map((x) => LABEL[x.id]).join(", ")})`;
}
