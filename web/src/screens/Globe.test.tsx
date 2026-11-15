import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Site } from "../contracts";
import { Globe } from "./Globe";

describe("Globe", () => {
  it("renders the globe section with a loading state and the site picker", () => {
    const sites: Site[] = [
      { id: "a", name: "Site A", group: "artemis", status: "", kind: "point", lat: -89, lonE: 10, elevM: null,
        source: "", confidence: "high", terrain: "polar80", note: "" },
      { id: "b", name: "No point", group: "artemis", status: "", kind: "region", lat: null, lonE: null, elevM: null,
        source: "", confidence: "low", terrain: "none", note: "" },
    ];
    const html = renderToString(<Globe sites={sites} atUtc="2027-01-15T00:00:00Z" selected="a" onSelect={() => {}} />);
    expect(html).toContain('aria-label="Globe"');
    expect(html).toContain("Loading globe");
    expect(html).toContain('aria-label="Fly to site"');
    expect(html).not.toContain("No point"); // no marker without a point
    // The fly-to list (a Select: options exist only while it is open) lists only sites with a point.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<Globe sites={sites} atUtc="2027-01-15T00:00:00Z" selected="a" onSelect={() => {}} />));
    act(() => host.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Fly to site"]')!.click());
    const names = [...document.querySelectorAll('[role="listbox"] [role="option"]')].map((o) => o.textContent);
    expect(names).toEqual(["—", "Site A"]); // no fly target without a point
    act(() => root.unmount());
    host.remove();
  });

  it("offers Retry when the globe data fails to load and loads again on click (#393)", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      calls++;
      return Promise.reject(new Error("signal timed out"));
    }) as typeof fetch;
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<Globe sites={[]} atUtc="2027-01-15T00:00:00Z" selected={null} onSelect={() => {}} />));
      const alert = host.querySelector('[role="alert"]')!;
      expect(alert.textContent).toContain("Globe data is not available");
      const before = calls;
      await act(async () => alert.querySelector("button")!.click());
      expect(calls).toBeGreaterThan(before);
      expect(host.querySelector('[role="alert"] button')?.textContent).toBe("Retry");
    } finally {
      act(() => root.unmount());
      globalThis.fetch = realFetch;
    }
  });
});
