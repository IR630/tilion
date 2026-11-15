import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { EllipseExample } from "./EllipseExample";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("EllipseExample", () => {
  it("labels the share as an area criterion, not a safety claim, and names DEM and baseline", () => {
    const el = document.createElement("div");
    act(() => createRoot(el).render(<EllipseExample />));
    const t = el.textContent ?? "";
    expect(t).toContain("not a probability of success or a safety certification");
    expect(t).toContain("Boulders, guidance and landing dynamics are not assessed");
    expect(t).toContain("DEM 5 m (PGDA 78");
    expect(t).toContain("10 m baseline");
    expect(t).toContain("No data: 0.00 %");
    expect(t).toContain("unknown (outside DEM coverage)");
  });
});
