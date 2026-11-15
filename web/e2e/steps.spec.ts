import { expect, test } from "@playwright/test";

// #360, #460: the steps live in the left rail. A step link opens its view; a rail step click writes
// #step= and the browser Back goes to the last step.
test("steps: #step= opens the view, a click moves the step, Back returns", async ({ page }) => {
  await page.goto("/#step=sky");
  const steps = page.getByRole("navigation", { name: "Main" });
  await expect(page.getByRole("dialog", { name: /^Horizon from / })).toBeVisible();
  await expect(steps.locator('[aria-current="step"]')).toHaveAccessibleName("Sky");
  await expect(steps.locator('[aria-current="step"] .rail-num')).toHaveText("02");
  await expect(steps.getByRole("button", { name: "Sites" })).toHaveClass(/is-done/);
  // #460: the current step and the active rail button are the same button.
  await expect(steps.locator(".rail-btn.is-active")).toHaveCount(1);
  await expect(steps.locator(".rail-btn.is-active")).toHaveAttribute("aria-current", "step");

  await steps.getByRole("button", { name: "Windows", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Landing windows" })).toBeVisible();
  await expect(page).toHaveURL(/#step=windows$/);
  await expect(steps.locator('[aria-current="step"] .rail-num')).toHaveText("03");
  await expect(steps.locator(".rail-btn.is-active")).toHaveAttribute("aria-current", "step");

  await page.goBack();
  await expect(page.getByRole("dialog", { name: /^Horizon from / })).toBeVisible();
  await expect(steps.locator('[aria-current="step"]')).toHaveAccessibleName("Sky");
});

test("steps: the rail numbers 01–06 follow the path, Schedule and Guide come after", async ({ page }) => {
  await page.goto("/?guide=0");
  const names = await page.getByRole("navigation", { name: "Main" }).locator(".rail-btn").evaluateAll((els) =>
    els.map((e) => `${e.querySelector(".rail-num")?.textContent ?? "--"} ${e.getAttribute("aria-label")}`),
  );
  expect(names).toEqual(["01 Sites", "02 Sky", "03 Windows", "04 Compare", "05 Mission", "06 NASA check", "-- Schedule", "-- How to read"]);
});
