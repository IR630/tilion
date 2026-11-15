import { expect, test } from "@playwright/test";
import { rail } from "./nav";

test("NASA check: real numbers with sources, badge in Compare", async ({ page }) => {
  await page.goto("/?guide=0");
  await rail(page, "Compare");
  // Compare shows a NASA check badge for a polar site.
  await expect(page.getByRole("table", { name: "Site comparison" })).toContainText(/\d+ of \d+ NASA checks pass/);
  await rail(page, "NASA check");
  await expect(page.getByRole("dialog", { name: "NASA check" }).getByRole("status")).toContainText(/\d+ of \d+ checks pass/, { timeout: 15000 });
  for (const t of ["Sun and Earth position vs JPL Horizons", "Sun at historic Apollo landings"]) {
    await expect(page.getByRole("region", { name: t, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("region", { name: "Sun at historic Apollo landings", exact: true })).toContainText("Apollo 12");
  const failed = page.locator(".val-card").filter({ has: page.locator(".val-fail") }).first();
  await expect(failed).toContainText("FAIL");
  await expect(failed.locator(".val-explanation")).not.toBeEmpty();
  await expect(page.getByRole("region", { name: "Terrain illumination vs NASA on the same LOLA DEM", exact: true })).toContainText("Corridor B–C");
  await expect(page.locator(".validation a[href^='https://']").first()).toBeVisible();
});
