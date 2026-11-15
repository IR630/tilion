import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { HorizonMask, Site, Timeline } from "../contracts";
import { loadMask, loadTimeline, loadVariants } from "../api";
import { gsap, setMotion } from "../motion";
import {
  elevationRange,
  gridStep,
  Horizon,
  maskAt,
  nextEvent,
  pathThrough,
  sampleIndexes,
  seamCopies,
  splitAtSeam,
  statusText,
  stepsToChange,
  visiblePercent,
  nextEventParts,
} from "./Horizon";
import { humanHours, moreThan } from "./hud";
import { mockMask, mockTimeline } from "../mock";
import { terrainCaption, terrainEffect } from "../summary";

const mask: HorizonMask = {
  siteId: "t",
  observerHeightM: 2,
  terrain: "polar80",
  azStepDeg: 1,
  elevDeg: Array.from({ length: 360 }, (_, k) => (k === 359 ? 3 : k === 0 ? 1 : 0)),
};

function timeline(sunVisible: number[], earthVisible: number[]): Timeline {
  const n = sunVisible.length;
  return {
    siteId: "t",
    startUtc: "2027-01-01T00:00:00Z",
    stepMin: 60,
    sunAz: Array.from({ length: n }, (_, k) => (350 + k * 5) % 360),
    sunEl: Array(n).fill(1),
    sunVisible,
    earthAz: Array(n).fill(180),
    earthEl: Array(n).fill(5),
    earthVisible,
    stub: true,
  };
}

describe("horizon geometry", () => {
  it("interpolates the mask across the 0/360 seam", () => {
    expect(maskAt(mask, 359.5)).toBeCloseTo(2);
    expect(maskAt(mask, -0.5)).toBeCloseTo(2);
    expect(maskAt(mask, 360)).toBeCloseTo(1);
  });
  it("splits a track where it crosses north", () => {
    const runs = splitAtSeam([350, 355, 0, 5], [1, 1, 1, 1]);
    expect(runs.map((r) => r.map(([a]) => a))).toEqual([[350, 355], [0, 5]]);
  });
  it("draws a disc on both edges at the seam", () => {
    const [a, b] = seamCopies(359.9, 0.265);
    expect(a).toBeCloseTo(359.9);
    expect(b).toBeCloseTo(-0.1);
    expect(seamCopies(0.1, 0.265)).toEqual([0.1, 360.1]);
    expect(seamCopies(180, 0.265)).toEqual([180]);
  });
  it("keeps the panorama height bounded", () => {
    const tl = timeline([1, 1], [1, 1]);
    tl.sunEl = [-80, 80];
    const [lo, hi] = elevationRange(mask, tl, 12);
    expect(lo).toBe(-4);
    expect((hi - lo) * 12).toBeLessThanOrEqual(480);
    expect(gridStep(hi - lo)).toBe(5);
  });
});

describe("horizon period paths", () => {
  const id = (v: number) => v;
  it("samples every 2 h and breaks the line at the 0/360 seam", () => {
    const tl = timeline(Array(8).fill(1), Array(8).fill(1)); // 60 min step: indexes 0, 2, 4, 6
    expect(sampleIndexes(tl)).toEqual([0, 2, 4, 6]);
    tl.sunAz = [350, 0, 355, 0, 5, 0, 10, 0];
    expect(pathThrough([0, 2, 4, 6], tl.sunAz, tl.sunEl, id, id)).toBe("M350.0,1.0L355.0,1.0M5.0,1.0L10.0,1.0");
  });
  it("skips hidden samples in the visible path", () => {
    expect(pathThrough([0, 1, 2], [10, 20, 30], [1, 2, 3], id, id, [1, 0, 1])).toBe("M10.0,1.0M30.0,3.0");
  });
  it("legend share equals the share counted over the series", () => {
    const flags = [0, 0.3, 1, 0, 0, 1, 1, 0, 0.01, 0];
    expect(visiblePercent(flags)).toBe(50); // 5 of 10 rows have flag > 0
    expect(visiblePercent([])).toBe(0);
  });
});

