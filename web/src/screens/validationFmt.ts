// #435: the NASA check formatters in a light module, so the first screen (Hero) shows the same
// value with the same precision as NASA check without loading that screen.
import type { ValidationFile } from "../contracts";

/**
 * A value with its unit at the precision its source supports (#155): angles 0.01° (Apollo
 * references are stated to 0.01–0.1°), below that 0.001° and "< 0.001°" (the ephemeris tolerance is
 * 0.002°); percentages whole (PGDA 69 maps are 18.6-year means); hours whole (hourly samples).
 */
export function fmtValue(x: number | null, unit: string): string {
  if (x === null) return "—";
  const u = unit === "deg" ? "°" : unit === "%" ? " %" : ` ${unit}`;
  if (unit === "deg" && x !== 0 && Math.abs(x) < 0.0005) return `< 0.001${u}`;
  const digits = unit === "deg" ? (Math.abs(x) < 0.01 && x !== 0 ? 3 : 2) : unit === "%" || unit === "h" ? 0 : 2;
  const r = x.toFixed(digits);
  // No "-0": a value that rounds to zero is zero.
  return `${Number(r) === 0 ? r.replace("-", "") : r}${u}`;
}

/** #364: worst error of the graded rows (pass or fail, no INFO, no trap rows) of one group; null when none. */
export function maxError(v: ValidationFile, groupId: string, units: string[]): { value: number; unit: string; n: number } | null {
  const rows = (v.groups.find((g) => g.id === groupId)?.rows ?? []).filter(
    (r) => r.pass !== null && r.diff !== null && units.includes(r.unit) && !r.check.startsWith("Trap check:"),
  );
  if (!rows.length) return null;
  return { value: Math.max(...rows.map((r) => Math.abs(r.diff as number))), unit: rows[0].unit, n: rows.length };
}
