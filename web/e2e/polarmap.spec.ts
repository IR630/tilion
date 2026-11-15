import { expect, test } from "@playwright/test";
import { enterMap, rail } from "./nav";

// A click on empty map drops a pin (custom point); it joins the comparison with values computed in
// the browser (Web Worker, LOLA DEM 240 m or bare sphere, #31), not mock.
test("navigator: dropped pin gives a custom point and adds it to comparison", async ({ page }) => {
  await page.goto("/?guide=0");
  await enterMap(page);
  const map = page.getByRole("region", { name: "Navigator map" });
  await expect(map).toHaveAttribute("data-ready", "1");
  const box = (await map.boundingBox())!;
  // Empty map only: a site marker or an IAU name label (#147) takes the click. Labels are placed
  // after the camera settles, so pick the first candidate where the canvas itself is on top.
  const spots = [[0.62, 0.3], [0.66, 0.36], [0.58, 0.24], [0.7, 0.42]];
  const readout = page.getByTestId("custom-readout");
  await expect(async () => {
    if ((await readout.count()) === 0) {
      for (const [fx, fy] of spots) {
        const [x, y] = [box.x + box.width * fx, box.y + box.height * fy];
        const free = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.classList.contains("maplibregl-canvas"), [x, y]);
        if (free) {
          await page.mouse.click(x, y);
          break;
        }
      }
    }
    await expect(readout).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await expect(page.getByTestId("custom-readout")).toContainText(/°S \d+\.\d{4}°E/);
  await expect(page.getByTestId("custom-marker")).toBeVisible();
  await expect(page.getByTestId("custom-dem")).toContainText("Computed in your browser: horizon from the LOLA DEM 240 m");
  await page.getByRole("button", { name: "Add to comparison" }).click();
  await rail(page, "Compare");
  const table = page.getByRole("table", { name: "Site comparison" });
  await expect(table).toContainText("Custom point");
  const row = table.getByRole("row").filter({ hasText: "Custom point" });
  await expect(row).toContainText(/\d+ %/, { timeout: 20_000 }); // the worker has answered ("…" until then)
  await expect(row.locator(".compare-mock")).toHaveCount(0);
});
