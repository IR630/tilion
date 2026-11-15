import { expect, test } from "@playwright/test";
import { enterMap, openPlace } from "./nav";

// #129: a selected 20 m site shows the close-up inset on the navigator map: the 5 × 5 km outline, two
// leader lines, the tile with the scale label (static hillshade: no date, #155). A 240 m site shows none; closing the
// place card removes it; zooming in to the tile size moves the tile and keeps the leaders.
test("navigator inset: 20 m site shows the tile with label, outline and two leaders; 240 m site none", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0");
  await enterMap(page);

  const card = await openPlace(page, "Haworth");
  const inset = page.getByTestId("site-inset");
  await expect(inset).toBeVisible();
  await expect(inset.getByText("5 × 5 KM, LOLA 20 M")).toBeVisible();
  await expect(inset.locator("time")).toHaveCount(0);
  await expect(inset.getByRole("img", { name: /Haworth/ })).toBeVisible();
  await expect(inset.locator("svg polygon")).toHaveCount(1);
  await expect(inset.locator("svg line")).toHaveCount(2);
  // The tile does not cover the place card.
  const t = (await inset.locator(".site-inset").boundingBox())!;
  const c = (await card.boundingBox())!;
  expect(t.x + t.width).toBeLessThanOrEqual(c.x);

  if (process.env.INSET_SHOT) await page.screenshot({ path: process.env.INSET_SHOT });

  // Close zoom: the 5 km box is larger than the tile; the tile moves, two leaders stay.
  // One click per finished zoom step: a click during the ease adds less than one zoom level.
  const boxW = async () => (await inset.locator("svg polygon").boundingBox())?.width ?? 0;
  for (let k = 0; k < 3; k++) {
    const w0 = await boxW();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(boxW, { timeout: 5000 }).toBeGreaterThan(w0 * 1.6);
  }
  await expect.poll(boxW, { timeout: 5000 }).toBeGreaterThan(200);
  await expect(inset.locator("svg line")).toHaveCount(2);
  const t2 = (await inset.locator(".site-inset").boundingBox())!;
  const poly = (await inset.locator("svg polygon").boundingBox())!;
  const apart = t2.x + t2.width <= poly.x || t2.x >= poly.x + poly.width || t2.y + t2.height <= poly.y || t2.y >= poly.y + poly.height;
  expect(apart).toBe(true);

  // Dismiss with the place card.
  await card.getByRole("button", { name: "Close place card" }).click();
  await expect(inset).toHaveCount(0);

  // 240 m DEM: no inset.
  await openPlace(page, "Luna-25");
  await expect(page.getByRole("article", { name: "Place card" })).toBeVisible();
  await page.waitForTimeout(800);
  await expect(page.getByTestId("site-inset")).toHaveCount(0);
  expect(errors).toEqual([]);
});
