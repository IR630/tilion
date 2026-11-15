import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NextWindows } from "./NextWindows";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

it("shows an alert when hours.json fails to load", async () => {
  vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<NextWindows siteId="s" atUtc="2027-01-15T00:00:00Z" onPick={() => {}} />));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("Next windows unavailable");
  await act(async () => root.unmount());
});
