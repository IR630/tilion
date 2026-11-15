import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fmtBand, type UncertaintyFile, widest } from "./uncertainty";
import { UncertaintyCheck, UncertaintyLine } from "./UncertaintyLine";

const file: UncertaintyFile = {
  version: 1,
  startUtc: "2026-12-01T00:00:00Z",
  endUtc: "2028-01-01T00:00:00Z",
  hours: 9505,
  sigma: "LOLA height error, 1 sigma",
  method: "atan(sigma / distance)",
  sites: [
    { siteId: "a", name: "Ridge A", sigmaMedianM: 0.18, errMaxDeg: 0.2, sun: { value: 0.9295, lo: 0.9262, hi: 0.9348 }, earth: { value: 0.506, lo: 0.506, hi: 0.506 } },
    { siteId: "b", name: "Rim B", sigmaMedianM: 0.5, errMaxDeg: 0.08, sun: { value: 0.47, lo: 0.469, hi: 0.471 }, earth: { value: 0.5, lo: 0.49, hi: 0.52 } },
  ],
};

describe("horizon uncertainty beta", () => {
  it("formats a band and a collapsed band (sigma = 0 gives the plain share)", () => {
    expect(fmtBand(file.sites[0].sun)).toBe("93.0 % [92.6–93.5 %]");
    expect(fmtBand({ value: 0.73, lo: 0.73, hi: 0.73 })).toBe("73.0 % (no change)");
  });
  it("finds the widest band", () => {
    expect(widest(file, "sun")).toEqual({ pp: expect.closeTo(0.53, 5), name: "Ridge A" });
    expect(widest(file, "earth")).toEqual({ pp: expect.closeTo(2, 5), name: "Rim B" });
  });
  it("renders the place card line with the BETA tag and the assumption", () => {
    const html = renderToString(<UncertaintyLine siteId="a" file={file} />);
    expect(html).toContain("Sun 93.0 % [92.6–93.5 %], Earth 50.6 % (no change)");
    expect(html).toContain("BETA");
    expect(html).toContain("Assumption: LOLA height error, 1 sigma");
    expect(html).not.toContain("·");
  });
  it("renders nothing for a site without data or without the file", () => {
    expect(renderToString(<UncertaintyLine siteId="zz" file={file} />)).toBe("");
    expect(renderToString(<UncertaintyLine siteId="a" file={null} />)).toBe("");
  });
  it("renders one NASA check line", () => {
    const html = renderToString(<UncertaintyCheck file={file} />);
    expect(html).toContain("Sun share moves at most ±0.5 pp (Ridge A), Earth ±2.0 pp.");
    expect(html).toContain("±5 pp");
  });
});
