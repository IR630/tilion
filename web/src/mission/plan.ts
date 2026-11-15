// Mission plan: state transitions, the URL link and the JSON file (TZ TLN-TZ-001 §3–4).
// Pure functions; the React hook is useMission.ts.
import type { RouteOption } from "../route/route";
import { DEFAULT_PLAN, type MissionPlan, type MissionState, type Mode, type Waypoint } from "./types";

export const EMPTY_MISSION: MissionState = { plan: null, original: null, selected: null };
export const MODES: Mode[] = ["energy", "comms", "balanced"];
export const FILE_FORMAT = "tilion-mission/1";
// Input limits. The data covers about 13 months, so wider tolerances add nothing.
export const SLIP_LIMIT = 90;
export const MAX_DAYS = 60;
const HOUR_MS = 3_600_000;

/** ISO UTC floored to the whole hour ("2027-03-01T12:00:00Z"), or null for a bad time. */
export function wholeHourUtc(t: string | number): string | null {
  const ms = typeof t === "number" ? t : Date.parse(t);
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.floor(ms / HOUR_MS) * HOUR_MS).toISOString().replace(".000Z", "Z");
}

/** A new plan from a site and a moment; the original is the same plan. */
export function startPlan(siteId: string, landingUtc: string, base: Partial<MissionPlan> = {}): MissionState {
  const plan: MissionPlan = {
    ...DEFAULT_PLAN,
    ...base,
    siteId,
    landingUtc: wholeHourUtc(landingUtc) ?? landingUtc,
  };
  return { plan, original: plan, selected: null };
}

/** "Plan mission from here": a new plan at the site; the tolerances of the open plan carry over. */
export function planFrom(state: MissionState, siteId: string, landingUtc: string): MissionState {
  const p = state.plan;
  const keep = p
    ? { durationDays: p.durationDays, slipMinDays: p.slipMinDays, slipMaxDays: p.slipMaxDays, radiusKm: p.radiusKm, mode: p.mode }
    : {};
  return startPlan(siteId, landingUtc, keep);
}

/** Open a plan from a link or a file: it becomes both current and original. */
export function openPlan(plan: MissionPlan): MissionState {
  return { plan, original: plan, selected: null };
}

/** Edit the current plan. The selection belongs to the old option list, so it is cleared. */
export function editPlan(state: MissionState, patch: Partial<MissionPlan>): MissionState {
  if (!state.plan) return state;
  return { ...state, plan: { ...state.plan, ...patch }, selected: null };
}

/** The timeline sheet (#58) moves the landing moment of the current plan. */
export function moveLanding(state: MissionState, utc: string): MissionState {
  const t = wholeHourUtc(utc);
  if (!state.plan || !t || t === state.plan.landingUtc) return state;
  return editPlan(state, { landingUtc: t });
}

export function selectOption(state: MissionState, option: RouteOption | null): MissionState {
  return { ...state, selected: option };
}

/** "Make current": the selected option becomes the plan; the original stays for comparison. */
export function makeCurrent(state: MissionState, option: RouteOption): MissionState {
  if (!state.plan) return state;
  const landingUtc = wholeHourUtc(option.landingUtc) ?? option.landingUtc;
  return { plan: { ...state.plan, siteId: option.siteId, landingUtc }, original: state.original ?? state.plan, selected: null };
}

export function backToOriginal(state: MissionState): MissionState {
  if (!state.original) return state;
  return { ...state, plan: state.original, selected: null };
}

export function samePlace(a: MissionPlan | null, b: MissionPlan | null): boolean {
  return !!a && !!b && a.siteId === b.siteId && a.landingUtc === b.landingUtc;
}

// ---------- Link: ?site=&t=&days=&slip=-14..30&radius=&mode=&name=&wp= ----------

const LINK_KEYS = ["site", "t", "days", "slip", "radius", "mode", "name", "wp"];

