import { expect, test, type Page } from "@playwright/test";

// #158: the guide is opt-in. It never opens by itself on load (no Compare sheet over the map);
// the Guide button in the rail or ?guide=1 opens it. A step opens its view over the globe or the
// map: Compare, Windows (calendar) and NASA check as side panels, Horizon as an overlay.
const VIEW: Record<string, string | RegExp> = {
  Compare: "Compare sites",
  Calendar: "Landing windows",
  "NASA check": "NASA check",
  Horizon: /^Horizon from /,
};
const view = (page: Page, screen: string) => page.getByRole("dialog", { name: VIEW[screen] });

test("guide: closed on load; the rail button opens it; steps drive the app", async ({ page }) => {
  await page.goto("/");
  const guide = page.getByRole("region", { name: "How to read" });
  await expect(page.getByRole("searchbox", { name: "Search sites" })).toBeVisible();
  await expect(guide).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "How to read", exact: true }).click();
  await expect(guide).toBeVisible();
  await expect(view(page, "Compare")).toBeVisible();
  const rows = page.getByRole("table", { name: "Site comparison", exact: true }).locator("tbody tr");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("Shackleton");
  await expect(rows.nth(1)).toContainText("Haworth");
  await expect(rows.nth(0)).toContainText("100 %");
  await expect(rows.nth(1)).not.toContainText("100 %");
  await expect(page.getByText(/Mock data/)).toHaveCount(0);
  for (const [screen, site, time] of [
    ["Horizon", "Shackleton", "2027-01-15T00:00"],
    ["Horizon", "Haworth", "2027-01-15T00:00"],
    ["Calendar", "Shackleton", "2027-03-15T00:00"],
    ["Compare", "Shackleton", "2027-03-22T00:00"],
    ["NASA check", "Shackleton", "2027-01-15T00:00"],
  ]) {
    await guide.getByRole("button", { name: "Next", exact: true }).click();
    await expect(view(page, screen)).toBeVisible();
    await expect(page.getByLabel("Current moment")).toHaveText(`${time.replace("T", " ")} UTC`);
    if (screen === "Horizon") await expect(view(page, screen).getByRole("heading", { level: 2 }).first()).toContainText(site);
    else if (screen === "NASA check") await expect(page.getByRole("article", { name: "Place card" })).toContainText(site);
    else await expect(page.getByLabel("Sites in use")).toContainText(site);
  }
  await guide.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByLabel("Current moment")).toHaveText("2027-03-22 00:00 UTC");
  await guide.getByRole("button", { name: "Next", exact: true }).click();
  await guide.getByRole("button", { name: "Done", exact: true }).click();
  await expect(guide).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search sites" })).toBeVisible();
  await expect(guide).toHaveCount(0);
  await page.goto("/?guide=1");
  await expect(guide).toBeVisible();
});

test("shared mission link never opens the guide or changes the plan", async ({ page }) => {
  await page.goto("/?site=a_haworth&t=2027-02-01T06:00Z&guide=1");
  await expect(page.getByRole("button", { name: "How to read", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "How to read" })).toHaveCount(0);
  await expect(page.getByLabel("Landing time (UTC)")).toHaveValue("2027-02-01 06:00");
  await expect(page.getByLabel("Current moment")).toHaveText("2027-02-01 06:00 UTC");
});
