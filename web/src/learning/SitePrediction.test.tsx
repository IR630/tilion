import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { Site, Timeline } from "../contracts";
import { SitePrediction } from "./SitePrediction";

const site = (id: string): Site => ({ id, name: id, group: "ridge", status: "", kind: "point", lat: -89, lonE: 0, elevM: 0, source: "", confidence: "high", terrain: "polar80", note: "" });
const sites = [site("ridge"), site("floor")];
let maskHeight = 2;
const timeline = (id: string, date: string): Timeline => ({ siteId: id, startUtc: date, stepMin: 60, sunAz: [0, 0], sunEl: [1, 1], sunVisible: id === "ridge" ? [1, 1] : [0, 0], earthAz: [0, 0], earthEl: [0, 0], earthVisible: [0, 0] });
vi.mock("../api", () => ({
  loadMaskOnce: async () => ({ terrain: "polar80", elevDeg: [maskHeight], azStepDeg: 360 }),
  loadTimeline: async (s: Site, t: string) => timeline(s.id, t),
}));
vi.mock("../fullWindow", () => ({ loadFullWindow: async (s: Site) => timeline(s.id, "2027-01-01T00:00:00Z") }));

it("checks real shares and clears the reveal when the date changes", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const show = (date: string) => root.render(<SitePrediction sites={sites} atUtc={date} />);
  try {
    await act(async () => show("2027-01-01T00:00:00Z"));
    await act(async () => el.querySelector<HTMLInputElement>('input[value="ridge"]')!.click());
    await act(async () => el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(el.textContent).toContain("ridge: 100 %");
    expect(el.textContent).toContain("floor: 0 %");
    await act(async () => show("2027-01-02T00:00:00Z"));
    expect(el.textContent).not.toContain("ridge: 100 %");
    expect(el.querySelector<HTMLInputElement>('input[value="ridge"]')!.checked).toBe(false);
  } finally { act(() => root.unmount()); el.remove(); }
});

it("disables the comparison without terrain", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  try {
    await act(async () => root.render(<SitePrediction sites={[sites[0], { ...sites[1], terrain: "none" }]} atUtc="2027-01-01T00:00:00Z" />));
    expect(el.textContent).toContain("Terrain data unavailable");
    expect(el.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  } finally { act(() => root.unmount()); el.remove(); }
});

it("does not claim terrain blocks the Sun when a zero visibility has a clear horizon", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  maskHeight = 0;
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () => root.render(<SitePrediction sites={sites} atUtc="2027-01-01T00:00:00Z" />));
    expect(el.textContent).toContain("No example of the Sun hidden above level");
    expect(el.textContent).not.toContain("Is any part of the Sun visible?");
  } finally { act(() => root.unmount()); maskHeight = 2; }
});
