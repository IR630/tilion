import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Site, SitesFile, Timeline } from "../../contracts";
import { CommsMarginLine } from "./CommsMarginLine";
import { LcrnsCheck, type Row } from "./LcrnsCheck";
import { commsMargin, LCRNS_CASES } from "./margin";

const tl = (earthEl: number[], earthVisible: number[]) => ({ earthEl, earthVisible }) as Timeline;

describe("comms margin (beta)", () => {
  it("splits the hours in view at 5°, strictly above", () => {
    // 6 hours: hidden at 9°, in view at 3/5/5.01/8°, hidden at 1°.
    const m = commsMargin(tl([9, 3, 5, 5.01, 8, 1], [0, 1, 1, 1, 1, 0]))!;
    expect(m.n).toBe(6);
    expect(m.inView).toBeCloseTo(4 / 6);
    expect(m.high).toBeCloseTo(2 / 6);
    expect(m.low).toBeCloseTo(2 / 6);
    expect(commsMargin(tl([], []))).toBeNull();
    expect(commsMargin({ ...tl([1], [1]), stub: true })).toBeNull();
    expect(commsMargin(tl([1, 2], [1]))).toBeNull();
  });

  it("renders the panel rows with the assumption and its source", () => {
    const html = renderToString(<CommsMarginLine site={{ id: "s" } as Site} tl={tl([3, 8, 8, 0], [1, 1, 0, 0])} />);
    expect(html).toContain("50.0 % of hours. Above 5°: 25.0 %. Low margin (in view, 5° or lower): 25.0 %.");
    expect(html).toContain("5° is our assumption for multipath");
    expect(html).toContain("20240013248");
    expect(html).toContain("BETA");
    expect(html).not.toContain("·");
    // No Earth in view: nothing to say.
    expect(renderToString(<CommsMarginLine site={{ id: "s" } as Site} tl={tl([8], [0])} />)).toBe("");
  });

  it("renders the LCRNS rows as INFO, without a pass or fail", () => {
    const rows: Row[] = [{ ...LCRNS_CASES[1], name: "C1", ours: 16.9, at4: 23.9, at6: 3.3 }];
    const html = renderToString(<LcrnsCheck rows={rows} />);
    expect(html).toContain("INFO");
    expect(html).not.toContain("PASS");
    expect(html).toContain("16.9\u00a0%");
    expect(html).toContain("\u22120.1\u00a0pp"); // #399 true minus, unit kept on the line
    expect(html).toContain("Match not confirmed");
    expect(html).toContain("20250003321");
  });
});

// Real data: vitest runs from web/.
const dataDir = join(process.cwd(), "public", "data");
const haveData = LCRNS_CASES.every((c) => existsSync(join(dataDir, "timeline", `${c.siteId}.json`)));

describe.skipIf(!haveData)("comms margin on the real timelines vs NASA LCRNS (NTRS 20250003321)", () => {
  const load = (id: string) => JSON.parse(readFileSync(join(dataDir, "timeline", `${id}.json`), "utf8")) as Timeline;

  it("reproduces 43 % (Malapert) and 17 % (Spudis Ridge as C1) within 1.5 pp at 5°", () => {
    const got = LCRNS_CASES.map((c) => +(commsMargin(load(c.siteId))!.high * 100).toFixed(1));
    // Values of the #248 research run, independent Python over the same files.
    expect(got).toEqual([42.0, 16.9]);
    LCRNS_CASES.forEach((c, k) => expect(Math.abs(got[k] - c.reference)).toBeLessThan(1.5));
  });

  it("states the distances to the IAU Gazetteer features correctly", () => {
    const sites = (JSON.parse(readFileSync(join(dataDir, "sites.json"), "utf8")) as SitesFile).sites;
    const rad = Math.PI / 180;
    const km = (a: number, b: number, c: number, d: number) =>
      1737.4 * Math.acos(Math.sin(a * rad) * Math.sin(c * rad) + Math.cos(a * rad) * Math.cos(c * rad) * Math.cos((b - d) * rad));
    const at = (id: string) => sites.find((s) => s.id === id)!;
    const mma = at("a_malapert_massif");
    const c1 = at("cr1_connecting_ridge");
    // Mons Malapert: Gazetteer 16338, -85.98°, -1.67°E. Spudis crater: Gazetteer 16007, -89.51°, -84.61°E.
    expect(km(mma.lat!, mma.lonE!, -85.98, 358.33).toFixed(1)).toBe("1.9");
    expect(km(c1.lat!, c1.lonE!, -89.51, 275.39).toFixed(1)).toBe("14.2");
    expect(LCRNS_CASES[0].match).toContain("1.9 km");
    expect(LCRNS_CASES[1].match).toContain("14.2 km");
  });
});
