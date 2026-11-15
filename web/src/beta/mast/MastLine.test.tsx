import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Site, Timeline, VisibilityVariants } from "../../contracts";
import { MastLine } from "./MastLine";
import { mastEarth, mastShares } from "./mast";

const site = { id: "s1", name: "S" } as Site;
const tl = { siteId: "s1", startUtc: "2027-01-01T00:00:00.000Z", stepMin: 60, sunVisible: new Array(10).fill(1) } as Timeline;
const v = (heights: number[]): VisibilityVariants => ({
  siteId: "s1",
  startUtc: "2027-01-01T00:00:00Z",
  stepMin: 60,
  n: 10,
  ref: { heightM: 2, dem: "240" },
  // flips from 0: lit from step a; 10 m lit from 2 (8 of 10), 2 m lit from 5 (5 of 10)
  variants: heights.map((h) => ({ heightM: h, dem: "240" as const, sun: h === 10 ? [2] : h === 2 ? [5] : [8], earth: [] })),
});
// Earth over the whole window (n = 10): 0 m 3 of 10, 2 m 6 of 10, 10 m 7 of 10; another DEM is ignored.
const ve = (heights: number[]): VisibilityVariants => ({
  ...v([]),
  variants: [
    ...heights.map((h) => ({ heightM: h, dem: "240" as const, sun: [], earth: h === 10 ? [3] : h === 2 ? [4] : [7] })),
    { heightM: 10, dem: "80+240" as const, sun: [], earth: [0] },
  ],
});

describe("mast line", () => {
  it("computes the shares", () => {
    expect(mastShares(v([0, 2, 10]), tl)).toEqual({ m10: 0.8, m2: 0.5 });
  });
  it("renders the line with data and the BETA tag", () => {
    const html = renderToString(<MastLine site={site} tl={tl} variants={v([0, 2, 10])} />);
    expect(html).toContain("Sun with 10 m mast: 80.0 % (2 m: 50.0 %)");
    expect(html).toContain("BETA");
  });
  it("computes the Earth shares by mast height over the whole window", () => {
    expect(mastEarth(ve([0, 2, 10]))).toEqual({ m0: 0.3, m2: 0.6, m10: 0.7 });
    expect(mastEarth(ve([0, 2]))).toBeNull();
    expect(mastEarth(null)).toBeNull();
  });
  it("shows the Earth gain from 0 to 2 to 10 m, also on a stub period", () => {
    const html = renderToString(<MastLine site={site} tl={{ ...tl, stub: true }} variants={ve([0, 2, 10])} />);
    expect(html).toContain("Earth in view, Dec 2026 – Dec 2027: 0 m 30.0 % → 2 m 60.0 % → 10 m 70.0 % (+10.0 pp)");
    expect(html).not.toContain("Sun with 10 m mast");
  });
  it("renders nothing without 10 m, without variants or on a stub", () => {
    expect(renderToString(<MastLine site={site} tl={tl} variants={v([0, 2])} />)).toBe("");
    expect(renderToString(<MastLine site={site} tl={tl} variants={null} />)).toBe("");
    expect(renderToString(<MastLine site={site} tl={{ ...tl, stub: true }} variants={v([2, 10])} />)).toBe("");
  });
});
