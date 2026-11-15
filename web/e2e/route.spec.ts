import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { enterMap, pinNow, rail } from "./nav";

// #57 acceptance: plan → options with real numbers → select → route line on the map → make
// current → the link holds the new plan; a link restores a plan; a bad mission file is refused.
const AT = "2027-01-15T00:00:00Z"; // the app's default shared moment
const hours = JSON.parse(readFileSync("public/data/hours.json", "utf8"));
const codes: string = hours.sites.a_haworth;
const i0 = Math.round((Date.parse(AT) - Date.parse(hours.startUtc)) / (hours.stepMin * 60000));
const win = codes.slice(i0, i0 + 14 * 24);
const count = (f: (c: number) => boolean) => [...win].filter((c) => f(Number(c))).length;
const sunH = count((c) => (c & 1) === 1);
const earthH = count((c) => (c & 2) === 2);

test("route: plan from a site, pick an option, draw the line, make it current", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await pinNow(page);
  await page.goto("/?guide=0");
  await enterMap(page);
  const map = page.getByRole("region", { name: "Navigator map" });
  await expect(map).toHaveAttribute("data-ready", "1");
  await map.getByRole("button", { name: "Haworth (HW02)" }).click();
  await page.getByRole("article", { name: "Place card" }).getByRole("button", { name: "Plan mission from here" }).click();

  const panel = page.getByRole("region", { name: "Mission route" });
  await expect(panel).toContainText("Earth centre above terrain: geometric visibility only.");
  await expect(panel).toContainText("No antenna schedule or link budget");
  await expect(panel).toContainText("Sun + Earth is a geometric overlap, not mission readiness.");
  // #72: the search pill turns into the route header: "From <site> <time>" and the mode chips.
  const head = page.getByRole("region", { name: "Route header" });
  await expect(head.getByRole("button", { name: "Landing site: Haworth (HW02)" })).toBeVisible();
  await expect(head.getByLabel("Landing time (UTC)")).toHaveValue("2027-01-15 00:00");
  // The plan card shows the real window sums from hours.json.
  const card = panel.getByRole("region", { name: "Plan metrics" });
  await expect(card).toContainText(`Sun${sunH} h`);
  await expect(card).toContainText(`Earth${earthH} h`);
  await expect(page).toHaveURL(/site=a_haworth/);

  const options = panel.getByRole("region", { name: "Route options" }).getByRole("listitem");
  await expect(options).toHaveCount(6);
  await expect(options.first()).toContainText(/\d+ h/);
  await expect(options.first()).toContainText("best");

  // Every option is a line on the map with a bubble; select the first option at another site.
  const other = panel.locator('li.rp-opt:not([data-site="a_haworth"])').first();
  const target = await other.getAttribute("data-site");
  expect(target).toBeTruthy();
  await other.getByRole("button", { pressed: false }).click();
  const end = page.getByTestId("route-end");
  await expect(end).toHaveAttribute("data-site", target as string);
  // The end marker sits on the target site's marker (polled: the camera fits the line first).
  const centre = async (sel: string) => {
    const b = await page.locator(sel).boundingBox();
    return b ? [b.x + b.width / 2, b.y + b.height / 2] : [NaN, NaN];
  };
  await expect
    .poll(async () => {
      const [ax, ay] = await centre('[data-testid="route-end"] i');
      const [bx, by] = await centre(`.nav-marker[data-site="${target}"] .nav-marker-dot`);
      return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
    })
    .toBeLessThan(3);

  await other.getByRole("button", { name: "Make current" }).click();
  await expect(page).toHaveURL(new RegExp(`site=${target}`));
  await expect(end).toHaveCount(0);
  await expect(panel).toContainText("Original: Haworth (HW02)");
  await panel.getByRole("button", { name: "Back to original" }).click();
  await expect(page).toHaveURL(/site=a_haworth/);
  expect(errors).toEqual([]);
});

test("route: a link restores the plan", async ({ page }) => {
  await page.goto("/?site=a_malapert_massif&t=2027-03-01T12:00Z&days=10&slip=-3..7&radius=200&mode=energy&name=Ridge+lander");
  const panel = page.getByRole("region", { name: "Mission route" });
  const head = page.getByRole("region", { name: "Route header" });
  await expect(panel.getByLabel("Mission name")).toHaveValue("Ridge lander");
  await expect(head.getByRole("button", { name: "Landing site: Malapert Massif (MMA01)" })).toBeVisible();
  await expect(head.getByLabel("Landing time (UTC)")).toHaveValue("2027-03-01 12:00");
  await expect(head.getByRole("group", { name: "Ranking mode" }).getByRole("button", { name: "Energy" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toContainText("Slip −3…+7 d, ≤ 200 km, 10-day window");
  const options = panel.getByRole("region", { name: "Route options" }).getByRole("listitem");
  await expect(options.first()).toBeVisible();
  for (const t of await options.allInnerTexts()) {
    const km = /\b([\d.]+) km\b/.exec(t);
    if (km) expect(Number(km[1])).toBeLessThanOrEqual(200);
    expect(t).toMatch(/same day|[+−][1-7] d/);
  }
});

test("route: a bad mission file shows a clear error, a good one opens", async ({ page }) => {
  await page.goto("/?guide=0");
  await rail(page, "Mission");
  const panel = page.getByRole("region", { name: "Mission route" });
  const file = panel.getByLabel("Mission file");
  await file.setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"format":"x"}') });
  await expect(panel.getByRole("alert")).toContainText('bad.json: Unknown format "x"');
  const good = {
    format: "tilion-mission/1", name: "From file", siteId: "a_haworth", landingUtc: "2027-02-01T06:00:00Z",
    durationDays: 14, slipMinDays: -14, slipMaxDays: 30, radiusKm: null, mode: "comms",
  };
  await file.setInputFiles({ name: "good.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(good)) });
  await expect(panel.getByLabel("Mission name")).toHaveValue("From file");
  await expect(page).toHaveURL(/mode=comms/);
});