describe("horizon status", () => {
  it("says Sun hidden when the disc is under the mask", () => {
    const tl = timeline([0.5, 0, 0, 1], [1, 1, 0, 0]);
    expect(statusText(tl, 0).now).toBe("Sun visible (50 % of sunlight), Earth in view");
    expect(statusText(tl, 1).now).toBe("Sun hidden, Earth in view");
    expect(statusText(tl, 2).now).toBe("Sun hidden, Earth hidden");
  });
  it("counts hours to the next sunset or earthset from the current index", () => {
    const tl = timeline([1, 1, 1, 0, 0, 1], [1, 0, 0, 0, 0, 0]);
    expect(statusText(tl, 0).next).toBe("Sunset in 3 h; Earthset in 1 h");
    expect(statusText(tl, 3).next).toBe("Sunrise in 2 h; No earthrise before period end (> 2 h)");
    expect(stepsToChange([1, 1, 1], 0)).toBeNull();
    expect(nextEvent([1, 1, 1], 0, 30, "Sunset", "Sunrise")).toBe("No sunset before period end (> 1 h)");
    // Q8 spread: variant already set (0 h), variant sets later (3 h)
    expect(nextEvent([1, 1, 0, 0], 0, 60, "Sunset", "Sunrise", [[0, 0, 0, 0], [1, 1, 1, 0]])).toBe("Sunset in 2 h, spread 0–3 h");
  });
  it("writes long times in days, without raw ranges in brackets", () => {
    // 214 h to the event, 30-day period: "in 8.9 d"; no event in the period: "> 30.0 d" (#162: one duration format).
    const set = Array.from({ length: 720 }, (_, k) => (k < 214 ? 1 : 0));
    expect(nextEventParts(set, 0, 60, "Earthset", "Earthrise").when).toBe("in 8.9 d");
    const up = Array(720).fill(1);
    const e = nextEventParts(up, 0, 60, "Sunset", "Sunrise", [Array.from({ length: 720 }, (_, k) => (k < 31 ? 1 : 0))]);
    expect(e).toEqual({ word: "Sunset", none: true, when: "> 30.0 d", spread: "31 h – > 30.0 d" });
    expect(nextEvent(up, 0, 60, "Sunset", "Sunrise")).toBe("No sunset before period end (> 30.0 d)");
    expect(humanHours(7.5)).toBe("7.5 h");
    expect(moreThan(40)).toBe("> 40 h");
  });
});

vi.mock("../api", async () => {
  const m = await import("../mock");
  return {
    loadVariants: vi.fn(async () => null),
    getJson: vi.fn(async () => null),
    loadMask: vi.fn(async (s: Site) => m.mockMask(s)),
    loadTimeline: vi.fn(async (s: Site, t: string) => m.mockTimeline(s, t)),
    loadFullTimeline: async (s: Site) => (s.id === "cr1" ? m.mockTimeline(s, "2026-12-01T00:00:00Z", 90) : null),
  };
});

