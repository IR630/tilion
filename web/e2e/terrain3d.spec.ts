import { expect, test } from "@playwright/test";
import { enterMap, openPlace } from "./nav";

test("3D terrain: real LOLA tile loads under 3 s with Sun/Earth directions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0");
  await enterMap(page);
  const card = await openPlace(page, "Haworth");
  // The start globe has faded out and unmounted: the budget times the 3D tile, not the fade.
  await expect(page.getByRole("region", { name: "Globe" })).toHaveCount(0);
  const t0 = Date.now();
  await card.getByRole("button", { name: "View from site" }).click();
  const section = page.getByRole("region", { name: "3D terrain" });
  await expect(section.locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 3000 });
  expect(Date.now() - t0).toBeLessThan(3000);
  await expect(section).toContainText("20.4 × 20.4 km");
  await expect(section.getByRole("status")).toContainText("LOLA 80 m");
  await expect(section.getByRole("note")).toHaveCount(0); // real timeline (#12, #18): no mock note

  // #155: the site view gives the angles once, in the Sun / Earth box, to 0.1° in elevation.
  await expect(section.getByLabel("Sun and Earth")).toContainText(/Sun\s*(centre )?\d+\.\d° (above|below) (terrain|level).*, az \d+°/);

  await section.getByLabel(/Relief height/).fill("4");
  await expect(section).toContainText("Relief height 4×");
  expect(errors).toEqual([]);
});


test("approach profile loads real terrain and shows trajectory clearance", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("/?guide=0");
  await enterMap(page);
  const card = await openPlace(page, "Haworth");
  await card.getByRole("button", { name: "View from site" }).click();
  const section = page.getByRole("region", { name: "3D terrain" });
  await section.getByText("Approach terrain profile").click();
  await expect(section.getByText(/sampled coverage/)).toBeVisible({ timeout: 60000 });
  await expect(section.getByRole("img", { name: /Surface profile/ })).toBeVisible();
  await section.getByLabel("Optional start trajectory height (m)").fill("3000");
  await section.getByLabel("Optional end trajectory height (m)").fill("2000");
  await expect(section.getByRole("columnheader", { name: "Clearance m" })).toBeVisible();
});
