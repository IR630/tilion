import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TraversePanel } from "./ScoreParts";
import { planTraverse } from "./traverse";
import type { MissionPlan } from "./types";
import { DEFAULT_PLAN } from "./types";

afterEach(() => vi.unstubAllGlobals());

// #195: one drive read "Drive 3979 h" here and "16.6 d" in the profile. Drive and leg times use
// the shared duration format (format.ts fmtDuration), and the text names the one rover speed.
it("shows drive and leg times in days with the shared format", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const v = [
    { name: "site", lat: -89.44, lonE: 222.8 },
    { name: "WP1", lat: -88.0, lonE: 120.0 },
  ];
  const n = 2000;
  const s = { startMs: 0, stepMin: 60, sun: new Array(n).fill(1), earth: new Array(n).fill(1), terrain: true };
  const traverse = planTraverse(v, [s, s], 0);
  expect(traverse.hours).toBeGreaterThan(48);
  const plan: MissionPlan = { ...DEFAULT_PLAN, siteId: "site", landingUtc: "1970-01-01T00:00:00Z", waypoints: [{ name: "WP1", lat: -88, lonE: 120 }] };
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<TraversePanel state={{ traverse, pending: 0, failed: [] }} plan={plan} onMission={() => {}} />));
  const days = `${(traverse.hours / 24).toFixed(1)} d`;
  expect(host.querySelector('[data-testid="traverse-score"]')?.textContent).toContain(`Drive ${days}`);
  expect(host.querySelector('[data-testid="traverse-leg"]')?.textContent).toContain(days);
  expect(host.textContent).toContain("36 m/h");
  expect(host.textContent).not.toMatch(/\d{3,} h\b/);
  act(() => root.unmount());
});
