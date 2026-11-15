import { expect, test } from "@playwright/test";
import { openPlace, pinNow } from "./nav";

// #158 acceptance: the welcome screen is a separate first screen, shown once. After "Open navigator"
// it never comes back on its own: a reload lands in the navigator; the logo in the rail reopens it.
// Dragging the time scrubber changes the Sun elevation in the place card.
test.use({ storageState: { cookies: [], origins: [] } }); // a first-time visitor

test("first visit: welcome screen → navigator; a reload goes straight to the navigator", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await pinNow(page, "2026-11-15T18:30:00Z"); // before the data: the first screen says where it starts (#377)
  await page.goto("/");
  const hero = page.getByRole("region", { name: "Welcome" });
  await expect(hero).toBeVisible();
  await expect(hero).toContainText("Data starts 2026-12-01 00:00 UTC; now is earlier.");
  await expect(hero.getByRole("heading", { level: 1, name: "Tilion" })).toBeVisible();
  await expect(page.getByLabel("Lunar south pole landing site navigator")).toHaveCount(1);
  await expect(hero.getByRole("definition").first()).toHaveText(/\d/); // a live number, not a dash
  // No first-load overlays: no guide, no Compare sheet; the navigator chrome waits under the screen.
  await expect(page.getByRole("region", { name: "How to read" })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

  await hero.getByRole("button", { name: "Open navigator" }).click();
  await expect(hero).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search sites" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Time sheet" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("searchbox", { name: "Search sites" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Welcome" })).toHaveCount(0);

  // The logo reopens it; Esc or the button closes it again.
  await page.getByRole("button", { name: "About Tilion" }).click();
  await expect(page.getByRole("region", { name: "Welcome" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Welcome" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`audience entries are visible at ${viewport.width}px (#384)`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    const hero = page.getByRole("region", { name: "Welcome" });
    for (const name of ["Open navigator", "Learn: 1-minute tour", "Plan a landing"]) {
      const button = hero.getByRole("button", { name, exact: true });
      await expect(button).toBeVisible();
      await expect(button).toBeInViewport({ ratio: 1 });
    }
    await hero.getByRole("button", { name: "Plan a landing" }).click();
    await expect(page.getByRole("region", { name: "Welcome" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Mission" })).toBeVisible();
  });
}

test("blocked storage: the welcome screen still opens and lets the visitor in", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
  });
  await page.goto("/");
  const hero = page.getByRole("region", { name: "Welcome" });
  await hero.getByRole("button", { name: "Open navigator" }).click();
  await expect(hero).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search sites" })).toBeVisible();
});

test("a shared mission link skips the welcome screen", async ({ page }) => {
  await page.goto("/?site=a_haworth&t=2027-02-01T06:00Z");
  await expect(page.getByLabel("Landing time (UTC)")).toHaveValue("2027-02-01 06:00");
  await expect(page.getByRole("region", { name: "Welcome" })).toHaveCount(0);
});

test("scrubber: dragging the time changes the Sun elevation in the place card", async ({ page }) => {
  await page.goto("/?hero=0");
  const card = await openPlace(page, "Haworth");
  const elevation = card.locator(".place-clear").first(); // #206 "1.3° above terrain (0.3° above level)"
  await expect(elevation).toBeVisible();
  const before = await elevation.textContent();
  const strip = page.getByRole("slider", { name: "Scrub date" });
  const box = (await strip.boundingBox())!;
  const y = box.y + 50; // the numbers row: no pin there
  await page.mouse.move(box.x + box.width * 0.7, y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + box.width * (0.7 - k * 0.05), y);
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect.poll(async () => elevation.textContent()).not.toBe(before);
  // Sun-lit and Earth-in-view bands are named beside the track.
  await expect(page.getByRole("region", { name: "Time sheet" })).toContainText("Sun-lit");
  await expect(page.getByRole("region", { name: "Time sheet" })).toContainText("Earth in view");
});

test("1-minute tour from the welcome screen plays the guide to NASA check without clicks (#382)", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const hero = page.getByRole("region", { name: "Welcome" });
  await hero.getByRole("button", { name: "Learn: 1-minute tour" }).click();
  const guide = page.getByRole("region", { name: "How to read" });
  await expect(guide).toContainText("1 / 6");
  const started = Date.now();
  // Real time: 5 steps of 8 s, so the last step (NASA check) shows within 60 s.
  await expect(guide).toContainText("6 / 6", { timeout: 55_000 });
  expect(Date.now() - started).toBeLessThan(60_000);
  await expect(page.getByRole("dialog", { name: "NASA check" })).toBeVisible();
});
