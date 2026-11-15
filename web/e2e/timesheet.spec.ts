import { expect, test, type Locator, type Page } from "@playwright/test";
import { pinNow } from "./nav";

// #58 acceptance: the HUD time strip at the bottom drives the shared moment. Dragging the strip
// scrubs it, a click on a pin jumps to the event, the landing pin slips the plan, and the date picker
// (coloured days) moves the landing. #298: no buttons under the scale; keys zoom, T opens the picker.
const hud = (page: Page) => page.getByRole("region", { name: "Time sheet" });
const moment = (page: Page) => page.getByLabel("Current moment");
const ms = (text: string) => Date.parse(text.replace(" UTC", ":00Z").replace(" ", "T"));
const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

async function openPlaceCard(page: Page, name: string) {
  // #72: no tabs; the search pill floats over the globe and the map alike.
  await page.getByRole("searchbox", { name: "Search sites" }).fill(name);
  await page.getByRole("list", { name: "Site list" }).getByRole("listitem").first().click();
  const card = page.getByRole("article", { name: "Place card" });
  await expect(card.getByRole("heading", { level: 2 })).toContainText(name);
  return card;
}

/** Visible pins from the canvas test hook: kind, x and y (CSS px), time (ms). */
async function pins(strip: Locator) {
  const raw = (await strip.getAttribute("data-pins")) ?? "";
  return raw
    .split(" ")
    .filter(Boolean)
    .map((s) => {
      const [kind, x, t, y] = s.split(":");
      return { kind, x: Number(x), t: Number(t), y: Number(y) };
    });
}

test("time strip: only the timeline under the scale, drag scrubs, a click on a pin jumps to the event", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await pinNow(page);
  await page.goto("/?guide=0");
  const strip = hud(page).getByRole("slider", { name: "Scrub date" });
  await expect(strip).toBeVisible();
  await expect(moment(page)).toHaveText("2027-01-15 00:00 UTC");
  await expect(strip).toHaveAttribute("aria-valuetext", "JAN 15 2027 00:00 UTC");
  await expect(hud(page).getByLabel("Next events")).toContainText(/(Sunset|Sunrise) in >? ?[\d.]+ [hd]/);
  await expect(hud(page).locator("button:not(.hud-legend-hint)")).toHaveCount(0); // no Play, zoom, Now, steps or date field
  // #461: SET DATE is the one button (it opens the picker); the exact moment sits over the playhead.
  await expect(hud(page).locator(".hud-now")).toHaveText("2027-01-15 00:00 UTC");
  await hud(page).getByRole("button", { name: "T set date" }).click();
  await expect(page.getByRole("dialog", { name: "Date picker" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Date picker" })).toHaveCount(0);
  await expect(hud(page).getByLabel("DSN complexes in view")).toHaveCount(0);

  // Drag the scale to the left: later moments come under the fixed centre marker; the place card follows.
  const card = await openPlaceCard(page, "Haworth");
  const before = ms((await moment(page).textContent())!);
  const cardBefore = (await card.getByRole("status").textContent())!;
  const box = (await strip.boundingBox())!;
  const y = box.y + 50;
  await page.mouse.move(box.x + box.width * 0.6, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, y, { steps: 6 });
  await page.mouse.move(box.x + box.width * 0.3, y, { steps: 6 });
  await page.waitForTimeout(150); // no fling: release at rest
  await page.mouse.up();
  await expect.poll(async () => ms((await moment(page).textContent())!)).toBeGreaterThan(before);
  const after = (await moment(page).textContent())!;
  expect(after).toMatch(/^20\d\d-\d\d-\d\d \d\d:00 UTC$/); // snapped to the whole hour
  // #155: the card shows no date of its own (the strip does); its Sun / Earth values follow the moment.
  await expect(card.getByRole("status")).not.toHaveText(cardBefore);

  // Rise and set events are the band edges: click one, the moment jumps to its hour.
  for (let k = 0; k < 4; k++) await strip.press("-"); // zoom out: 3 d × 1.5⁴ ≈ 15 d
  await page.waitForTimeout(500); // the snap and glide after the drag settle
  await expect.poll(async () => (await pins(strip)).filter((p) => /rise|set/.test(p.kind) && p.x > 120 && p.x < box.width - 120).length).toBeGreaterThan(0);
  const pin = (await pins(strip)).find((p) => /rise|set/.test(p.kind) && p.x > 120 && p.x < box.width - 120)!;
  await strip.click({ position: { x: pin.x, y: pin.y } });
  await expect(moment(page)).toHaveText(iso(pin.t));

  // Keyboard: → +1 h, shift+→ +1 d.
  await strip.focus();
  await strip.press("ArrowRight");
  await strip.press("Shift+ArrowRight");
  await expect(moment(page)).toHaveText(iso(pin.t + 25 * 3600_000));
  expect(errors).toEqual([]);
});

test("time strip: the landing pin slips the plan; the date picker moves the landing", async ({ page }) => {
  await page.goto("/?guide=0");
  const strip = hud(page).getByRole("slider", { name: "Scrub date" });
  await strip.focus();
  await page.keyboard.press("t");
  const picker = page.getByRole("dialog", { name: "Date picker" });
  await picker.getByLabel("Date (UTC)").fill("2027-03-15 06:00");
  await expect(moment(page)).toHaveText("2027-03-15 06:00 UTC");
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);

  const card = await openPlaceCard(page, "Shackleton–de Gerlache ridge");
  await card.getByRole("button", { name: "Plan mission from here" }).click();
  // Drag the landing pin to the right: whole days; the date picker outlines the new landing day.
  for (let k = 0; k < 4; k++) await strip.press("-"); // zoom out: 3 d × 1.5⁴ ≈ 15 d
  await expect(strip).toHaveAttribute("data-landing-x", /\d/);
  const lx = Number(await strip.getAttribute("data-landing-x"));
  const box = (await strip.boundingBox())!;
  expect(Math.abs(lx - box.width / 2)).toBeLessThan(2); // on plan: the landing is the moment
  await page.mouse.move(box.x + lx, box.y + 12);
  await page.mouse.down();
  await page.mouse.move(box.x + lx + 60, box.y + 12, { steps: 5 });
  await page.mouse.move(box.x + lx + 130, box.y + 12, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await strip.getAttribute("data-landing-x"))).toBeGreaterThan(lx);

  // Date picker: the landing day is outlined; days outside the slip range are disabled; a click lands there.
  await strip.focus();
  await page.keyboard.press("t");
  const landing = (await picker.locator(".dp-day.is-landing").getAttribute("aria-label"))!.slice(0, 10);
  expect(Date.parse(landing)).toBeGreaterThan(Date.parse("2027-03-15")); // slipped later by whole days
  await expect(picker.getByRole("gridcell", { name: /^2027-03-15: Sun \+ Earth \d+ % of the window/ })).toHaveClass(/q-(both|sun|earth|poor)/);
  await expect(picker.getByRole("gridcell", { name: /^2027-04-15:/ })).toBeDisabled(); // +31 d: outside −14…+30
  await picker.getByRole("gridcell", { name: /^2027-03-16:/ }).click();
  await expect(moment(page)).toHaveText("2027-03-16 06:00 UTC");
  await expect(picker.getByRole("gridcell", { name: /^2027-03-16:/ })).toHaveClass(/is-landing/);
});
