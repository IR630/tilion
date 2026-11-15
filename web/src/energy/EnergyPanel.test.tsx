import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Timeline } from "../contracts";
import { EnergyPanel } from "./EnergyPanel";

afterEach(() => vi.unstubAllGlobals());

const tl = (stub: boolean): Timeline => {
  const f = (v: number) => Array(24).fill(v);
  return {
    siteId: "a", startUtc: "2027-01-01T00:00:00Z", stepMin: 60,
    sunAz: f(0), sunEl: f(0), sunVisible: f(0), earthAz: f(0), earthEl: f(0), earthVisible: f(0),
    ...(stub ? { stub: true } : {}),
  };
};

function verdict(t: Timeline): string {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<EnergyPanel tl={t} period="next 30 d" />));
  const text = host.querySelector(".energy-verdict")?.textContent ?? "";
  act(() => root.unmount());
  return text;
}

// #235: the site screen and the mission plan share one rule: no energy verdict on mock data.
it("gives a verdict on real data and none on mock data", () => {
  expect(verdict(tl(false))).toMatch(/^Survives next 30 d: lowest charge/);
  expect(verdict(tl(true))).toBe("No verdict on mock data: the Sun track is synthetic.");
});

// #332: the panel field adds a flat deck preset and a tilted panel; the default stays the vertical tracking panel.
it("switches to a horizontal deck and a tilted panel; tilt 90° gives the vertical fixed verdict", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const f = (v: number) => Array(24).fill(v);
  // Sun visible all day at 30° elevation, azimuth 0. Vertical: 320 cos30 = 277 W > 174 W load, the battery stays
  // full. Deck: 320 sin30 = 160 W, 14 W short for 24 h = 336 Wh of 5,420 Wh, lowest charge 94 %.
  const t: Timeline = { siteId: "a", startUtc: "2027-01-01T00:00:00Z", stepMin: 60, sunAz: f(0), sunEl: f(30), sunVisible: f(1), earthAz: f(0), earthEl: f(0), earthVisible: f(0) };
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<EnergyPanel tl={t} period="next 1 d" />));
  const text = () => host.querySelector(".energy-verdict")?.textContent ?? "";
  const select = host.querySelector("select")!;
  const pick = (v: string) => act(() => {
    select.value = v;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const tiltInput = () => [...host.querySelectorAll("label")].find((l) => l.textContent?.startsWith("Tilt"))?.querySelector("input");
  expect(text()).toBe("Survives next 1 d: the battery stays full.");
  expect(tiltInput()).toBeUndefined();
  pick("deck");
  expect(text()).toMatch(/^Survives next 1 d: lowest charge 94\u00a0% at/);
  pick("tilted");
  const input = tiltInput()!;
  expect(input.value).toBe("90");
  const fixedVerdict = text();
  pick("fixed");
  expect(text()).toBe(fixedVerdict);
  act(() => root.unmount());
});
