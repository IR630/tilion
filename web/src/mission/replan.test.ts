import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Timeline, VisibilityVariants } from "../contracts";
import { type Conditions, type Win, scanWindows, verdictAt } from "../landing";
import { decodeHours, type HoursFile } from "../route/hours";
import { buildMatrix, firstCause, headline, lowestHeight, moveSameDate, nearestStart, passDaysText, verdictOf, waitAtSite } from "./replan";

const START = "2027-01-01T00:00:00Z";
const at = (h: number) => new Date(Date.parse(START) + h * 3_600_000).toISOString().replace(".000Z", "Z");
const hrs = (sites: Record<string, string>) => decodeHours({ startUtc: START, stepMin: 60, n: Object.values(sites)[0].length, sites });
const c6h: Conditions = { days: 0.25, maxNightH: 2, maxGapH: 2 }; // a 6-step window
const win = (p: Partial<Win>): Win => ({ start: 0, sunAtLanding: true, earthAtLanding: true, nightH: 0, gapH: 0, sunShare: 1, earthShare: 1, ...p });

describe("replan matrix (#328)", () => {
  it("names the body behind the first failed limit: Sun at landing, Earth at landing, night (Sun), comm gap (Earth)", () => {
    const all = { sunAtLanding: false, earthAtLanding: false, nightH: 9, gapH: 9 };
    expect(firstCause(win(all), c6h)).toBe("sun");
    expect(firstCause(win({ ...all, sunAtLanding: true }), c6h)).toBe("earth");
    expect(firstCause(win({ nightH: 9, gapH: 9 }), c6h)).toBe("sun");
    expect(firstCause(win({ gapH: 9 }), c6h)).toBe("earth");
    expect(firstCause(win({ nightH: 2, gapH: 2 }), c6h)).toBeNull();
  });

  it("returns the nearest passing hourly start and skips a start that holds only at landing", () => {
    // 0: Sun down; 1: both up but a 3 h night follows (partial pass); 2–4: Sun down; 5: all limits hold.
    const h = hrs({ s: "23000" + "3".repeat(40) });
    expect(verdictOf(h, "s", at(1), c6h)?.level).toBe("FAIL");
    const r = nearestStart(h, "s", at(0), c6h);
    expect(r?.hours).toBe(5);
    expect(r?.landingUtc).toBe(at(5));
    expect(r?.verdict.level).toBe("OK");
  });

  it("keeps cells outside the data unknown and never takes them as Plan B", () => {
    const h = hrs({ s: "2".repeat(72), t: "2".repeat(72) }); // 3 days, Sun never up
    const rows = buildMatrix(h, [{ siteId: "s", distanceKm: 0 }, { siteId: "t", distanceKm: 5 }], START, { days: 1, maxNightH: 100, maxGapH: 100 });
    const cell = (d: number) => rows[0].cells.find((x) => x.day === d)!;
    expect(cell(-1)).toMatchObject({ verdict: null, cause: null });
    expect(cell(2)).toMatchObject({ cause: "sun" });
    expect(cell(2).verdict?.level).toBe("FAIL");
    expect(cell(3)).toMatchObject({ verdict: null, cause: null }); // the 1 d window leaves the data
    expect(waitAtSite(rows)).toBeNull();
    expect(moveSameDate(rows)).toBeNull();
    expect(headline(rows)).toEqual({ level: "fail", passDays: 0, total: 31 });
    // #435: the text says what is counted, so 31 here and 30 on Windows do not read as a mismatch.
    expect(passDaysText(4, 31, "Site A", "2027-01-15T07:00:00Z")).toBe(
      "4 of 31 days pass at Site A, landing at 07:00 UTC each day from day 0 to +30 (Windows counts a day if any hour in it passes).",
    );
    expect(headline(buildMatrix(h, [{ siteId: "s", distanceKm: 0 }], at(72), { days: 1, maxNightH: 100, maxGapH: 100 })).level).toBe("unknown");
  });

  it("finds the lowest passing observer height among the variants of the reference DEM", () => {
    const v: VisibilityVariants = {
      siteId: "s", startUtc: START, stepMin: 60, n: 6, ref: { heightM: 2, dem: "80+240" },
      variants: [
        { heightM: 10, dem: "80+240", sun: [0], earth: [0] },
        { heightM: 0, dem: "80+240", sun: [0], earth: [] },
        { heightM: 0, dem: "240", sun: [0], earth: [0] }, // another DEM: ignored
        { heightM: 2, dem: "80+240", sun: [0], earth: [3] },
      ],
    };
    const r = lowestHeight(v, START, c6h);
    expect(r.tried.map((t) => [t.heightM, t.verdict?.level])).toEqual([[0, "FAIL"], [2, "FAIL"], [10, "OK"]]);
    expect(r.lowest).toBe(10);
  });

  it("gives the same verdict as the plan card on real IM-2 Athena data", () => {
    const hours = decodeHours(JSON.parse(readFileSync("public/data/hours.json", "utf8")) as HoursFile);
    const tl = JSON.parse(readFileSync("public/data/timeline/im2_athena.json", "utf8")) as Timeline;
    const c: Conditions = { days: 14, maxNightH: 100, maxGapH: 120 };
    const ws = scanWindows(tl, c.days);
    for (let d = 0; d < 400; d += 3) {
      const utc = at(-744 + d * 24 + 12); // from 2026-12-01 12:00
      expect(verdictOf(hours, "im2_athena", utc, c)?.reason).toBe(verdictAt(tl, ws, c, utc)?.reason);
    }
  });
});
