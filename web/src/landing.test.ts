import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Timeline } from "./contracts";
import {
  DEFAULT_LIMITS, PRESETS, explainNoWindow, findWindow, indexToUtc, judge, nextWindow, scanWindows, utcToIndex,
  verdictAt, verdictRule, type Conditions,
} from "./landing";

const N = 240;
// Sun down 0..29 (30 h) and 100..109 (10 h). Earth down 20..39 (20 h).
const synthetic: Timeline = {
  siteId: "s",
  startUtc: "2027-01-01T00:00:00Z",
  stepMin: 60,
  sunAz: new Array(N).fill(0),
  sunEl: new Array(N).fill(0),
  sunVisible: Array.from({ length: N }, (_, i) => (i < 30 || (i >= 100 && i < 110) ? 0 : 1)),
  earthAz: new Array(N).fill(0),
  earthEl: new Array(N).fill(0),
  earthVisible: Array.from({ length: N }, (_, i) => (i >= 20 && i < 40 ? 0 : 1)),
};
const c3: Conditions = { days: 3, maxNightH: 12, maxGapH: 12 };

describe("landing window on a synthetic timeline", () => {
  it("finds the earliest start and calls it marginal when the night uses > 75 % of its limit", () => {
    const ws = scanWindows(synthetic, 3);
    expect(ws.length).toBe(N - 72 + 1);
    const i = findWindow(ws, c3, 0);
    expect(i).toBe(40); // Sun is down before 30, Earth is down until 40
    const v = judge(ws[i], c3);
    expect(v.level).toBe("MARGINAL");
    expect(v.binding).toBe("Sun");
    expect(v.reason).toContain("night uses 83 % of its limit");
    expect(v.reason).toContain("longest night 10 of 12 h");
    expect(indexToUtc(synthetic, i)).toBe("2027-01-02T16:00:00Z");
    expect(utcToIndex(synthetic, "2027-01-02T16:30:00Z")).toBe(40);
  });
  it("says OK when every metric is at most 75 % of its limit", () => {
    const ws = scanWindows(synthetic, 3);
    const v = judge(ws[110], { days: 3, maxNightH: 12, maxGapH: 12 });
    expect(v.level).toBe("OK");
    expect(v.binding).toBeNull();
  });
  it("fails with Sun and Earth named when both limits break", () => {
    const ws = scanWindows(synthetic, 3);
    const v = judge(ws[0], c3);
    expect(v.level).toBe("FAIL");
    expect(v.binding).toBe("Sun + Earth");
    expect(v.reason).toContain("Sun below the horizon at landing");
    expect(v.reason).toContain("longest night 30 h, limit 12 h");
    expect(v.reason).toContain("longest comm gap 20 h, limit 12 h");
  });
  it("names Earth when only the comm gap breaks", () => {
    const ws = scanWindows(synthetic, 3);
    const v = judge(ws[30], c3); // Sun up at 30, Earth down at 30
    expect(v.binding).toBe("Earth");
  });
  it("a zero night limit means no night at all", () => {
    const ws = scanWindows(synthetic, 3);
    const none: Conditions = { days: 3, maxNightH: 0, maxGapH: 12 };
    expect(findWindow(ws, none, 0)).toBe(110); // first start whose 72 h miss hours 100..109
    expect(judge(ws[110], none).level).toBe("OK");
  });
  it("next window skips the viable run that holds the date", () => {
    const ws = scanWindows(synthetic, 3);
    expect(nextWindow(ws, c3, 40)).toBe(110); // starts 40..99 viable, 100..109 start in the dark
    expect(nextWindow(ws, c3, 110)).toBe(-1);
  });
});

