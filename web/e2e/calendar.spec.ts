import { expect, test } from "@playwright/test";
import { closeLayer, openPlace, pinNow, rail } from "./nav";

// #22 acceptance: day colours come from the real timelines; a click on a day sets the shared moment
// for every screen; the bottom time sheet steps and scrubs that moment. #72: the calendar (with the
// #39 landing verdict) opens from the rail as "Windows" over the globe or the map.
test("calendar: real day colours, click sets the time for other screens", async ({ page }) => {
  await pinNow(page);
  await page.goto("/?guide=0");
  const now = page.getByLabel("Current moment");
  await expect(now).toHaveText("2027-01-15 00:00 UTC");
  const strip = page.getByRole("slider", { name: "Scrub date" });
  await strip.press("Shift+ArrowRight"); // #298: the strip keys step the moment: +1 day
  await strip.press("ArrowRight"); // +1 hour
  await expect(now).toHaveText("2027-01-16 01:00 UTC");

  await rail(page, "Windows");
  await expect(page.getByRole("dialog", { name: "Landing windows" })).toBeVisible();
  await expect(page.locator(".calendar-site")).toHaveCount(2); // ridge and shadowed Haworth
  const first = page.locator(".calendar-site").first();
  await expect(first.locator(".calendar-row")).toHaveCount(13); // Dec 2026 … Dec 2027
  await expect(first.locator(".calendar-day")).toHaveCount(396);
  await expect(first).toContainText(/Longest dark period\s*\d+(\.\d)? [hd]/);
  await expect(first).toContainText(/Longest Sun \+ Earth window\s*\d+(\.\d)? [hd]/);
  await expect(page.getByText(/No precomputed timeline/)).toHaveCount(0);
  // Real data: a polar site has more than one kind of day over 13 months.
  const kinds = await first.locator(".calendar-day").evaluateAll((els) =>
    new Set(els.map((e) => e.getAttribute("data-kind"))).size,
  );
  expect(kinds).toBeGreaterThan(1);

  const day = first.getByRole("gridcell", { name: /^2027-03-15: Sun \d+ h, Earth \d+ h, both \d+ h$/ });
  await day.hover();
  await expect(first.locator(".calendar-hover")).toContainText(/2027-03-15: Sun \d+ h/);
  await day.click();
  await expect(now).toHaveText("2027-03-15 00:00 UTC");
  await expect(day).toHaveAttribute("aria-selected", "true");

  await rail(page, "Compare");
  await expect(page.getByLabel("Date slip value")).toContainText("2027-03-15 00:00 UTC");
  await page.keyboard.press("t"); // the exact time lives in the date picker (#298: T opens it)
  await expect(page.getByLabel("Date (UTC)")).toHaveValue("2027-03-15 00:00");
  await page.keyboard.press("Escape"); // closes the date picker only
  await expect(page.getByRole("dialog", { name: "Date picker" })).toHaveCount(0);
  // #223: the sheets stack, so Close on Compare goes back to Windows, and a second Close leaves the sheets.
  await closeLayer(page);
  await expect(page.getByRole("dialog", { name: "Landing windows" })).toBeVisible();
  await closeLayer(page);
  await expect(page.getByRole("dialog", { name: "Landing windows" })).toHaveCount(0);
  const card = await openPlace(page, "Gerlache ridge", "Shackleton–de Gerlache ridge");
  await card.getByRole("button", { name: "Horizon view" }).click();
  await expect(page.getByText("Time 2027-03-15 00:00 UTC")).toBeVisible();
  await closeLayer(page);

  // Scrubber and Now stay inside the data range (today 2026-11 is before it → data start).
  await page.keyboard.press("t");
  await page.getByRole("dialog", { name: "Date picker" }).getByRole("button", { name: "Now" }).click();
  await expect(now).toHaveText(/^20(26-12|27-\d\d)-\d\d \d\d:00 UTC$/);
  await strip.press("Home"); // time strip: Home = data start
  await expect(now).toHaveText("2026-12-01 00:00 UTC");
  await expect(page.getByRole("button", { name: "Animate time" })).toHaveCount(0); // #298: no Play under the scale
});
