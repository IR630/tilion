// First-screen texts of the Horizon overlay (#362): one verdict line and the Earth window KPI.
// Pure functions over numbers the screen already has; nothing is computed from the ephemeris here.
import { fmtClearance } from "../format";
import { humanHours, moreThan } from "./hud";

/** Steps from index i until the flag changes state; null = no change before the data ends. */
function runEnd(flags: number[], i: number): number | null {
  const now = flags[i] > 0;
  for (let k = i + 1; k < flags.length; k++) if (flags[k] > 0 !== now) return k - i;
  return null;
}

/**
 * "Sun up 3.2°. Sets in 41 h." / "Sun hidden. Rises in 5 h." / "Sun up 3.2°. No sunset in the data (> 30 d)."
 * sunFrac is the flux share (D-010): above 0 means any part of the disc is above the terrain.
 * when/none come from nextEventParts: "in 41 h", or the open upper bound when the event is not in the data.
 */
export function heroVerdict(sunEl: number, sunFrac: number, next: { none: boolean; when: string }, clearDeg: number | null = null): string {
  if (sunFrac > 0) {
    // #450: the same words as the Sun card: above terrain, then above level in brackets.
    const head = `Sun up, ${fmtClearance(clearDeg, sunEl, true)}.`;
    return next.none ? `${head} No sunset in the data (${next.when}).` : `${head} Sets ${next.when}.`;
  }
  const head = `Sun hidden${sunEl > 0 ? " behind terrain" : ""}.`;
  return next.none ? `${head} No sunrise in the data (${next.when}).` : `${head} Rises ${next.when}.`;
}

/** Earth communication window KPI: the open window now, or the next one with its length. */
export type EarthWindow = { value: string; foot: string; open: boolean };

export function earthWindow(flags: number[], i: number, stepMin: number): EarthWindow {
  const h = (s: number) => (s * stepMin) / 60;
  const left = h(flags.length - 1 - i);
  const open = flags[i] > 0;
  if (open) {
    const end = runEnd(flags, i);
    return { open, value: "open now", foot: end === null ? `no close in the data (${moreThan(left)})` : `closes in ${humanHours(h(end))}` };
  }
  const start = runEnd(flags, i);
  if (start === null) return { open, value: "none", foot: `no window in the data (${moreThan(left)})` };
  const len = runEnd(flags, i + start);
  return { open, value: `in ${humanHours(h(start))}`, foot: len === null ? "open to the data end" : `lasts ${humanHours(h(len))}` };
}
