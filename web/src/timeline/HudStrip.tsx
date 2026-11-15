// Time scrubber (#58, #158): the centre marker is fixed and is the shared moment; the scale scrolls
// under it. Two bands show the site's hours: Sun-lit (top) and Earth in view (bottom); their edges
// are the rise and set events (hover names them, a click jumps there). Pins mark the landing, the
// window end and the option. Everything draws on one canvas in requestAnimationFrame; drag, inertia
// and easing live in refs, and the app hears the moment at most once per animation frame.
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { Hours, SiteHours } from "../route/hours";
import {
  bandRuns,
  clampCentre,
  clampSpan,
  clampUtc,
  DAY,
  dragSlip,
  edgePin,
  eventsIn,
  fmtDay,
  fmtHud,
  fmtOffset,
  fmtSlip,
  HOUR,
  hudTicks,
  landingFor,
  LUNAR_DAY_H,
  placeLabels,
  stepUtc,
  T0,
  T1,
  T_END,
  type EventKind,
  type Pin,
} from "./time";

/** Colours and the label font come from the CSS variables of styles.css :root (#94); no colours here. */
export type Palette = {
  fg: string;
  muted: string;
  dim: string;
  bg: string;
  panel: string;
  line: string;
  accent: string;
  sun: string;
  earth: string;
  mono: string;
};
export function readPalette(): Palette {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  const muted = v("--muted", "grey");
  return {
    fg: v("--fg", "white"),
    muted,
    dim: v("--dim", muted),
    bg: v("--bg", "black"),
    panel: v("--panel", "black"),
    line: v("--line", muted),
    accent: v("--accent", "white"),
    sun: v("--sun", "white"),
    earth: v("--earth", "white"),
    mono: v("--font-mono", "ui-monospace, monospace"),
  };
}
export const PIN_LABEL: Record<Pin["kind"], string> = {
  landing: "Landing",
  end: "Window end",
  option: "Option landing",
  sunrise: "Sunrise",
  sunset: "Sunset",
  earthrise: "Earthrise",
  earthset: "Earthset",
};
export const H = 62; // canvas height, CSS px
// Rows, top to bottom: window dimension line, mission pins, Sun band, Earth band, ticks, numbers.
const WIN_Y = 4;
const PIN_Y = 11;
export const SUN_Y = 19;
export const EARTH_Y = 28;
const BAND_H = 6;
const LINE_Y = EARTH_Y + BAND_H; // bottom of the bands: pin stems end here
const TICK_Y = 37;
const LABEL_Y = 53;
/** Row of an event pin: the edge of its band. */
const pinY = (kind: Pin["kind"]) =>
  kind === "sunrise" || kind === "sunset" ? SUN_Y + BAND_H / 2 : kind === "earthrise" || kind === "earthset" ? EARTH_Y + BAND_H / 2 : PIN_Y;
const isEvent = (kind: Pin["kind"]) => pinY(kind) !== PIN_Y;

/** The mission window on the strip, in ms. */
export type HudWin = { landing: number; original: number; durationDays: number; bounds: [number, number]; slip: number };
export type ExtraPin = { utc: string; label: string; color: string }; // color: a CSS colour, e.g. "var(--g-clps)"

type Props = {
  hours: Hours | null;
  siteId: string | null;
  atUtc: string;
  onAtUtc: (utc: string) => void;
  spanMs: number;
  onSpan: (ms: number) => void;
  playMs: number | null; // Play tick length: the strip glides linearly between ticks
  win: HudWin | null;
  option: { utc: string; label: string } | null;
  extraPins?: ExtraPin[]; // other missions' landings (#73)
  onMoveLanding: (utc: string) => void;
};

type Drag =
  | { kind: "scrub"; x0: number; c0: number; moved: number; samples: [number, number][] }
  | { kind: "landing"; x0: number; slip: number; moved: number };
type Anim = { from: number; to: number; t0: number; dur: number; linear: boolean };
type Drawn = { x: number; y: number; t: number; kind: Pin["kind"]; n: number; label?: string };

