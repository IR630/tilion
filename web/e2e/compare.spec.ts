import { expect, test } from "@playwright/test";
import { rail } from "./nav";

test("compare: spread values, best highlight, date slip changes numbers", async ({ page }) => {
  await page.goto("/?guide=0");
  await rail(page, "Compare");
  const table = page.getByRole("table", { name: "Site comparison" });
  await expect(table.getByRole("row")).toHaveCount(3); // header + 2 default sites
  await expect(table).toContainText(/\d+ % \d+–\d+ %/); // value, then its Q8 spread
  await expect(table.locator(".compare-best").first()).toBeVisible();
  await expect(table.locator(".compare-mock")).toHaveCount(0); // polar sites have real timelines in range
  const before = await table.innerText();
  await page.getByRole("button", { name: "Slip +7 days" }).click();
  await expect(page.getByRole("table", { name: "Date slip delta" })).toContainText("of light");
  // #335: the same slip in plain sentences, with a Copy button.
  const report = page.getByRole("region", { name: "What the slip changes" });
  await expect(report).toContainText(/Sun lit over the next 30 d: \d+ % → \d+ % \((better|worse|same)\)\./);
  await expect(report).toContainText("Windows check");
  await expect(report.getByRole("button", { name: "Copy" })).toBeVisible();
  expect(await table.innerText()).not.toBe(before);
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("table", { name: "Date slip delta" })).toHaveCount(0);
  await expect(report).toHaveCount(0);
});

// #197: on a 390 px phone the rail buttons are tappable, Compare is a bottom sheet inside the
// viewport, and the table scrolls sideways inside its frame (the page itself never scrolls sideways).
test("compare: phone 390×844 bottom sheet with a sideways-scrolling table", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?guide=0");
  await rail(page, "Compare"); // a real click: fails if the rail button has no width
  const sheet = page.getByRole("dialog", { name: "Compare sites" });
  const box = (await sheet.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y).toBeGreaterThan(100); // the top of the globe stays in view
  const table = page.getByRole("table", { name: "Site comparison" });
  await expect(table.getByRole("row")).toHaveCount(3);
  const scroll = page.locator(".compare-scroll");
  const [sw, cw] = await scroll.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sw).toBeGreaterThan(cw);
  await expect(page.getByText("Swipe the table sideways for all columns")).toBeVisible(); // #401: a visible scroll cue
  const site = table.getByRole("row").nth(1).getByRole("cell").first();
  const x0 = (await site.boundingBox())!.x;
  await scroll.evaluate((el) => (el.scrollLeft = 200));
  await expect.poll(async () => (await site.boundingBox())!.x).toBeCloseTo(x0, 0); // the site column is sticky
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

// #401: three sites at 1440×900 (the long ridge name widened the site column): every column fits,
// the last one is inside the frame, with no sideways scroll on a laptop screen.
test("compare: three sites at 1440×900, the last column is fully visible", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?guide=0");
  await page.getByRole("searchbox", { name: "Search sites" }).fill("Malapert");
  await page.getByRole("listitem").filter({ hasText: "Malapert" }).first().click();
  await page.getByRole("article", { name: "Place card" }).getByRole("button", { name: "Compare", exact: true }).click();
  const table = page.getByRole("table", { name: "Site comparison" });
  await expect(table.getByRole("row")).toHaveCount(4); // header + 3 sites
  const scroll = page.locator(".compare-scroll");
  const [sw, cw] = await scroll.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  const frame = (await scroll.boundingBox())!;
  const last = (await table.getByRole("columnheader").last().boundingBox())!;
  expect(last.x + last.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
  await expect(page.getByText("Swipe the table sideways for all columns")).toBeHidden();
});
