import { expect, test } from "@playwright/test";

// #160: route alternatives are cards ranked by the route score, the best one says why; a route
// from JSON points is drawn as a traverse with comms per leg and its own score.
test("route score: best card says why; JSON import → traverse legs with comms and a score", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/?guide=0&site=cr1_connecting_ridge&t=2027-03-01T12:00Z&days=14&mode=balanced");
  const panel = page.getByRole("region", { name: "Mission route" });
  const options = panel.getByRole("region", { name: "Route options" }).locator("li.rp-opt");
  await expect(options).toHaveCount(6);
  // Scores are 0–100 and best first.
  const scores = (await options.getByTestId("option-score").allInnerTexts()).map(Number);
  for (const s of scores) expect(s).toBeGreaterThanOrEqual(0);
  expect(scores[0]).toBeLessThanOrEqual(100);
  expect(scores[0]).toBeGreaterThanOrEqual(Math.max(...scores.slice(1, 5)) - 1);
  await expect(panel.getByTestId("best-why")).toContainText(/^Best landing option: .+ — (.+: \+\d+ points over #2|ties with the next option)/);
  await expect(options.first().getByRole("img", { name: /^Score breakdown: Power/ })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Plan metrics" })).toContainText("score / 100");

  // The selected card lists every parameter with units.
  await options.first().getByRole("button", { pressed: false }).click();
  const params = options.first().getByRole("definition");
  await expect(options.first().getByLabel("Route parameters")).toContainText(/Longest night\d+ h/);
  await expect(options.first().getByLabel("Route parameters")).toContainText(/DSN in view(\d+ %|no data)/);
  expect(await params.count()).toBeGreaterThan(10);

  // JSON import: a broken file lists every problem; a good one builds the traverse.
  const tr = panel.getByRole("region", { name: "Traverse" });
  await tr.getByRole("button", { name: "Import JSON" }).click();
  const box = tr.getByRole("textbox", { name: "Route points JSON" });
  await box.fill('[{"name": "North", "lat": -45, "lon": -10}]');
  await tr.getByRole("button", { name: "Build route" }).click();
  const alert = tr.getByRole("alert");
  await expect(alert).toContainText("lat -45 is north of 60°S");
  await expect(alert).toContainText("lon -10 is negative: use 0–360°E (-10 → 350)");

  await box.fill('[{"name": "Rim A", "lat": -89.43, "lon": 222.83}, {"name": "Rim B", "lat": -89.42, "lon": 223.5}]');
  await tr.getByRole("button", { name: "Build route" }).click();
  await expect(page.getByTestId("waypoint-marker")).toHaveCount(2);
  const legs = tr.getByTestId("traverse-leg");
  await expect(legs).toHaveCount(2);
  await expect(legs.first()).toContainText("→ Rim A");
  // Custom horizons are computed in the browser: wait for every leg to get its comms level.
  await expect(tr.getByTestId("traverse-score")).toBeVisible({ timeout: 90_000 });
  for (const l of await legs.all()) await expect(l).toHaveAttribute("data-level", /^(good|partial|poor)$/);
  await expect(legs.first()).toContainText(/Earth \d+ %/);
  await expect(tr).toContainText("Comms on a leg");
  expect(errors).toEqual([]);
});
