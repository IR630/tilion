import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Site, Timeline } from "../contracts";
import { bestLanding, Calendar, causes, dailyStats, dayKind, dayLabel, dayLevels, dayVerdicts, longestRun, margin } from "./Calendar";
import { scanWindows, type Win } from "../landing";

const N = 72; // 3 days hourly
const tl: Timeline = {
  siteId: "a",
  startUtc: "2027-01-01T00:00:00Z",
  stepMin: 60,
  sunAz: new Array(N).fill(0),
  sunEl: new Array(N).fill(0),
  // day 1: Sun 18 h (0.3 partial disc counts), day 2: dark, day 3: Sun all day
  sunVisible: Array.from({ length: N }, (_, i) => (i < 18 ? (i % 2 ? 1 : 0.3) : i >= 48 ? 1 : 0)),
  earthAz: new Array(N).fill(0),
  earthEl: new Array(N).fill(0),
  // Earth 11 h on day 1 (h 9..19), none after
  earthVisible: Array.from({ length: N }, (_, i) => (i >= 9 && i < 20 ? 1 : 0)),
};

const site: Site = {
  id: "a", name: "Site A", group: "ridge", status: "", kind: "point", lat: -89, lonE: 10,
  elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
};
const state = vi.hoisted(() => ({ tl: null as Timeline | null }));
state.tl = tl;
// The real constants (DATA_START_UTC …) stay: the calendar's Next windows (#207) reads them.
vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), loadFullTimeline: async () => state.tl }));

describe("Calendar stats", () => {
  it("counts hours per day with any limb as Sun", () => {
    const d = dailyStats(tl);
    expect(d.map((x) => x.day)).toEqual(["2027-01-01", "2027-01-02", "2027-01-03"]);
    expect(dayLabel(d[0])).toBe("Sun 18 h, Earth 11 h, both 9 h");
    expect(dayKind(d[0]).kind).toBe("both");
    expect(dayKind(d[1])).toEqual({ kind: "none", share: 1 });
    expect(dayKind(d[2])).toEqual({ kind: "sun", share: 1 });
  });
  it("finds the longest dark period and Sun+Earth window", () => {
    expect(longestRun(tl, (i) => tl.sunVisible[i] <= 0)).toEqual({
      hours: 30, startUtc: "2027-01-01 18:00", endUtc: "2027-01-03 00:00",
    });
    expect(longestRun(tl, (i) => tl.sunVisible[i] > 0 && tl.earthVisible[i] > 0)?.hours).toBe(9);
    expect(longestRun(tl, () => false)).toBeNull();
  });
});

describe("Calendar", () => {
  it("click on a day sets the shared moment to its 00:00 UTC", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    const pick = vi.fn();
    await act(async () => root.render(<Calendar sites={[site]} atUtc="2027-01-02T05:00:00Z" onPick={pick} />));
    const cells = el.querySelectorAll<HTMLButtonElement>(".calendar-day");
    expect(cells.length).toBe(3);
    expect(cells[1].getAttribute("aria-selected")).toBe("true");
    expect(cells[0].getAttribute("aria-label")).toBe("2027-01-01: Sun 18 h, Earth 11 h, both 9 h");
    act(() => cells[2].click());
    expect(pick).toHaveBeenCalledWith("2027-01-03T00:00:00Z");
    expect(el.textContent).toContain("Longest dark period30 h");
    act(() => root.unmount());
  });
});