/** Write the plan into a query string, keeping unrelated parameters. */
export function planToQuery(plan: MissionPlan | null, search = ""): string {
  const q = new URLSearchParams(search);
  for (const k of LINK_KEYS) q.delete(k);
  if (plan) {
    q.set("site", plan.siteId);
    q.set("t", plan.landingUtc.replace(":00Z", "Z")); // 2027-03-01T12:00Z
    q.set("days", String(plan.durationDays));
    q.set("slip", `${plan.slipMinDays}..${plan.slipMaxDays}`);
    q.set("radius", Number.isFinite(plan.radiusKm) ? String(plan.radiusKm) : "any");
    q.set("mode", plan.mode);
    if (plan.name && plan.name !== DEFAULT_PLAN.name) q.set("name", plan.name);
    if (plan.waypoints?.length) q.set("wp", JSON.stringify(plan.waypoints));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

const int = (s: string | null, lo: number, hi: number): number | null => {
  if (s === null || !/^[+-]?\d+$/.test(s.trim())) return null;
  const v = Number(s);
  return v >= lo && v <= hi ? v : null;
};

/** Read a plan from a query string. null = no plan or no valid site and time. A bad optional
 *  value falls back to its default and is listed in `warnings`. */
export function planFromQuery(search: string): { plan: MissionPlan; warnings: string[] } | null {
  const q = new URLSearchParams(search);
  const siteId = q.get("site")?.trim();
  const t = q.get("t");
  const landingUtc = t ? wholeHourUtc(/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}Z`) : null;
  if (!siteId || !landingUtc) return null;
  const warnings: string[] = [];
  const plan: MissionPlan = { ...DEFAULT_PLAN, siteId, landingUtc };

  if (q.has("days")) {
    const d = int(q.get("days"), 1, MAX_DAYS);
    if (d === null) warnings.push(`days "${q.get("days")}" ignored`);
    else plan.durationDays = d;
  }
  if (q.has("slip")) {
    const m = /^\s*([+-]?\d+)\s*\.\.\s*([+-]?\d+)\s*$/.exec(q.get("slip") ?? "");
    const lo = m ? int(m[1], -SLIP_LIMIT, SLIP_LIMIT) : null;
    const hi = m ? int(m[2], -SLIP_LIMIT, SLIP_LIMIT) : null;
    if (lo === null || hi === null || lo > hi) warnings.push(`slip "${q.get("slip")}" ignored`);
    else Object.assign(plan, { slipMinDays: lo, slipMaxDays: hi });
  }
  if (q.has("radius")) {
    const r = q.get("radius")?.trim() ?? "";
    const v = Number(r);
    if (r === "any" || r === "") plan.radiusKm = Infinity;
    else if (r !== "" && Number.isFinite(v) && v > 0) plan.radiusKm = v;
    else warnings.push(`radius "${r}" ignored`);
  }
  if (q.has("mode")) {
    const m = q.get("mode") as Mode;
    if (MODES.includes(m)) plan.mode = m;
    else warnings.push(`mode "${m}" ignored`);
  }
  const name = q.get("name")?.trim();
  if (name) plan.name = name.slice(0, 80);
  if (q.has("wp")) {
    try {
      plan.waypoints = parseWaypoints(JSON.parse(q.get("wp") ?? ""));
    } catch (e) {
      warnings.push(`waypoints ignored: ${(e as Error).message}`);
    }
  }
  return { plan, warnings };
}

// ---------- File: {"format": "tilion-mission/1", ...MissionPlan} ----------

export type MissionFile = Omit<MissionPlan, "radiusKm"> & { format: typeof FILE_FORMAT; radiusKm: number | null };

/** JSON has no Infinity: "any distance" is radiusKm: null. */
export function planToJson(plan: MissionPlan): string {
  const file: MissionFile = {
    format: FILE_FORMAT,
    name: plan.name,
    siteId: plan.siteId,
    landingUtc: plan.landingUtc,
    durationDays: plan.durationDays,
    slipMinDays: plan.slipMinDays,
    slipMaxDays: plan.slipMaxDays,
    radiusKm: Number.isFinite(plan.radiusKm) ? plan.radiusKm : null,
    mode: plan.mode,
    ...(plan.waypoints?.length ? { waypoints: plan.waypoints } : {}),
  };
  return JSON.stringify(file, null, 2) + "\n";
}

export function fileName(plan: MissionPlan): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `tilion-mission-${slug(plan.siteId)}-${plan.landingUtc.slice(0, 13).replace("T", "-")}h.json`;
}

function parseWaypoints(v: unknown): Waypoint[] {
  if (!Array.isArray(v)) throw new Error("waypoints must be a list");
  return v.map((w, i) => {
    const o = w as Record<string, unknown>;
    if (!o || typeof o !== "object") throw new Error(`waypoint ${i + 1} is not an object`);
    const { name, lat, lonE, note } = o;
    if (typeof name !== "string" || !name.trim()) throw new Error(`waypoint ${i + 1}: name is missing`);
    if (typeof lat !== "number" || !(lat >= -90 && lat <= 90)) throw new Error(`waypoint ${i + 1}: lat must be −90…90`);
    if (typeof lonE !== "number" || !(lonE >= 0 && lonE < 360)) throw new Error(`waypoint ${i + 1}: lonE must be 0–360°E`);
    if (note !== undefined && typeof note !== "string") throw new Error(`waypoint ${i + 1}: note must be text`);
    return note === undefined ? { name, lat, lonE } : { name, lat, lonE, note };
  });
}

/** Validate a mission file. Every problem is an error: a file is a deliberate input. */
export function planFromJson(text: string): { plan: MissionPlan } | { error: string } {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text);
  } catch {
    return { error: "The file is not valid JSON." };
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { error: "The file is not a mission object." };
  if (o.format !== FILE_FORMAT) {
    return { error: `Unknown format ${JSON.stringify(o.format ?? null)}: expected "${FILE_FORMAT}".` };
  }
  const errs: string[] = [];
  const isInt = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
  if (typeof o.siteId !== "string" || !o.siteId.trim()) errs.push("siteId is missing");
  const landingUtc =
    typeof o.landingUtc === "string" && /T.*(Z|[+-]\d\d:?\d\d)$/.test(o.landingUtc) ? wholeHourUtc(o.landingUtc) : null;
  if (!landingUtc) errs.push("landingUtc must be an ISO UTC time, e.g. 2027-03-01T12:00:00Z");
  if (!isInt(o.durationDays, 1, MAX_DAYS)) errs.push(`durationDays must be a whole number 1–${MAX_DAYS}`);
  if (!isInt(o.slipMinDays, -SLIP_LIMIT, SLIP_LIMIT)) errs.push(`slipMinDays must be a whole number ±${SLIP_LIMIT}`);
  if (!isInt(o.slipMaxDays, -SLIP_LIMIT, SLIP_LIMIT)) errs.push(`slipMaxDays must be a whole number ±${SLIP_LIMIT}`);
  if (isInt(o.slipMinDays, -SLIP_LIMIT, SLIP_LIMIT) && isInt(o.slipMaxDays, -SLIP_LIMIT, SLIP_LIMIT) && (o.slipMinDays as number) > (o.slipMaxDays as number)) {
    errs.push("slipMinDays is greater than slipMaxDays");
  }
  if (!(o.radiusKm === null || (typeof o.radiusKm === "number" && o.radiusKm > 0 && Number.isFinite(o.radiusKm)))) {
    errs.push("radiusKm must be a positive number or null (any distance)");
  }
  if (!MODES.includes(o.mode as Mode)) errs.push(`mode must be one of ${MODES.join(", ")}`);
  if (o.name !== undefined && typeof o.name !== "string") errs.push("name must be text");
  let waypoints: Waypoint[] | undefined;
  if (o.waypoints !== undefined) {
    try {
      waypoints = parseWaypoints(o.waypoints);
    } catch (e) {
      errs.push((e as Error).message);
    }
  }
  if (errs.length) return { error: `The mission file is invalid: ${errs.join("; ")}.` };
  const plan: MissionPlan = {
    name: ((o.name as string | undefined)?.trim() || DEFAULT_PLAN.name).slice(0, 80),
    siteId: (o.siteId as string).trim(),
    landingUtc: landingUtc as string,
    durationDays: o.durationDays as number,
    slipMinDays: o.slipMinDays as number,
    slipMaxDays: o.slipMaxDays as number,
    radiusKm: o.radiusKm === null ? Infinity : (o.radiusKm as number),
    mode: o.mode as Mode,
  };
  if (waypoints?.length) plan.waypoints = waypoints;
  return { plan };
}
