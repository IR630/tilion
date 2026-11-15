import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Site } from "../contracts";
import { DEFAULT_LIMITS } from "../landing";

// #424: a failed timeline load must say why the verdict is missing, not leave an empty slot.
vi.mock("../api", async (orig) => ({
  ...(await orig<typeof import("../api")>()),
  loadFullTimeline: (s: Site) => (s.id === "broken" ? Promise.reject(new Error("HTTP 500")) : Promise.resolve(null)),
}));
const { PlanVerdict } = await import("./PlanVerdict");

const site = (id: string): Site => ({
  id, name: id, group: "ridge", status: "", kind: "point", lat: -89.4, lonE: 222.8, elevM: null, source: "", confidence: "high", terrain: "polar80", note: "",
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function render(s: Site) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => createRoot(host).render(<PlanVerdict site={s} landingUtc="2027-01-01T00:00:00Z" limits={DEFAULT_LIMITS.cond} />));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

describe("Windows verdict on a failed timeline (#424)", () => {
  it("says the verdict is unavailable when the timeline load fails", async () => {
    const host = await render(site("broken"));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Windows verdict unavailable: timeline failed to load.");
  });
  it("says the same when the timeline file is missing", async () => {
    const host = await render(site("missing"));
    expect(host.textContent).toBe("Windows verdict unavailable: timeline failed to load.");
  });
});
