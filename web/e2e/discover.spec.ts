import { expect, test, type Page } from "@playwright/test";
import { openPlace, pinNow, rail } from "./nav";

// #207: outside tester №3 (fresh browser, no URL params) could not find features that exist.
const hud = (page: Page) => page.getByRole("region", { name: "Time sheet" });
const strip = (page: Page) => hud(page).getByRole("slider", { name: "Scrub date" });

test.describe("first-time visitor", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // #298: the dock has no date field; T opens the picker, the strip names the moment.
  test("T opens the date picker: type a date, Enter → the site card follows", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await pinNow(page);
    await page.goto("/");
    await page.getByRole("region", { name: "Welcome" }).getByRole("button", { name: "Open navigator" }).click();
    const card = await openPlace(page, "Haworth");
    const windows = card.getByRole("region", { name: "Next windows" });
    await expect(windows).toContainText("from Jan 15 00:00 UTC");

    await expect(hud(page).getByRole("button", { name: "Open calendar" })).toHaveCount(0);
    await expect(hud(page).locator(".hud-legend-hint")).toHaveText("T set date"); // #313: the key is named on screen

    // T from anywhere outside a text field opens the picker with the typing field focused.
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await strip(page).focus();
    await page.keyboard.press("t");
    const typed = page.getByRole("dialog", { name: "Date picker" }).getByRole("textbox", { name: "Date (UTC)" });
    await expect(typed).toBeFocused();
    await page.keyboard.type("2027-02-01 06:00");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Date picker" })).toHaveCount(0);
    await expect(strip(page)).toHaveAttribute("aria-valuetext", "FEB 1 2027 06:00 UTC");
    await expect(windows).toContainText("from Feb 01 06:00 UTC");

    // T typed into a text field stays text.
    const search = page.getByRole("searchbox", { name: "Search sites" });
    await search.fill("");
    await search.press("t");
    await expect(page.getByRole("dialog", { name: "Date picker" })).toHaveCount(0);
    await expect(search).toHaveValue("t");
    expect(errors).toEqual([]);
  });
});

test("Next windows: in the place card above the fold, in Horizon view and in the Windows panel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?guide=0");
  const card = await openPlace(page, "Shackleton");
  await expect(card.getByRole("heading", { name: /Next windows/ })).toBeInViewport();

  await card.getByRole("button", { name: "Horizon view" }).click();
  const horizon = page.getByRole("dialog").filter({ hasText: "Horizon from" });
  const hw = horizon.getByRole("region", { name: "Next windows" });
  await expect(hw.getByRole("list", { name: "Sun-lit" })).toBeVisible();
  await expect(hw).toBeInViewport();
  // A click on a later window sets the shared moment to its start.
  const later = hw.getByRole("list", { name: "Earth in view" }).getByRole("button").last();
  const start = (await later.getAttribute("data-start"))!;
  await later.click();
  await expect(page.getByLabel("Current moment")).toHaveText(`${start.slice(0, 16).replace("T", " ")} UTC`);
  await horizon.getByRole("button", { name: "Close", exact: true }).click();

  await rail(page, "Windows");
  const cal = page.getByRole("region", { name: /^Calendar / }).first();
  await expect(cal.getByRole("region", { name: "Next windows" })).toBeInViewport();
});

test("Mission panel is opaque (no ghost of map labels); the open panel's rail button has no tooltip", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?guide=0");
  await rail(page, "Mission");
  const bg = await page.locator(".lpanel").first().evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(bg).toMatch(/^rgb\(/); // rgba(…, 0.94) let the globe's SUN tag and map labels show through
  const btn = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Schedule", exact: true });
  await btn.click();
  await btn.hover();
  await page.waitForTimeout(500);
  const tip = await btn.evaluate((e) => getComputedStyle(e, "::after").display);
  expect(tip).toBe("none");
});

test("390×844: the dock fits, nothing clipped; the globe's site marker clears the panels", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?guide=0");
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible();
  await expect(strip(page)).toBeInViewport({ ratio: 1 });
  // No text cut by its box: the site name, the band keys.
  for (const sel of [".hud-legend-site", ".hud-legend-k.k-earth", ".hud-legend-k.k-sun"]) {
    const cut = await hud(page).locator(sel).evaluate((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > innerWidth);
    expect(cut, sel).toBe(false);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  // The globe is drawn above the Selected panel, so the polar marker is not under it.
  const canvasBottom = await page.locator(".globe-stage .terrain3d-view").evaluate((e) => e.getBoundingClientRect().bottom);
  const panelTop = await page.locator(".globe-stage .scene3d-selected").evaluate((e) => e.getBoundingClientRect().top);
  expect(canvasBottom).toBeLessThanOrEqual(panelTop);
});
