import { readFileSync } from "node:fs";
import { pinNow } from "./nav";
import { expect, test } from "@playwright/test";
import { enterMap, rail } from "./nav";

// #36 acceptance, after #72: the app opens on the globe; the south polar map paints under 2 s from
// the switch (MapLibre loads lazily); a marker opens the place card with the real Sun/Earth state
// of the shared moment; search filters; layers switch.
const AT = "2027-01-15T00:00:00Z";
const tl = JSON.parse(readFileSync("public/data/timeline/a_haworth.json", "utf8"));
const i = Math.floor((Date.parse(AT) - Date.parse(tl.startUtc)) / (tl.stepMin * 60000)); // #162: the step that holds the moment

test("IM-2 place card finishes loading within 3 seconds of first paint", async ({ page }) => {
  await page.goto("/?site=im2_athena&t=2026-12-01T12:00Z", { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    while (!performance.getEntriesByName("first-paint").length) await new Promise(requestAnimationFrame);
    const deadline = performance.getEntriesByName("first-paint")[0].startTime + 3000;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, deadline - performance.now())));
  });
  const card = page.getByRole("article", { name: "Place card" });
  await expect(card).toBeVisible({ timeout: 0 });
  await expect(card).not.toContainText(/loading…/i, { timeout: 0 });
});

test("IM-2 place card reports a timeline fetch failure", async ({ page }) => {
  await page.route("**/data/timeline/im2_athena.json", (route) => route.abort("failed"));
  await page.goto("/?site=im2_athena&t=2026-12-01T12:00Z");
  await expect(page.getByRole("article", { name: "Place card" })).toContainText("Timeline unavailable: file missing or failed to load.");
});

test("navigator: map paints fast, marker opens the place card with real Sun and Earth", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await pinNow(page);
  await page.goto("/?guide=0");
  // #72: no screen tabs; the start view is the globe with the same chrome.
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible();
  // The user looks at the globe first; meanwhile the map chunk is prefetched (idle, ≤ 1.5 s).
  await page.waitForLoadState("networkidle");
  const t0 = Date.now();
  await page.getByRole("button", { name: "South pole map" }).press("Enter");
  const map = page.getByRole("region", { name: "Navigator map" });
  await expect(map).toHaveAttribute("data-ready", "1", { timeout: 2000 });
  expect(Date.now() - t0).toBeLessThan(2000);
  await expect(map.locator("canvas")).toBeVisible();
  // #154: site names show at the start zoom wherever they fit (not only after zooming in).
  await expect.poll(() => map.locator(".nav-marker.lbl-on").count()).toBeGreaterThan(5);

  await map.getByRole("button", { name: "Haworth (HW02)" }).click();
  const card = page.getByRole("article", { name: "Place card" });
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Haworth (HW02)");
  await expect(card).toContainText("Earth centre above terrain: geometric visibility only.");
  await expect(card).toContainText("No antenna schedule or link budget");
  await expect(card).toContainText("LOLA 20 m within 5 km + 80 m + 240 m polar DEM");
  const live = card.getByRole("status");
  // #162: angles to 0.1°. #206: above the terrain horizon first, above level in brackets (format.ts fmtClearance).
  const lvl = (d: number) => `(${Math.abs(d).toFixed(1)}° ${d < 0 ? "below" : "above"} level)`;
  // #155: the moment is shown once, in the time strip; the card values below are for that hour.
  const strip = page.getByRole("slider", { name: "Scrub date" });
  await expect(strip).toHaveAttribute("aria-valuetext", "JAN 15 2027 00:00 UTC");
  await expect(live).toContainText(new RegExp(`Sun${tl.sunVisible[i] > 0 ? "Up" : "Down"}(centre )?\\d+\\.\\d° (above|below) terrain`));
  await expect(live).toContainText(lvl(tl.sunEl[i]));
  await expect(live).toContainText(new RegExp(`Earth${tl.earthVisible[i] > 0 ? "In view" : "Hidden"}\\d+\\.\\d° (above|below) terrain`));
  await expect(live).toContainText(lvl(tl.earthEl[i]));
  await expect(live).toContainText(/(Sunset|Sunrise) in >? ?[\d.]+ [hd]/);
  await expect(live).toContainText(/(Earthset|Earthrise) in >? ?[\d.]+ [hd]/);

  // The shared moment drives the card.
  const before = await live.innerText();
  await strip.press("Shift+ArrowRight"); // +1 day (#298)
  await expect(strip).toHaveAttribute("aria-valuetext", "JAN 16 2027 00:00 UTC");
  await expect(live).not.toHaveText(before);

  await card.getByRole("button", { name: "Horizon view" }).click();
  await expect(page.getByRole("region", { name: "Horizon panorama" }).getByRole("heading", { level: 2 })).toContainText("Haworth");
  expect(errors).toEqual([]);
});

test("navigator: search filters the list, a list item flies to the site", async ({ page }) => {
  await page.goto("/?guide=0");
  await rail(page, "Sites");
  const list = page.getByRole("list", { name: "Site list" });
  await expect(list.getByRole("listitem").first()).toBeVisible();
  const all = await list.getByRole("listitem").count();
  expect(all).toBeGreaterThan(10);
  const search = page.getByRole("searchbox", { name: "Search sites" });
  await search.fill("malapert massif");
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await list.getByRole("listitem").click();
  await expect(page.getByRole("article", { name: "Place card" }).getByRole("heading", { level: 2 })).toContainText("Malapert");
  // From the globe a polar site opens the map there (no load budget here: specs run in parallel).
  await expect(page.getByRole("region", { name: "Navigator map" })).toHaveAttribute("data-ready", "1", { timeout: 15000 });
  await search.fill("no such site");
  await expect(list.getByRole("listitem")).toHaveCount(0);
  await expect(page.getByText(/No sites or features match/)).toBeVisible();
  await search.fill("");
  await expect(list.getByRole("listitem")).toHaveCount(all);
});

test("navigator: the Layers button opens the layer switch: Sunlight and Earth view with a legend", async ({ page }) => {
  await page.goto("/?guide=0");
  await enterMap(page);
  await page.getByRole("button", { name: "Layers" }).click();
  const layers = page.getByRole("group", { name: "Map layer" });
  await expect(layers.getByRole("button", { name: "Relief" })).toHaveAttribute("aria-pressed", "true");
  const legend = page.getByLabel("Layer legend");
  await expect(legend).toHaveCount(0);
  await layers.getByRole("button", { name: "Sunlight" }).click();
  await expect(layers.getByRole("button", { name: "Sunlight" })).toHaveAttribute("aria-pressed", "true");
  await expect(legend).toContainText("Sunlight: % of time any part of the solar disc is up");
  await expect(legend).toContainText("Mazarico et al. 2011");
  await layers.getByRole("button", { name: "Earth view" }).click();
  await expect(legend).toContainText("Earth in view: mean % of time");
  await layers.getByRole("button", { name: "Relief" }).click();
  await expect(legend).toHaveCount(0);
});
