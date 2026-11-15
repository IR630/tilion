import { expect, test } from "@playwright/test";

// #326: the printable brief. On paper only the sheet shows, and its verdict is the plan card's verdict.
test("Print brief prints the plan card verdict on a white A4 sheet", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0&site=cr1_connecting_ridge&t=2027-01-15T00:00Z&days=14&mode=balanced");
  const panel = page.getByRole("region", { name: "Mission route" });
  await expect(panel.getByRole("button", { name: /Print brief/ })).toBeVisible();
  const rule = await panel.getByLabel("Windows verdict").locator(".rp-verdict-line > span:not(.info)").textContent();
  expect(rule).toBe("Comm gap 122 h > 120 h limit");

  // The reproduce link is read when printing starts: a mode switch just before Print is in it.
  await page.getByRole("group", { name: "Ranking mode" }).getByRole("button", { name: "Energy" }).click();
  await expect(page).toHaveURL(/mode=energy/);
  await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
  await expect(page.locator(".mb-url")).toContainText("mode=energy");
  await page.getByRole("group", { name: "Ranking mode" }).getByRole("button", { name: "Balanced" }).click();
  await expect(panel.getByLabel("Windows verdict")).toContainText("FAIL");

  const sheet = page.locator(".mb-sheet");
  await expect(sheet).toBeHidden();
  await page.emulateMedia({ media: "print" });
  await expect(sheet).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(sheet.locator(".mb-verdict-tag")).toHaveText("FAIL");
  await expect(sheet.getByTestId("brief-rule")).toHaveText(rule!);
  await expect(sheet.getByTestId("brief-checks")).toContainText(/\d+ of \d+ checks pass, \d+ fail/);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
  const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  expect(pdf.byteLength).toBeGreaterThan(10_000);
  expect(errors).toEqual([]);
});
