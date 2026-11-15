import { expect, test, type Page } from "@playwright/test";
import { enterMap, openPlace, rail } from "./nav";

// #310: the search pill and its result list against the panels that share the screen.

/** True when the element's centre is not under another element. */
const onTop = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  });

test.describe("1440×900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the NASA check panel does not show a cut search pill; the pill is back on close", async ({ page }) => {
    await page.goto("/?guide=0");
    await enterMap(page);
    await openPlace(page, "Malapert Massif");
    const pill = page.getByRole("searchbox", { name: "Search sites" });
    await rail(page, "NASA check");
    await expect(page.getByRole("dialog", { name: "NASA check" })).toBeVisible();
    await expect(pill).toBeHidden();
    await page.getByRole("dialog", { name: "NASA check" }).getByRole("button", { name: "Close", exact: true }).click();
    await expect(pill).toBeVisible();
    expect(await onTop(page, ".pill")).toBe(true);
  });
});

test.describe("390×844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a new search with a place card open shows the results over the card, and a tap picks one", async ({ page }) => {
    await page.goto("/?guide=0");
    await enterMap(page);
    const card = await openPlace(page, "Haworth");
    await page.getByRole("searchbox", { name: "Search sites" }).fill("Malapert Massif");
    const first = page.getByRole("list", { name: "Site list" }).getByRole("listitem").first();
    await expect(first).toBeVisible();
    expect(await onTop(page, '[aria-label="Site list"] [role="listitem"]')).toBe(true);
    await first.click();
    await expect(card.getByRole("heading", { level: 2 })).toContainText("Malapert Massif");
    expect(await onTop(page, ".place-card")).toBe(true);
  });

  test("#402, #403: Mission goes over the place card; the plan header fits and leaves the sheets alone", async ({ page }) => {
    await page.goto("/?guide=0");
    await enterMap(page);
    await openPlace(page, "Malapert Massif");
    await rail(page, "Mission");
    const mission = page.getByRole("complementary", { name: "Mission" });
    expect(await onTop(page, '[aria-label="Mission"] .rp-btn')).toBe(true);
    await mission.getByRole("button", { name: "Plan a mission" }).click({ timeout: 3000 });
    const close = page.getByRole("button", { name: "Close mission plan" });
    await expect(close).toBeVisible();
    expect(await onTop(page, ".route-head-close")).toBe(true);
    const when = await page.getByRole("textbox", { name: "Landing time (UTC)" }).boundingBox();
    expect(when && when.x + when.width).toBeLessThanOrEqual(390);
    // No map control sits on the Mission panel.
    await expect(page.locator(".mapctl")).toBeHidden();
    await rail(page, "Windows");
    await expect(page.getByRole("dialog", { name: "Landing windows" })).toBeVisible();
    await expect(close).toBeHidden();
  });
});
