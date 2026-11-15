import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Blocker } from "./Bottleneck";
import type { HorizonMask, Timeline } from "../contracts";

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(() => vi.unstubAllGlobals());

it("keeps the blocker sentence without distance when its optional file is missing", async () => {
  vi.stubGlobal("fetch", async () => ({ ok: false, status: 404 }));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const tl: Timeline = {
    siteId: "missing", startUtc: "2026-12-01T00:00:00Z", stepMin: 60,
    sunAz: [132], sunEl: [0], sunVisible: [0], earthAz: [0], earthEl: [0], earthVisible: [0],
  };
  const mask: HorizonMask = {
    siteId: "missing", terrain: "polar80", observerHeightM: 2, azStepDeg: 1, elevDeg: Array(360).fill(1),
  };
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () => root.render(<Blocker period="next 30 d" timeline={tl} mask={mask} />));
    expect(el.textContent).toContain("Main blocker: ridge at 132–133° az, peak 1.0° elevation — costs 1 h");
    expect(el.textContent).not.toContain("km away");
    expect(error).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    error.mockRestore();
  }
});

it("reports zero terrain losses without loading a ridge file", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const tl: Timeline = {
    siteId: "ridge", startUtc: "2026-12-01T00:00:00Z", stepMin: 60,
    sunAz: [132], sunEl: [1], sunVisible: [1], earthAz: [0], earthEl: [0], earthVisible: [0],
  };
  const mask: HorizonMask = {
    siteId: "ridge", terrain: "polar80", observerHeightM: 2, azStepDeg: 1, elevDeg: Array(360).fill(-1),
  };
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () => root.render(<Blocker period="next 30 d" timeline={tl} mask={mask} />));
    expect(el.textContent).toContain("Main blocker: none — terrain hides the Sun for 0 h, next 30 d; any night here is the Sun under the level horizon.");
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});
