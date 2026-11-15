import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StationPanel } from "./StationPanel";

describe("station panel", () => {
  it("shows each measured elevation, link state, and the next geometric link", () => {
    const html = renderToStaticMarkup(<StationPanel rows={[
      { name: "Goldstone", elevationDeg: 12.3, link: true },
      { name: "Madrid", elevationDeg: -4.5, link: false },
      { name: "Canberra", elevationDeg: 20, link: false },
    ]} next={{ kind: "available", station: "Madrid", hours: 3 }} />);
    expect(html).toContain("Goldstone");
    expect(html).toContain("12.3°");
    expect(html).toContain("−4.5°");
    expect(html).toContain("Canberra");
    expect(html).toContain("Link available");
    expect(html).toContain("Link available now via Goldstone");
    expect(html).toContain("No link");
    expect(html).toContain("Next link via Madrid in 3 h");
    expect(html).toContain("No station schedule or link budget");
  });

  it("does not invent a next link beyond available data", () => {
    const html = renderToStaticMarkup(<StationPanel rows={[{ name: "Goldstone", elevationDeg: null, link: null }]} next={{ kind: "none" }} />);
    expect(html).toContain("No next link in the available data");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("Next link via");
  });

  it("distinguishes missing data from a search with no future event", () => {
    const html = renderToStaticMarkup(<StationPanel rows={[]} next={{ kind: "unknown" }} />);
    expect(html).toContain("Next link unavailable");
    expect(html).not.toContain("No next link in the available data");
  });
});
