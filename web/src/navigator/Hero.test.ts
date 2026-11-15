import { afterEach, describe, expect, it, vi } from "vitest";
import type { ValidationFile, ValidationRow } from "../contracts";
import { readFileSync } from "node:fs";
import { headlineKpis } from "../screens/Validation";
import { ENTERED, heroProofs, initialHero, rememberEntered } from "./Hero";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("welcome screen once (#158)", () => {
  it("shows on the first visit only; ?hero overrides; a shared link skips it", () => {
    expect(initialHero("")).toBe(true);
    rememberEntered();
    expect(localStorage.getItem(ENTERED)).toBe("1");
    expect(initialHero("")).toBe(false);
    expect(initialHero("?hero=1")).toBe(true);
    localStorage.clear();
    expect(initialHero("?hero=0")).toBe(false);
    expect(initialHero("?site=a_haworth&t=2027-02-01T06:00Z")).toBe(false);
  });

  it("blocked storage: shows the screen and entering does not throw", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(initialHero("")).toBe(true);
    expect(() => rememberEntered()).not.toThrow();
  });
});

describe("heroProofs", () => {
  const r = (check: string, ours: number, diff: number): ValidationRow => ({
    check, site: "", siteId: null, source: "", url: "", ours, reference: 0, diff, unit: "deg", tolerance: null, pass: true, note: "",
  });
  it("gives the median sphere error, the max ephemeris error without the trap row, and the pass count", () => {
    const f: ValidationFile = {
      generatedUtc: "", command: "", summary: { checks: 90, pass: 87, fail: 3, info: 21 },
      groups: [
        { id: "ephemeris", title: "", explanation: "", rows: [r("Sun", 0, 1e-6), r("Earth", 0, -2e-6), r("Trap check: PA", 0, 0.03)] },
        { id: "sphere", title: "", explanation: "", rows: [r("s", 10, 10), r("s", 40, 40), r("s", 30, 30), r("s", 800, 800)] },
      ],
    };
    expect(heroProofs(f).map((p) => p.v)).toEqual(["35.0 h", "< 0.001°", "87 / 90"]);
  });
  it("#435: shows the Horizons max error exactly as NASA check does", () => {
    const f = JSON.parse(readFileSync("public/data/validation.json", "utf8")) as ValidationFile;
    const kpi = headlineKpis(f).find((k) => k.label === "Horizons, max error")!;
    expect(heroProofs(f)[1].v).toBe(kpi.value);
  });
});
