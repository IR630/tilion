import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ValidationFile, ValidationRow } from "../contracts";
import { failedChecks, fmtTolerance, fmtValue, headlineKpis, maxError, rowMatches, siteChecks, Validation } from "./Validation";

const r = (o: Partial<ValidationRow>): ValidationRow => ({
  check: "c", site: "s", siteId: null, source: "PGDA 69", url: "https://pgda.gsfc.nasa.gov/products/69",
  ours: 1, reference: 1, diff: 0, unit: "%", tolerance: 5, pass: true, note: "", ...o,
});
const file: ValidationFile = {
  generatedUtc: "2026-11-14T19:29:50Z",
  command: "cd backend && uv run python -m precompute.validation",
  summary: { checks: 3, pass: 2, fail: 1, info: 1 },
  groups: [
    { id: "ephemeris", title: "Sun and Earth position vs JPL Horizons", explanation: "e",
      rows: [r({ unit: "deg", ours: 0.000001, reference: 0, diff: 0.000001, tolerance: 0.002 })] },
    { id: "illumination", title: "Terrain illumination", explanation: "i",
      rows: [r({ siteId: "a", pass: true }), r({ siteId: "a", pass: false, note: "steep relief" }),
             r({ siteId: "a", pass: null, tolerance: null, unit: "h" })] },
  ],
};  // prettier-ignore
let response = file;
vi.mock("../api", () => ({ loadValidation: async () => response }));

describe("Validation helpers", () => {
  it("counts only pass/fail checks of a site", () => {
    expect(siteChecks(file, "a")).toEqual({ pass: 1, fail: 1 });
    expect(siteChecks(file, "zzz")).toBeNull();
  });
  it("leaves the thermal model-vs-model rows out of the site badge (D-022)", () => {
    const thermal = { id: "thermal", title: "t", explanation: "t", rows: [r({ siteId: "a", pass: false, unit: "K" })] };
    expect(siteChecks({ ...file, groups: [...file.groups, thermal] }, "a")).toEqual({ pass: 1, fail: 1 });
  });
  it("shows each value at the precision its source supports (#155)", () => {
    // A tiny ephemeris error is not shown as zero, and not with digits no reference has.
    expect(fmtValue(0.000001, "deg")).toBe("< 0.001°");
    expect(fmtValue(-0.005, "deg")).toBe("-0.005°");
    expect(fmtValue(0, "deg")).toBe("0.00°");
    expect(fmtValue(10.704, "deg")).toBe("10.70°");
    // PGDA 69 illumination is an 18.6-year mean: whole percent; hourly samples: whole hours.
    expect(fmtValue(72.997, "%")).toBe("73 %");
    expect(fmtValue(-0.33, "%")).toBe("0 %");
    expect(fmtValue(654.167, "h")).toBe("654 h");
    expect(fmtValue(null, "h")).toBe("—");
    expect(fmtTolerance(r({}))).toBe("± 5 pp");
    expect(fmtTolerance(r({ tolerance: null }))).toBe("—");
  });
});

describe("Validation headline (#364)", () => {
  const real: ValidationFile = JSON.parse(readFileSync("public/data/validation.json", "utf8"));
  const maxOf = (id: string, units: string[]) =>
    Math.max(...real.groups.find((g) => g.id === id)!.rows
      .filter((x) => x.pass !== null && units.includes(x.unit) && !x.check.startsWith("Trap check:"))
      .map((x) => Math.abs(x.diff!)));

  it("computes the three KPIs from the rows of their groups", () => {
    const [h, p, e] = headlineKpis(real);
    expect(h.value).toBe(fmtValue(maxOf("ephemeris", ["deg"]), "deg"));
    expect(p.value).toBe(`${maxOf("illumination", ["%", "pp"]).toFixed(1)} pp`);
    expect(e.value).toBe(`${maxOf("eclipse", ["s"]).toFixed(1)} s`);
    expect(maxError(real, "ephemeris", ["deg"])!.value).toBeLessThan(0.002);
  });

  it("shows a dash when a group or its rows are missing", () => {
    expect(headlineKpis({ ...file, groups: [] }).map((k) => k.value)).toEqual(["—", "—", "—"]);
    expect(maxError(file, "ephemeris", ["deg"])!.n).toBe(1);
    expect(headlineKpis(file)[2].value).toBe("—");
  });

  it("renders the numbers and names every failed check", async () => {
    response = real;
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Validation />));
      expect(el.querySelector('[role="status"]')?.textContent).toBe(`${real.summary.pass} of ${real.summary.checks} checks pass`);
      expect([...el.querySelectorAll(".val-kpi strong")].map((n) => n.textContent)).toEqual(headlineKpis(real).map((k) => k.value));
      const line = el.querySelector(".val-failed")!.textContent!;
      const failed = failedChecks(real);
      expect(failed).toHaveLength(real.summary.fail);
      failed.forEach((f) => expect(line).toContain(f));
      expect(el.querySelector(".val-kpis")!.textContent).not.toContain("·");
    } finally {
      act(() => root.unmount());
      response = file;
    }
  });

  it("says so when nothing failed", async () => {
    response = { ...file, groups: [file.groups[0]], summary: { checks: 1, pass: 1, fail: 0, info: 0 } };
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Validation />));
      expect(el.querySelector(".val-failed")?.textContent).toBe("No failed checks.");
    } finally {
      act(() => root.unmount());
      response = file;
    }
  });
});

