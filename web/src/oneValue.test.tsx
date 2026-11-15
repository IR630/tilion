// #162: one quantity = one computation and one precision on every screen.
// The same site and moment must give the same text on the place card, the Compare row, the
// Windows (Calendar) summary and the Horizon view. The data is served through the real loaders (api.ts).
// #206: the headline Sun angle is the clearance above the terrain horizon; every share names its period.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HorizonMask, Site, Timeline, VisibilityVariants } from "./contracts";
import { EllipseBlock, type EllipseDoc } from "./beta/ellipse/Ellipse";
import { PlaceCard } from "./navigator/Navigator";
import { Calendar } from "./screens/Calendar";
import { Compare } from "./screens/Compare";
import { Horizon } from "./screens/Horizon";

const START = "2026-12-01T00:00:00Z";
const N = 120 * 24; // 120 days hourly
const NOW = 45 * 24 + 12; // 2027-01-15 12:00 UTC
const SUNSET = NOW + 1469; // 61.2 d after NOW
const NIGHT_H = 110; // 4.6 d
const EARTHSET = NOW + 202; // 8.4 d
const GAP_H = 322; // 13.4 d
const site: Site = {
  id: "ridge_x", name: "Ridge X", group: "ridge", status: "", kind: "point", lat: -89.44, lonE: 222.83,
  elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
};
const tl: Timeline = {
  siteId: site.id,
  startUtc: START,
  stepMin: 60,
  sunAz: new Array(N).fill(120),
  // A new tenth of a degree every hour: a different hour boundary shows as a different number.
  sunEl: Array.from({ length: N }, (_, k) => (k % 10) / 10 + 0.03),
  sunVisible: Array.from({ length: N }, (_, k) => (k >= SUNSET && k < SUNSET + NIGHT_H ? 0 : 1)),
  earthAz: new Array(N).fill(0),
  earthEl: new Array(N).fill(5.23),
  earthVisible: Array.from({ length: N }, (_, k) => (k >= EARTHSET && k < EARTHSET + GAP_H ? 0 : 1)),
};
const variants: VisibilityVariants = {
  siteId: site.id,
  startUtc: START,
  stepMin: 60,
  n: N,
  ref: { heightM: 2, dem: "20+80+240" },
  variants: [
    // observer 0 m: the Sun goes behind near terrain after 19 h
    { heightM: 0, dem: "20+80+240", sun: [0, NOW + 19, NOW + 69], earth: [0, EARTHSET, EARTHSET + GAP_H] },
    { heightM: 10, dem: "20+80+240", sun: [0, SUNSET, SUNSET + NIGHT_H], earth: [0, EARTHSET, EARTHSET + GAP_H] },
  ],
};

// The terrain horizon is 1.0° under level toward the Sun (az 120°) and 0.5° above it toward the Earth (az 0°).
const mask: HorizonMask = {
  siteId: site.id, observerHeightM: 2, terrain: "polar80", azStepDeg: 1,
  elevDeg: Array.from({ length: 360 }, (_, a) => (a >= 90 && a <= 150 ? -1 : 0.5)),
};
// PGDA 69 18.6-year means at the aim point: Earth 54 %, next to a "next 30 d" share of 56 %.
const ellipse: EllipseDoc = {
  thresholdPct: 40, pixelM: 60,
  sites: { [site.id]: { "1000": { n: 900, sun: { aim: 88.1, p10: 61.2, shareGe40: 97 }, earth: { aim: 54.2, p10: 30.1, shareGe40: 70 } } } },
};

