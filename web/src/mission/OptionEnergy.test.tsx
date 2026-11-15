import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Site, Timeline } from "../contracts";
import type { RouteOption } from "../route/route";
import { OptionParams } from "./ScoreParts";

afterEach(() => vi.unstubAllGlobals());

const tl = (stub: boolean): Timeline => {
  const f = (v: number) => Array(48).fill(v);
  return {
    siteId: "a", startUtc: "2027-01-01T00:00:00Z", stepMin: 60,
    sunAz: f(0), sunEl: f(0), sunVisible: f(0), earthAz: f(0), earthEl: f(0), earthVisible: f(0),
    ...(stub ? { stub: true } : {}),
  };
};
let current = tl(false);
vi.mock("../api", () => ({ loadFullTimeline: async () => current }));

const site = {
  id: "a", name: "a", group: "artemis", status: "", kind: "point", lat: -89, lonE: 10, elevM: null,
  source: "", confidence: "high", terrain: "polar80", note: "",
} as Site;
const o: RouteOption = {
  windowH: 24, windowClipped: false, sunH: 0, earthH: 0, bothH: 0, longestDarkH: 24, longestNoCommsH: 24,
  hoursToSunset: null, hoursToEarthset: null, sunsetBeyondData: false, earthsetBeyondData: false,
  sunUpAtLanding: false, earthUpAtLanding: false,
  siteId: "a", landingUtc: "2027-01-01T00:00:00Z", slipDays: 0, distanceKm: 0, tags: [],
};

async function render(stub: boolean): Promise<string> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  current = tl(stub);
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<OptionParams o={o} site={site} hours={null} mode="balanced" />));
  const row = [...host.querySelectorAll("dl.sc-params > div")].find((d) => d.querySelector("dt")?.textContent === "Energy margin");
  act(() => root.unmount());
  return row?.querySelector("dd")?.textContent ?? "missing row";
}

// #235: every variant shows the battery margin, not only the plan verdict.
it("shows the energy margin of a variant: 24 h of dark at 108 W takes VIPER to 52 %", async () => {
  expect(await render(false)).toBe("lowest charge 52\u00a0%");
});

it("shows no margin on mock data", async () => {
  expect(await render(true)).toBe("no data");
});
