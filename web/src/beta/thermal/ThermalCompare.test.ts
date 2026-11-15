import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Timeline } from "../../contracts";
import { COLD_K, thermalStats } from "./ThermalCompare";

describe("thermalStats (Compare)", () => {
  const tl = JSON.parse(readFileSync("public/data/timeline/a_haworth.json", "utf8")) as Timeline;

  it("gives ordered statistics, a cold share and one mean per day", () => {
    const s = thermalStats(tl, "2027-01-15T00:00:00Z")!;
    expect(s.min).toBeLessThan(s.mean);
    expect(s.mean).toBeLessThan(s.max);
    expect(s.now).toBeGreaterThanOrEqual(s.min);
    expect(s.coldShare).toBeGreaterThanOrEqual(0);
    expect(s.coldShare).toBeLessThanOrEqual(1);
    expect(s.daily).toHaveLength(Math.ceil(tl.sunEl.length / 24));
    expect(Math.min(...s.daily)).toBeGreaterThanOrEqual(s.min);
    expect(Math.max(...s.daily)).toBeLessThanOrEqual(s.max);
    expect(COLD_K).toBe(100);
  });

  it("is null on mock data and has no 'now' outside the data window", () => {
    expect(thermalStats({ ...tl, stub: true } as Timeline, "2027-01-15T00:00:00Z")).toBeNull();
    expect(thermalStats(null, "2027-01-15T00:00:00Z")).toBeNull();
    expect(thermalStats(tl, "2035-01-01T00:00:00Z")!.now).toBeNull();
  });
});

// #340: the note names the validation group that holds the checked backend model.
import { CHECKED_NOTE } from "./thermal";
describe("CHECKED_NOTE", () => {
  it("names the real title of the thermal group in validation.json", () => {
    const v = JSON.parse(readFileSync("public/data/validation.json", "utf8")) as { groups: { id: string; title: string }[] };
    const g = v.groups.find((x) => x.id === "thermal");
    expect(g).toBeDefined();
    expect(CHECKED_NOTE).toContain(g!.title);
  });
});