describe("Horizon screen", () => {
  it("shows a mask failure as an alert without a terrain claim and recovers on reload", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(loadMask).mockRejectedValueOnce(new Error("Horizon mask unavailable"));
    const site = { id: "t", name: "Test", terrain: "polar80" } as Site;
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" />));
      expect(el.querySelector('[role="alert"]')?.textContent).toContain("mask unavailable");
      expect(el.textContent).not.toContain("LOLA");
      await act(async () => root.render(<Horizon site={site} atUtc="2027-01-16T00:00:00Z" />));
      expect(el.querySelector('[role="alert"]')).toBeNull();
      expect(el.querySelector('[aria-label="Horizon panorama"]')).not.toBeNull();
    } finally {
      act(() => root.unmount());
    }
  });

  it("marks sampled points hidden and counts visibility over every series row", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const tl = timeline([0, 1, 0.2, 0], [0, 1, 1, 1]);
    tl.sunEl = [-1, 1, -0.1, -1];
    tl.earthEl = [-1, 1, 1, 1];
    vi.mocked(loadMask).mockResolvedValueOnce({ ...mask, elevDeg: Array(360).fill(0) });
    vi.mocked(loadTimeline).mockResolvedValueOnce(tl);
    const el = document.createElement("div");
    const root = createRoot(el);
    const site = { id: "t", name: "Test", terrain: "polar80" } as Site;
    try {
      await act(async () => root.render(<Horizon site={site} atUtc={tl.startUtc} />));
      const sun = el.querySelectorAll(".horizon-sun-point");
      expect(sun).toHaveLength(2);
      expect(sun[0].getAttribute("data-visible")).toBe("false");
      expect(sun[0].getAttribute("aria-label")).toContain("Sun hidden");
      // The centre is below the mask, but the upper solar limb remains visible.
      expect(sun[1].getAttribute("data-visible")).toBe("true");
      expect(el.textContent).toContain("Sun visible 50 % of next 30\u00a0d");
      expect(el.textContent).toContain("Earth visible 75 % of next 30\u00a0d");
      expect(el.textContent).toContain("Earth centre above terrain: geometric visibility only.");
      expect(el.textContent).toContain("No antenna schedule or link budget");
      expect(el.textContent).toContain("spread unavailable");
    } finally {
      act(() => root.unmount());
    }
  });
  it("switches between the mission span and 30 days, and puts the state in the aria-label", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const site = { id: "t", name: "Test", terrain: "polar80" } as Site;
    const el = document.createElement("div");
    const root = createRoot(el);
    const days = () => vi.mocked(loadTimeline).mock.calls.at(-1)?.[2];
    try {
      await act(async () => root.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" missionDays={7} />));
      expect(days()).toBe(7);
      const [mission, thirty] = Array.from(el.querySelectorAll<HTMLButtonElement>(".horizon-span button"));
      expect(mission.getAttribute("aria-pressed")).toBe("true");
      expect(el.querySelector('svg[aria-label^="Horizon mask"]')?.getAttribute("aria-label")).toMatch(/UTC: Sun (visible|hidden)/);
      await act(async () => thirty.click());
      expect(days()).toBe(30);
      expect(thirty.getAttribute("aria-pressed")).toBe("true");
    } finally {
      act(() => root.unmount());
    }
  });
  it("disables the mission span without a plan", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const site = { id: "t", name: "Test", terrain: "polar80" } as Site;
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" />));
      const [mission, thirty] = Array.from(el.querySelectorAll<HTMLButtonElement>(".horizon-span button"));
      expect(mission.disabled).toBe(true);
      expect(thirty.getAttribute("aria-pressed")).toBe("true");
    } finally {
      act(() => root.unmount());
    }
  });
  it("names the Earth libration with N from the timeline, only for a real timeline on terrain", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const site: Site = {
      id: "cr1", name: "Ridge", group: "ridge", status: "", kind: "point", lat: -89.44, lonE: 222.8,
      elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
    };
    const real = async (s: Site, t: string) => {
      const m = mockTimeline(s, t);
      const n = m.earthAz.length;
      return { ...m, stub: false, earthAz: Array.from({ length: n }, (_, k) => 100 + (k % 2) * 6), earthEl: Array(n).fill(3) };
    };
    const el = document.createElement("div");
    const root = createRoot(el);
    vi.mocked(loadTimeline).mockImplementationOnce(real);
    await act(async () => root.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" />));
    expect(el.querySelector('[aria-label="Earth libration"]')?.textContent).toContain("Earth wobbles ±3.0° in the sky (libration)");
    await act(async () => (el.querySelectorAll('input[name="horizon-surface"]')[1] as HTMLInputElement).click());
    expect(el.querySelector('[aria-label="Earth libration"]')).toBeNull();
    act(() => root.unmount());
    const mock = document.createElement("div");
    const root2 = createRoot(mock);
    await act(async () => root2.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" />));
    expect(mock.querySelector('[aria-label="Earth libration"]')).toBeNull();
    act(() => root2.unmount());
  });

  it("shows the verdict and three KPIs first, above the panorama, with numbers from the same series", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const site: Site = {
      id: "cr1", name: "Ridge", group: "ridge", status: "", kind: "point", lat: -89.44, lonE: 222.8,
      elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
    };
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" />));
    const hero = el.querySelector('[aria-label="Horizon summary"]') as HTMLElement;
    expect(hero.compareDocumentPosition(el.querySelector("svg.horizon-panorama")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(hero.querySelector(".horizon-verdict")?.textContent).toMatch(/^Sun (up, -?\d+\.\d° above (terrain|level)|hidden)/);
    const kpis = Array.from(hero.querySelectorAll(".horizon-kpi")).map((k) => k.textContent);
    expect(kpis).toHaveLength(3);
    expect(kpis[0]).toContain("Sun elevation now");
    expect(kpis[2]).toContain("Next Earth window");
    expect(hero.textContent).not.toContain("·");
    expect(el.querySelector('[role="status"]')?.textContent).toMatch(/Sun (visible|hidden)/);
    act(() => root.unmount());
  });

  it("renders the panorama, the status line and the mock disclaimer", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const site: Site = {
      id: "cr1",
      name: "Ridge",
      group: "ridge",
      status: "",
      kind: "point",
      lat: -89.44,
      lonE: 222.8,
      elevM: null,
      source: "",
      confidence: "high",
      terrain: "polar80",
      note: "",
    };
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" />));
    expect(el.querySelector('[role="img"][aria-label^="Horizon mask"]')).not.toBeNull();
    expect(el.querySelector('[role="status"]')?.textContent).toMatch(/Sun (visible|hidden)/);
    expect(el.textContent).toContain("Mock data");
    expect(el.querySelector(".horizon-stub")?.textContent).not.toContain("terrain mask");
    expect(el.textContent).toContain("Relief height");
    expect(el.querySelectorAll("ellipse.horizon-sun").length).toBeGreaterThan(0);
    expect(el.querySelector("p.bottleneck")?.textContent).toMatch(/^Sun \d+ %, Earth \d+ % of next 30\u00a0d: /);
    act(() => root.unmount());
  });

  it("switches the mask to a flat sphere without reload and writes the caption from the two series", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const site: Site = {
      id: "cr1", name: "Ridge", group: "ridge", status: "", kind: "point", lat: -89.44, lonE: 222.8,
      elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
    };
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" />));
    const caption = () => el.querySelector('[aria-label="Terrain effect"]')?.textContent;
    expect(caption()).toBe(terrainCaption(terrainEffect(mockTimeline(site, "2026-12-01T00:00:00Z", 90))));
    const ground = () => el.querySelector("svg.horizon-panorama polygon.horizon-ground")?.getAttribute("points");
    const status = () => el.querySelector('[role="status"]')?.textContent;
    const terrainGround = ground();
    const radios = el.querySelectorAll<HTMLInputElement>('input[name="horizon-surface"]');
    await act(async () => radios[1].click());
    expect(ground()).not.toBe(terrainGround); // the mask is flat now
    expect(status()).toMatch(/Sun (visible|hidden)/);
    expect(caption()).toContain("Terrain changes the Sun share from");
    await act(async () => radios[0].click());
    expect(ground()).toBe(terrainGround);
    act(() => root.unmount());
  });

  it("says there is no sphere variant when the site has no timeline", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const site: Site = {
      id: "nofile", name: "X", group: "ridge", status: "", kind: "point", lat: -88, lonE: 10,
      elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
    };
    const el = document.createElement("div");
    const root = createRoot(el);
    await act(async () => root.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" />));
    expect(el.querySelector('[aria-label="Terrain effect"]')?.textContent).toContain("No sphere variant");
    act(() => root.unmount());
  });

  it("keeps site A on screen until site B's mask and timeline arrive; Earth windows follow the shown site", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const base = { group: "ridge", status: "", kind: "point", elevM: null, source: "", confidence: "high", terrain: "polar80", note: "" } as const;
    const a: Site = { ...base, id: "site-a", name: "Alpha", lat: -89.4, lonE: 222.8 };
    const b: Site = { ...base, id: "site-b", name: "Bravo", lat: -88.8, lonE: 120.1 };
    const el = document.createElement("div");
    const root = createRoot(el);
    const h2 = () => el.querySelector("h2")?.textContent ?? "";
    const variantsFor = () => vi.mocked(loadVariants).mock.calls.at(-1)?.[0]?.id;
    try {
      await act(async () => root.render(<Horizon site={a} atUtc="2027-01-15T00:00:00Z" />));
      expect(h2()).toContain("Alpha");
      expect(variantsFor()).toBe("site-a");
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => (release = r));
      vi.mocked(loadMask).mockImplementationOnce(async (s: Site) => (await gate, mockMask(s)));
      vi.mocked(loadTimeline).mockImplementationOnce(async (s: Site, t: string) => (await gate, mockTimeline(s, t)));
      await act(async () => root.render(<Horizon site={b} atUtc="2027-01-15T00:00:00Z" />));
      // B is still loading: the screen shows A whole, with no blank "Loading…" and no B variants.
      expect(h2()).toContain("Alpha");
      expect(el.textContent).not.toContain("Loading…");
      expect(variantsFor()).toBe("site-a");
      await act(async () => release());
      expect(h2()).toContain("Bravo");
      expect(variantsFor()).toBe("site-b");
    } finally {
      act(() => root.unmount());
    }
  });

  it("with motion on, the entry ends on the rendered state: no inline props, helper nodes or half-counted numbers", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const site: Site = {
      id: "cr1", name: "Ridge", group: "ridge", status: "", kind: "point", lat: -89.44, lonE: 222.8,
      elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
    };
    const render = async () => {
      const el = document.createElement("div");
      document.body.appendChild(el);
      const root = createRoot(el);
      await act(async () => root.render(<Horizon site={site} atUtc="2027-01-15T00:00:00Z" />));
      return { el, root };
    };
    const still = await render(); // motion off: the reference final state
    const finalText = still.el.textContent;
    act(() => still.root.unmount());
    setMotion(true);
    try {
      const { el, root } = await render();
      // Jump every running animation to its end (the intro waits for a frame: unpause it too).
      await act(async () => {
        for (const a of gsap.globalTimeline.getChildren(false)) a.paused(false).progress(1);
      });
      const styled = [...el.querySelectorAll<HTMLElement | SVGElement>("*")].filter(
        (n) => n.style.opacity || n.style.transform || n.style.clipPath || n.style.filter,
      );
      expect(styled.map((n) => n.tagName + "." + n.getAttribute("class"))).toEqual([]);
      expect(document.querySelectorAll(".motion-tmp, .motion-bracketing")).toHaveLength(0);
      expect(el.querySelectorAll('[mask^="url(#mdraw"]')).toHaveLength(0);
      expect(el.textContent).toBe(finalText);
      act(() => root.unmount());
    } finally {
      setMotion(null);
    }
  }, 30000); // two full renders of a 30-day panorama in jsdom: ~9 s
});
