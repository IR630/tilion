import { expect, test } from "@playwright/test";

// #164 acceptance: a plan with waypoints → the drive profile shows a sampled LOLA path, stats,
// Sun/Earth bands and a rover that follows the shared moment; a click moves the moment.
const wp = [
  { name: "Rim", lat: -86.7, lonE: 338.28 },
  { name: "Ridge", lat: -86.7, lonE: 340.0 },
];

test("drive profile: route with waypoints → elevation profile with a non-empty path", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`/?guide=0&site=a_haworth&t=2027-01-15T00:00Z&wp=${encodeURIComponent(JSON.stringify(wp))}`);
  const panel = page.getByRole("region", { name: "Mission route" });
  const prof = panel.locator("details.elev");
  await expect(prof).toContainText("Drive profile");
  const canvas = prof.getByTestId("elevation-profile");
  await expect(canvas).toBeVisible({ timeout: 15000 });
  // ~5 km of drive sampled every ≤ 120 m.
  expect(Number(await canvas.getAttribute("data-samples"))).toBeGreaterThan(30);
  await expect(canvas).toHaveAttribute("aria-label", /Elevation profile: \d+\.\d+ km, -?\d+ to -?\d+ m, max slope \d+\.\d°/);
  await expect(prof).toContainText(/vertical scale ×\d/);
  await expect(prof).toContainText("they are assumptions");
  // The canvas has drawn pixels (not a blank box).
  const inked = await canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  expect(inked).toBeGreaterThan(1000);
  // Hover shows km, height, slope, Sun and Earth at that point.
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const at = { x: Math.round(box.width * 0.6), y: 60 };
  await canvas.hover({ position: at });
  const tip = prof.locator(".elev-tip");
  await expect(tip).toContainText(/km/);
  await expect(tip).toContainText(/slope/);
  await expect(tip).toContainText(/Sun/);
  if (process.env.SHOT) await prof.screenshot({ path: process.env.SHOT });
  // The rover sits at the site at landing; a click on the profile moves the shared moment there.
  const rover = prof.getByTestId("elevation-rover");
  await expect(rover).toContainText(/Rover at (the landing site|0\.00 of)/);
  await canvas.click({ position: at });
  await expect(rover).toContainText(/Rover at \d+\.\d\d of \d+\.\d\d km/);
  // #204, #323: the data note folds behind "?"; a click opens it.
  const viper = prof.getByRole("link", { name: "NASA VIPER operations" });
  await expect(viper).toBeHidden();
  await prof.getByRole("button", { name: "About the elevation profile" }).click();
  await expect(prof.getByRole("note")).toContainText(/^LOLA 240 m DEM \(PGDA 90\)/);
  await expect(viper).toBeVisible();
  expect(errors).toEqual([]);
});
