// #282: "the landing date slips" on the place card — the same site at −3…+3 days, each over the next
// `days` days of the precomputed timeline. Shares and the longest dark run; no new numbers.
import type { Timeline } from "../contracts";
import { stepIndex } from "../summary";

export type SlipRow = { slipD: number; atUtc: string; sun: number; earth: number; longestDarkH: number } | null;

export const SLIPS = [-3, -1, 0, 1, 3];

export function slipRows(tl: Timeline, atUtc: string, days = 14, slips = SLIPS): SlipRow[] {
  const per = (days * 24 * 60) / tl.stepMin;
  return slips.map((d) => {
    const t = new Date(Date.parse(atUtc) + d * 86_400_000).toISOString().replace(".000Z", "Z");
    const i = stepIndex(tl, t);
    if (i < 0 || i + per > tl.sunVisible.length) return null;
    let sun = 0, earth = 0, dark = 0, run = 0;
    for (let k = i; k < i + per; k++) {
      if (tl.sunVisible[k] > 0) (sun++, (run = 0));
      else dark = Math.max(dark, ++run);
      if (tl.earthVisible[k] > 0) earth++;
    }
    return { slipD: d, atUtc: t, sun: sun / per, earth: earth / per, longestDarkH: (dark * tl.stepMin) / 60 };
  });
}
