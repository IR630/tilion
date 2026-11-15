// Shared steps for the map-first navigation (#72): rail buttons, search → place card, overlays.
import { expect, type Page } from "@playwright/test";

/** Click a button of the left icon rail (Sites, Mission, Compare, Schedule, NASA check). */
export async function rail(page: Page, name: string) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name, exact: true }).click();
}

/** Search a site in the pill, pick the first result and wait for its place card. */
export async function openPlace(page: Page, query: string, heading: string | RegExp = query) {
  await page.getByRole("searchbox", { name: "Search sites" }).fill(query);
  await page.getByRole("list", { name: "Site list" }).getByRole("listitem").first().click();
  const card = page.getByRole("article", { name: "Place card" });
  await expect(card.getByRole("heading", { level: 2 })).toContainText(heading);
  return card;
}

/** Close the top overlay or side panel. */
export async function closeLayer(page: Page) {
  await page.getByRole("dialog").last().getByRole("button", { name: "Close", exact: true }).click();
}

/** The app starts on the globe (#72): switch to the south polar map and wait for it. */
export async function enterMap(page: Page) {
  await page.getByRole("button", { name: "South pole map" }).press("Enter");
  // No load budget here (specs run in parallel on software GL); navigator.spec times the switch.
  await expect(page.getByRole("region", { name: "Navigator map" })).toHaveAttribute("data-ready", "1", { timeout: 15000 });
}

/** The app opens on the current UTC hour held inside the data range (#377). A spec that checks a fixed
 *  moment pins the clock before `page.goto`; the clock keeps running from that time. */
export async function pinNow(page: Page, utc = "2027-01-15T00:00:00Z") {
  await page.clock.install({ time: new Date(utc) });
}
