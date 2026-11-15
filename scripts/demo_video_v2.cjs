#!/usr/bin/env node
// Demo video v2 (#303): the #152 video (scripts/demo_video.cjs) plus the betas that came after it:
// the horizon panorama with the Sun, Terrain ±1σ on the place card, DSN stations in Next windows (#314),
// the smallest battery in Lander energy, Direct-to-Earth coverage vs NASA LCRNS on the NASA check screen.
// ≈ 41 s, 1920×1080, 60 fps, English subtitles, no sound. Writes tilion-demo-v2.mp4; the v1 file is left alone.
//
//   node scripts/demo_video_v2.cjs                                   # against the production site
//   BASE=http://localhost:8000 OUT=data/demo node scripts/demo_video_v2.cjs
//
// Each beat is a separate screencast segment (loads happen between segments, off camera), cut or held
// to a fixed length; the subtitles (OUT/tilion-demo-v2.srt) are written from the same beat table.
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

const BASE = process.env.BASE || "https://tilion.nedovost.org";
const OUT = path.resolve(process.env.OUT || path.join(ROOT, "data/demo"));
const SRT = path.join(OUT, "tilion-demo-v2.srt");
const FONT = process.env.SUB_FONT || "Adwaita Sans";
const W = 1440; // CSS px; ×4/3 = 1920 device px
const H = 750; //  ×4/3 = 1000 device px; the 80 px band below holds the subtitles
const DPR = 4 / 3;
const FPS = 60;
const XF = 0.3; // crossfade between beats, s
// Beats: length, s (the screencast is cut or held to it), and subtitles [text, from, to] in s from the
// beat start (to < 0: from the beat end). The numbers in the LCRNS line are checked on screen below.
const BEATS = [
  { len: 4.4, subs: [["Tilion: real Sun and Earth over the Moon", 0.15, -0.35]] },
  { len: 5.2, subs: [["Pick a site: Sun, sunset, Earth windows", 0.2, -0.35]] },
  { len: 6.0, subs: [["Scrub time. DSN stations: Moon elevation and the next link", 0.2, -0.35]] },
  { len: 4.4, subs: [["Terrain ±1σ: the LOLA height error as a range", 0.2, -0.35]] },
  { len: 5.0, subs: [["Horizon from 2 m: the Sun's path over the terrain", 0.2, -0.35]] },
  { len: 4.6, subs: [["Lander energy: battery and panel sizing for 30 days", 0.2, -0.35]] },
  { len: 4.6, subs: [["Plan a mission: alternatives ranked by score", 0.2, -0.35]] },
  {
    len: 7.8,
    subs: [
      ["Our numbers against JPL Horizons and PGDA", 0.2, 4.0],
      ["Earth contact vs NASA LCRNS: 42.0 % vs 43 %, 16.9 % vs 17 %", 4.2, -0.35],
    ],
  },
];
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
// Glide to a point of `loc` given as fractions of its box: keeps the cursor off the numbers.
async function glideAt(page, loc, fx, fy, ms) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("no box: " + loc);
  await glide(page, b.x + b.width * fx, b.y + b.height * fy, ms);
}
async function clickAt(page, loc, ms = 700) {
  await glideTo(page, loc, ms);
  await sleep(140);
  await page.mouse.down();
  await sleep(70);
  await page.mouse.up();
}
// Scroll the nearest scrollable ancestor so `loc` sits `offset` px below its top, eased over `ms`.
// A negative offset puts the bottom of `loc` that many px above the bottom of the scroller.
async function scrollTo(loc, ms, offset = 0) {
  await loc.evaluate(
    (el, [ms, offset]) =>
      new Promise((res) => {
        let p = el.parentElement;
        while (p && !(p.scrollHeight > p.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(p).overflowY))) p = p.parentElement;
        if (!p) return res();
        const a = p.scrollTop;
        const er = el.getBoundingClientRect();
        const pr = p.getBoundingClientRect();
        const d = offset >= 0 ? er.top - pr.top - offset : er.bottom - pr.bottom - offset;
        const b = Math.max(0, Math.min(p.scrollHeight - p.clientHeight, a + d));
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
  const SITE = "cr1_connecting_ridge"; // Shackleton–de Gerlache ridge, the LCRNS "Spudis Ridge Peak" row

  // 1. Welcome screen → navigator: the Moon with the real Sun and Earth.
  await page.goto(BASE + "/");
  const hero = page.getByRole("region", { name: "Welcome" });
  await hero.getByRole("button", { name: "Open navigator" }).waitFor();
  await page.mouse.move(cur.x, cur.y);
  await sleep(3500); // globe textures
  await rec.start();
  await sleep(1100);
  await clickAt(page, hero.getByRole("button", { name: "Open navigator" }), 1000);
  await page.getByRole("searchbox", { name: "Search sites" }).waitFor();
  await glide(page, W * 0.66, H * 0.36, 900);
  await sleep(1500);
  segs.push(await rec.stop());

  // 2. Pick a site on the polar map: the card has Sun, sunset and the next Earth windows.
  await glide(page, W * 0.5, H * 0.5, 10);
  await page.getByRole("button", { name: "South pole map" }).click();
  const map = page.getByRole("region", { name: "Navigator map" });
  await map.and(page.locator('[data-ready="1"]')).waitFor({ timeout: 20000 });
  await sleep(1500);
  // Off camera: zoom in at the ridge, so the Shackleton rim marker no longer covers it.
  const dot = page.locator(`.nav-marker[data-site="${SITE}"] .nav-marker-dot`);
  {
    const [zx, zy] = await centre(dot);
    await page.mouse.move(zx, zy);
    for (let k = 0; k < 3; k++) {
      await page.mouse.wheel(0, -240);
      await sleep(250);
    }
    await page.mouse.move(cur.x, cur.y);
  }
  await sleep(3000); // basemap tiles
  await rec.start();
  await sleep(300);
  await clickAt(page, dot, 1100);
  const card = page.getByRole("article", { name: "Place card" });
  await card.getByRole("heading", { level: 2, name: /de Gerlache ridge/ }).waitFor();
  await sleep(900);
  await glideTo(page, card.getByText(/^Sunset in /).first(), 900);
  await sleep(500);
  await glideTo(page, card.getByText(/^NEXT WINDOWS|^Next windows/i).first(), 800);
  await sleep(900);
  segs.push(await rec.stop());

  // 3. Scrub time by dragging the strip; each Earth window in Next windows names its DSN stations.
  const strip = page.getByRole("slider", { name: "Scrub date" });
  await strip.focus();
  for (let k = 0; k < 4; k++) await strip.press("-"); // off camera: zoom the strip out to ~15 days
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await sleep(800);
  const sb = await strip.boundingBox();
  const sy = sb.y + sb.height * 0.5;
  await rec.start();
  await glide(page, sb.x + sb.width * 0.8, sy, 700);
  await page.mouse.down();
  await sleep(100);
  await glide(page, sb.x + sb.width * 0.35, sy, 1800); // drag left = later
  await page.mouse.up();
  await sleep(400);
  // The DSN stations panel of the card (#448): Moon elevation at each complex and the next link.
  const next = card.getByText(/^Next link via/).first();
  const dsnHead = card.getByText("DSN stations", { exact: true }).first();
  if (await next.count()) await glideAt(page, next, 0.85, 0.5, 800); // right of the line, off the text
  else await glideAt(page, dsnHead, 1.3, 0.5, 800);
  await sleep(1800);
  segs.push(await rec.stop());

  // 4. Terrain ±1σ on the same card: Sun and Earth shares with the LOLA height error as a range.
  const unc = card.getByLabel("DEM error range");
  await unc.waitFor({ timeout: 20000 });
  await rec.start();
  await sleep(200);
  await scrollTo(unc, 1100, 90);
  await glideAt(page, unc, 0.8, 0.88, 800); // right of "(no change)", off the numbers
  await sleep(2100);
  segs.push(await rec.stop());

  // 5. Horizon view: the LOLA skyline from 2 m with the Sun's and the Earth's paths.
  const hv = card.getByRole("button", { name: "Horizon view" });
  await scrollTo(hv, 10, -12);
  await sleep(400);
  const hz = page.getByRole("region", { name: "Horizon panorama" });
  const mask = hz.getByLabel(/^Horizon mask with Sun and Earth tracks/);
  await rec.start();
  await clickAt(page, hv, 800);
  await mask.waitFor({ timeout: 20000 });
  await sleep(500);
  await scrollTo(mask, 1100, 40);
  const mb = await mask.boundingBox();
  await glide(page, mb.x + mb.width * 0.3, mb.y + mb.height * 0.2, 700); // above the tracks
  await glide(page, mb.x + mb.width * 0.7, mb.y + mb.height * 0.2, 1200);
  await sleep(500);
  segs.push(await rec.stop());

  // 6. Lander energy on the same screen: the battery curve and the smallest battery that survives.
  const energy = hz.getByRole("region", { name: "Lander energy" });
  const small = energy.getByLabel("Smallest battery");
  await small.waitFor({ timeout: 20000 });
  await rec.start();
  await scrollTo(energy, 1100, 12);
  await glideAt(page, small, 0.62, 0.5, 800); // right of the text
  await sleep(700);
  const dark = energy.getByLabel("Longest dark spell"); // absent when the panel never stops
  if (await dark.count()) await glideAt(page, dark, 0.62, 0.5, 600);
  await sleep(1100);
  segs.push(await rec.stop());

  // 7. Plan a mission: route alternatives ranked by score, "Best landing option".
  await page.getByRole("button", { name: "Close", exact: true }).first().click();
  await hz.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  const plan = card.getByRole("button", { name: "Plan mission from here" });
  await scrollTo(plan, 10, -12);
  await sleep(600);
  await rec.start();
  await clickAt(page, plan, 800);
  const panel = page.getByRole("region", { name: "Mission route" });
  const best = panel.getByTestId("best-why");
  await best.waitFor({ timeout: 20000 });
  await sleep(1000);
  await scrollTo(best, 1100, 16);
  await glideTo(page, best, 800);
  await sleep(1800);
  segs.push(await rec.stop());

  // 8. NASA check: the summary against JPL Horizons and PGDA, then Direct-to-Earth coverage vs NASA LCRNS.
  const nasa = page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "NASA check", exact: true });
  const dlg = page.getByRole("dialog", { name: "NASA check" });
  const pass = dlg.getByRole("status").filter({ hasText: /checks pass/ });
  const lcrns = dlg.getByRole("region", { name: /Direct-to-Earth coverage vs NASA LCRNS/ });
  await nasa.click(); // load its data off camera
  await pass.waitFor({ timeout: 20000 });
  await lcrns.waitFor({ timeout: 20000 });
  const lt = (await lcrns.textContent()).replace(/[\u00a0\u2009\u202f]/g, " "); // the UI uses thin spaces before %
  for (const n of ["42.0 %", "43 %", "16.9 %", "17 %"]) if (!lt.includes(n)) throw new Error(`LCRNS block has no ${n}; fix the subtitle`);
  await dlg.getByRole("button", { name: "Close", exact: true }).click();
  await sleep(800);
  await rec.start();
  await glideTo(page, nasa, 700);
  await sleep(400);
  await clickAt(page, nasa, 100);
  await pass.waitFor({ timeout: 20000 });
  await glideTo(page, pass, 600);
  await sleep(500);
  await scrollTo(lcrns, 1200, 4);
  const cards = lcrns.locator("article");
  await glideAt(page, cards.nth(0), 0.4, 0.34, 700); // between "Ours" and "NASA LCRNS"
  await sleep(900);
  await glideAt(page, cards.nth(1), 0.4, 0.34, 700);
  await sleep(1300);
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

// Subtitles from the beat table: beat i starts where the crossfade into it starts.
function writeSrt() {
  const ts = (t) => {
    const ms = Math.round(t * 1000);
    const p = (n, w = 2) => String(n).padStart(w, "0");
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  const out = [];
  let t0 = 0;
  BEATS.forEach((b) => {
    const end = t0 + b.len;
    for (const [text, from, to] of b.subs) {
      if (text.includes("\u00b7")) throw new Error("no middle dot in subtitles: " + text);
      out.push(`${out.length / 4 + 1}`, `${ts(t0 + from)} --> ${ts(to < 0 ? end + to : t0 + to)}`, text, "");
    }
    t0 += b.len - XF;
  });
  fs.writeFileSync(SRT, out.join("\n"));
}

function assemble(segs) {
  const out = path.join(OUT, "tilion-demo-v2.mp4");
  writeSrt();
  const inputs = [];
  const parts = [];
  segs.forEach((s, i) => {
    inputs.push("-i", s);
    // Cut or hold to the beat length, then the subtitle band below the 1920×1000 page.
    parts.push(`[${i}:v]tpad=stop_mode=clone:stop_duration=6,trim=0:${BEATS[i].len},setpts=PTS-STARTPTS,pad=1920:1080:0:0:color=${BG},fps=${FPS},settb=1/${FPS}[v${i}]`);
  });
  const e = segs.length;
  inputs.push("-loop", "1", "-t", String(END), "-i", path.join(OUT, "end.png"));
  parts.push(`[${e}:v]scale=1920:1080:out_range=tv,format=yuv420p,fps=${FPS},settb=1/${FPS}[v${e}]`);
  const lens = [...BEATS.map((b) => b.len), END];
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
  if (!process.env.KEEP_SEGS) for (const s of segs) fs.rmSync(s, { force: true });
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
