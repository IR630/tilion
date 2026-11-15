import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN, type MissionPlan } from "../mission/types";
import { calendarItems, CURRENT_ID, layoutWeek, nearestMission, rangeMonths, rangeTitle, utcOnDay, weekStarts, type CalItem } from "./calendarLayout";

const DAY = 86_400_000;
const ms = (s: string) => Date.parse(s);
const plan = (name: string, landingUtc: string, durationDays = 14, siteId = "a_haworth"): MissionPlan => ({ ...DEFAULT_PLAN, name, siteId, landingUtc, durationDays });
const item = (id: string, landingUtc: string, durationDays = 14): CalItem => {
  const p = plan(id, landingUtc, durationDays);
  const startMs = ms(landingUtc);
  return { id, name: id, siteId: p.siteId, startMs, endMs: startMs + durationDays * DAY, active: false, plan: p };
};

describe("range rule: max(1 month, nearest mission), at most 3", () => {
  const jan = ms("2027-01-01T00:00:00Z");
  it("is one month with no mission", () => {
    expect(rangeMonths(jan, ms("2027-01-10T00:00:00Z"), [])).toBe(1);
  });
  it("is one month when the nearest mission fits in the month", () => {
    expect(rangeMonths(jan, ms("2027-01-02T00:00:00Z"), [item("a", "2027-01-05T00:00:00Z", 14)])).toBe(1);
  });
  it("grows to show the nearest mission across a month boundary", () => {
    expect(rangeMonths(jan, ms("2027-01-02T00:00:00Z"), [item("a", "2027-01-20T00:00:00Z", 14)])).toBe(2);
  });
  it("stops at three months for a long mission", () => {
    expect(rangeMonths(jan, ms("2027-01-02T00:00:00Z"), [item("a", "2027-01-20T00:00:00Z", 180)])).toBe(3);
  });
  it("ignores a nearest mission that lands after the three months", () => {
    expect(rangeMonths(jan, ms("2027-01-02T00:00:00Z"), [item("a", "2027-06-01T00:00:00Z", 14)])).toBe(1);
  });
  it("takes the mission on the surface before a later one", () => {
    const now = ms("2027-01-10T00:00:00Z");
    const list = [item("later", "2027-01-12T00:00:00Z", 5), item("on", "2027-01-05T00:00:00Z", 60)];
    expect(nearestMission(list, now)?.id).toBe("on");
    expect(rangeMonths(jan, now, list)).toBe(3);
  });
  it("skips a finished mission; an end at midnight does not add a month", () => {
    const list = [item("done", "2026-12-01T00:00:00Z", 10), item("next", "2027-01-18T00:00:00Z", 14)]; // ends 1 Feb 00:00
    expect(nearestMission(list, ms("2027-01-02T00:00:00Z"))?.id).toBe("next");
    expect(rangeMonths(jan, ms("2027-01-02T00:00:00Z"), list)).toBe(1);
  });
});

describe("weeks", () => {
  it("start on Monday and cover every day of the months", () => {
    const w = weekStarts(ms("2027-01-01T00:00:00Z"), 1); // 1 Jan 2027 is a Friday
    expect(new Date(w[0]).toISOString().slice(0, 10)).toBe("2026-12-28");
    expect(w.every((x) => new Date(x).getUTCDay() === 1)).toBe(true);
    expect(w.at(-1)! + 7 * DAY).toBeGreaterThan(ms("2027-01-31T23:00:00Z"));
    expect(w).toHaveLength(5);
  });
  it("titles the range", () => {
    expect(rangeTitle(ms("2027-01-01T00:00:00Z"), 1)).toBe("Jan 2027");
    expect(rangeTitle(ms("2027-01-01T00:00:00Z"), 2)).toBe("Jan – Feb 2027");
    expect(rangeTitle(ms("2026-12-01T00:00:00Z"), 3)).toBe("Dec 2026 – Feb 2027");
  });
});

describe("bar layout", () => {
  const mon = ms("2027-01-18T00:00:00Z"); // Monday
  it("splits a mission at the week boundary: head in the first week, tail in the next", () => {
    const m = item("m", "2027-01-20T06:00:00Z", 10); // Wed 20 → Sat 30 06:00
    const w1 = layoutWeek(mon, [m]).segs;
    const w2 = layoutWeek(mon + 7 * DAY, [m]).segs;
    expect(w1).toEqual([{ id: "m", col: 2, span: 5, lane: 0, head: true, tail: false }]);
    expect(w2).toEqual([{ id: "m", col: 0, span: 6, lane: 0, head: false, tail: true }]);
  });
  it("spans the whole middle week with neither end", () => {
    const m = item("m", "2027-01-14T00:00:00Z", 21);
    expect(layoutWeek(mon, [m]).segs).toEqual([{ id: "m", col: 0, span: 7, lane: 0, head: false, tail: false }]);
  });
  it("stacks overlaps in lanes and counts the hidden ones per day", () => {
    const list = [item("a", "2027-01-18T00:00:00Z", 7), item("b", "2027-01-19T00:00:00Z", 2), item("c", "2027-01-19T00:00:00Z", 1), item("d", "2027-01-22T00:00:00Z", 1)];
    const { segs, more } = layoutWeek(mon, list, 2);
    expect(segs.map((s) => [s.id, s.lane])).toEqual([
      ["a", 0],
      ["b", 1],
      ["d", 1],
    ]);
    expect(more).toEqual([0, 1, 0, 0, 0, 0, 0]);
  });
  it("leaves out a mission outside the week", () => {
    expect(layoutWeek(mon, [item("x", "2027-02-10T00:00:00Z")]).segs).toEqual([]);
  });
});

describe("items and day click", () => {
  it("adds the app plan when it is not in the schedule, and marks the active mission", () => {
    const stored = plan("Stored", "2027-02-01T00:00:00Z");
    const cur = plan("Draft", "2027-01-10T00:00:00Z");
    const s = { missions: [{ id: "m1", plan: stored, baseLandingUtc: stored.landingUtc }], activeId: null };
    const list = calendarItems(s, { plan: cur, original: cur, selected: null });
    expect(list.map((i) => [i.id, i.active])).toEqual([
      [CURRENT_ID, true],
      ["m1", false],
    ]);
    expect(calendarItems({ ...s, activeId: "m1" }, { plan: stored, original: stored, selected: null }).map((i) => [i.id, i.active])).toEqual([["m1", true]]);
  });
  it("keeps the hour of the moment on the clicked day", () => {
    expect(utcOnDay(ms("2027-01-25T00:00:00Z"), "2027-01-20T06:00:00Z")).toBe("2027-01-25T06:00:00Z");
  });
});
