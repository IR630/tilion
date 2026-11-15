import { expect, test } from "@playwright/test";
import { enterMap, pinNow, rail } from "./nav";

// #195: outside tester found these on the live site.
// "Plan a mission" starts at the site the app shows as selected (the globe default is the
// Shackleton–de Gerlache ridge), at the current moment — not at Haworth.
test("plan a mission starts from the selected site at the current time", async ({ page }) => {
  await pinNow(page);
  await page.goto("/?guide=0");
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible();
  await rail(page, "Mission");
  await page.getByRole("button", { name: "Plan a mission" }).click();
  await expect(page.getByRole("button", { name: /^Landing site: / })).toHaveAccessibleName("Landing site: Shackleton–de Gerlache ridge (C1, 2 m)");
  await expect(page.getByRole("textbox", { name: "Landing time (UTC)" })).toHaveValue(/^2027-01-15[ T]00:00/);
});

// Each "Add waypoint" appends: Esc cancels only the pending add, and a route bubble under the
// cursor does not take the click in add mode. The bubbles say what their numbers are.
test("waypoints append after Esc and over a route bubble; bubbles are labelled", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0&site=cr1_connecting_ridge&t=2027-01-15T12:00Z&days=14&mode=balanced");
  const map = page.getByRole("region", { name: "Navigator map" });
  await expect(map).toHaveAttribute("data-ready", "1", { timeout: 15000 });
  const panel = page.getByRole("region", { name: "Mission route" });
  const items = panel.getByTestId("waypoint-item");
  const add = panel.getByRole("button", { name: "Add waypoint" });
  const bubbles = map.locator(".nav-callout");
  await expect(bubbles.first()).toBeVisible();
  // #195 (4): a bubble reads "score 87, slip −5 d", not a bare "87 PTS −5 D".
  await expect(bubbles.first()).toHaveText(/^#1score \d+(slip [+−]\d+ d|same day)/); // #204: rank first; a tie may add the distance
  await expect(panel.getByTestId("best-why")).toContainText(/^Best landing option: /);

  // WP1: an empty spot of the map (the place card closed, clear of the left panel and controls).
  await page.getByRole("article", { name: "Place card" }).getByRole("button", { name: "Close place card" }).click();
  const box = (await map.boundingBox())!;
  await add.click();
  await page.mouse.click(box.x + box.width * 0.72, box.y + box.height * 0.3);
  await expect(items).toHaveCount(1);

  // #207: add mode stays on after a click; Esc ends it: nothing is added or removed.
  await expect(panel.getByRole("button", { name: "Done adding" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(add).toHaveAttribute("aria-pressed", "false");
  await expect(items).toHaveCount(1);

  // WP2: the click lands on a route bubble.
  await add.click();
  // A user clicks where the bubble is drawn; in add mode the map under it takes the click.
  const b = (await bubbles.first().boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(items).toHaveCount(2);
  expect(errors).toEqual([]);
});

// #207: tester №3 pressed "Add waypoint" on the globe, switched to the South pole map and clicked
// twice: the second click dropped a pin instead of WP2. Each click in add mode appends, until Esc / Done.
test("add mode: two map clicks after switching to the map make WP1 and WP2; Done ends it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0");
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible();
  await rail(page, "Mission");
  await page.getByRole("button", { name: "Plan a mission" }).click();
  const panel = page.getByRole("region", { name: "Mission route" });
  await panel.getByRole("button", { name: "Add waypoint" }).click();
  await enterMap(page);
  const map = page.getByRole("region", { name: "Navigator map" });
  const box = (await map.boundingBox())!;
  const items = panel.getByTestId("waypoint-item");
  // #266: one click, one waypoint, also while the globe still fades out over the map.
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await expect(items).toHaveCount(1);
  await page.mouse.click(box.x + box.width * 0.66, box.y + box.height * 0.55);
  await expect(items).toHaveCount(2);
  await expect(items.nth(1)).toContainText("WP2");
  await expect(page.getByRole("article", { name: "Dropped pin" })).toHaveCount(0);
  // Done on the map banner ends the mode; the next click is a plain map click again.
  await page.getByRole("status").getByRole("button", { name: "Done" }).click();
  await expect(panel.getByRole("button", { name: "Add waypoint" })).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

// #210: tester №4 pressed "Add waypoint" on the globe and did not know to switch to the map.
// Add mode now opens the polar map by itself and says what to do; two map clicks make WP1 and WP2.
test("add waypoint on the globe opens the map with a hint; two clicks make WP1 and WP2", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0");
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible();
  await rail(page, "Mission");
  await page.getByRole("button", { name: "Plan a mission" }).click();
  const panel = page.getByRole("region", { name: "Mission route" });
  // #266: the globe fades out over the map for ~0.8 s and took the map clicks of that time. What takes a
  // click on the map area when the fade starts? Read in the page at the class change: no timing race.
  await page.evaluate(() => {
    const stage = document.querySelector(".globe-stage") as HTMLElement;
    new MutationObserver((_, obs) => {
      if (stage.classList.contains("is-active")) return;
      obs.disconnect();
      const hit = document.elementFromPoint(innerWidth * 0.6, innerHeight * 0.35);
      document.body.dataset.fadeHit = hit?.closest(".globe-stage") ? "globe" : "under";
    }).observe(stage, { attributes: true, attributeFilter: ["class"] });
  });
  await panel.getByRole("button", { name: "Add waypoint" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-fade-hit", "under");
  // No click on "South pole map": the app switches by itself.
  const map = page.getByRole("region", { name: "Navigator map" });
  await expect(map).toHaveAttribute("data-ready", "1", { timeout: 15000 });
  await expect(page.getByRole("button", { name: "South pole map" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("status").filter({ hasText: "Click the map to place WP1. Press Esc to finish." })).toBeVisible();
  const box = (await map.boundingBox())!;
  const items = panel.getByTestId("waypoint-item");
  // #266: one click, one waypoint: the globe fading out over the map takes no clicks.
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.42);
  await expect(items).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: "Click the map to place WP2" })).toBeVisible();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6);
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("WP1");
  await expect(items.nth(1)).toContainText("WP2");
  expect(errors).toEqual([]);
});
