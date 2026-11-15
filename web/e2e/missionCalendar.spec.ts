import { expect, test } from "@playwright/test";
import { rail } from "./nav";

// A screen under 820 px tall starts with the calendar folded to its icon (the map needs the room).
test.use({ viewport: { width: 1440, height: 900 } });

// #159 acceptance: the mission bar sits on its dates; a click on a day moves the shared moment.
test("mission calendar: bar on its dates, a day click sets the time", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // A 14-day plan from 20 Jan: Jan – Feb are shown (the window ends on 3 Feb).
  await page.goto("/?site=a_haworth&t=2027-01-20T06:00Z&name=Haworth%20rover");
  // The calendar takes the left slot while no Sites / Mission panel is open (#158): fold the route panel.
  await rail(page, "Mission");
  const cal = page.getByRole("region", { name: "Mission calendar" });
  await expect(cal.getByRole("heading", { level: 2 })).toHaveText("Jan – Feb 2027");

  // The grid scrolls to the day of the moment.
  await expect(cal.locator('[data-day="2027-01-20"]')).toBeInViewport();

  // The bar starts on the landing day and the mission goes on into the next weeks.
  const first = cal.locator(".mcal-bar.is-head", { hasText: "Haworth rover" });
  await expect(first).toBeVisible();
  const bar = await first.boundingBox();
  const day20 = await cal.locator('[data-day="2027-01-20"]').boundingBox();
  const day19 = await cal.locator('[data-day="2027-01-19"]').boundingBox();
  expect(bar && day20 && day19).toBeTruthy();
  expect(Math.abs(bar!.x - day20!.x)).toBeLessThan(8);
  expect(bar!.y).toBeGreaterThan(day20!.y);
  expect(bar!.y + bar!.height).toBeLessThan(day20!.y + day20!.height);
  expect(bar!.x).toBeGreaterThan(day19!.x + day19!.width - 2);
  await expect(cal.locator(".mcal-bar", { hasText: "Haworth rover" })).toHaveCount(3); // 20–24 Jan, 25–31 Jan, 1–3 Feb
  await expect(cal.locator(".mcal-bar.is-tail")).toHaveAttribute("aria-label", /3 Feb 2027/);

  // A click on a day keeps the hour and moves the moment to that day.
  await cal.locator('[data-day="2027-01-27"]').click({ position: { x: 12, y: 9 } }); // the number row; the bar below selects the mission
  await expect(page.getByLabel("Current moment")).toHaveText("2027-01-27 06:00 UTC");
  await expect(cal.locator('[data-day="2027-01-27"]')).toHaveAttribute("aria-pressed", "true");

  // The arrows page the months and stay there (the moment does not pull the view back).
  await cal.getByRole("button", { name: "Next month" }).click();
  await expect(cal.getByRole("heading", { level: 2 })).toHaveText("Feb 2027");
  await expect(cal.locator('[data-day="2027-02-24"]')).toBeVisible();
  await cal.getByRole("button", { name: "Previous month" }).click();
  await expect(cal.getByRole("heading", { level: 2 })).toHaveText("Jan – Feb 2027");

  // Fold to the icon and back.
  await cal.getByRole("button", { name: "Hide mission calendar" }).click();
  await expect(cal.locator('[data-day="2027-01-27"]')).toBeHidden();
  await cal.getByRole("button", { name: "Show mission calendar" }).click();
  await expect(cal.locator('[data-day="2027-01-27"]')).toBeVisible();
  expect(errors).toEqual([]);
});
