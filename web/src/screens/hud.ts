// #95 shared helpers of the HUD screens: human time formats. #162: one format for the whole UI (format.ts).
import { fmtDuration, fmtDurationRange, fmtUntil } from "../format";

/** Hours without a unit: one decimal under 10 h, whole hours above. */
export function hoursNum(h: number): string {
  return h < 10 && !Number.isInteger(h) ? h.toFixed(1) : String(Math.round(h));
}

/** Hours as a person reads them: "7.5 h", "31 h", "8.9 d" (days from 48 h). */
export const humanHours = fmtDuration;

/** Longer than the rest of the period: "> 30.0 d", "> 40 h". */
export function moreThan(h: number): string {
  return fmtUntil(h, true);
}

/** Spread "197–214 h", "3.2–8.9 d"; null when the low and high ends read the same. */
export function spreadHours(lo: number, hi: number): string | null {
  return fmtDurationRange(lo, hi);
}