function serve() {
  const files: Record<string, unknown> = {
    [`timeline/${site.id}.json`]: tl, [`variants/${site.id}.json`]: variants, [`mask/${site.id}.json`]: mask, "beta/ellipse.json": ellipse,
  };
  vi.stubGlobal("fetch", async (url: string) => {
    const key = Object.keys(files).find((k) => url.endsWith(k));
    return key ? { ok: true, status: 200, json: async () => files[key] } : { ok: false, status: 404, json: async () => null };
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(node: React.ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  const root = createRoot(el);
  await act(async () => root.render(node));
  await act(async () => {}); // loaders settle
  return { el, unmount: () => act(() => root.unmount()) };
}

/** Compare cell: the small grey text under the big value. */
function compareSpread(el: HTMLElement, head: string): string {
  const ths = [...el.querySelectorAll('table[aria-label="Site comparison"] th')];
  const col = ths.findIndex((h) => (h.textContent ?? "").startsWith(head));
  const td = el.querySelector('table[aria-label="Site comparison"] tbody tr')!.children[col];
  return (td.querySelector(".cmp-spread")?.textContent ?? "").trim();
}

/** Text of a Compare cell: first row, the column whose header starts with `head`; the big value only. */
function compareValue(el: HTMLElement, head: string): string {
  const ths = [...el.querySelectorAll('table[aria-label="Site comparison"] th')];
  const col = ths.findIndex((h) => (h.textContent ?? "").startsWith(head));
  expect(col, head).toBeGreaterThan(0);
  const td = el.querySelector('table[aria-label="Site comparison"] tbody tr')!.children[col];
  return (td.querySelector(".cmp-v")?.textContent ?? td.textContent ?? "").trim();
}

const noop = () => {};

describe("one value on every screen (#162, #206)", () => {
  for (const at of ["2027-01-15T12:00:00Z", "2027-01-15T12:20:00Z"]) {
    it(`card, Compare, Windows and Horizon agree at ${at}`, async () => {
      serve();
      const card = await mount(
        <PlaceCard site={site} nearby={null} onAddCustom={noop} atUtc={at} onChange={noop} onClose={noop} onOpenHorizon={noop} onOpenView={noop} onCompare={noop} onPlanFrom={noop} onAddWaypoint={null} waypointAdded={false} />,
      );
      const sun = card.el.querySelector(".place-tile.sun")?.textContent ?? "";
      const earth = card.el.querySelector(".place-tile.earth")?.textContent ?? "";
      card.unmount();

      const cmp = await mount(<Compare sites={[site]} atUtc={at} />);
      const el = compareValue(cmp.el, "Sun above terrain");
      const level = compareSpread(cmp.el, "Sun above terrain");
      const sunset = compareValue(cmp.el, "To sunset");
      const sunsetSpread = compareSpread(cmp.el, "To sunset");
      const earthset = compareValue(cmp.el, "To Earthset");
      const night = compareValue(cmp.el, "Longest night");
      const gap = compareValue(cmp.el, "Longest Earth gap");
      const light = compareValue(cmp.el, "Sun lit, % 30 d");
      const earthShare = compareValue(cmp.el, "Earth in view, % 30 d");
      cmp.unmount();

      // One precision: angles to 0.1°, durations in d with one decimal above 48 h.
      // #206 the headline is above terrain: sunEl 0.23° (step 12:00) over a −1.0° skyline = 1.2°.
      expect(el).toBe("1.2°");
      expect(level).toBe("0.2° above level");
      expect(sun).toContain("1.2° above terrain (0.2° above level)");
      expect(earth).toContain("4.7° above terrain (5.2° above level)");
      expect(sunset).toBe("61.2 d");
      expect(sun).toContain(`Sunset in ${sunset}`);
      expect(earthset).toBe("8.4 d");
      expect(earth).toContain(`Earthset in ${earthset}`);
      expect(night).toBe("4.6 d");
      expect(gap).toBe("13.4 d");

      const win = await mount(<Calendar sites={[site]} atUtc={at} onPick={noop} />);
      const long = [...win.el.querySelectorAll("button")].find((b) => b.textContent === "Long stay 30 d")!;
      await act(async () => long.click());
      const runs = win.el.querySelector(".calendar-runs")?.textContent ?? "";
      win.unmount();
      expect(runs).toContain(`Longest dark period${night}`);
      expect(runs).toContain(`Sun lit ${light}, Earth in view ${earthShare}`);
      expect(runs).toContain("(share of the 30 d mission window from");

      // #206 Horizon view: the same moment (the step that holds it), the same clearance, the time to
      // sunset searched to the data end (not "> 30.0 d" inside its own period) and the same 30-day shares.
      const hz = await mount(<Horizon site={site} atUtc={at} />);
      await act(async () => {}); // the whole window for the events
      const tiles = [...hz.el.querySelectorAll(".horizon-readouts > .hud-tile")].map((t) => t.textContent ?? "");
      // #436: the time to sunset is the KPI (second of the row), not repeated among the readout tiles.
      const sunKpi = hz.el.querySelectorAll(".horizon-kpis > .horizon-kpi")[1]?.textContent ?? "";
      const text = hz.el.textContent ?? "";
      hz.unmount();
      expect(tiles).toHaveLength(3);
      expect(tiles[0]).toContain("1.2° above terrain (0.2° above level)");
      expect(sunKpi).toContain(`in ${sunset}`);
      expect(sunKpi).not.toContain(">");
      expect(sunKpi).toContain(`spread ${sunsetSpread}`);
      expect(tiles.join(" ")).not.toMatch(/Sunset|Sunrise/); // not repeated in the readout row
      expect(tiles[1]).toContain("4.7° above terrain (5.2° above level)");
      expect(tiles[2]).toContain(`in ${earthset}`);
      expect(text).toContain(`Sun visible ${light} of next 30\u00a0d`);
      expect(text).toContain(`Earth visible ${earthShare} of next 30\u00a0d`);
    });
  }

  it("labels the landing-ellipse shares as 18.6-year means, not a 30-day share", async () => {
    serve();
    const { el, unmount } = await mount(<EllipseBlock siteId={site.id} />);
    const text = el.textContent ?? "";
    const bars = [...el.querySelectorAll("svg title")].map((t) => t.textContent ?? "");
    unmount();
    expect(text).toContain("Earth, % (18.6-y mean)");
    expect(text).toContain("Bars at 1 km, 18.6-y mean");
    expect(bars.find((b) => b.startsWith("Earth at aim"))).toBe("Earth at aim: 54.2 %, 18.6-y mean");
    expect(bars.every((b) => b.endsWith("18.6-y mean"))).toBe(true);
  });
});
