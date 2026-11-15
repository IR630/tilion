import { renderToString } from "react-dom/server";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Site } from "../contracts";
import { mockSummary, mockTimeline } from "../mock";
import { terrainCaption, terrainEffect } from "../summary";
import { bestRows, clampSlip, outsideData, Compare, compareVerdict, fmtLightDelta, shiftUtc } from "./Compare";

const site = (id: string, lat: number | null, terrain: Site["terrain"]): Site => ({
  id, name: id, group: "artemis", status: "", kind: "point", lat, lonE: lat === null ? null : 10,
  elevM: null, source: "", confidence: "high", terrain, note: "",
});
const A = site("a", -89, "polar80");
const B = site("b", -85, "none");
const C = site("c", -88, "polar80"); // no precomputed timeline
const D = site("d", -87, "polar80"); // timeline without variants (#424)

const FULL_DAYS = 90;
const requested: number[] = [];

vi.mock("../api", async () => {
  const m = await import("../mock");
  const real = (s: Site, t: string, days: number) => {
    const { stub: _, ...tl } = m.mockTimeline(s, t, days);
    let contacts = 0;
    const dsnVisible = tl.earthVisible.map((v) => v && contacts++ < 180 ? 1 : 0);
    if (s.id === "d") return { ...tl, dsnVisible }; // #424: terrain site without variants/<id>.json
    return { ...tl, dsnVisible, variantSunLit: [tl.sunVisible.map(() => 1)], variantEarthVisible: [tl.earthVisible] };
  };
  return {
    ...(await vi.importActual<object>("../api")), // DATA_START_UTC / DATA_END_UTC for timeline/time.ts
    loadValidation: async () => null,
    loadMaskOnce: async () => null,
    loadFullTimeline: async (s: Site) => (s.id === "a" || s.id === "d" ? real(s, "2026-12-01T00:00:00Z", FULL_DAYS) : null),
    loadTimeline: async (s: Site, t: string, days = 30) => {
      requested.push(days);
      return (s.id === "a" || s.id === "d") && t >= "2026-12-01T00:00:00Z" && t < "2027-02-01T00:00:00Z" ? real(s, t, days) : m.mockTimeline(s, t, days);
    },
  };
});

