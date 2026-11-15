import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EllipseBlock } from "./Ellipse";

const q = (aim: number, p10: number, s: number) => ({ aim, p10, shareGe40: s });
const doc = {
  thresholdPct: 40, pixelM: 60,
  sites: { slater: {
    "100": { n: 37, sun: q(48.5, 40, 80), earth: q(46, 30, 70) },
    "500": { n: 900, sun: q(48.5, 25, 30), earth: q(46, 10, 50) },
    "1000": { n: 3600, sun: q(48.5, 18.8, 14.3), earth: q(46.3, 0, 38.6) },
  } },
};
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(siteId: string, body: unknown, ok = true) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok, json: async () => body })));
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => { root.render(<EllipseBlock siteId={siteId} />); });
  await act(async () => {});
  return { el, root };
}
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

describe("EllipseBlock", () => {
  it("shows the BETA tag, the caveat, table numbers and radius toggle", async () => {
    const { el } = await mount("slater", doc);
    expect(el.textContent).toContain("BETA");
    expect(el.textContent).toContain("PGDA 69 18.6-y mean, not for a date");
    expect(el.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(el.textContent).toContain("18.8");
    const buttons = [...el.querySelectorAll<HTMLButtonElement>(".beta-radii button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["100 m", "500 m", "1 km"]);
    expect(el.querySelector("svg title")?.textContent).toBe("Sun at aim: 48.5 %, 18.6-y mean");
    await act(async () => { buttons[0].click(); });
    expect(el.querySelector('tr[aria-selected="true"]')?.textContent).toContain("100 m");
    expect(el.querySelectorAll("svg title")[1].textContent).toBe("Sun worst 10 %: 40.0 %, 18.6-y mean");
  });
  it("says so when the site has no coverage or the file is missing", async () => {
    expect((await mount("other", doc)).el.textContent).toContain("No PGDA 69 85°S map coverage");
    document.body.innerHTML = "";
    expect((await mount("slater", null, false)).el.textContent).toContain("No PGDA 69 85°S map coverage");
  });
});
