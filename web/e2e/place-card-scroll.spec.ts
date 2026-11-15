import { expect, test } from "@playwright/test";
import { enterMap, openPlace } from "./nav";

// #404: a place card scrolled down to its buttons must open the next site from the top
// (name, Sun, Earth), not at the old scroll offset.
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("a new site resets the place card scroll to the top", async ({ page }) => {
      await page.goto("/?guide=0");
      await enterMap(page);
      const card = await openPlace(page, "Haworth");
      // #431: the buttons render before the timeline. While it loads the card is short; on a tall
      // viewport the buttons already fit, so a single scrollIntoViewIfNeeded was a no-op and the
      // card stayed at 0 once the Sun and Earth tiles grew it. Wait for the tiles, then scroll
      // again on every poll so the later blocks (windows, evidence) cannot leave it unscrolled.
      await expect(card.locator(".place-tile.sun")).toBeVisible();
      const horizon = card.getByRole("button", { name: "Horizon view" });
      await expect
        .poll(async () => {
          await horizon.scrollIntoViewIfNeeded();
          return card.evaluate((el) => el.scrollTop);
        })
        .toBeGreaterThan(0);

      await openPlace(page, "Malapert Massif", "Malapert");
      await expect.poll(() => card.evaluate((el) => el.scrollTop)).toBe(0);
      await expect(card.getByRole("heading", { level: 2 })).toBeInViewport();
      await expect(card.locator(".place-tile.sun")).toBeInViewport();
    });
  });
}
