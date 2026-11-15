import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { closeLayer, enterMap, pinNow, rail } from "./nav";

// #72 acceptance: the map is the app. No top tabs; the rail opens Compare and NASA check over the
// map; a plan draws every route option on the map with a bubble; a bubble selects its option; the
// itinerary lists the window's events with offsets and moves the shared moment; "View from site"
// opens the 3D view with a clear header and live Sun and Earth labels.
const hours = JSON.parse(readFileSync("public/data/hours.json", "utf8"));
const H0 = Date.parse(hours.startUtc);
const STEP = hours.stepMin * 60000;

/** Sun and Earth transitions of a site in [from, from + days) straight from hours.json. */
function events(site: string, fromUtc: string, days: number): number {
  const codes: string = hours.sites[site];
  const i0 = Math.round((Date.parse(fromUtc) - H0) / STEP);
  let n = 0;
  for (let i = i0 + 1; i < i0 + days * 24; i++) {
    const x = Number(codes[i - 1]) ^ Number(codes[i]);
    n += (x & 1) + ((x >> 1) & 1);
  }
  return n;
}

test("navigator v2: rail panels, route lines with bubbles, itinerary, view from site", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await pinNow(page);
  await page.goto("/?guide=0");
  await enterMap(page);
  const map = page.getByRole("region", { name: "Navigator map" });

  // No screen tabs: a rail with tooltips.
  await expect(page.getByRole("tablist")).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Sites", "Mission", "Compare", "Schedule", "NASA check"]) {
    await expect(nav.getByRole("button", { name, exact: true })).toBeVisible();
  }

  // Compare and NASA check open as panels over the map and close with Esc / the close button.
  await rail(page, "Compare");
  await expect(page.getByRole("dialog", { name: "Compare sites" }).getByRole("table", { name: "Site comparison" })).toBeVisible();
  await expect(map).toBeVisible(); // still the map underneath
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Compare sites" })).toHaveCount(0);
  await rail(page, "NASA check");
  await expect(page.getByRole("dialog", { name: "NASA check" }).getByRole("status")).toContainText(/\d+ of \d+ checks pass/);
  await closeLayer(page);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Plan from Haworth: the pill turns into the route header; every option is a line with a bubble.
  await map.getByRole("button", { name: "Haworth (HW02)" }).click();
  await page.getByRole("article", { name: "Place card" }).getByRole("button", { name: "Plan mission from here" }).click();
  const head = page.getByRole("region", { name: "Route header" });
  await expect(head).toContainText("From");
  await expect(head.getByLabel("Landing time (UTC)")).toHaveValue("2027-01-15 00:00");
  await expect(head.getByRole("group", { name: "Ranking mode" }).locator("button[aria-pressed]")).toHaveText(["Energy", "Comms", "Balanced"]);
  const panel = page.getByRole("region", { name: "Mission route" });
  const cards = panel.getByRole("region", { name: "Route options" }).locator("li.rp-opt");
  await expect(cards).toHaveCount(6);
  const bubbles = page.locator(".nav-callout");
  await expect(bubbles).toHaveCount(6);
  await expect(bubbles.first()).toHaveText(/^#1score \d+(same day|slip [+−]\d+ d)/); // #204: rank first; a tie may add the distance
  // The line source holds one line per option away from the plan site.
  const away = await cards.evaluateAll((els) => els.filter((e) => (e as HTMLElement).dataset.site !== "a_haworth").length);
  expect(away).toBeGreaterThan(1);
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.nav-callout:not(.on-origin)').length)).toBe(away);

  // A bubble click selects that option and its card.
  const pick = page.locator('.nav-callout:not(.on-origin)').nth(1);
  const key = (await pick.getAttribute("data-key"))!;
  await pick.click();
  await expect(pick).toHaveAttribute("aria-pressed", "true");
  await expect(pick).toHaveClass(/is-selected/);
  await expect(panel.locator(`li.rp-opt[data-key="${key}"]`)).toHaveClass(/is-selected/);
  await expect(page.locator(".nav-callout.is-selected")).toHaveCount(1);
  await expect(page.getByTestId("route-end")).toHaveAttribute("data-site", key.split("@")[0]);

  // Back to the plan: the itinerary of Haworth from landing to the window end, with offsets.
  await panel.locator(`li.rp-opt[data-key="${key}"]`).getByRole("button", { pressed: true }).click();
  const itin = page.getByRole("region", { name: "Itinerary" });
  await expect(itin).toContainText("Itinerary: Current plan");
  const steps = itin.getByRole("listitem");
  const want = events("a_haworth", "2027-01-15T00:00:00Z", 14);
  expect(want).toBeGreaterThan(0);
  await expect(steps).toHaveCount(want + 2);
  await expect(steps.first()).toContainText(/^Landing\s*Jan 15 00:00 UTC, Sun (up|down) [\d.]+° (above|below) (terrain|level), Earth (in view|hidden) [\d.]+° (above|below) (terrain|level)/);
  await expect(steps.nth(1)).toContainText(/^(Sunrise|Sunset|Earthrise|Earthset)\s*\w{3} \d+ \d\d:00 UTC\s*\+\d+ h$/);
  await expect(steps.last()).toContainText(/^Window ends\s*Jan 29 00:00 UTC\s*\+336 h$/);

  // A step click moves the shared moment there and marks the step.
  const second = (await steps.nth(1).innerText()).match(/(\w{3}) (\d+) (\d\d):00 UTC/)!;
  await steps.nth(1).getByRole("button").click();
  const day = String(second[2]).padStart(2, "0");
  await expect(page.getByLabel("Current moment")).toHaveText(`2027-01-${day} ${second[3]}:00 UTC`);
  await expect(steps.nth(1).getByRole("button")).toHaveAttribute("aria-current", "step");

  // "View from site": the 3D view with a header, an explanation and Sun / Earth labels.
  await itin.getByRole("button", { name: "View from site" }).click();
  const view = page.getByRole("dialog", { name: /^View from Haworth \(HW02\), Jan \d+ 2027 \d\d:00 UTC$/ });
  await expect(view.getByRole("heading", { level: 2 })).toHaveText(`View from Haworth (HW02), Jan ${Number(day)} 2027 ${second[3]}:00 UTC`);
  await expect(view).toContainText("20.4 × 20.4 km of real LOLA terrain around the site");
  await expect(view.locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 15000 });
  const bodies = view.getByLabel("Sun and Earth");
  await expect(bodies).toContainText(/Sun\s*(centre )?[\d.]+° (above|below) (terrain|level).*, az \d+°, (in view|behind terrain|below the horizon)/);
  await expect(bodies).toContainText(/Earth\s*[\d.]+° (above|below) (terrain|level).*, az \d+°, (in view|behind terrain|below the horizon)/);
  await expect(view.getByRole("img", { name: "Compass" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(map).toBeVisible();
  expect(errors).toEqual([]);
});

test("navigator v2: a plan site without terrain says so on the plan card", async ({ page }) => {
  await page.goto("/?site=apollo11&t=2027-01-15T00:00Z");
  const card = page.getByRole("region", { name: "Plan metrics" });
  await expect(card.getByRole("note")).toContainText("Smooth sphere — no terrain model");
});

test("navigator v2: starts on the globe, scrolling in zooms through to the map and back", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0");
  const globe = page.getByRole("region", { name: "Globe" });
  await expect(globe.locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("region", { name: "Navigator map" })).toHaveCount(0); // MapLibre not loaded yet
  // The same chrome floats over the globe: search pill and rail.
  await expect(page.getByRole("searchbox", { name: "Search sites" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  const box = (await globe.locator("canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let k = 0; k < 6; k++) await page.mouse.wheel(0, -400);
  const map = page.getByRole("region", { name: "Navigator map" });
  await expect(map).toHaveAttribute("data-ready", "1");
  await expect(globe).toHaveCount(0);
  await page.getByRole("button", { name: "Globe", exact: true }).press("Enter");
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "South pole map" })).toBeVisible();
  expect(errors).toEqual([]);
});

// #465: no visible globe/map switch; a wheel in on the globe is the way to the map.
test("globe: no visible view switch, wheel in on the globe opens the map", async ({ page }) => {
  await page.goto("/?guide=0");
  const globe = page.getByRole("region", { name: "Globe" });
  await expect(globe.locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 10000 });
  // The switch is kept for the keyboard and screen readers, but takes no room on screen.
  const sw = page.getByRole("group", { name: "Base view" });
  const swBox = (await sw.boundingBox())!;
  expect(swBox.width * swBox.height).toBeLessThanOrEqual(1);
  const box = (await globe.locator("canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const map = page.getByRole("region", { name: "Navigator map" });
  for (let k = 0; k < 10 && !(await map.count()); k++) {
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(150);
  }
  await expect(map).toHaveAttribute("data-ready", "1");
  await expect(page.locator(".navigator.is-globe")).toHaveCount(0);
});

// #146: relief ends at 60°S. At the widest view one more zoom out goes back to the globe,
// by the button and by the wheel (the step mirrors globe → map).
test("map: one more zoom out at the widest view returns to the globe (button)", async ({ page }) => {
  await page.goto("/?guide=0");
  await enterMap(page);
  const isGlobe = page.locator(".navigator.is-globe");
  let clicks = 0;
  while (!(await isGlobe.count()) && clicks < 6) {
    await page.getByRole("button", { name: "Zoom out" }).click();
    clicks++;
    await page.waitForTimeout(520);
  }
  expect(clicks).toBeGreaterThan(0);
  expect(clicks).toBeLessThanOrEqual(4);
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("button", { name: "South pole map" })).toBeVisible();
});

test("map: wheel out at the widest view returns to the globe", async ({ page }) => {
  await page.goto("/?guide=0");
  await enterMap(page);
  const map = page.getByRole("region", { name: "Navigator map" });
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  const isGlobe = page.locator(".navigator.is-globe");
  for (let k = 0; k < 8 && !(await isGlobe.count()); k++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(600);
  }
  await expect(isGlobe).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 10000 });
});

