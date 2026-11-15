import { expect, type Page, test } from "@playwright/test";
import { enterMap, openPlace, pinNow } from "./nav";

// #397: the Sun / Earth / DSN status strip (#371) sat over the inset caption "5 × 5 KM, LOLA 20 M"
// (#129) and over the route option bubbles of a plan (#72), and the bubbles piled up under it.
// Boxes of the strip, the inset (caption and tile) and the bubbles must not intersect; the strip
// also clears the left column and the place card.

type Box = { l: number; r: number; t: number; b: number; name: string };

const SHOTS = process.env.SHOTS_397;

async function overlaps(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    const vis = (el: Element) => {
      const r = el.getBoundingClientRect();
      return getComputedStyle(el).display !== "none" && r.width > 0 && r.height > 0;
    };
    const box = (el: Element, name: string): Box => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, name };
    };
    const pick = (sel: string, name: (el: Element, i: number) => string) =>
      [...document.querySelectorAll(sel)].filter(vis).map((el, i) => box(el, name(el, i)));
    const strip = pick(".status-strip", () => "status strip");
    const inset = [...pick(".inset-tile .si-label", () => "inset caption"), ...pick(".inset-tile .si-frame", () => "inset tile")];
    const bubbles = pick(".nav-callout", (el) => `bubble ${(el as HTMLElement).innerText.replace(/\s+/g, " ")}`);
    const hit = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const panels = pick(".lcol > *, .place-card", (el) => `panel ${el.className.split(" ")[0]}`);
    // #437: the route bubbles also keep off the place card on the right.
    const card = pick(".place-card", () => "place card");
    const pairs: [Box[], Box[]][] = [
      [strip, panels],
      [strip, inset],
      [strip, bubbles],
      [inset, bubbles],
      [card, bubbles],
    ];
    for (const [as, bs] of pairs) for (const a of as) for (const b of bs) if (hit(a, b)) out.push(`${a.name} × ${b.name}`);
    for (let i = 0; i < bubbles.length; i++)
      for (let j = i + 1; j < bubbles.length; j++) if (hit(bubbles[i], bubbles[j])) out.push(`${bubbles[i].name} × ${bubbles[j].name}`);
    return { out, strip: strip.length, inset: inset.length, bubbles: bubbles.length, card: card.length };
  });
}

const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
];

for (const size of SIZES) {
  const wide = size.width > 900;
  test.describe(`${size.width}×${size.height}`, () => {
    test.use({ viewport: size });

    for (const site of ["Haworth", "Malapert Massif"]) {
      test(`site ${site}: the status strip clears the inset caption and tile`, async ({ page }) => {
        await pinNow(page); // a bare ?t= does not set the moment; the app opens on the clock (#377)
        await page.goto("/?guide=0&t=2027-01-15T00:00Z");
        await enterMap(page);
        await openPlace(page, site);
        if (wide) {
          await expect(page.locator(".status-strip")).toBeVisible();
          await expect(page.getByTestId("site-inset")).toBeVisible();
        }
        await page.waitForTimeout(1600); // past the fly-to: the end state
        const end = await overlaps(page);
        if (SHOTS) await page.screenshot({ path: `${SHOTS}/${size.width}-site-${site}.png` });
        expect(end.out).toEqual([]);
        if (wide) expect(end.inset).toBe(2); // the inset did not simply drop
      });
    }

    test("Malapert plan: route bubbles clear the strip, the inset, the place card and each other", async ({ page }) => {
      await page.goto("/?guide=0&site=a_malapert_massif&t=2027-01-15T00:00Z&days=14&mode=balanced");
      const map = page.getByRole("region", { name: "Navigator map" });
      await expect(map).toHaveAttribute("data-ready", "1", { timeout: 15000 });
      await expect(map.locator(".nav-callout").first()).toBeAttached();
      await page.waitForTimeout(1600); // past the camera fit
      const end = await overlaps(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${size.width}-plan-malapert.png` });
      expect(end.out).toEqual([]);
    });
  });
}
