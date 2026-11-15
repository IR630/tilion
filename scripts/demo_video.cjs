#!/usr/bin/env node
// Demo video for the Space Apps submission (#152): ≤ 30 s, 1920×1080, 60 fps, English subtitles.
// Headless Chromium with hardware WebGL (ANGLE on Vulkan), scripted with Playwright: eased mouse
// moves with a drawn cursor, CDP screencast frames, ffmpeg for the cut, the subtitles and the end card.
//
//   make demo                     # or any static server of web/dist (BASE below)
//   BASE=http://localhost:8000 OUT=data/demo node scripts/demo_video.cjs
//
// Each beat is a separate screencast segment (loads happen between segments, off camera). Every
// segment is cut or held to a fixed length, so scripts/demo_video.srt is a static file.
// Needs: ffmpeg with libass, the Playwright Chromium (web/node_modules), a GPU (REQUIRE_GPU=0 skips the check).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
let pw;
try {
  pw = require(path.join(ROOT, "web/node_modules/playwright-core"));
} catch {
  pw = require("playwright-core"); // NODE_PATH=<main checkout>/web/node_modules from a worktree
}

const BASE = process.env.BASE || "http://localhost:8000";
const OUT = path.resolve(process.env.OUT || path.join(ROOT, "data/demo"));
const SRT = path.join(__dirname, "demo_video.srt");
const FONT = process.env.SUB_FONT || "Adwaita Sans";
const W = 1440; // CSS px; ×4/3 = 1920 device px
const H = 750; //  ×4/3 = 1000 device px; the 80 px band below holds the subtitles
const DPR = 4 / 3;
const FPS = 60;
const XF = 0.3; // crossfade between beats, s
// Beat lengths, s (the screencast of each beat is cut or held to this). Keep in sync with the .srt.
const BEATS = [4.6, 4.6, 5.4, 5.0, 5.2, 4.8];
const END = 2.1;
const BG = "#08090b";

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A drawn cursor and a click ripple: headless screencast has no OS cursor.
function cursorScript() {
  const css = `#__dc{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;will-change:transform;
    filter:drop-shadow(0 1px 2px rgba(0,0,0,.7))}
    .__dr{position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;
    border:2px solid #ff6a2b;border-radius:50%;animation:__dr .5s ease-out forwards}
    @keyframes __dr{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}`;
  let el = null;
  const pos = { x: -100, y: -100 };
  const ensure = () => {
    if (el && el.isConnected) return el;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    el = document.createElement("div");
    el.id = "__dc";
    el.innerHTML =
      '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M2 2v20l5.2-4.8 3.6 8.2 3.4-1.5-3.6-8h7.4z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(el);
    return el;
  };
  const place = () => (ensure().style.transform = `translate(${pos.x - 2}px,${pos.y - 2}px)`);
  addEventListener("mousemove", (e) => ((pos.x = e.clientX), (pos.y = e.clientY), place()), true);
  addEventListener(
    "mousedown",
    (e) => {
      const r = document.createElement("div");
      r.className = "__dr";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 600);
    },
    true,
  );
}

