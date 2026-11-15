// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Timeline } from "../contracts";
import { DEFAULT_LIMITS, type Win, indexToUtc, judge, scanWindows, verdictAt } from "../landing";
import { type Sample, missionSpan, offsetPoint, pointVerdict, scatter, summarize, wilson } from "./dispersion";

const c = DEFAULT_LIMITS.cond;

describe("landing dispersion (#327)", () => {
  it("gives the same points for the same seed and other points for another seed", () => {
    expect(scatter(200, 100, 7)).toEqual(scatter(200, 100, 7));
    expect(scatter(200, 100, 8)).not.toEqual(scatter(200, 100, 7));
  });

  it("moves a point by the offset along the sphere: 100 m north of the ridge is 100 m away, closer to the equator", () => {
    const p = offsetPoint(-89.4398, 222.83, 0, 100);
    const back = offsetPoint(-89.4398, 222.83, 0, 0);
    expect(back).toEqual({ lat: -89.4398, lonE: 222.83 });
    expect(p.lat).toBeCloseTo(-89.4398 + 100 / ((1737400 * Math.PI) / 180), 6);
    expect(p.lonE).toBeCloseTo(222.83, 6);
  });

  // The worker computes a point only over the mission window. At the target that cut must give the
  // plan card verdict (PlanVerdict: verdictAt on the whole site timeline).
  it("judges the target over the mission window exactly as the plan card judges the whole timeline", () => {
    const tl = JSON.parse(readFileSync(new URL("../../public/data/timeline/cr1_connecting_ridge.json", import.meta.url), "utf8")) as Timeline;
    const ws = scanWindows(tl, c.days);
    const levels = new Set<string>();
    for (let i = 0; i < ws.length; i += 97) {
      const utc = indexToUtc(tl, i);
      const span = missionSpan(tl.startUtc, tl.stepMin, tl.sunVisible.length, utc, c.days)!;
      const cut = <T,>(a: T[]) => a.slice(span.at, span.at + span.len);
      const part: Timeline = { ...tl, startUtc: utc, sunVisible: cut(tl.sunVisible), earthVisible: cut(tl.earthVisible) };
      const whole = verdictAt(tl, ws, c, utc)!;
      const mine = pointVerdict(part, c, utc)!;
      expect({ ...mine, win: { ...mine.win, start: i } }).toEqual(whole);
      levels.add(whole.level);
    }
    expect(levels.has("FAIL") && levels.size > 1).toBe(true);
  });

  it("keeps unknown points in the denominator", () => {
    const win = (gapH: number): Win => ({ start: 0, sunAtLanding: true, earthAtLanding: true, nightH: 10, gapH, sunShare: 1, earthShare: 1 });
    const s = (v: Sample["verdict"]): Sample => ({ e: 0, n: 0, lat: -89, lonE: 0, verdict: v });
    const samples = [...Array(6).fill(s(judge(win(20), c))), s(judge(win(130), c)), s(judge(win(200), c)), s(null), s(null)];
    const r = summarize(samples, c);
    expect([r.pass, r.fail, r.unknown, r.total, r.share]).toEqual([6, 2, 2, 10, 0.6]);
    expect({ lo: r.lo, hi: r.hi }).toEqual(wilson(6, 10));
    expect(r.worst).toBe(7); // the larger comm gap over the limit
  });

  it("matches the published Wilson 95 % interval (Newcombe 1998: 81 of 263, 0 of 20)", () => {
    const a = wilson(81, 263);
    expect([a.lo, a.hi].map((x) => +x.toFixed(4))).toEqual([0.2553, 0.3662]);
    const b = wilson(0, 20);
    expect([b.lo, b.hi].map((x) => +x.toFixed(4))).toEqual([0, 0.1611]);
  });
});