describe("Validation search (#337)", () => {
  it("matches every query word in any field and the verdict filter", () => {
    const row = r({ check: "Mean illumination", site: "Connecting ridge", source: "PGDA 69", note: "steep relief" });
    expect(rowMatches(row, "Terrain illumination", "", "all")).toBe(true);
    expect(rowMatches(row, "Terrain illumination", "RIDGE pgda", "all")).toBe(true);
    expect(rowMatches(row, "Terrain illumination", "terrain steep", "pass")).toBe(true);
    expect(rowMatches(row, "Terrain illumination", "ridge horizons", "all")).toBe(false);
    expect(rowMatches(row, "Terrain illumination", "", "fail")).toBe(false);
    expect(rowMatches(r({ pass: null }), "g", "", "info")).toBe(true);
  });

  const type = (input: HTMLInputElement, value: string) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("hides cards and empty groups that do not match, and counts what is shown", async () => {
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Validation />));
      expect(el.querySelector(".val-shown")).toBeNull();
      act(() => type(el.querySelector<HTMLInputElement>('input[type="search"]')!, "steep"));
      expect(el.querySelectorAll(".val-card")).toHaveLength(1);
      expect(el.querySelectorAll(".val-group")).toHaveLength(1);
      expect(el.querySelector(".val-shown")?.textContent).toBe("1 of 4 shown");
      act(() => type(el.querySelector<HTMLInputElement>('input[type="search"]')!, "no such check"));
      expect(el.querySelectorAll(".val-card")).toHaveLength(0);
      expect(el.textContent).toContain("No check matches.");
      // The summary still counts every check.
      expect(el.querySelector('[role="status"]')?.textContent).toBe("2 of 3 checks pass");
    } finally {
      act(() => root.unmount());
    }
  });

  it("filters by verdict, and the fail button clears a filter that hides the failed card", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Validation />));
      const chip = (label: string) => [...el.querySelectorAll(".val-chips button")].find((b) => b.textContent === label) as HTMLButtonElement;
      act(() => chip("INFO").click());
      expect(chip("INFO").getAttribute("aria-pressed")).toBe("true");
      expect([...el.querySelectorAll(".val-card")].map((c) => c.getAttribute("data-verdict"))).toEqual(["info"]);
      act(() => el.querySelector<HTMLButtonElement>(".val-jump")!.click());
      expect(chip("All").getAttribute("aria-pressed")).toBe("true");
      expect((document.activeElement as HTMLElement).textContent).toContain("steep relief");
    } finally {
      act(() => root.unmount());
      el.remove();
    }
  });
});

