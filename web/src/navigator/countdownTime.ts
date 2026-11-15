import type { Terrain, Timeline } from "../contracts";
import { stepsToChange, SUN_DIAMETER_DEG, wrapAz } from "../screens/Horizon";
import { fmtUntil } from "../format";
import { stepIndex } from "../summary";

/** Next flag transition on the hourly grid; null time means no event in the remaining data. */
export function nextVisibilityEvent(tl: Timeline, atUtc: string, body: "sun" | "earth" | "dsn"): {
  index: number | null; hours: number | null; utc: string | null; leftH: number;
} | null {
  const stepMs = tl.stepMin * 60000;
  const start = Date.parse(tl.startUtc);
  const i = stepIndex(tl, atUtc);
  const flags = body === "sun" ? tl.sunVisible : body === "earth" ? tl.earthVisible : tl.dsnVisible;
  if (!flags) return null;
  if (!(i >= 0 && i < flags.length)) return null;
  const steps = stepsToChange(flags, i);
  const index = steps === null ? null : i + steps;
  return {
    index,
    hours: steps === null ? null : steps * tl.stepMin / 60,
    utc: index === null ? null : new Date(start + index * stepMs).toISOString().replace(".000Z", "Z"),
    leftH: (flags.length - 1 - i) * tl.stepMin / 60,
  };
}

/** Use the first hidden sample: terrain hides a disc whose upper limb is still above zero. */
export function sunsetDirection(tl: Timeline, i: number, terrain: Terrain): string {
  if (terrain === "none" || tl.sunEl[i] + SUN_DIAMETER_DEG / 2 <= 0) return "below horizon";
  const az = wrapAz(tl.sunAz[i]);
  const compass = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return `behind terrain, ${compass[Math.round(az / 22.5) % 16]}, az ${Math.round(az) % 360}°`;
}

export function sunsetTone(hours: number | null): string {
  return hours === null ? "neutral" : hours < 12 ? "red" : hours <= 48 ? "yellow" : "green";
}

const CARD_WORDS = {
  sun: ["Up", "Down", "sets", "rises"],
  earth: ["In view", "Hidden", "sets", "rises"],
  dsn: ["Up", "Down", "ends", "opens"],
} as const;

/** #371: one card of the status strip. State and "sets in 2.9 d" from the next flag change; no series = no data. */
export function statusCard(tl: Timeline, atUtc: string, body: "sun" | "earth" | "dsn"): { state: string; up: boolean; when: string } {
  const e = nextVisibilityEvent(tl, atUtc, body);
  if (!e) return { state: "", up: false, when: body === "dsn" && !tl.dsnVisible ? "no DSN data" : "no data" };
  const flags = body === "sun" ? tl.sunVisible : body === "earth" ? tl.earthVisible : tl.dsnVisible!;
  const up = flags[stepIndex(tl, atUtc)] > 0;
  const [on, off, set, rise] = CARD_WORDS[body];
  return { state: up ? on : off, up, when: `${up ? set : rise} in ${fmtUntil(e.hours ?? e.leftH, e.hours === null)}` };
}
