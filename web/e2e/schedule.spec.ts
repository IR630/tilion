import { expect, test } from "@playwright/test";

// #73 acceptance: two missions → both on the timeline → a click makes one active → the map plan
// (and the link) follows. The panel opens from the left icon rail of #72.
test("schedule: two missions on the timeline, a click puts one on the map", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The plan from a link is the first mission.
  await page.goto("/?site=a_haworth&t=2027-01-20T00:00Z&name=Haworth%20rover");
  await page.getByRole("button", { name: "Schedule" }).click();
  const panel = page.getByRole("region", { name: "Mission schedule" });
  await expect(panel).toBeVisible();

  // Public missions: facts only, no invented dates.
  await expect(panel.locator('.sch-public[data-site="viper_nobile_west"]')).toHaveText("Planned 2027 — date not published");
  await expect(panel.locator('.sch-public[data-site="change7_target"]')).toHaveText("Planned 2027 — date not published");

  await panel.getByRole("button", { name: "Add current plan" }).first().click();
  await panel.getByRole("button", { name: "New mission" }).first().click();
  const form = panel.getByRole("form", { name: "New mission" });
  await form.getByRole("textbox").first().fill("Ridge relay");
  // The site Select: open the list and pick the option.
  const site = form.getByRole("combobox", { name: "Site", exact: true });
  await site.click();
  await page.getByRole("listbox", { name: "Site", exact: true }).getByRole("option", { name: "Shackleton–de Gerlache ridge (C1, 2 m)" }).click();
  await expect(site).toHaveText("Shackleton–de Gerlache ridge (C1, 2 m)");
  await form.getByLabel("Landing (UTC)").fill("2027-02-10 06:00");
  await form.getByRole("button", { name: "Create" }).click();

  const rows = panel.locator(".sch-row");
  await expect(rows).toHaveCount(2);
  await expect(page).toHaveURL(/site=cr1_connecting_ridge/); // the new mission is on the map

  // A click on the first mission makes it active: the map plan and the link follow.
  await panel.getByRole("button", { name: "Make Haworth rover active" }).click();
  await expect(rows.first()).toHaveClass(/is-active/);
  await expect(page).toHaveURL(/site=a_haworth/);
  await expect(page).toHaveURL(/t=2027-01-20T00%3A00Z|t=2027-01-20T00:00Z/);

  // Slip the active mission by two days from the keyboard: the plan moves, the chip shows it.
  await panel.getByRole("slider", { name: "Landing of Haworth rover" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(panel.locator(".sch-row.is-active .sch-chip")).toHaveText("+2 d");
  await expect(page).toHaveURL(/t=2027-01-22T00/);

  // The schedule survives a reload (localStorage).
  await page.reload();
  await page.getByRole("button", { name: "Schedule" }).click();
  await expect(page.getByRole("region", { name: "Mission schedule" }).locator(".sch-row")).toHaveCount(2);
  expect(errors).toEqual([]);
});
