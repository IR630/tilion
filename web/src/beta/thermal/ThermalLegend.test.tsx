import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThermalLegend } from "./ThermalLegend";

// #437: on a phone the open legend squeezed the globe to 211 px; it starts folded at ≤ 760 px.
const media = (narrow: boolean) =>
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: narrow && q.includes("max-width: 760px"), media: q }));

describe("ThermalLegend", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts folded on a narrow screen", () => {
    media(true);
    expect(renderToString(<ThermalLegend />)).not.toMatch(/<details[^>]*\bopen/);
  });

  it("starts open on a wide screen", () => {
    media(false);
    expect(renderToString(<ThermalLegend />)).toMatch(/<details[^>]*\bopen/);
  });
});
