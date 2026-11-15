// Rover traverse along the mission waypoints (#160): landing site → WP1 → WP2 → … at a fixed mean
// speed, from the landing moment. For every hour the rover is on a leg we read the hourly Sun and
// Earth visibility of the nearer leg end (the precomputed site timeline, or the in-browser custom
// point timeline, D-009/D-013). Pure functions; the hook is useTraverse.ts.
import type { ScoreInput } from "../route/score";
import { distanceKm } from "./waypoints";

/** The one rover speed of every drive time (traverse, drive profile; #195): the VIPER planning mean
 *  of about 1 cm/s = 36 m/h. VIPER moves at 10–20 cm/s but stops every ~4.5 m for the ground to
 *  plan the next step (science.nasa.gov/mission/viper/lunar-operations), so it waits ~90 % of the
 *  time (NASA NTRS 20220008301, SpaceOps 2022). The moving speed alone would read 10× too fast. */
export const ROVER_M_PER_H = 36;

/** Display bins of comms on a leg: share of the leg hours with the Earth centre in view. */
export const COMMS_GOOD = 0.8;
export const COMMS_POOR = 0.4;
export type Level = "good" | "partial" | "poor" | "pending";

export type Vertex = { name: string; lat: number; lonE: number };
/** Hourly 0/1 series at one point. dsn is absent for custom points. */
export type Series = { startMs: number; stepMin: number; sun: ArrayLike<number>; earth: ArrayLike<number>; dsn?: ArrayLike<number>; terrain: boolean };

export type Leg = {
  from: string;
  to: string;
  km: number;
  startMs: number;
  hours: number; // planned hours on the leg at ROVER_M_PER_H (whole steps, at least 1)
  counted: number; // hours inside the data (less when the data ends)
  sunShare: number | null; // null = timelines pending or no hour inside the data
  earthShare: number | null;
  dsnShare: number | null; // null when a leg end has no DSN series
  level: Level;
};

export type Traverse = {
  legs: Leg[];
  km: number;
  hours: number;
  /** Score input over the whole drive, or null while a timeline is pending. */
  input: (ScoreInput & { sunWindows: number; commsWindows: number }) | null;
  clipped: boolean; // the drive runs past the data end
  noTerrain: string[]; // vertices without LOLA terrain (bare sphere)
};

const HOUR_MS = 3_600_000;

export function levelOf(share: number | null): Level {
  if (share === null) return "pending";
  return share >= COMMS_GOOD ? "good" : share >= COMMS_POOR ? "partial" : "poor";
}

function at(s: Series, t: number): number {
  const i = Math.floor((t - s.startMs) / (s.stepMin * 60_000));
  return i >= 0 && i < s.sun.length && i < s.earth.length ? i : -1;
}

/** The traverse over vertices[0] (landing) → … with one series per vertex (null = pending). */
export function planTraverse(vertices: Vertex[], series: (Series | null)[], landingMs: number, mPerH = ROVER_M_PER_H): Traverse {
  const legs: Leg[] = [];
  const sun: number[] = [];
  const earth: number[] = [];
  let clipped = false;
  let t = landingMs;
  const ready = series.every((s) => s !== null);
  for (let i = 0; i + 1 < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const km = distanceKm(a.lat, a.lonE, b.lat, b.lonE);
    const hours = Math.max(1, Math.round((km * 1000) / mPerH));
    const sa = series[i];
    const sb = series[i + 1];
    let counted = 0, s = 0, e = 0, d = 0;
    const withDsn = !!sa?.dsn && !!sb?.dsn;
    if (sa && sb) {
      for (let k = 0; k < hours; k++) {
        const ts = t + k * HOUR_MS;
        const src = (k + 0.5) / hours < 0.5 ? sa : sb; // nearer leg end
        const j = at(src, ts);
        if (j < 0) {
          clipped = true;
          break;
        }
        counted++;
        const sv = src.sun[j] > 0 ? 1 : 0;
        const ev = src.earth[j] > 0 ? 1 : 0;
        s += sv;
        e += ev;
        if (withDsn) d += (src.dsn as ArrayLike<number>)[j] > 0 ? 1 : 0;
        if (ready) {
          sun.push(sv);
          earth.push(ev);
        }
      }
    }
    const share = (x: number) => (sa && sb && counted > 0 ? x / counted : null);
    legs.push({
      from: a.name,
      to: b.name,
      km,
      startMs: t,
      hours,
      counted,
      sunShare: share(s),
      earthShare: share(e),
      dsnShare: withDsn ? share(d) : null,
      level: levelOf(share(e)),
    });
    t += hours * HOUR_MS;
  }
  // Sun all through the drive: the sunset margin runs on at the last point, where the rover parks.
  let afterH = 0;
  const last = series[series.length - 1];
  if (ready && last && sun.length && sun.every((x) => x)) {
    for (let j = at(last, t); j >= 0 && j < last.sun.length && last.sun[j] > 0; j++) afterH++;
  }
  const noTerrain = vertices.filter((_, i) => series[i] && !series[i]!.terrain).map((v) => v.name);
  const total = { km: legs.reduce((x, l) => x + l.km, 0), hours: legs.reduce((x, l) => x + l.hours, 0) };
  return { legs, ...total, input: ready && sun.length ? driveInput(sun, earth, afterH) : null, clipped, noTerrain };
}

/** Score input of hourly 0/1 Sun and Earth series along the drive. afterH = lit hours after the drive
 *  end at the last point, counted only when the Sun never sets during the drive. */
export function driveInput(sun: number[], earth: number[], afterH = 0): ScoreInput & { sunWindows: number; commsWindows: number } {
  let dark = 0, darkRun = 0, quiet = 0, quietRun = 0, sunW = 0, earthW = 0;
  for (let i = 0; i < sun.length; i++) {
    if (sun[i]) {
      darkRun = 0;
      if (i === 0 || !sun[i - 1]) sunW++;
    } else if (++darkRun > dark) dark = darkRun;
    if (earth[i]) {
      quietRun = 0;
      if (i === 0 || !earth[i - 1]) earthW++;
    } else if (++quietRun > quiet) quiet = quietRun;
  }
  const firstDark = sun.indexOf(0);
  return {
    windowH: sun.length,
    sunH: sun.reduce((a, b) => a + b, 0),
    earthH: earth.reduce((a, b) => a + b, 0),
    longestDarkH: dark,
    longestNoCommsH: quiet,
    hoursToSunset: sun[0] ? (firstDark < 0 ? sun.length + afterH : firstDark) : null,
    sunWindows: sunW,
    commsWindows: earthW,
  };
}
