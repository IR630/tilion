import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { openPlace } from "./nav";

test("recording is hidden without rec=1", async ({ page }) => {
  await page.goto("/?guide=0");
  await expect(page.getByRole("region", { name: "Time sheet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rec", exact: true })).toHaveCount(0);
});

for (const [tab, codec] of [["Globe", "vp9"], ["3D terrain", "vp8"]]) {
  test(`${tab}: five seconds download and play as ${codec} WebM`, async ({ page }) => {
    // Exercise the VP8 fallback with the real encoder, not a fake MediaRecorder.
    if (codec === "vp8") await page.addInitScript(() => {
      const supported = MediaRecorder.isTypeSupported.bind(MediaRecorder);
      MediaRecorder.isTypeSupported = (type) => !type.includes("vp9") && supported(type);
    });
    // The app opens on the WebGL globe (#72): loading, recording and decoding take longer on software GL.
    test.setTimeout(90_000);
    await page.goto("/?rec=1&guide=0");
    // The globe is the start view; the 3D terrain opens from the place card on the map.
    if (tab !== "Globe") await (await openPlace(page, "Haworth")).getByRole("button", { name: "View from site" }).click();
    await expect(page.getByRole("region", { name: tab, exact: true }).locator('canvas[data-ready="1"]')).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Rec", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stop recording", exact: true })).toBeVisible(); // time plays while it records
    await page.waitForTimeout(5000);
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Stop recording", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^tilion-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ\.webm$/);
    const bytes = await readFile(await download.path());
    expect(bytes.length).toBeGreaterThan(1000);
    await page.route("**/recorded.webm", (route) => route.fulfill({ body: bytes, contentType: "video/webm" }));
    const decoded = await page.evaluate(async () => {
      const video = document.createElement("video");
      video.muted = true;
      video.src = "/recorded.webm";
      document.body.append(video);
      await video.play();
      const size = [video.videoWidth, video.videoHeight];
      await new Promise<void>((resolve, reject) => {
        video.onended = () => resolve();
        video.onerror = () => reject(new Error(video.error?.message));
      });
      return { size, seconds: video.currentTime };
    });
    expect(decoded.size.every((v) => v > 0)).toBe(true);
    expect(decoded.seconds).toBeGreaterThanOrEqual(4.5);
  });
}
