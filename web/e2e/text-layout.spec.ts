import { expect, test, type Page } from "@playwright/test";
import { closeLayer, enterMap, openPlace, rail } from "./nav";

// #296: the owner reads "·" as filler; no visible text on the main screens has it.
// #298: the dock has no DSN band (was #295) and no buttons under the scale.
// #297: at 390 px the build stamp does not cover the time strip of the dock.
// #317: on 1440 and 1280 px the build stamp keeps off every "… in …" line of the next events.

const noDot = async (page: Page, where: string) => {
  const text = await page.evaluate(() => document.body.innerText);
  const hits = text.split("\n").filter((l) => l.includes("·"));
  expect(hits, `"·" on ${where}`).toEqual([]);
};

type Box = { x: number; y: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
// #317: 2 px of air round the stamp, so a 1 px font difference does not put it on the text.
const grow = (a: Box, d: number): Box => ({ x: a.x - d, y: a.y - d, width: a.width + 2 * d, height: a.height + 2 * d });

for (const vp of [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`text and dock layout at ${vp.width} px: no "·", no DSN band, build stamp clear`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/?guide=0");
    await expect(page.locator(".build-label")).toBeVisible();
    await noDot(page, "start");
    await enterMap(page);
    const card = await openPlace(page, "Haworth");
    // A pick from typed search closes the result list.
    await expect(page.getByRole("list", { name: "Site list" })).toHaveCount(0);
    await expect(card.getByLabel("If the landing slips")).toBeVisible({ timeout: 15000 });
    await noDot(page, "place card");

    // #298: no DSN band and no buttons under the scale.
    const dock = page.getByRole("region", { name: "Time sheet" });
    await expect(dock.locator(".hud-dsn")).toHaveCount(0);
    await expect(dock.locator("button:not(.hud-legend-hint)")).toHaveCount(0); // #461: SET DATE is the one button

    // #297: the build stamp and the time strip of the dock do not overlap.
    const stamp = (await page.locator(".build-label").boundingBox())!;
    const strip = (await dock.getByRole("slider", { name: "Scrub date" }).boundingBox())!;
    expect(overlap(stamp, strip), "build stamp over the time strip").toBe(false);
    // #317: each "Sunset in …", "Earthset in …" line; the block is hidden at ≤ 1100 px.
    const lines = dock.getByLabel("Next events").locator(".hud-next");
    if (vp.width > 1100) await expect(lines.first()).toContainText(/ in /);
    for (const line of await lines.all()) {
      const box = await line.boundingBox();
      if (box) expect(overlap(grow(stamp, 2), box), `build stamp over "${await line.textContent()}"`).toBe(false);
    }

    await card.getByRole("button", { name: "Horizon view" }).click();
    await expect(page.getByRole("img", { name: "Horizon mask with Sun and Earth tracks" })).toBeVisible();
    await noDot(page, "Horizon");
    await closeLayer(page);

    await rail(page, "NASA check");
    const check = page.getByRole("dialog", { name: "NASA check" });
    await expect(check.getByRole("status")).toContainText(/\d+ of \d+ checks pass/, { timeout: 15000 });
    await expect(check.getByRole("region", { name: "Model shadow vs LRO images" })).toBeVisible();
    await noDot(page, "NASA check");
    // The open mission calendar does not show from under the sheet.
    const cal = page.locator(".mcal.is-open");
    if (await cal.count()) await expect(cal).toBeHidden();

    await rail(page, "Compare");
    await expect(page.getByRole("table", { name: "Site comparison" })).toBeVisible();
    await noDot(page, "Compare");
    await rail(page, "Windows");
    await noDot(page, "Windows");
  });
}

// #398: on the first screen no stat label ends in "…" and no step label is cut at the screen edge.
for (const vp of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`first screen at ${vp.width} px: stat labels and steps are whole`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto("/?hero=1&guide=0");
    await expect(page.locator(".hero-stats dt").first()).toBeVisible();
    const cut = await page.evaluate(() => {
      const out: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>(".hero-stats dt"))
        if (el.scrollWidth > el.clientWidth + 1) out.push(`label "${el.textContent}"`);
      // #460: the steps live in the rail; under the welcome screen the rail slides away, on screen it is whole.
      for (const el of document.querySelectorAll<HTMLElement>(".rail .rail-btn")) {
        const r = el.getBoundingClientRect();
        if (getComputedStyle(el).visibility === "hidden") continue;
        if (r.left < 0 || r.right > window.innerWidth) out.push(`rail "${el.textContent}"`);
        const label = el.querySelector<HTMLElement>(".rail-label");
        if (label && label.scrollWidth > label.clientWidth + 1) out.push(`rail label "${label.textContent}"`);
      }
      return out;
    });
    expect(cut).toEqual([]);
  });
}