describe("Calendar landing verdict", () => {
  const M = 800; // 33 days; Sun down for the first 30 h, then always up; Earth always up
  const long: Timeline = {
    ...tl,
    sunAz: new Array(M).fill(0),
    sunEl: new Array(M).fill(0),
    sunVisible: Array.from({ length: M }, (_, i) => (i < 30 ? 0 : 1)),
    earthAz: new Array(M).fill(0),
    earthEl: new Array(M).fill(0),
    earthVisible: new Array(M).fill(1),
  };
  const mount = async (atUtc: string, pick = vi.fn()) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Calendar sites={[site]} atUtc={atUtc} onPick={pick} />));
    return { el, root, pick };
  };
  const button = (el: HTMLElement, text: string) =>
    [...el.querySelectorAll("button")].find((b) => b.textContent === text)!;

  it("colours a day by its best landing hour: FAIL while the Sun is down, OK once it is up", () => {
    const cond = { days: 1, maxNightH: 0, maxGapH: 0 };
    const levels = dayLevels(long, scanWindows(long, cond.days), cond);
    expect(levels.get("2027-01-01")).toBe("FAIL"); // Sun below the horizon at every landing hour
    expect(levels.get("2027-01-02")).toBe("OK"); // from 06:00 the Sun is up and stays up
    expect(levels.has("2027-02-03")).toBe(false); // data end 02-03 08:00: no 1 d window starts that day
  });
  it("shows FAIL with the reason and jumps to the nearest suitable landing", async () => {
    state.tl = long;
    const { el, root, pick } = await mount("2027-01-01T05:00:00Z");
    const verdict = el.querySelector(".landing-verdict")!;
    expect(verdict.textContent).toContain("FAIL");
    expect(verdict.textContent).toContain("Sun below the horizon at landing");
    expect(verdict.textContent).toContain("2027-01-02 06:00 UTC");
    act(() => button(el, "Go to it").click());
    expect(pick).toHaveBeenCalledWith("2027-01-02T06:00:00Z");
    act(() => root.unmount());
  });
  it("shows OK for a suitable landing hour", async () => {
    state.tl = long;
    const { el, root } = await mount("2027-01-03T00:00:00Z");
    expect(el.querySelector(".landing-ok")?.textContent).toContain("OK");
    expect(el.textContent).toContain("Earth centre above terrain: geometric visibility only.");
    expect(el.textContent).toContain("No antenna schedule or link budget");
    expect(el.textContent).toContain("Sun + Earth is a geometric overlap, not mission readiness.");
    expect(el.textContent).not.toContain("Earth in contact");
    // #435: the day count says what it counts, so it does not read as a mismatch with Mission replan (one hour per day, 31 days).
    const dt = el.querySelector(".calendar-kpis dt")!;
    expect(dt.textContent).toBe("Days with any passing landing hour, next 30 d");
    expect(dt.getAttribute("title")).toContain("Mission replan counts one start per day at the plan's hour, day 0 to +30.");
    act(() => root.unmount());
  });
  it.each(["mock", "sphere", "missing"])("labels %s data without confirming contact", async (kind) => {
    state.tl = kind === "missing" ? null : { ...long, stub: kind === "mock" };
    const shownSite = kind === "sphere" ? { ...site, terrain: "none" as const } : site;
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Calendar sites={[shownSite]} atUtc="2027-01-03T00:00:00Z" onPick={vi.fn()} />));
    expect(el.textContent).toContain(kind === "mock" ? "Mock data: synthetic visibility." : kind === "sphere" ? "Bare sphere: no terrain." : "No precomputed timeline");
    expect(el.textContent).toContain("No antenna schedule or link budget");
    if (kind !== "sphere") expect(el.querySelector(".landing-ok")).toBeNull();
    act(() => root.unmount());
    state.tl = tl;
  });
  it("explains why there is no window when the data has none", async () => {
    state.tl = tl;
    const { el, root } = await mount("2027-01-01T05:00:00Z");
    act(() => button(el, "Crew 6.5 d, no night").click());
    const verdict = el.querySelector(".landing-verdict")!;
    expect(verdict.textContent).toContain("No window: ");
    act(() => root.unmount());
    state.tl = tl;
  });
});

// #363: a replan-matrix cell: the colour is the margin, a letter is the fail cause.
describe("day verdict: margin and fail cause", () => {
  const w = (o: Partial<Win>): Win => ({ start: 0, sunAtLanding: true, earthAtLanding: true, nightH: 0, gapH: 0, sunShare: 1, earthShare: 1, ...o });
  const c = { days: 1, maxNightH: 100, maxGapH: 40 };
  it("P = power (night or Sun at landing), C = comm (gap or Earth at landing)", () => {
    expect(causes(w({ nightH: 120 }), c)).toEqual(["P"]);
    expect(causes(w({ sunAtLanding: false }), c)).toEqual(["P"]);
    expect(causes(w({ gapH: 50 }), c)).toEqual(["C"]);
    expect(causes(w({ earthAtLanding: false, nightH: 101 }), c)).toEqual(["P", "C"]);
    expect(causes(w({ nightH: 100, gapH: 40 }), c)).toEqual([]);
  });
  it("margin = share of the tighter limit left; 0 when the window fails", () => {
    expect(margin(w({ nightH: 50, gapH: 30 }), c)).toBeCloseTo(0.25); // gap uses 75 %
    expect(margin(w({ nightH: 0, gapH: 0 }), c)).toBe(1);
    expect(margin(w({ gapH: 41 }), c)).toBe(0);
  });
  it("keeps the best hour of each day and finds the best landing of the next 30 d", () => {
    const ws = scanWindows(tl, 1);
    const cond = { days: 1, maxNightH: 30, maxGapH: 60 };
    const v = dayVerdicts(tl, ws, cond);
    expect([...v]).toEqual([
      ["2027-01-01", { level: "OK", margin: 0.5, causes: [] }], // best hour: Sun and Earth up, half of the tighter limit left
      ["2027-01-02", { level: "FAIL", margin: 0, causes: ["P", "C"] }], // dark, Earth gone
      ["2027-01-03", { level: "FAIL", margin: 0, causes: ["C"] }], // Sun back, Earth still gone
    ]);
    expect(dayLevels(tl, ws, cond).get("2027-01-02")).toBe("FAIL");
    expect(bestLanding(tl, ws, cond, 0)).toBe(9); // Earth rises at 09:00, the first hour with both up
    expect(bestLanding(tl, ws, { days: 1, maxNightH: 0, maxGapH: 0 }, 0)).toBe(-1);
  });
});
