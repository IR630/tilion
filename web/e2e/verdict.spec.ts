import { expect, test } from "@playwright/test";
import { rail } from "./nav";

// #210: tester №4 saw Mission score the plan 86/100 while Windows said FAIL for a Robot 14 d mission
// (longest comm gap 122 h > 120 h). The plan card shows the Windows verdict next to the score, from the
// same timeline and the same rule; an edit of the limits in Windows changes both.
test("Mission plan card and Windows show the same verdict and follow the same limits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0&site=cr1_connecting_ridge&t=2027-01-15T00:00Z&days=14&mode=balanced");
  const card = page.getByRole("region", { name: "Mission route" }).getByLabel("Windows verdict");
  await expect(card).toContainText("FAIL");
  await expect(card).toContainText("Comm gap 122 h > 120 h limit");
  await expect(card).toContainText("The score ranks options; the verdict checks hard limits.");
  await expect(page.getByRole("region", { name: "Plan metrics" })).toContainText(/\d+\s*score \/ 100/);

  await rail(page, "Windows");
  const win = page.getByRole("dialog", { name: "Landing windows" }).getByLabel("Landing window verdict").first();
  await expect(win.locator(".landing-level strong")).toHaveText("FAIL");
  await expect(win).toContainText("longest comm gap 122 h, limit 120 h");

  // A looser comm gap limit in Windows: both say MARGINAL (122 h is 94 % of 130 h).
  await page.getByRole("spinbutton", { name: "Max comm gap, h" }).fill("130");
  await expect(win.locator(".landing-level strong")).toHaveText("MARGINAL");
  await rail(page, "Mission"); // closes Windows, opens the plan again
  await expect(card.locator(".rp-verdict-tag")).toHaveText("MARGINAL");
  await expect(card).toContainText("comm gap 122 of 130 h");
  expect(errors).toEqual([]);
});
