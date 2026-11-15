import { expect, test } from "@playwright/test";
import { openPlace } from "./nav";

// #332: a flat deck panel at the pole gets the Sun at a grazing angle: at Haworth the battery is without
// power for more hours than with the default vertical tracking panel; back to defaults gives the first verdict.
test("energy: horizontal deck vs vertical tracking panel at Haworth", async ({ page }) => {
  await page.goto("/?guide=0");
  const card = await openPlace(page, "Haworth");
  await card.getByRole("button", { name: "Horizon view" }).click();
  const energy = page.getByRole("region", { name: "Lander energy" });
  const verdict = energy.locator(".energy-verdict");
  await expect(verdict).toContainText(/Battery empty at|Survives/);
  const deadHours = async () => Number((await verdict.textContent())?.match(/no power for (\d+) h/)?.[1] ?? 0);
  const before = await verdict.textContent();
  const vertical = await deadHours();
  await energy.locator("select").selectOption("deck");
  await expect(verdict).not.toHaveText(before!);
  expect(await deadHours()).toBeGreaterThan(vertical);
  await energy.locator("select").selectOption("tilted");
  await expect(energy.getByLabel("Tilt, °")).toHaveValue("90");
  await energy.getByRole("button", { name: "VIPER-class defaults" }).click();
  await expect(verdict).toHaveText(before!);
});
