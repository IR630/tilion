import { expect, test } from "@playwright/test";
import { enterMap, rail } from "./nav";

// #147: official IAU names in search and on the map. #148: mission waypoints by a map click, in the
// list with distance, on the map, restored from the link.
test("IAU names: search Shackleton → fly → label and feature card", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0");
  await enterMap(page);
  await expect(page.locator(".iau-label").first()).toBeVisible();

  await page.getByRole("searchbox", { name: "Search sites" }).fill("Shackleton");
  const group = page.getByRole("region", { name: "Craters & features" });
  await expect(group.getByRole("listitem").first()).toContainText("Shackleton");
  await expect(group.getByRole("listitem").first()).toContainText("21 km");
  await group.getByRole("listitem").first().click();

  const card = page.getByRole("article", { name: "Feature card" });
  await expect(card.getByRole("heading", { level: 2 })).toHaveText("Shackleton");
  await expect(card).toContainText("89.6700°S 129.7800°E");
  await expect(card.getByRole("link", { name: "IAU Gazetteer of Planetary Nomenclature" })).toHaveAttribute("href", /planetarynames\.wr\.usgs\.gov\/Feature\//);
  // No plan yet: the button says why it is off.
  await expect(card.getByRole("button", { name: "Add as waypoint" })).toBeDisabled();
  await expect(card).toContainText("Plan a mission first");
  // After the flight the selected label is on the map, inside the view.
  const label = page.locator(".iau-label.is-selected");
  await expect(label).toHaveText("Shackleton");
  await expect(label).toBeInViewport();
  expect(errors).toEqual([]);
});

test("waypoints: add by a map click → map and list → the link restores them", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0");
  await enterMap(page);
  await page.getByRole("searchbox", { name: "Search sites" }).fill("Haworth");
  await page.getByRole("list", { name: "Site list" }).getByRole("listitem").first().click();
  await page.getByRole("article", { name: "Place card" }).getByRole("button", { name: "Plan mission from here" }).click();
  const wp = page.getByRole("region", { name: "Waypoints" });
  await expect(wp).toContainText("No waypoints yet");

  await wp.getByRole("button", { name: "Add waypoint" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Click the map to place WP1" })).toBeVisible();
  // An empty spot of the map: right half, away from the panels. Markers, labels and route bubbles
  // move with the camera, so click the first candidate where the canvas itself is on top.
  const box = (await page.locator(".nav-map-canvas").boundingBox())!;
  const spots = [[0.62, 0.82], [0.7, 0.75], [0.58, 0.7], [0.72, 0.62], [0.66, 0.9]];
  const items = page.getByTestId("waypoint-item");
  await expect(async () => {
    if ((await items.count()) === 0) {
      for (const [fx, fy] of spots) {
        const [x, y] = [box.x + box.width * fx, box.y + box.height * fy];
        const free = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.classList.contains("maplibregl-canvas"), [x, y]);
        if (free) {
          await page.mouse.click(x, y);
          break;
        }
      }
    }
    await expect(items).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await expect(items.first().getByTestId("waypoint-distance")).toHaveText(/^\d+(\.\d)?km$/);
  await expect(items.first()).toContainText(/Azimuth\s*\d+°/);
  await expect(items.first()).toContainText(/Sun, 18\.6-y mean\s*(\d+\s*%|no data)/);
  await expect(wp).toContainText("PGDA 69 mean, 18.6 y");
  await expect(wp).toContainText("only for the 23 precomputed sites");
  const marker = page.getByTestId("waypoint-marker");
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute("aria-label", /^WP1: .+, \d+(\.\d)? KM$/);

  // Rename: the link follows.
  const name = items.first().getByRole("textbox", { name: "Waypoint 1 name" });
  await name.fill("Ice target");
  await name.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("wp")).toContain("Ice target");

  const url = page.url();
  await page.goto(url);
  // A link with a plan opens on the map.
  await expect(page.getByRole("region", { name: "Navigator map" })).toHaveAttribute("data-ready", "1", { timeout: 15000 });
  await expect(page.getByTestId("waypoint-marker")).toHaveAttribute("aria-label", /^WP1: ICE TARGET, /);
  if (!(await page.getByRole("region", { name: "Waypoints" }).isVisible())) await rail(page, "Mission");
  await expect(page.getByTestId("waypoint-item")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Waypoint 1 name" })).toHaveValue("Ice target");
  expect(errors).toEqual([]);
});
