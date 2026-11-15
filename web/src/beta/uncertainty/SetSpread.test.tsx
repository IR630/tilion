import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { type BodyEvents, type EventsFile, fmtSpread, setSpread, spreadTip, stateAt } from "./events";
import { SetSpread } from "./SetSpread";

// Nominal: up 10..19 (set at 20). Raised: up 10..16, a gap, up 18 (sets at 17 and 19). Lowered: up 9..22 (set at 23).
const sun: BodyEvents = {
  nominal: { start: 0, flips: [10, 20] },
  raised: { start: 0, flips: [10, 17, 18, 19] },
  lowered: { start: 0, flips: [9, 23] },
};
// Earth: the same set hour over all three masks.
const earth: BodyEvents = {
  nominal: { start: 1, flips: [30] },
  raised: { start: 1, flips: [30] },
  lowered: { start: 1, flips: [30] },
};
const file: EventsFile = {
  version: 1, startUtc: "2026-12-01T00:00:00Z", stepMin: 60, hours: 100, sigma: "LOLA height error, 1 sigma", note: "",
  sites: [{ siteId: "a", sun, earth }],
};

describe("sunset band beta (#379)", () => {
  it("reads the state back from the flips", () => {
    expect([9, 10, 19, 20].map((i) => stateAt(sun.nominal, i))).toEqual([0, 1, 1, 0]);
  });
  it("takes the last raised set inside the lit run and the first lowered set after the nominal one", () => {
    expect(setSpread(sun, 12, 100)).toEqual({ at: 20, early: 1, late: 3 });
    expect(setSpread(sun, 9, 100)).toBeNull(); // nominal Sun down
    expect(setSpread(earth, 0, 100)).toEqual({ at: 30, early: 0, late: 0 });
  });
  it("raised set already passed counts as now", () => {
    expect(setSpread({ ...sun, raised: { start: 0, flips: [10, 11] } }, 15, 100)).toEqual({ at: 20, early: 5, late: 3 });
  });
  it("formats the larger side, and <1 h when all masks agree", () => {
    expect(fmtSpread(1, 3, 60)).toBe("±3 h");
    expect(fmtSpread(0, 0, 60)).toBe("(±<1 h)");
    expect(fmtSpread(1, 48, 60)).toBe("±48 h");
    expect(fmtSpread(1, 1427, 60)).toBe("(±>2 d)");
  });
  it("renders next to the countdown with the BETA tag, nothing when the body is down", () => {
    const at = (h: number) => new Date(Date.parse(file.startUtc) + h * 3600000).toISOString();
    expect(renderToString(<SetSpread siteId="a" atUtc={at(12)} body="sun" file={file} />)).toContain("±3 h");
    expect(renderToString(<SetSpread siteId="a" atUtc={at(12)} body="sun" file={file} />)).toContain("BETA");
    expect(renderToString(<SetSpread siteId="a" atUtc={at(5)} body="earth" file={file} />)).toContain("(±&lt;1 h)");
    expect(renderToString(<SetSpread siteId="a" atUtc={at(5)} body="sun" file={file} />)).toBe("");
    expect(renderToString(<SetSpread siteId="x" atUtc={at(12)} body="sun" file={file} />)).toBe("");
  });
  it("GR1: the lowered terrain bridges a short night, so the display caps at (±>2 d) and the tooltip says why (#441)", () => {
    const real = JSON.parse(readFileSync("public/data/beta/uncertainty_events.json", "utf8")) as EventsFile;
    const gr1 = real.sites.find((r) => r.siteId === "de_gerlache_rim_gr1")!;
    const s = setSpread(gr1.sun, 7329, real.hours)!;
    expect(s.at).toBe(7330);
    expect(s.late).toBe(1427);
    expect(fmtSpread(s.early, s.late, real.stepMin)).toBe("(±>2 d)");
    const tip = spreadTip("Sunset", s.early, s.late, real.stepMin);
    expect(tip).toContain("1σ lower: 1427 h (59 d) later (a short night disappears at −1σ)");
    const at = new Date(Date.parse(real.startUtc) + 7329 * 3600000).toISOString();
    const html = renderToString(<SetSpread siteId="de_gerlache_rim_gr1" atUtc={at} body="sun" file={real} />);
    expect(html).toContain("(±&gt;2 d)");
    expect(html).toContain("a short night disappears at −1σ");
  });
});
