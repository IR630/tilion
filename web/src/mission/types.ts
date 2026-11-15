// Mission plan shared by the route panel (#57) and the timeline/calendar sheet (#58). D-004, TZ TLN-TZ-001 §3–4.
import type { RouteOption } from "../route/route";

export type Mode = "energy" | "comms" | "balanced";

/** The mission the operator works on: where and when to land, and what slips are allowed. */
export type MissionPlan = {
  name: string;
  siteId: string; // a site from sites.json with a timeline (hours.json)
  landingUtc: string; // ISO UTC, whole hours
  durationDays: number; // surface window, default 14
  slipMinDays: number; // default -14
  slipMaxDays: number; // default 30
  radiusKm: number; // Infinity = any site
  mode: Mode;
  waypoints?: Waypoint[]; // user points of interest; kept in the link and the file, no UI yet
};

export type Waypoint = { name: string; lat: number; lonE: number; note?: string };

/** App-level mission state. The original plan stays for comparison after an option becomes current. */
export type MissionState = {
  plan: MissionPlan | null; // the current (actual) plan
  original: MissionPlan | null; // the plan as first opened (link, file or "Plan mission from here")
  selected: RouteOption | null; // option highlighted in the route list / on the map / on the timeline
};

/** Search radius of a NEW plan. Infinity ("any") stays selectable and is kept when a link or file says so. */
export const DEFAULT_RADIUS_KM = 150;

export const DEFAULT_PLAN: Omit<MissionPlan, "siteId" | "landingUtc"> = {
  name: "Untitled mission",
  durationDays: 14,
  slipMinDays: -14,
  slipMaxDays: 30,
  radiusKm: DEFAULT_RADIUS_KM, // alternatives in the same region; a link or file may still say "any"
  mode: "balanced",
};
