import { expect, test } from "@playwright/test";

// #204: the demo plan (Shackleton–de Gerlache ridge, 2027-01-22, Balanced) put route bubbles over
// site names, and four bubbles read "score 100" with nothing to tell them apart. Bubbles and names
// now share one layout: the selected name, then the bubbles in rank order, then the other names.
test.use({ viewport: { width: 1440, height: 900 } });

type Box = { l: number; r: number; t: number; b: number; text: string };

test("plan state at 1440×900: no route bubble over a site name; tied scores show rank and slip", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0&site=cr1_connecting_ridge&t=2027-01-22T00:00Z&days=14&mode=balanced");
  const map = page.getByRole("region", { name: "Navigator map" });
  await expect(map).toHaveAttribute("data-ready", "1", { timeout: 15000 });
  const bubbles = map.locator(".nav-callout");
  await expect(bubbles).toHaveCount(6);

  // Rank first, then the score; the tied ones mark the slip that ranks them.
  await expect(bubbles.first()).toHaveText(/^#1score \d+(same day|slip [+−]\d+ d)/);
  expect(await map.locator(".nav-callout.is-tie").count()).toBeGreaterThanOrEqual(4);
  await expect(map.locator(".nav-callout.is-tie").first()).toHaveAttribute("aria-label", /ranks it$/);

  const overlaps = () =>
    page.evaluate(() => {
      const box = (el: Element): Box => {
        const r = el.getBoundingClientRect();
        return { l: r.left, r: r.right, t: r.top, b: r.bottom, text: (el as HTMLElement).innerText };
      };
      const W = window.innerWidth;
      const H = window.innerHeight;
      const names = [...document.querySelectorAll(".nav-marker.lbl-on .nav-marker-label, .nav-marker.is-selected .nav-marker-label")]
        .filter((el) => getComputedStyle(el).opacity !== "0")
        .map(box)
        .filter((n) => n.r > 0 && n.l < W && n.b > 0 && n.t < H);
      const bubs = [...document.querySelectorAll(".nav-callout")].map(box);
      const hit = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      const out: string[] = [];
      for (const b of bubs) for (const n of names) if (hit(b, n)) out.push(`${b.text} × ${n.text}`);
      return { names: names.length, out };
    });
  // The camera fits the routes with an animation; the layout follows every frame.
  await expect.poll(async () => (await overlaps()).out, { timeout: 10000 }).toEqual([]);
  await page.waitForTimeout(1200); // past the 900 ms camera fit: the end state is clean too
  const end = await overlaps();
  expect(end.out).toEqual([]);
  expect(end.names).toBeGreaterThan(3); // the names did not all drop
  expect(errors).toEqual([]);
});
