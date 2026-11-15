import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LrocCheck, type LrocResult } from "./LrocCheck";

const row: LrocResult = {
  id: "NAC_DTM_X_M1_4M", place: "Malapert massif", images: ["M1LC", "M1RC"], imageUrls: ["u1", "u2"],
  orthoUrl: "o", page: "p", startUtc: "2010-10-07T08:41:08", stopUtc: "2010-10-07T08:41:47",
  midUtc: "2010-10-07T08:41:27.5", pixelM: 4, cellM: 20, bounds: [0, 0, 1, 1], centre: { lonE: 359, lat: -86 },
  sun: { az: 189, el: -2.1, radius: 0.27 }, shiftM: [12, -20], shiftCorrelation: 0.9, cells: 100, otsuIof: 0.014,
  imageShadowPct: 87, modelShadowPct: 48, agreementPct: 60.7, shadowIou: 0.55, sphereAgreementPct: 87.3,
  modelShadowDarkPct: 100, minAgreementPct: 85, minIou: 0.7, pass: false,
  reason: "agreement 60.7 % < 85 %", image: "a.webp", mask: "a_mask.webp", terrain: "LOLA",
};  // prettier-ignore

afterEach(() => vi.unstubAllGlobals());

describe("LrocCheck", () => {
  it("keeps a failed image on screen with its reason", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal("fetch", async (url: string) => ({
      ok: true,
      json: async () => (url.endsWith("index.json") ? { ids: [row.id], rule: "r" } : row),
    }));
    const el = document.createElement("div");
    await act(async () => createRoot(el).render(<LrocCheck />));
    expect(el.textContent).toContain("0 of 1 pass");
    expect(el.querySelector(".val-fail")?.textContent).toBe("FAIL");
    expect(el.textContent).toContain("agreement 60.7 % < 85 %");
  });

  it("counts S9 only on the blind test images and can switch a card back to S8", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const s9 = {
      albedo: 0.1, excludedPct: 4.3, imageShadowPct: 20, modelShadowPct: 19, agreementPct: 99.3, shadowIou: 0.96,
      sphereAgreementPct: 80.4, pass: true, reason: "agreement 99.3 % ≥ 85 %", mask: "a_mask9.webp",
    };  // prettier-ignore
    const dev = { ...row, split: "dev", s9 };
    const test = { ...row, id: "T", place: "Nobile crater", split: "test", s9 };
    vi.stubGlobal("fetch", async (url: string) => ({
      ok: true,
      json: async () =>
        url.endsWith("index.json") ? { ids: [dev.id, test.id], rule: "r" } : url.endsWith("/T.json") ? test : dev,
    }));
    const el = document.createElement("div");
    await act(async () => createRoot(el).render(<LrocCheck />));
    expect(el.querySelector("h3")?.textContent).toContain("S9 photometry 1 of 1 new images pass");
    expect(el.querySelector("h3")?.textContent).toContain("S8 Otsu 0 of 1 pass");
    const card = el.querySelectorAll("article")[1];
    expect(card.textContent).toContain("99.3 %");
    const otsu = card.querySelectorAll<HTMLInputElement>("input[type=radio]")[1];
    await act(async () => otsu.click());
    expect(card.textContent).toContain("60.7 %");
    expect(card.querySelector(".val-fail")?.textContent).toBe("FAIL");
  });
});
