import { readFileSync } from "node:fs";
import { pinNow } from "./nav";
import { expect, test } from "@playwright/test";

// #21 acceptance: the Globe loads under 5 s from page open (#72: it is the start view); the
// sub-solar point is the SPICE value for the shared moment; a click on a site marker selects the
// site and opens the south polar map there (#72); the Globe control returns to the globe.
const sub = JSON.parse(readFileSync("public/data/globe/subpoints.json", "utf8"));
const hour = (utc: string) => (Date.parse(utc) - Date.parse(sub.startUtc)) / 3600000;
const point = (lat: number, lonE: number) =>
  `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}, ${lonE.toFixed(2)}° E`;

test("globe: loads under 5 s, Sun follows the shared moment, click selects a site", async ({ page }) => {
  // The walk below (globe → map → globe → horizon) is long on software GL; the 5 s load budget stays.
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const t0 = Date.now();
  await pinNow(page);
  await page.goto("/?guide=0");
  // MapLibre is not loaded for the first paint: the map region does not exist yet.
  await expect(page.getByRole("region", { name: "Navigator map" })).toHaveCount(0);
  const section = page.getByRole("region", { name: "Globe" });
  await expect(section.locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 5000 });
  expect(Date.now() - t0).toBeLessThan(5000);
  await expect(section.getByRole("note")).toHaveCount(0); // inside the SPICE range: no clamp note

  const status = section.getByRole("status");
  let i = hour("2027-01-15T00:00:00Z");
  await expect(status).toContainText(`Sun overhead at ${point(sub.sunLat[i], sub.sunLonE[i])}`);
  await expect(status).toContainText(`Earth overhead at ${point(sub.earthLat[i], sub.earthLonE[i])}`);
  await page.getByRole("slider", { name: "Scrub date" }).press("Shift+ArrowRight"); // +1 day (#298)
  i = hour("2027-01-16T00:00:00Z");
  await expect(status).toContainText(`Sun overhead at ${point(sub.sunLat[i], sub.sunLonE[i])}`); // the date is in the time strip (#155)

  // The default first pick is selected; fly over Haworth and click its marker at the canvas centre.
  const selected = section.getByLabel("Selected site");
  await expect(selected).toContainText("Shackleton–de Gerlache ridge");
  await expect(selected).toContainText(/Sun (centre )?\d+\.\d° (above|below) terrain.*\(\d+\.\d° (above|below) level\); Earth \d+\.\d° (above|below) terrain \(\d+\.\d° (above|below) level\)/);
  await section.getByLabel(/Relief height/).fill("6");
  await expect(section).toContainText("Relief height 6×");
  const fly = section.getByRole("combobox", { name: "Fly to site" });
  await fly.click();
  await page.getByRole("listbox", { name: "Fly to site" }).getByRole("option", { name: "Haworth (HW02)" }).click();
  await expect(fly).toHaveText("Haworth (HW02)");
  await expect(fly).toHaveAttribute("aria-expanded", "false");
  await page.waitForTimeout(300); // a few frames: damping settles, the matrices update
  await section.locator("canvas").click({ position: await centre(section.locator("canvas")) });
  // The pick selects Haworth and zooms through to the polar map with its place card.
  const card = page.getByRole("article", { name: "Place card" });
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Haworth (HW02)");
  await expect(page.getByRole("region", { name: "Navigator map" })).toHaveAttribute("data-ready", "1", { timeout: 10000 });
  await expect(section).toHaveCount(0); // the globe unmounts after the fade
  // The Globe control returns to the globe; the card's horizon still opens.
  await page.getByRole("button", { name: "Globe", exact: true }).press("Enter");
  await expect(page.getByRole("region", { name: "Globe" }).locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 10000 });
  await card.getByRole("button", { name: "Horizon view" }).click();
  await expect(page.getByRole("region", { name: "Horizon panorama" }).getByRole("heading", { level: 2 })).toContainText("Haworth");
  expect(errors).toEqual([]);
});

async function centre(loc: import("@playwright/test").Locator) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("canvas has no box");
  return { x: b.width / 2, y: b.height / 2 };
}
