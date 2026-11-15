import { expect, test } from "@playwright/test";
import { openPlace } from "./nav";

// #8 acceptance: mask and tracks draw; the slider moves the Sun; a disc under the mask reads
// "Sun hidden". Real CR1 timeline (#18): lit all of Jan 2027, so the test starts in mid-March.
test("horizon: slider moves the Sun, status follows the timeline", async ({ page }) => {
  await page.goto("/?guide=0");
  await page.getByRole("slider", { name: "Scrub date" }).focus();
  await page.keyboard.press("t"); // #298: T opens the date picker
  await page.getByLabel("Date (UTC)").fill("2027-03-15 00:00");
  await page.keyboard.press("Escape");
  const card = await openPlace(page, "Gerlache ridge", "Shackleton–de Gerlache ridge");
  await card.getByRole("button", { name: "Horizon view" }).click();
  const region = page.getByRole("region", { name: "Horizon panorama" });
  const panorama = page.getByRole("img", { name: "Horizon mask with Sun and Earth tracks" });
  await expect(panorama).toBeVisible();
  await expect(panorama.locator("polygon.horizon-ground")).toHaveCount(1);
  await expect(panorama.locator("path.horizon-sun-track")).toHaveAttribute("d", /M.+L/);
  await expect(panorama.locator("path.horizon-earth-track")).toHaveAttribute("d", /M.+L/);
  await expect(page.getByText(/Mock data/)).toHaveCount(0); // real timeline (#12, #18)
  // Q8: every next-event time carries the measured spread "spread lo–hi h" (or "lo h … > N d")
  // #436: the Sun event lives in the KPI row ("Horizon summary") only; the readout tiles keep the Earth event.
  const summary = region.getByLabel("Horizon summary");
  await expect(summary).toContainText(/(Sunset|Sunrise)[^·]*spread [\d.]+ ?(–[\d.]+ )?h/);
  await expect(region.getByText("Relief height", { exact: true })).toBeVisible();

  const sun = panorama.locator("ellipse.horizon-sun").first();
  const status = region.getByRole("status");
  await expect(status).toContainText(/Sun (visible|hidden)/);
  await expect(summary).toContainText(/(Sunset|Sunrise|No sunset|No sunrise)/);
  await expect(status).toContainText(/(Earthset|Earthrise|No earthset|No earthrise)/);

  const slider = page.getByRole("slider", { name: "Time" });
  const cx0 = await sun.getAttribute("cx");
  await slider.fill("100");
  await expect(sun).not.toHaveAttribute("cx", cx0!);

  // Walk the period until the disc is under the mask.
  const max = Number(await slider.getAttribute("max"));
  let hidden = false;
  for (let k = 0; k <= max && !hidden; k += 6) {
    await slider.fill(String(k));
    hidden = (await status.textContent())!.includes("Sun hidden");
  }
  expect(hidden).toBe(true);

  const play = page.getByRole("button", { name: "Play" });
  await play.click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});

// #197: an outside tester stayed on the globe, where "Selected: <site>" had no Horizon view
// button (only the map's place card had one). The globe readout now opens it, on desktop and phone.
for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`horizon: opens from the globe's selected site at ${w}×${h}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/?guide=0");
    const selected = page.getByRole("region", { name: "Globe" }).getByLabel("Selected site");
    await expect(selected).toContainText("Shackleton–de Gerlache ridge");
    const btn = selected.getByRole("button", { name: "Horizon view" });
    await expect(btn).toBeInViewport();
    await btn.click();
    const dialog = page.getByRole("dialog", { name: /^Horizon from Shackleton–de Gerlache ridge/ });
    await expect(dialog.getByRole("img", { name: "Horizon mask with Sun and Earth tracks" })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}

// #210: tester №4 at 1440×900 saw the Horizon chart cut at the bottom of the overlay.
test("horizon at 1440×900: the whole chart is in view without a scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?guide=0");
  const card = await openPlace(page, "Gerlache ridge", "Shackleton–de Gerlache ridge");
  await card.getByRole("button", { name: "Horizon view" }).click();
  const panorama = page.getByRole("img", { name: "Horizon mask with Sun and Earth tracks" });
  await expect(panorama).toBeVisible();
  const body = page.locator(".layer-overlay .layer-body");
  await expect(body).toHaveJSProperty("scrollTop", 0);
  const legend = page.locator(".horizon-period-legend");
  const [b, p, l] = [(await body.boundingBox())!, (await panorama.boundingBox())!, (await legend.boundingBox())!];
  expect(p.y).toBeGreaterThanOrEqual(b.y);
  expect(l.y + l.height).toBeLessThanOrEqual(b.y + b.height);
});
