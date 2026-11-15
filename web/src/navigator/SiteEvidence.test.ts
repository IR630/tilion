import { describe, expect, it } from "vitest";
import type { ValidationFile, ValidationRow } from "../contracts";
import { mapSpread, siteEvidence, verdictRow } from "./SiteEvidence";

const row = (check: string, siteId: string | null): ValidationRow => ({
  check, site: "", siteId, source: "", url: "", ours: 1, reference: 1, diff: 0, unit: "%", tolerance: 5, pass: true, note: "",
});
const file: ValidationFile = {
  generatedUtc: "", command: "", summary: { checks: 0, pass: 0, fail: 0, info: 0 },
  groups: [
    { id: "illumination", title: "", explanation: "", rows: [
      row("Mean visible solar disc time (any part), 18.6 y", "b"),
      row("Mean visible solar disc time (any part), 18.6 y", "a"),
      row("Earth visible (any part of disc), 18.6 y", "a"),
      row("Same DEM: visible solar disc time (any part), 18.6 y", "a"),
      row("Same 60 m DEM: visible solar disc time (any part), 18.6 y", "c"),
      row("Same DEM: visible solar disc time (any part), 18.6 y", "c"),
    ] },
    { id: "sphere", title: "", explanation: "", rows: [row("Bare-sphere sunset error (median)", "a")] },
  ],
};

describe("siteEvidence", () => {
  it("takes only the site's own PGDA 69 and sphere rows, null for a site without rows", () => {
    const e = siteEvidence(file, "a");
    expect([e?.sun, e?.earth, e?.sphere].map((r) => r?.siteId)).toEqual(["a", "a", "a"]);
    expect(e?.sun).toBe(file.groups[0].rows[1]);
    expect(e?.same).toBe(file.groups[0].rows[3]);
    expect(siteEvidence(file, "zzz")).toBeNull();
  });

  it("takes the verdict from the 60 m own-grid row, then the 120 m one, else the single-pixel row", () => {
    expect(verdictRow(siteEvidence(file, "b"))).toBe(file.groups[0].rows[0]);
    expect(verdictRow(siteEvidence(file, "a"))).toBe(file.groups[0].rows[3]);
    expect(verdictRow(siteEvidence(file, "c"))).toBe(file.groups[0].rows[4]);
  });

  it("reads the 3×3 map spread from the note", () => {
    expect(mapSpread({ ...row("x", "a"), note: "At 2 m: 92.3 %. Map 3×3 neighbourhood: 44.3–75.5 %. Fail" })).toBe("44.3–75.5 %");
    expect(mapSpread(row("x", "a"))).toBeNull();
  });
});
