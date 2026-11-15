// The moment the app opens on (#377): the current UTC hour, held inside the data range.
// The range comes from time.ts (T0, T1), which reads it from api.ts: no second copy here.
import { fmtExact, HOUR, isoUtc, T0, T1 } from "./time";

/** How the opening moment relates to the real now: inside the data, or held at an end of it. */
export type OpenKind = "now" | "before" | "after";

/** The current UTC hour, clamped to the data range, and which case it is. */
export function openMoment(nowMs = Date.now()): { utc: string; kind: OpenKind } {
  const hour = Math.floor(nowMs / HOUR) * HOUR;
  if (hour < T0) return { utc: isoUtc(T0), kind: "before" };
  if (hour > T1) return { utc: isoUtc(T1), kind: "after" };
  return { utc: isoUtc(hour), kind: "now" };
}

/** The line that names the moment in use. Another moment than the opening one: just "At <time> UTC". */
export function momentLine(atUtc: string, nowMs = Date.now()): string {
  const open = openMoment(nowMs);
  const t = `${fmtExact(atUtc)} UTC`;
  if (atUtc !== open.utc) return `At ${t}.`;
  if (open.kind === "now") return `Now, ${t}.`;
  return open.kind === "before" ? `Data starts ${t}; now is earlier.` : `Data ends ${t}; now is later.`;
}