describe("Compare", () => {
  it("hides comparison answers while the prediction is open", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Compare sites={[A, C]} atUtc="2027-01-15T00:00:00Z" />));
      const details = el.querySelector<HTMLDetailsElement>("details")!;
      const radios = el.querySelectorAll<HTMLInputElement>('input[name="compare-surface"]');
      await act(async () => radios[1].click());
      expect(radios[1].checked).toBe(true);
      await act(async () => { details.open = true; details.dispatchEvent(new Event("toggle")); });
      expect(radios[0].checked).toBe(true);
      expect(el.querySelector('table[aria-label="Site comparison"]')!.closest("[hidden]")).not.toBeNull();
      await act(async () => { details.open = false; details.dispatchEvent(new Event("toggle")); });
      expect(el.querySelector('table[aria-label="Site comparison"]')!.closest("[hidden]")).toBeNull();
    } finally { act(() => root.unmount()); el.remove(); }
  });
  it("clamps slip to -14..+30", () => {
    expect(clampSlip(-20)).toBe(-14);
    expect(clampSlip(99)).toBe(30);
  });
  it("shifts the date", () => {
    expect(shiftUtc("2027-01-15T00:00:00Z", 7)).toBe("2027-01-22T00:00:00Z");
  });
  it("mock fractions stay within [0,1]", () => {
    for (const s of [A, B]) {
      const m = mockSummary(s, "2027-01-15T00:00:00Z");
      for (const f of [m.lightFraction, m.earthFraction]) {
        expect(f.lo).toBeGreaterThanOrEqual(0);
        expect(f.hi).toBeLessThanOrEqual(1);
      }
    }
  });
  it("picks the best row per column", () => {
    const rows = [A, B].map((s) => ({ ...mockSummary(s, "2027-01-15T00:00:00Z"), stub: false }));
    const w = bestRows(rows, "light");
    expect(w.length).toBeGreaterThan(0);
    expect(bestRows(rows.slice(0, 1), "light")).toEqual([]);
    expect(bestRows(rows, "dsn")).toEqual([]); // unavailable data cannot be best
  });
  it("ranks the shorter night and gap as best", () => {
    const [a, b] = [A, B].map((s) => ({ ...mockSummary(s, "2027-01-15T00:00:00Z"), stub: false }));
    const rows = [
      { ...a, longestNightH: { value: 90, lo: 80, hi: 100 }, longestCommGapH: { value: 5, lo: 4, hi: 6 } },
      { ...b, longestNightH: { value: 60, lo: 50, hi: 70 }, longestCommGapH: { value: 9, lo: 8, hi: 10 } },
    ];
    expect(bestRows(rows, "night")).toEqual([1]);
    expect(bestRows(rows, "gap")).toEqual([0]);
  });
  it("names one winner and its Sun lead in percentage points (#363)", () => {
    const [a, b] = [A, B].map((s) => ({ ...mockSummary(s, "2027-01-15T00:00:00Z"), stub: false }));
    const rows = [
      { ...a, lightFraction: { value: 0.93, lo: 0.9, hi: 0.95 }, earthFraction: { value: 0.6, lo: 0.6, hi: 0.6 } },
      { ...b, lightFraction: { value: 0.47, lo: 0.4, hi: 0.5 }, earthFraction: { value: 0.5, lo: 0.5, hi: 0.5 } },
    ];
    expect(compareVerdict([A, B], rows)).toMatch(/^Winner: .+ — Sun 93 % of the next 30 d, \+46 pp over /);
    const split = [rows[0], { ...rows[1], earthFraction: { value: 0.7, lo: 0.7, hi: 0.7 } }];
    expect(compareVerdict([A, B], split)).toMatch(/^No single winner: /);
  });
  it("says the days of data in the winner line near the data end (#424)", () => {
    const [a, b] = [A, B].map((s) => ({ ...mockSummary(s, "2027-12-20T00:00:00Z"), stub: false }));
    const rows = [
      { ...a, lightFraction: { value: 0.93, lo: 0.9, hi: 0.95 }, earthFraction: { value: 0.6, lo: 0.6, hi: 0.6 } },
      { ...b, lightFraction: { value: 0.47, lo: 0.4, hi: 0.5 }, earthFraction: { value: 0.5, lo: 0.5, hi: 0.5 } },
    ];
    expect(compareVerdict([A, B], rows)).toMatch(/ of the next 12 d of data, \+46 pp over /);
  });
  it("ranks only real rows and keeps their original indexes", () => {
    const m = mockSummary(C, "2027-01-15T00:00:00Z");
    const real = { ...m, stub: false, lightFraction: { value: 0.5, lo: 0.5, hi: 0.5 } };
    const rows = [m, real, real];
    expect(bestRows(rows, "light")).toEqual([1, 2]);
    expect(compareVerdict([C, A, B], rows)).toBe("No site leads: light and Earth view are equal.");
    expect(bestRows([m, real], "light")).toEqual([]);
    expect(bestRows([m, m], "light")).toEqual([]);
  });
  it.each([
    ["2027-01-31T00:00:00Z", "Slip +1 day"],
    ["2027-02-01T00:00:00Z", "Slip −1 day"],
  ])("does not recommend synthetic rows or calculate deltas across the data boundary from %s", async (atUtc, button) => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Compare sites={[A, B]} atUtc={atUtc} />));
      await act(async () => el.querySelector<HTMLButtonElement>(`button[aria-label="${button}"]`)!.click());
      for (const row of el.querySelectorAll('table[aria-label="Site comparison"] tbody tr')) {
        if (row.querySelector(".compare-mock")) expect(row.querySelector(".compare-star")).toBeNull();
      }
      expect(el.querySelector(".hud-verdict")?.textContent).toBe("Pick at least 2 sites with precomputed data to compare.");
      // #155: the leader tiles are gone; the ★ in the table is the only recommendation, and there is none.
      expect(el.querySelectorAll(".compare-star")).toHaveLength(0);
      const deltas = el.querySelectorAll('table[aria-label="Date slip delta"] tbody tr');
      expect(deltas).toHaveLength(2);
      for (const row of deltas) {
        expect([...row.querySelectorAll("td")].slice(1).map((td) => td.textContent)).toEqual(["—", "—", "—"]);
      }
    } finally {
      act(() => root.unmount());
    }
  });
  it("#335: the slip report says the same numbers as the tables and copies them", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Compare sites={[A, B]} atUtc="2027-01-15T00:00:00Z" />));
      expect(el.querySelector('[aria-label="What the slip changes"]')).toBeNull(); // no slip, no report
      const lightBefore = el.querySelector('table[aria-label="Site comparison"] tbody tr')!.children[3].querySelector(".cmp-v")!.textContent;
      await act(async () => el.querySelector<HTMLButtonElement>('button[aria-label="Slip +7 days"]')!.click());
      const report = el.querySelector('[aria-label="What the slip changes"]')!;
      expect(report.textContent).toContain("BETA");
      const [lightLine, sunsetLine] = [...report.querySelectorAll("li")].map((li) => li.textContent ?? "");
      const rowA = el.querySelector('table[aria-label="Site comparison"] tbody tr')!.children;
      // Light: before = the table before the slip, after = the table now.
      expect(lightLine).toContain(`${lightBefore} → ${rowA[3].querySelector(".cmp-v")!.textContent}`);
      // Sunset after = the "Time to sunset" cell, or the Sun is down in both.
      const sunsetCell = rowA[2].querySelector(".cmp-v")!.textContent!;
      expect(sunsetLine).toContain(sunsetCell === "not visible" ? "Sun down" : `→ in ${sunsetCell}`);
      // The mark agrees with the sign of the "Date slip delta" light cell.
      const deltaLight = el.querySelector('table[aria-label="Date slip delta"] tbody tr')!.children[1].textContent!;
      if (lightLine.includes("(worse)")) expect(deltaLight.startsWith("−")).toBe(true);
      if (lightLine.includes("(better)")) expect(deltaLight.startsWith("+")).toBe(true);
      expect(report.textContent).toContain("Windows check, 14 d mission");
      expect(report.textContent).toContain("Synthetic mock data at one of the dates"); // B has no timeline: no sentences
      const writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
      await act(async () => report.querySelector("button")!.click());
      const copied = (writeText.mock.calls[0] as unknown as [string])[0];
      expect(copied).toContain("Landing: 2027-01-15 00:00 UTC → 2027-01-22 00:00 UTC (slip +7 d)");
      expect(copied).toContain(lightLine.slice(2)); // the screen line, after its mark
      expect(copied).toContain("Model: LOLA terrain horizon");
      expect(report.textContent).toContain("Copied");
    } finally {
      act(() => root.unmount());
    }
  });
  it("#423: a moment before the data says outside data, not mock numbers, and slip buttons stop at the edge", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    const btn = (l: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${l}"]`) ?? [...el.querySelectorAll("button")].find((b) => b.textContent === l)!;
    try {
      expect(outsideData("2026-11-30T23:00:00Z")).toBe(true);
      await act(async () => root.render(<Compare sites={[A, B]} atUtc="2026-12-20T00:00:00Z" />));
      await act(async () => btn("Slip −7 days").click());
      await act(async () => btn("Slip −7 days").click()); // slip −14: 2026-12-06, still inside
      expect(el.textContent).not.toContain("outside data");
      await act(async () => root.render(<Compare sites={[A, B]} atUtc="2026-12-05T00:00:00Z" />)); // slip −14 → 2026-11-21
      const rows = el.querySelectorAll('table[aria-label="Site comparison"] tbody tr');
      for (const row of rows) {
        const cells = [...row.querySelectorAll("td")].slice(1);
        expect(cells.map((td) => td.textContent)).toEqual(cells.map(() => "outside data"));
      }
      expect(btn("Slip −1 day").disabled).toBe(true);
      expect(btn("Slip −1 day").title).toBe("Outside data range");
      expect(btn("Reset").disabled).toBe(false); // the way back stays open
    } finally {
      act(() => root.unmount());
    }
  });
  it("formats light delta with sign", () => {
    const a = mockSummary(A, "2027-01-15T00:00:00Z");
    const b = mockSummary(A, "2027-02-10T00:00:00Z");
    expect(fmtLightDelta(a, b)).toMatch(/^[+−±]\d+ h of light$/);
  });
  it("marks a terrain site without variants as no spread (#424)", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Compare sites={[A, D]} atUtc="2027-01-15T00:00:00Z" />));
      const rows = el.querySelectorAll('table[aria-label="Site comparison"] tbody tr');
      expect(rows[0].textContent).not.toContain("no spread");
      expect(rows[1].querySelector(".cmp-site")!.textContent).toContain("no spread");
    } finally {
      act(() => root.unmount());
    }
  });
  it("renders the no-terrain badge before data arrive", () => {
    const html = renderToString(<Compare sites={[A, B]} atUtc="2027-01-15T00:00:00Z" />);
    expect(html).toContain("sphere only — no terrain");
  });
  it("renders values with spread and a per-row mock badge for stub timelines", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Compare sites={[A, B]} atUtc="2027-01-15T00:00:00Z" />));
    expect(el.textContent).toMatch(/\d+ % \d+–\d+ %/); // value, then its Q8 spread
    expect(el.textContent).not.toMatch(/\(\d+(\.\d)?–\d+(\.\d)?\)/); // no raw ranges in brackets
    expect(el.querySelectorAll(".compare-mock").length).toBe(1); // only B is stub
    expect(el.textContent).toContain("Longest night, all data");
    expect(el.textContent).toContain("Longest Earth gap");
    expect(el.textContent).toContain("Earth centre above terrain: geometric visibility only.");
    expect(el.textContent).toContain("No antenna schedule or link budget");
    expect(el.textContent).toContain("Goldstone, Madrid or Canberra");
    const headers = [...el.querySelectorAll('table[aria-label="Site comparison"] th')];
    const dsnColumn = headers.findIndex((h) => h.textContent === "Earth + DSN, % 30 d");
    expect(dsnColumn).toBe(headers.findIndex((h) => h.textContent === "Earth in view, % 30 d") + 1);
    const rows = el.querySelectorAll('table[aria-label="Site comparison"] tbody tr');
    expect(rows[0].children[dsnColumn].textContent).toContain("25 %"); // 180 of 720 hours
    expect(rows[1].children[dsnColumn].textContent).toBe("—");
    expect(requested).toContain(FULL_DAYS); // night and gap use the whole window, not a 30-day slice
    act(() => root.unmount());
  });

  it("toggles terrain / bare sphere without reload and takes the caption numbers from the two series", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Compare sites={[A, B, C]} atUtc="2027-01-15T00:00:00Z" />));
    const rowA = () => el.querySelector('table[aria-label="Site comparison"] tbody tr')?.textContent;
    const terrainRow = rowA();
    const caption = el.querySelector('[aria-label="Terrain effect"]')?.textContent ?? "";
    const full = mockTimeline(A, "2026-12-01T00:00:00Z", FULL_DAYS);
    expect(caption).toContain(`a: ${terrainCaption(terrainEffect(full))}`);
    expect(caption).toContain("b: no terrain model, already a bare sphere.");
    expect(caption).toContain("c: no sphere variant");

    const radios = el.querySelectorAll<HTMLInputElement>('input[name="compare-surface"]');
    expect(radios[0].checked).toBe(true);
    await act(async () => radios[1].click());
    expect(radios[1].checked).toBe(true);
    expect(rowA()).not.toBe(terrainRow); // the table changed
    expect(el.textContent).toContain("The sphere has one answer");
    expect(el.querySelector('[aria-label="Terrain effect"]')?.textContent).toBe(caption); // caption is the same in both modes
    await act(async () => radios[0].click());
    expect(rowA()).toBe(terrainRow);
    act(() => root.unmount());
  });
});
