import { expect, test, type Page } from "@playwright/test";
import { openPlace, pinNow, rail } from "./nav";

// #196 (outside test 2): the shared moment set by the user survives the Guide and the rail panels;
// a new plan lands at it; an edit of the plan's landing time moves the moment with it. T opens the
// date picker with its field focused (#298: no date field in the dock), typing sets the moment.
const moment = (page: Page) => page.getByLabel("Current moment");
const hud = (page: Page) => page.getByRole("region", { name: "Time sheet" });

async function typeMoment(page: Page, text: string) {
  await hud(page).getByRole("slider", { name: "Scrub date" }).focus();
  await page.keyboard.press("t");
  const field = page.getByRole("dialog", { name: "Date picker" }).getByRole("textbox", { name: "Date (UTC)" });
  await expect(field).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Date picker" })).toHaveCount(0);
}

test("time: typed in the dock, kept through Guide and Sites, used by a new plan (#196)", async ({ page }) => {
  await pinNow(page);
  await page.goto("/");
  await expect(moment(page)).toHaveText("2027-01-15 00:00 UTC");

  await typeMoment(page, "2027-01-15 12:00");
  await expect(moment(page)).toHaveText("2027-01-15 12:00 UTC");

  // The Guide shows its own moments while open; closing it gives the user's moment back.
  await page.getByRole("button", { name: "How to read", exact: true }).click();
  const guide = page.getByRole("region", { name: "How to read" });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Close guide" }).click();
  await expect(moment(page)).toHaveText("2027-01-15 12:00 UTC");

  // A rail button closes the Guide too, and the moment stays the user's.
  await page.getByRole("button", { name: "How to read", exact: true }).click();
  await expect(guide).toBeVisible();
  await rail(page, "Sites");
  await expect(guide).toHaveCount(0);
  await expect(moment(page)).toHaveText("2027-01-15 12:00 UTC");

  // A moment the user sets while the Guide is open stays after it closes.
  await page.getByRole("button", { name: "How to read", exact: true }).click();
  await expect(moment(page)).toHaveText("2027-01-15 00:00 UTC"); // the Guide's first step
  await typeMoment(page, "2027-02-01 06:00");
  await guide.getByRole("button", { name: "Close guide" }).click();
  await expect(moment(page)).toHaveText("2027-02-01 06:00 UTC");
  await typeMoment(page, "2027-01-15 12:00");

  // A new plan lands at the moment.
  await rail(page, "Mission");
  await page.getByRole("button", { name: "Plan a mission", exact: true }).click();
  const landing = page.getByRole("textbox", { name: "Landing time (UTC)" });
  await expect(landing).toHaveValue("2027-01-15 12:00");

  // Typing a new landing time in the plan moves the shared moment with it.
  await landing.fill("2027-01-16 06:00");
  await expect(moment(page)).toHaveText("2027-01-16 06:00 UTC");
});

test("place card: next Sun and Earth windows with dates, period labelled; a click sets the time (#196)", async ({ page }) => {
  await page.goto("/");
  const card = await openPlace(page, "Haworth");
  const list = card.getByRole("region", { name: "Next windows" });
  await expect(list).toContainText(/next 30\sd/i);
  await expect(list.getByRole("list", { name: "Earth in view" }).getByRole("listitem").first()).toContainText(/(now|\d\d:00) – .*\d\d:00/);
  await expect(list.getByRole("list", { name: "Sun-lit" })).toBeVisible();
  // A later window (not the one open now): a click sets the moment to its start.
  const later = list.getByRole("list", { name: "Earth in view" }).getByRole("button").last();
  const label = (await later.getAttribute("data-start"))!;
  await later.click();
  await expect(moment(page)).toHaveText(`${label.slice(0, 16).replace("T", " ")} UTC`);
});