// #287: a wheel out right after the switch to the map. On a busy main thread the map's far-out
// timer and the globe fade timer (800 ms) fall due together; the globe must still come back.
test("map: a quick wheel out after the switch to the map still shows the globe", async ({ page }) => {
  await page.goto("/?guide=0");
  await enterMap(page);
  const map = page.getByRole("region", { name: "Navigator map" });
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4);
  const isGlobe = page.locator(".navigator.is-globe");
  for (let k = 0; k < 8 && !(await isGlobe.count()); k++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(600);
  }
  await expect(isGlobe).toHaveCount(1);
  // Back to the map: it keeps the widest view, so the first wheel out is a far-out push.
  await page.getByRole("button", { name: "South pole map" }).press("Enter");
  await page.evaluate(() => ((window as unknown as { t0: number }).t0 = performance.now()));
  await expect(isGlobe).toHaveCount(0);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.4); // the click moved the mouse to the button
  await page.mouse.wheel(0, 400);
  // Busy main thread until both timers are due (far-out at +150 ms, fade at +800 ms).
  await page.evaluate(() => {
    const t0 = (window as unknown as { t0: number }).t0;
    while (performance.now() - t0 < 1100);
  });
  await expect(isGlobe).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 10000 });
});

// The attribution sits clear of the left rail.
test("map: the attribution is not under the left rail", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto("/?guide=0");
  await enterMap(page);
  const attrib = (await page.locator(".nav-attrib").boundingBox())!;
  const rail = (await page.getByRole("navigation", { name: "Main" }).boundingBox())!;
  expect(attrib.x).toBeGreaterThanOrEqual(rail.x + rail.width);
});