export function HudStrip(p: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef(p);
  props.current = p;
  const size = useRef({ w: 0, dpr: 1 });
  const centre = useRef(Date.parse(p.atUtc)); // float ms at the fixed marker
  const anim = useRef<Anim | null>(null);
  const drag = useRef<Drag | null>(null);
  const inertia = useRef<{ v: number; last: number } | null>(null);
  const hover = useRef<number | null>(null);
  const drawn = useRef<Drawn[]>([]);
  const frame = useRef(0);
  const pending = useRef(false);
  const wheelIdle = useRef(0);
  const pinsAttr = useRef("");

  // While the strip moves the app hears the moment once per animation frame (the frame flushes
  // the pending value); a release or a click tells it at once.
  const emitNow = useCallback((t: number) => {
    pending.current = false;
    const utc = clampUtc(t);
    if (utc !== props.current.atUtc) props.current.onAtUtc(utc);
  }, []);

  const tick = useCallback(
    (now: number) => {
      frame.current = 0;
      let more = false;
      if (!Number.isFinite(centre.current)) centre.current = Date.parse(props.current.atUtc);
      const a = anim.current;
      if (a) {
        // rAF time can be a little earlier than t0: clamp, and a zero duration is a jump.
        const k = a.dur > 0 ? Math.min(1, Math.max(0, (now - a.t0) / a.dur)) : 1;
        const e = a.linear ? k : 1 - (1 - k) ** 3;
        centre.current = a.from + (a.to - a.from) * e;
        if (k >= 1) anim.current = null;
        else more = true;
      }
      const g = inertia.current;
      if (g) {
        const dt = Math.min(48, now - g.last);
        g.last = now;
        const ms = props.current.spanMs / Math.max(1, size.current.w);
        const before = centre.current;
        centre.current = clampCentre(centre.current - g.v * dt * ms);
        g.v *= Math.exp(-dt / 325);
        pending.current = true;
        if (Math.abs(g.v) > 0.02 && centre.current !== before) more = true;
        else {
          inertia.current = null;
          settle();
        }
      }
      if (pending.current) emitNow(centre.current);
      paint();
      if (more) frame.current = requestAnimationFrame(tick);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [emitNow],
  );
  const request = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(tick);
  }, [tick]);

  /** Snap to the whole hour after a scrub, ease there and tell the app. */
  const settle = () => {
    const to = Date.parse(clampUtc(centre.current));
    anim.current = { from: centre.current, to, t0: performance.now(), dur: 180, linear: false };
    emitNow(to);
    request();
  };
  const glideTo = (to: number, dur: number, linear = false) => {
    anim.current = { from: centre.current, to, t0: performance.now(), dur, linear };
    request();
  };

  // Size the backing store to the element and the device pixel ratio.
  useLayoutEffect(() => {
    const c = canvasRef.current!;
    const fit = () => {
      const w = Math.round(c.parentElement!.getBoundingClientRect().width);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      size.current = { w, dpr };
      c.width = Math.round(w * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${H}px`;
      paint();
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(c.parentElement!);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The moment changed outside the strip (Play, buttons, picker): glide there.
  useEffect(() => {
    if (drag.current || inertia.current) return;
    const to = Date.parse(p.atUtc);
    if (Math.abs(to - centre.current) < 1) return request();
    if (p.playMs) glideTo(to, p.playMs, true);
    else glideTo(to, Math.abs(to - centre.current) > 20 * DAY ? 0 : 240);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.atUtc]);
  useEffect(request, [p.hours, p.siteId, p.spanMs, p.win, p.option, p.extraPins, request]);

  // Wheel: scrub; ctrl or shift + wheel: zoom. Not passive: the page must not scroll.
  useEffect(() => {
    const c = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pr = props.current;
      if (e.ctrlKey || e.shiftKey) {
        pr.onSpan(clampSpan(pr.spanMs * Math.exp((e.deltaY || e.deltaX) * 0.0025)));
        return;
      }
      anim.current = null;
      inertia.current = null;
      const ms = pr.spanMs / Math.max(1, size.current.w);
      centre.current = clampCentre(centre.current + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * ms * 0.6);
      pending.current = true;
      request();
      clearTimeout(wheelIdle.current);
      wheelIdle.current = window.setTimeout(settle, 160);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emitNow, request]);

  const msPerPx = () => props.current.spanMs / Math.max(1, size.current.w);
  const xToT = (x: number) => centre.current + (x - size.current.w / 2) * msPerPx();
  const hitPin = (x: number, y: number) => {
    let best: Drawn | null = null;
    for (const d of drawn.current) {
      const dx = Math.abs(d.x - x);
      const dy = isEvent(d.kind) ? Math.abs(y - d.y) <= 5 : y >= d.y - 9 && y <= LINE_Y + 3;
      if (dx <= 7 && dy && (!best || dx < Math.abs(best.x - x))) best = d;
    }
    return best;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const x = e.nativeEvent.offsetX;
    const y = e.nativeEvent.offsetY;
    e.currentTarget.setPointerCapture(e.pointerId);
    anim.current = null;
    inertia.current = null;
    const pin = hitPin(x, y);
    const win = props.current.win;
    if (pin?.kind === "landing" && win) drag.current = { kind: "landing", x0: x, slip: win.slip, moved: 0 };
    else drag.current = { kind: "scrub", x0: x, c0: centre.current, moved: 0, samples: [[e.timeStamp, x]] };
    e.currentTarget.style.cursor = "grabbing";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const x = e.nativeEvent.offsetX;
    const d = drag.current;
    if (!d) {
      const pin = hitPin(x, e.nativeEvent.offsetY);
      hover.current = pin ? pin.t : null;
      e.currentTarget.style.cursor = pin ? (pin.kind === "landing" ? "ew-resize" : "pointer") : "grab";
      request();
      return;
    }
    d.moved = Math.max(d.moved, Math.abs(x - d.x0));
    if (d.kind === "scrub") {
      d.samples.push([e.timeStamp, x]);
      if (d.samples.length > 6) d.samples.shift();
      centre.current = clampCentre(d.c0 - (x - d.x0) * msPerPx());
      pending.current = true;
    } else {
      const w = props.current.win!;
      d.slip = dragSlip(w.slip, x - d.x0, msPerPx(), w.bounds);
    }
    request();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    e.currentTarget.style.cursor = "grab";
    if (!d) return;
    const x = e.nativeEvent.offsetX;
    const pr = props.current;
    if (d.moved < 4) {
      // A click: jump to the pin under the pointer, else to the time under it.
      const pin = hitPin(x, e.nativeEvent.offsetY);
      const to = Date.parse(clampUtc(pin ? pin.t : xToT(x)));
      glideTo(to, 260);
      emitNow(to);
      return;
    }
    if (d.kind === "landing") {
      const w = pr.win!;
      if (d.slip !== w.slip) pr.onMoveLanding(landingFor(new Date(w.original).toISOString(), d.slip));
      request();
      return;
    }
    const [t0, x0] = d.samples[0];
    const [t1, x1] = d.samples[d.samples.length - 1];
    const v = t1 > t0 && e.timeStamp - t1 < 80 ? (x1 - x0) / (t1 - t0) : 0;
    if (Math.abs(v) > 0.08) {
      inertia.current = { v, last: performance.now() };
      request();
    } else settle();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const pr = props.current;
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight") pr.onAtUtc(stepUtc(pr.atUtc, (k === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 24 : 1)));
    else if (k === "PageUp" || k === "PageDown") pr.onAtUtc(stepUtc(pr.atUtc, (k === "PageUp" ? -1 : 1) * LUNAR_DAY_H));
    else if (k === "Home") pr.onAtUtc(clampUtc(T0));
    else if (k === "End") pr.onAtUtc(clampUtc(T1));
    else if (k === "+" || k === "=" || k === "-") pr.onSpan(clampSpan(pr.spanMs * (k === "-" ? 1.5 : 1 / 1.5)));
    else return;
    e.preventDefault();
  };

  function paint() {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx || !size.current.w) return;
    const out = drawHud(ctx, size.current.w, size.current.dpr, centre.current, props.current, drag.current, hover.current, readPalette());
    drawn.current = out;
    // Rows under the strip (e.g. a beta band) follow the scale through this event.
    c.dispatchEvent(new CustomEvent("hudview", { bubbles: true, detail: { centre: centre.current, spanMs: props.current.spanMs, w: size.current.w } }));
    // Test and assistive hook: visible pins as "kind:x:t:y".
    const attr = out.map((d) => `${d.kind}:${Math.round(d.x)}:${d.t}:${d.y}`).join(" ");
    if (attr !== pinsAttr.current) {
      pinsAttr.current = attr;
      c.dataset.pins = attr;
    }
    const pr = props.current;
    if (pr.win) {
      const slip = drag.current?.kind === "landing" ? drag.current.slip : pr.win.slip;
      c.dataset.landingX = String(Math.round(size.current.w / 2 + (pr.win.original + slip * DAY - centre.current) / msPerPx()));
    } else delete c.dataset.landingX;
  }

  const t = Date.parse(p.atUtc);
  return (
    <canvas
      ref={canvasRef}
      className="hud-canvas"
      tabIndex={0}
      role="slider"
      aria-label="Scrub date"
      aria-valuemin={0}
      aria-valuemax={Math.round((T1 - T0) / HOUR)}
      aria-valuenow={Math.round((t - T0) / HOUR)}
      aria-valuetext={fmtHud(t)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={() => {
        hover.current = null;
        request();
      }}
      onKeyDown={onKeyDown}
    />
  );
}

/** Rise and set pins of a site over [a, b] plus the mission pins. */
export function pinsFor(hours: Hours | null, s: SiteHours | undefined, a: number, b: number, win: HudWin | null, landing: number | null): Pin[] {
  const pins: Pin[] = [];
  if (hours && s) {
    const step = hours.stepMin * 60_000;
    const i0 = Math.floor((a - hours.startMs) / step);
    const i1 = Math.ceil((b - hours.startMs) / step);
    for (const e of eventsIn(s.codes, i0, i1)) pins.push({ t: hours.startMs + e.i * step, kind: e.kind });
  }
  if (win && landing !== null) {
    pins.push({ t: landing, kind: "landing" });
    pins.push({ t: landing + win.durationDays * DAY, kind: "end" });
  }
  return pins.sort((x, y) => x.t - y.t);
}

function drawHud(
  ctx: CanvasRenderingContext2D,
  w: number,
  dpr: number,
  c: number,
  p: Props,
  drag: Drag | null,
  hoverT: number | null,
  P: Palette,
): Drawn[] {
  const MONO = P.mono;
  const spacing = (px: number) => {
    if ("letterSpacing" in ctx) (ctx as { letterSpacing: string }).letterSpacing = `${px}px`;
  };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, H);
  ctx.globalAlpha = 1;
  const ms = p.spanMs / w;
  const a = c - (w / 2) * ms;
  const b = c + (w / 2) * ms;
  const X = (t: number) => w / 2 + (t - c) / ms;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Mission window: a dimension line above the bands, |———|, with the slip range while dragging.
  const win = p.win;
  const slip = drag?.kind === "landing" ? drag.slip : (win?.slip ?? 0);
  const landing = win ? win.original + slip * DAY : null;
  if (win && landing !== null) {
    const x0 = X(landing);
    const x1 = X(landing + win.durationDays * DAY);
    ctx.fillStyle = drag?.kind === "landing" ? P.earth : P.muted;
    ctx.fillRect(x0, WIN_Y, x1 - x0, 1);
    ctx.fillRect(x1 - 0.5, WIN_Y - 3, 1, 7);
    if (drag?.kind === "landing") {
      const s0 = X(win.original + win.bounds[0] * DAY);
      const s1 = X(win.original + win.bounds[1] * DAY);
      ctx.strokeStyle = P.dim;
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(s0, WIN_Y + 0.5);
      ctx.lineTo(s1, WIN_Y + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (slip !== 0 && win.original >= a && win.original <= b) {
      // The original plan as a ghost tick.
      ctx.fillStyle = P.dim;
      ctx.fillRect(X(win.original) - 0.5, WIN_Y - 3, 1, LINE_Y - WIN_Y + 3);
    }
  }

  // The two bands of the site: Sun-lit and Earth in view, hour by hour.
  if (p.siteId) drawBands(ctx, { start: a, msPerPx: ms }, w, p.hours, p.siteId, P);

  // Mission pins (landing, window end, option) and the rise / set events at the band edges.
  // Events have no glyph: the band edge is the mark; they stay hit targets for hover and click.
  const s = p.siteId ? p.hours?.sites.get(p.siteId) : undefined;
  const all = pinsFor(p.hours, s, a - p.spanMs * 3, b + p.spanMs * 3, win, landing);
  if (p.option) all.push({ t: Date.parse(p.option.utc), kind: "option" });
  const drawnPins: Drawn[] = all.filter((q) => q.t >= a && q.t <= b).map((q) => ({ x: X(q.t), y: pinY(q.kind), t: q.t, kind: q.kind, n: 1 }));
  for (const e of p.extraPins ?? []) {
    const t = Date.parse(e.utc);
    if (t >= a && t <= b) glyph(ctx, X(t), PIN_Y, resolveColor(e.color), "dot", 1, P);
  }
  for (const d of drawnPins) if (!isEvent(d.kind)) glyph(ctx, d.x, d.y, markerColor(P, d.kind, drag?.kind === "landing"), d.kind, 1, P);
  if (win && landing !== null && landing >= a && landing <= b) {
    ctx.font = `600 9px ${MONO}`;
    spacing(1.2);
    ctx.fillStyle = drag?.kind === "landing" ? P.earth : P.fg;
    ctx.textAlign = "left";
    ctx.fillText(slip !== 0 || drag?.kind === "landing" ? `LDG ${fmtSlip(slip).toUpperCase()}` : "LDG", X(landing) + 8, PIN_Y - 4);
    ctx.textAlign = "center";
    spacing(0);
  }

  // Mission pins beyond the span: clamped to the edge of the pin row with their offset ("LDG +6 D ›").
  const mission = all.filter((q) => !isEvent(q.kind));
  for (const side of [-1, 1] as const) {
    const q = edgePin(mission, a, b, side);
    if (!q) continue;
    const name = q.kind === "landing" ? "LDG" : q.kind === "end" ? "END" : "OPT";
    const text = `${name} ${fmtOffset(q.t - c).toUpperCase()}`;
    ctx.font = `500 9px ${MONO}`;
    spacing(0.6);
    const tw = ctx.measureText(text).width;
    const gx = side < 0 ? 6 : w - 6;
    const tx = side < 0 ? gx + 9 : gx - 9 - tw;
    ctx.fillStyle = P.bg;
    ctx.fillRect(side < 0 ? 0 : tx - 4, PIN_Y - 7, tw + 21, 14);
    glyph(ctx, gx, PIN_Y, markerColor(P, q.kind, false), q.kind, 1, P);
    ctx.fillStyle = P.muted;
    ctx.textAlign = "left";
    ctx.fillText(side < 0 ? `‹ ${text}` : `${text} ›`, side < 0 ? tx : tx - 2, PIN_Y);
    ctx.textAlign = "center";
    spacing(0);
    drawnPins.push({ x: gx, y: PIN_Y, t: q.t, kind: q.kind, n: 1 });
  }

  // Scale: ticks under the bands, numbers under the ticks. Labels never overlap: majors first,
  // a label that would touch a placed one is skipped, and none is cut by the strip's ends.
  const ticks = hudTicks(a - 40 * ms, b + 40 * ms, ms);
  const fontOf = (level: number) => `${level === 2 ? 600 : 400} ${level === 2 ? 11 : 10}px ${MONO}`;
  const items = ticks.map((k) => {
    if (!k.label) return { x: X(k.t), w: 0, level: -1 };
    ctx.font = fontOf(k.level);
    spacing(k.level === 2 ? 1.3 : 0.6);
    return { x: X(k.t), w: ctx.measureText(k.label).width, level: k.level };
  });
  spacing(0);
  const show = placeLabels(items, [
    [-Infinity, 0],
    [w, Infinity],
  ]);
  ticks.forEach((k, i) => {
    const x = Math.round(X(k.t)) + 0.5;
    if (x < 0 || x > w) return;
    const len = k.level === 2 ? 9 : k.level === 1 ? 6 : 3;
    ctx.fillStyle = k.level === 0 ? P.dim : k.level === 1 ? P.muted : P.fg;
    ctx.fillRect(x - 0.5, TICK_Y, 1, len);
    if (!k.label || !show[i]) return;
    ctx.font = fontOf(k.level);
    spacing(k.level === 2 ? 1.3 : 0.6);
    ctx.fillStyle = k.level === 2 ? P.fg : P.muted;
    ctx.fillText(k.label, x, LABEL_Y);
    spacing(0);
  });

  // The fixed centre index: a line through the bands and the scale, a notch on top (the shared moment).
  const cx = Math.round(w / 2) + 0.5;
  ctx.fillStyle = P.accent;
  ctx.fillRect(cx - 0.5, 4, 1, TICK_Y + 10 - 4);
  ctx.beginPath();
  ctx.moveTo(cx - 4, 0);
  ctx.lineTo(cx + 4, 0);
  ctx.lineTo(cx, 5);
  ctx.closePath();
  ctx.fill();

  // Hover callout: a thin square around the pin, a leader line and a boxed mono caption.
  const hov = hoverT !== null ? drawnPins.find((d) => d.t === hoverT) : null;
  if (hov && !drag) {
    const ref = win && landing !== null && hov.kind !== "landing" ? landing : c;
    const rel = `${fmtOffset(hov.t - ref)}${ref === c ? " from now" : " from landing"}`;
    const text = `${PIN_LABEL[hov.kind]}: ${rel}, ${fmtDay(hov.t)} ${new Date(hov.t).toISOString().slice(11, 16)}`.toUpperCase();
    const color = markerColor(P, hov.kind, false);
    ctx.font = `500 9.5px ${MONO}`;
    spacing(0.6);
    const tw = ctx.measureText(text).width + 12;
    const right = hov.x + 26 + tw <= w;
    const bx = right ? hov.x + 26 : hov.x - 26 - tw;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(hov.x) - 5.5, hov.y - 5.5, 11, 11);
    ctx.beginPath();
    ctx.moveTo(hov.x + (right ? 5 : -5), hov.y - 5);
    ctx.lineTo(right ? bx : bx + tw, 7);
    ctx.stroke();
    ctx.fillStyle = P.bg;
    ctx.fillRect(bx, 0.5, tw, 13);
    ctx.strokeRect(Math.round(bx) + 0.5, 0.5, Math.round(tw) - 1, 13);
    ctx.fillStyle = P.fg;
    ctx.textAlign = "left";
    ctx.fillText(text, bx + 6, 7.5);
    ctx.textAlign = "center";
    spacing(0);
  }
  return drawnPins;
}

/** Marker colour: Sun events --sun, Earth events --earth, the landing white (blue while dragged). */
function markerColor(P: Palette, kind: Pin["kind"], active: boolean): string {
  if (kind === "landing") return active ? P.earth : P.accent;
  if (kind === "sunrise" || kind === "sunset") return P.sun;
  if (kind === "earthrise" || kind === "earthset") return P.earth;
  return P.muted;
}

/** A CSS colour for canvas: var(--x) is read from :root. */
function resolveColor(color: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(color.trim());
  return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() : color;
}

/** Small glyphs of the pin row: the landing diamond (filled), the option (outline), the window end bar, a dot. */
function glyph(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, kind: Pin["kind"] | "dot", n: number, P: Palette) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (kind === "landing" || kind === "option") {
    ctx.moveTo(x, y - 5);
    ctx.lineTo(x + 5, y);
    ctx.lineTo(x, y + 5);
    ctx.lineTo(x - 5, y);
    ctx.closePath();
    if (kind === "landing") ctx.fill();
    else ctx.stroke();
    ctx.fillRect(x - 0.5, y + 5, 1, LINE_Y - y - 5); // stem to the line
  } else if (kind === "end") {
    ctx.fillRect(x - 0.5, y - 4, 1, LINE_Y - y + 4);
    ctx.fillRect(x - 4, y - 4, 4, 1);
  } else {
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineWidth = 1;
  if (n > 1) {
    ctx.font = `600 8.5px ${P.mono}`;
    ctx.fillStyle = P.muted;
    ctx.textAlign = "left";
    ctx.fillText(`+${n - 1}`, x + 6, y - 3);
    ctx.textAlign = "center";
  }
}

/** The Sun-lit band (bit 1) and the Earth-in-view band (bit 2) of one site. Whole-hour runs when an
 *  hour is wider than a pixel; else each pixel column is shaded by its share of hours (prefix sums).
 *  A faint track marks the data range; outside it the bands are empty. */
export function drawBands(
  ctx: CanvasRenderingContext2D,
  v: { start: number; msPerPx: number },
  pw: number,
  hours: Hours | null,
  id: string,
  P: Palette,
) {
  const X = (t: number) => (t - v.start) / v.msPerPx;
  const s = hours?.sites.get(id);
  const x0 = Math.max(0, X(T0));
  const x1 = Math.min(pw, X(T_END));
  ctx.fillStyle = P.line;
  ctx.globalAlpha = s || !hours ? 1 : 0.4; // no timeline for this site: a fainter track
  if (x1 > x0) for (const y of [SUN_Y, EARTH_Y]) ctx.fillRect(x0, y, x1 - x0, BAND_H);
  ctx.globalAlpha = 1;
  if (!hours || !s) return;
  const step = hours.stepMin * 60_000;
  const hourPx = step / v.msPerPx;
  const bands = [
    { bit: 1, y: SUN_Y, color: P.sun, pre: s.sunPre },
    { bit: 2, y: EARTH_Y, color: P.earth, pre: s.earthPre },
  ];
  for (const band of bands) {
    ctx.fillStyle = band.color;
    if (hourPx >= 1) {
      const path = new Path2D();
      const i0 = Math.max(0, Math.floor((v.start - hours.startMs) / step));
      const i1 = Math.min(hours.n, Math.ceil((v.start + pw * v.msPerPx - hours.startMs) / step) + 1);
      for (const [i, j] of bandRuns(s.codes, band.bit, i0, i1)) {
        const xa = X(hours.startMs + i * step);
        const xb = X(hours.startMs + j * step);
        path.rect(xa, band.y, Math.max(1, xb - xa), BAND_H);
      }
      ctx.fill(path);
    } else {
      const n = s.codes.length;
      for (let x = 0; x < pw; x++) {
        const i = Math.max(0, Math.min(n, Math.floor((v.start + x * v.msPerPx - hours.startMs) / step)));
        const j = Math.max(i, Math.min(n, Math.floor((v.start + (x + 1) * v.msPerPx - hours.startMs) / step)));
        if (j <= i) continue;
        const share = (band.pre[j] - band.pre[i]) / (j - i);
        if (share <= 0.02) continue;
        ctx.globalAlpha = share;
        ctx.fillRect(x, band.y, 1, BAND_H);
      }
      ctx.globalAlpha = 1;
    }
  }
}