describe("Validation screen", () => {
  it("shows the summary, every group, verdicts and source links", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Validation />));
    expect(el.querySelector('[role="status"]')?.textContent).toBe("2 of 3 checks pass");
    expect(el.textContent).not.toContain("information rows");
    expect(el.querySelector(".val-info")?.getAttribute("title")).toMatch(/no tolerance/);
    expect(el.querySelectorAll(".val-cards")).toHaveLength(2);
    expect(el.querySelectorAll(".val-pass")).toHaveLength(2);
    expect(el.querySelectorAll(".val-fail")).toHaveLength(1);
    expect(el.querySelectorAll(".val-info")).toHaveLength(1);
    const links = [...el.querySelectorAll<HTMLAnchorElement>(".val-card a")];
    expect(links.length).toBe(4);
    expect(el.textContent).toContain("Refined Earth visibility example");
    expect(el.textContent).toContain("not physical accuracy");
    expect(links.every((a) => a.href.startsWith("https://"))).toBe(true);
    act(() => root.unmount());
  });

  it("keeps a failed check and its measured explanation on the same card", async () => {
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Validation />));
    const card = el.querySelector(".val-fail")?.closest("article");
    expect(card?.textContent).toContain("FAIL");
    expect(card?.textContent).toContain("steep relief");
    expect(card?.textContent).toContain("± 5 pp");
    act(() => root.unmount());
  });

  it.each([
    { pass: true, diff: 0.028994, label: "trap caught: error 0.03° > tolerance 0.002°" },
    { pass: false, diff: 0.002, label: "trap NOT caught: error 0.002° ≤ tolerance 0.002°" },
  ])("explains a trap with pass=$pass", async ({ pass, diff, label }) => {
    const row = r({ check: "Trap check: wrong frame is caught", pass, diff,
      ours: 0.5 + diff, reference: 0.5, unit: "deg", tolerance: 0.002 });
    response = { ...file, groups: [{ ...file.groups[0], rows: [row] }] };
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Validation />));
      const card = el.querySelector(".val-card");
      expect(card?.textContent).toContain(label);
      expect(card?.querySelector(pass ? ".val-pass" : ".val-fail")?.textContent).toBe(pass ? "PASS" : "FAIL");
      expect(card?.querySelector("dl")).toBeNull();
    } finally {
      act(() => root.unmount());
      response = file;
    }
  });

  it("turns the fail count into a button that focuses the first failed card (#246)", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => root.render(<Validation />));
    const jump = [...el.querySelectorAll("button")].find((b) => b.textContent === "1 fail")!;
    expect(jump).toBeDefined();
    act(() => jump.click());
    const card = document.activeElement as HTMLElement;
    expect(card.tagName).toBe("ARTICLE");
    expect(card.textContent).toContain("FAIL");
    expect(card.textContent).toContain("steep relief");
    act(() => root.unmount());
    el.remove();
  });

  it("shows no fail button when every check passes", async () => {
    response = { ...file, summary: { checks: 2, pass: 2, fail: 0, info: 1 } };
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Validation />));
      expect(el.querySelector('[role="status"]')?.textContent).toBe("2 of 2 checks pass");
      expect(el.querySelector(".val-jump")).toBeNull();
    } finally {
      act(() => root.unmount());
      response = file;
    }
  });

  it("keeps the ours and tolerance readouts for a normal row", async () => {
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Validation />));
      const card = el.querySelector(".val-card");
      expect([...card!.querySelectorAll("dt")].map((dt) => dt.textContent))
        .toEqual(["Ours", "Reference", "Difference", "Tolerance"]);
      expect([...card!.querySelectorAll("dd")].map((dd) => dd.textContent))
        .toEqual(["< 0.001°", "0.00°", "< 0.001°", "± 0.002°"]);
      expect(card?.textContent).not.toContain("trap caught");
      expect(card?.textContent).not.toContain("trap NOT caught");
    } finally {
      act(() => root.unmount());
    }
  });

  it("renders every real data row, including Barker corridors and the sphere baseline", async () => {
    response = JSON.parse(readFileSync("public/data/validation.json", "utf8"));
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Validation />));
      const groups = [...el.querySelectorAll(".val-group")];
      expect(groups).toHaveLength(response.groups.length);
      response.groups.forEach((group, index) => {
        const cards = [...groups[index].querySelectorAll("article")];
        expect(cards).toHaveLength(group.rows.length);
        expect(groups[index].textContent).toContain(group.explanation);
        group.rows.forEach((row, rowIndex) => {
          const card = cards[rowIndex];
          expect(card.textContent).toContain(row.site);
          if (row.check.startsWith("Trap check:") && row.pass !== null) {
            expect(card.textContent).toContain(`trap ${row.pass ? "caught" : "NOT caught"}: error ${fmtValue(row.diff, row.unit)} ${row.pass ? ">" : "≤"} tolerance ${fmtTolerance(row).replace(/^± /, "")}`);
          } else {
            expect(card.textContent).toContain(fmtValue(row.ours, row.unit));
            expect(card.textContent).toContain(fmtValue(row.reference, row.unit));
            if (group.id === "barker") expect(card.textContent).toContain("Corridor B–C");
            else expect(card.textContent).toContain(fmtTolerance(row));
          }
          expect(card.textContent).toContain(row.note);
          expect(card.querySelector("a")?.getAttribute("href")).toBe(row.url);
          expect(card.querySelector("a")?.textContent).toBe(row.source);
          expect(card.querySelector(".val-pass, .val-fail, .val-info")?.textContent)
            .toBe(row.pass === null ? "INFO" : row.pass ? "PASS" : "FAIL");
        });
      });
    } finally {
      act(() => root.unmount());
      response = file;
    }
  });
});