describe("no window returns a reason with the best value of each condition", () => {
  it("reports best night, best gap and the closest start", () => {
    const c: Conditions = { days: 6, maxNightH: 5, maxGapH: 12 };
    const ws = scanWindows(synthetic, 6);
    expect(findWindow(ws, c, 0)).toBe(-1);
    const r = explainNoWindow(synthetic, ws, c);
    expect(r.bestNightH).toBe(10); // night holds nowhere with both up at landing: min over gap-ok starts
    expect(r.bestGapH).toBeNull(); // no start keeps night <= 5 h
    expect(r.closest?.start).toBe(40); // ties go to the earliest
    expect(r.reason).toMatch(/^No window: /);
    expect(r.reason).toContain("best longest night 10 h (limit 5 h)");
    expect(r.reason).toContain("no start keeps the night in its limit");
    expect(r.reason).toContain("closest start 2027-01-02 16:00 UTC");
  });
  it("still names the closest start when a limit is 0 h", () => {
    const c: Conditions = { days: 6, maxNightH: 0, maxGapH: 12 };
    const ws = scanWindows(synthetic, 6);
    const r = explainNoWindow(synthetic, ws, c);
    expect(r.closest?.start).toBe(40);
    expect(r.reason).toContain("closest start 2027-01-02 16:00 UTC");
  });
  it("reports a mission that does not fit the data", () => {
    const c: Conditions = { days: 30, maxNightH: 5, maxGapH: 5 };
    const ws = scanWindows(synthetic, 30);
    expect(ws).toEqual([]);
    expect(explainNoWindow(synthetic, ws, c).reason).toContain("does not fit in the data range");
  });
});

describe("real timelines (web/public/data)", () => {
  const load = (id: string) =>
    JSON.parse(readFileSync(`public/data/timeline/${id}.json`, "utf8")) as Timeline;

  it("matches a brute-force count of night and comm gap on a real site", () => {
    const tl = load("cr1_connecting_ridge");
    const days = 14;
    const ws = scanWindows(tl, days);
    const len = days * 24;
    const longest = (a: number, on: (i: number) => boolean) => {
      let best = 0, cur = 0;
      for (let i = a; i < a + len; i++) (cur = on(i) ? cur + 1 : 0), (best = Math.max(best, cur));
      return best;
    };
    for (const a of [0, 1, 500, 2000, 4000, ws.length - 1]) {
      expect(ws[a].nightH).toBe(longest(a, (i) => !(tl.sunVisible[i] > 0)));
      expect(ws[a].gapH).toBe(longest(a, (i) => !(tl.earthVisible[i] > 0)));
    }
  });
  it("finds a Robot 14 d window on the Connecting Ridge and none for Crew at an Apollo site", () => {
    const [robot, crew] = PRESETS;
    const ridge = load("cr1_connecting_ridge");
    const rws = scanWindows(ridge, robot.days);
    const i = findWindow(rws, robot, 0);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(judge(rws[i], robot).level).not.toBe("FAIL");
    const apollo = load("apollo11");
    const aws = scanWindows(apollo, crew.days);
    expect(findWindow(aws, crew, 0)).toBeGreaterThanOrEqual(0); // Earth never sets there, nights are 14 d apart
    const long = PRESETS[2];
    const lws = scanWindows(apollo, long.days);
    expect(findWindow(lws, long, 0)).toBe(-1); // a 30 d stay always has a 354 h night
    expect(explainNoWindow(apollo, lws, long).reason).toMatch(/^No window: /);
  });
  // #210: tester №4 saw Mission score the plan 86/100 while Windows said FAIL. The plan card now shows
  // the Windows verdict from the same function; this is the hour the tester looked at.
  it("verdictAt + verdictRule: the ridge on Jan 15 fails the Robot 14 d comm gap, 122 h > 120 h", () => {
    const ridge = load("cr1_connecting_ridge");
    const c = DEFAULT_LIMITS.cond;
    const v = verdictAt(ridge, scanWindows(ridge, c.days), c, "2027-01-15T00:00:00Z")!;
    expect(v.level).toBe("FAIL");
    expect(verdictRule(v, c)).toBe("Comm gap 122 h > 120 h limit");
    expect(v.reason).toContain("longest comm gap 122 h, limit 120 h");
  });
});

describe("verdict rule text (#210)", () => {
  it("names every failing rule, and for a pass how much of each limit is used", () => {
    const ws = scanWindows(synthetic, 3);
    expect(verdictAt(synthetic, ws, c3, "2027-01-01T00:00:00Z")!.level).toBe("FAIL");
    expect(verdictRule(verdictAt(synthetic, ws, c3, "2027-01-01T00:00:00Z")!, c3)).toBe(
      "Sun down at landing; Night 30 h > 12 h limit; Comm gap 20 h > 12 h limit",
    );
    expect(verdictRule(judge(ws[40], c3), c3)).toBe("Night 10 of 12 h, comm gap 0 of 12 h");
    expect(verdictAt(synthetic, ws, c3, "2027-02-01T00:00:00Z")).toBeNull();
    expect(verdictAt(synthetic, ws, c3, "2026-12-01T00:00:00Z")).toBeNull();
  });
});
