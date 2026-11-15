import { expect, test } from "@playwright/test";
import { closeLayer } from "./nav";

// Jury demo path (#72): the globe → search a site → the polar map with its place card → compare
// sites → its horizon, all over the map.
test("demo path: navigator, place card, compare, then horizon", async ({ page }) => {
  await page.goto("/?guide=0");
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 15000 });
  if (process.env.DEMO_VIDEO) await page.waitForTimeout(2000);
  await page.getByRole("searchbox", { name: "Search sites" }).fill("Haworth");
  await page.getByRole("listitem").filter({ hasText: "Haworth" }).first().click();
  const card = page.getByRole("article", { name: "Place card" });
  await expect(card).toContainText("Haworth");
  await expect(page.getByRole("region", { name: "Navigator map" })).toHaveAttribute("data-ready", "1", { timeout: 15000 });
  await expect(card.getByRole("status")).toContainText(/Sun(Up|Down)/);
  if (process.env.DEMO_VIDEO) await page.waitForTimeout(2000);
  await card.getByRole("button", { name: "Compare", exact: true }).click();
  await expect(page.getByRole("table", { name: "Site comparison" })).toContainText("Haworth");
  await closeLayer(page);
  await card.getByRole("button", { name: "Horizon view" }).click();
  const horizon = page.getByRole("region", { name: "Horizon panorama" });
  await expect(horizon.getByRole("heading", { level: 2 })).toContainText("Haworth");
  await expect(horizon.getByRole("status")).toContainText("Sun");
  if (process.env.DEMO_VIDEO) await page.waitForTimeout(3000);
});