class Rec {
  constructor(page, cdp) {
    this.page = page;
    this.cdp = cdp;
    this.seg = 0;
    this.on = false;
    cdp.on("Page.screencastFrame", (f) => {
      if (this.on) {
        const file = path.join(this.dir, String(this.n++).padStart(5, "0") + ".jpg");
        fs.writeFileSync(file, Buffer.from(f.data, "base64"));
        this.frames.push({ file, ts: f.metadata.timestamp });
      }
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
  }
  async start() {
    this.dir = path.join(OUT, `seg${++this.seg}`);
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.frames = [];
    this.n = 0;
    this.on = true;
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1000, everyNthFrame: 1 });
    await sleep(120);
    this.t0 = Date.now() / 1000;
  }
  async stop() {
    const tEnd = Date.now() / 1000;
    await this.cdp.send("Page.stopScreencast");
    this.on = false;
    const fr = this.frames;
    if (!fr.length) throw new Error(`segment ${this.seg}: no frames`);
    // Wall-clock ends: the last frame holds until stop.
    const lastTs = fr[fr.length - 1].ts;
    const shift = tEnd - lastTs > 0 && tEnd - lastTs < 5 ? tEnd - lastTs : 0.05;
    const lines = ["ffconcat version 1.0"];
    for (let i = 0; i < fr.length; i++) {
      const d = i + 1 < fr.length ? fr[i + 1].ts - fr[i].ts : shift;
      lines.push(`file '${path.basename(fr[i].file)}'`, `duration ${Math.max(0.001, d).toFixed(4)}`);
    }
    lines.push(`file '${path.basename(fr[fr.length - 1].file)}'`);
    fs.writeFileSync(path.join(this.dir, "list.txt"), lines.join("\n") + "\n");
    const span = lastTs - fr[0].ts;
    console.log(`segment ${this.seg}: ${fr.length} frames, ${span.toFixed(2)} s, ${(fr.length / Math.max(span, 0.01)).toFixed(1)} fps`);
    const mp4 = path.join(OUT, `seg${this.seg}.mp4`);
    ff(["-f", "concat", "-safe", "0", "-i", path.join(this.dir, "list.txt"), "-vf", `fps=${FPS},scale=1920:1000:flags=lanczos:in_range=pc:out_range=tv,format=yuv420p`,
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", mp4]);
    fs.rmSync(this.dir, { recursive: true, force: true });
    return mp4;
  }
}

function ff(args) {
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("ffmpeg failed: " + args.join(" "));
}

// Mouse with eased glides; `cur` is the last position.
let cur = { x: W * 0.62, y: H * 0.55 };
async function glide(page, x, y, ms = 700) {
  const n = Math.max(6, Math.round(ms / 16));
  const s = { ...cur };
  for (let i = 1; i <= n; i++) {
    const e = ease(i / n);
    await page.mouse.move(s.x + (x - s.x) * e, s.y + (y - s.y) * e);
    await sleep(16);
  }
  cur = { x, y };
}
async function centre(loc) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box: " + loc);
  return [b.x + b.width / 2, b.y + b.height / 2];
}
async function glideTo(page, loc, ms) {
  const [x, y] = await centre(loc);
  await glide(page, x, y, ms);
}
async function clickAt(page, loc, ms = 700) {
  await glideTo(page, loc, ms);
  await sleep(140);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
// Scroll the nearest scrollable ancestor so `loc` sits `offset` px below its top, eased over `ms`.
async function scrollTo(loc, ms, offset = 0) {
  await loc.evaluate(
    (el, [ms, offset]) =>
      new Promise((res) => {
        let p = el.parentElement;
        while (p && !(p.scrollHeight > p.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
        if (!p) return res();
        const a = p.scrollTop;
        const b = Math.min(p.scrollHeight - p.clientHeight, a + el.getBoundingClientRect().top - p.getBoundingClientRect().top - offset);
        const t0 = performance.now();
        const e = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
        const f = (now) => {
          const t = Math.min(1, (now - t0) / ms);
          p.scrollTop = a + (b - a) * e(t);
          t < 1 ? requestAnimationFrame(f) : res();
        };
        requestAnimationFrame(f);
      }),
    [ms, offset],
  );
}

async function record() {
  const browser = await pw.chromium.launch({
    headless: true,
    args: ["--use-angle=vulkan", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-frame-rate-limit"],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme: "dark" });
  await ctx.addInitScript(cursorScript);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("pageerror:", e.message));
  const gl = await page.evaluate(() => {
    const g = document.createElement("canvas").getContext("webgl2");
    const x = g && g.getExtension("WEBGL_debug_renderer_info");
    return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : "none";
  });
  console.log("WebGL renderer:", gl);
  if (process.env.REQUIRE_GPU !== "0" && /swiftshader|llvmpipe|none/i.test(gl)) throw new Error("software WebGL: " + gl);
  const rec = new Rec(page, await ctx.newCDPSession(page));
  const segs = [];

  // 1. Welcome screen → navigator: the Moon with the real Sun and Earth.
  await page.goto(BASE + "/");
  const hero = page.getByRole("region", { name: "Welcome" });
  await hero.getByRole("button", { name: "Open navigator" }).waitFor();
  await page.mouse.move(cur.x, cur.y);
  await sleep(3500); // globe textures
  await rec.start();
  await sleep(1300);
  await clickAt(page, hero.getByRole("button", { name: "Open navigator" }), 1000);
  await page.getByRole("searchbox", { name: "Search sites" }).waitFor();
  await glide(page, W * 0.66, H * 0.36, 900);
  await sleep(1700);
  segs.push(await rec.stop());

  // 2. Scrub time on the bottom strip: the terminator, the Sun and the Earth move.
  await page.getByRole("button", { name: "Show 14 days" }).click();
  await sleep(800);
  const strip = page.getByRole("slider", { name: "Scrub date" });
  const sb = await strip.boundingBox();
  const sy = sb.y + sb.height * 0.75;
  await rec.start();
  await glide(page, sb.x + sb.width * 0.8, sy, 800);
  await page.mouse.down();
  await sleep(100);
  await glide(page, sb.x + sb.width * 0.3, sy, 2900); // drag left = later
  await page.mouse.up();
  await sleep(700);
  segs.push(await rec.stop());

  // 3. The polar map: select the Shackleton–de Gerlache ridge; the card has Sun, sunset, Earth windows.
  await glide(page, W * 0.5, H * 0.5, 10);
  await page.getByRole("button", { name: "South pole map" }).click();
  const map = page.getByRole("region", { name: "Navigator map" });
  await map.and(page.locator('[data-ready="1"]')).waitFor({ timeout: 20000 });
  await sleep(3000); // basemap tiles
  const ridge = page.locator('.nav-marker[data-site="cr1_connecting_ridge"] .nav-marker-dot');
  await rec.start();
  await sleep(300);
  await clickAt(page, ridge, 1100);
  const card = page.getByRole("article", { name: "Place card" });
  await card.getByRole("heading", { level: 2 }).waitFor();
  await sleep(900);
  await glideTo(page, card.getByText(/^Sunset in /).first(), 900);
  await sleep(500);
  await glideTo(page, card.getByText(/^NEXT WINDOWS|^Next windows/i).first(), 800);
  await sleep(900);
  segs.push(await rec.stop());

  // 4. Plan a mission: route alternatives ranked by score, "Best landing option".
  await rec.start();
  await clickAt(page, card.getByRole("button", { name: "Plan mission from here" }), 800);
  const panel = page.getByRole("region", { name: "Mission route" });
  const best = panel.getByTestId("best-why");
  await best.waitFor({ timeout: 20000 });
  await sleep(1000);
  await scrollTo(best, 1100, 16);
  await glideTo(page, best, 800);
  await sleep(2000);
  segs.push(await rec.stop());

  // 5. Drive profile: a waypoint on the Shackleton rim; the rover drives the LOLA terrain profile.
  if (await card.isVisible()) await card.getByRole("button", { name: "Close place card" }).click();
  const r0 = page.locator('.nav-marker[data-site="cr1_connecting_ridge"] .nav-marker-dot');
  const [rx, ry] = await centre(r0);
  await page.mouse.move(rx, ry);
  for (let k = 0; k < 6; k++) {
    await page.mouse.wheel(0, -240);
    await sleep(250);
  }
  await sleep(1500);
  await page.locator('.nav-marker[data-site="shackleton_rim"] .nav-marker-dot').click({ force: true });
  await card.getByRole("heading", { level: 2, name: /Shackleton rim/ }).waitFor();
  await card.getByRole("button", { name: "Add as waypoint" }).click();
  await sleep(500);
  await card.getByRole("button", { name: "Close place card" }).click();
  const prof = panel.locator("details.elev");
  const canvas = prof.getByTestId("elevation-profile");
  await canvas.waitFor({ timeout: 20000 });
  await sleep(1500);
  cur = { x: rx, y: ry };
  await page.mouse.move(rx, ry);
  await rec.start();
  await scrollTo(prof, 1200, 8);
  const cb = await canvas.boundingBox();
  const cy = cb.y + cb.height * 0.45;
  await glide(page, cb.x + cb.width * 0.15, cy, 700);
  for (const f of [0.35, 0.6, 0.8]) {
    await page.mouse.down();
    await page.mouse.up();
    await glide(page, cb.x + cb.width * f, cy, 900);
  }
  await page.mouse.down();
  await page.mouse.up();
  await sleep(700);
  segs.push(await rec.stop());

  // 6. NASA check: our numbers against JPL Horizons and PGDA.
  const nasa = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "NASA check", exact: true });
  const dlg = page.getByRole("dialog", { name: "NASA check" });
  await nasa.click(); // load its data off camera
  await dlg.getByRole("status").filter({ hasText: /checks pass/ }).waitFor({ timeout: 20000 });
  await dlg.getByRole("button", { name: "Close", exact: true }).click();
  await sleep(800);
  await rec.start();
  await glideTo(page, nasa, 700);
  await sleep(600); // the rail tooltip
  await clickAt(page, nasa, 100);
  await dlg.getByRole("status").filter({ hasText: /checks pass/ }).waitFor({ timeout: 20000 });
  // The summary and the Horizons cards; no scroll: the screen says what passes and what fails.
  await glideTo(page, dlg.getByRole("status").filter({ hasText: /checks pass/ }), 700);
  await sleep(600);
  await glideTo(page, dlg.getByRole("region", { name: "Sun and Earth position vs JPL Horizons", exact: true }).getByText("PASS").first(), 800);
  await sleep(900);
  segs.push(await rec.stop());

  // End card: the wordmark and the address.
  // web/src/ui/Wordmark.tsx
  const svg = `<svg viewBox="0 0 484 100" fill="currentColor" style="height:0.72em;width:auto;display:block">
    <path d="M0 0h92v17h-92zM37.5 17h17v83h-17zM112 0h17v100h-17zM149 0h17v83h-17zM149 83h70v17h-70zM239 0h17v100h-17zM396 0h17v100h-17zM467 0h17v100h-17zM396 0h20.06L484 100h-20.06z"/>
    <path fill-rule="evenodd" d="M276 50a50 50 0 1 0 100 0a50 50 0 1 0 -100 0zM281 50a36 36 0 1 0 72 0a36 36 0 1 0 -72 0z"/></svg>`;
  const card2 = await ctx.newPage();
  await card2.setViewportSize({ width: 1440, height: 810 });
  await card2.setContent(`<html><body style="margin:0;background:${BG};height:100vh;display:flex;flex-direction:column;
    align-items:center;justify-content:center;color:#ecebe6;font-family:'JetBrains Mono',monospace">
    <div style="font-size:150px;line-height:1">${svg}</div>
    <div style="margin-top:44px;font-size:30px;letter-spacing:.08em;color:#ff6a2b">tilion.nedovost.org</div>
    <div style="margin-top:18px;font-size:17px;letter-spacing:.18em;color:#8b8a85">SUN AND EARTH ABOVE THE LUNAR SOUTH-POLE HORIZON</div>
    </body></html>`);
  await card2.screenshot({ path: path.join(OUT, "end.png") });
  await browser.close();
  return segs;
}

function assemble(segs) {
  const out = path.join(OUT, "tilion-demo.mp4");
  const inputs = [];
  const parts = [];
  segs.forEach((s, i) => {
    inputs.push("-i", s);
    // Cut or hold to the beat length, then the subtitle band below the 1920×1000 page.
    parts.push(`[${i}:v]tpad=stop_mode=clone:stop_duration=6,trim=0:${BEATS[i]},setpts=PTS-STARTPTS,pad=1920:1080:0:0:color=${BG},fps=${FPS},settb=1/${FPS}[v${i}]`);
  });
  const e = segs.length;
  inputs.push("-loop", "1", "-t", String(END), "-i", path.join(OUT, "end.png"));
  parts.push(`[${e}:v]scale=1920:1080:out_range=tv,format=yuv420p,fps=${FPS},settb=1/${FPS}[v${e}]`);
  const lens = [...BEATS, END];
  let last = "v0";
  let t = lens[0];
  for (let i = 1; i < lens.length; i++) {
    const off = (t - XF).toFixed(3);
    parts.push(`[${last}][v${i}]xfade=transition=fade:duration=${XF}:offset=${off}[x${i}]`);
    last = `x${i}`;
    t = t - XF + lens[i];
  }
  const style = `FontName=${FONT},FontSize=10.5,PrimaryColour=&H00EEEEEE,Bold=0,BorderStyle=1,Outline=0,Shadow=0,Alignment=2,MarginV=7`;
  parts.push(`[${last}]subtitles='${SRT.replace(/'/g, "\\'")}':force_style='${style}',format=yuv420p[out]`);
  ff([...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-r", String(FPS), "-c:v", "libx264", "-preset", "slow",
    "-crf", "19", "-maxrate", "6M", "-bufsize", "12M", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out]);
  console.log(`total ${t.toFixed(2)} s →`, out, (fs.statSync(out).size / 1e6).toFixed(1), "MB");
  for (const s of segs) fs.rmSync(s, { force: true });
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const segs = process.env.ASSEMBLE_ONLY ? BEATS.map((_, i) => path.join(OUT, `seg${i + 1}.mp4`)) : await record();
  assemble(segs);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
