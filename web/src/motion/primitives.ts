// #126 motion primitives. Each one animates only transform, opacity, clip-path or stroke-dashoffset,
// starts from a hidden state and ends on the element's own CSS state (inline props are cleared).
// Motion off (reduced motion, tests): each returns null and changes nothing — the final state.
// Helper nodes (masks, corners, wipe) carry .motion-tmp and remove themselves; clearTemp() removes them early.
import { DUR, EASE, EASE_LINE, STAGGER, gsap, motionOff } from "./env";
import { countText, scrambleText, textNodes } from "./text";

type Targets = Element | Element[] | NodeListOf<Element> | HTMLCollection | null | undefined;
const list = (t: Targets): Element[] => (!t ? [] : t instanceof Element ? [t] : Array.from(t));
const SVG_NS = "http://www.w3.org/2000/svg";
/** An SVG shape with a length (path, polyline, circle…). Duck-typed: some DOMs lack SVGGeometryElement. */
export const isShape = (e: Element | null): e is SVGGeometryElement =>
  !!e && typeof (e as SVGGeometryElement).getTotalLength === "function" && !!(e as SVGGeometryElement).ownerSVGElement;
let seq = 0;

/** Rise in: opacity, 8 px up, a clip opening top → bottom. Stagger 0.04–0.08 s. */
export function reveal(targets: Targets, opts: { stagger?: number; duration?: number; y?: number; clip?: boolean } = {}) {
  const els = list(targets);
  if (motionOff() || !els.length) return null;
  const clip = opts.clip ?? true;
  return gsap.fromTo(
    els,
    { opacity: 0, y: opts.y ?? 8, ...(clip ? { clipPath: "inset(0% 0% 100% 0%)" } : {}) },
    {
      opacity: 1,
      y: 0,
      ...(clip ? { clipPath: "inset(0% 0% 0% 0%)" } : {}),
      duration: opts.duration ?? DUR.reveal,
      ease: EASE,
      stagger: opts.stagger ?? STAGGER,
      // Whole pixels: the box is still after ~0.3 s, so a click on it does not wait for the tail.
      snap: { y: 1 },
      clearProps: "opacity,transform,clipPath",
    },
  );
}

/** Fade in one by one, in the given order (a dot track appearing in time order). */
export function sequence(targets: Targets, opts: { amount?: number; duration?: number; scale?: number } = {}) {
  const els = list(targets);
  if (motionOff() || !els.length) return null;
  const from: gsap.TweenVars = { opacity: 0 };
  const to: gsap.TweenVars = { opacity: 1 };
  if (opts.scale) {
    from.scale = opts.scale;
    to.scale = 1;
    from.transformOrigin = to.transformOrigin = "50% 50%";
  }
  return gsap.fromTo(els, from, {
    ...to,
    duration: opts.duration ?? 0.25,
    ease: EASE_LINE,
    stagger: { amount: opts.amount ?? 0.6 },
    clearProps: "opacity,transform",
  });
}

/** A fixed overlay over the element's box on screen (body level: not clipped or faded with the element). */
export function overlayAt(el: Element, cls: string): HTMLDivElement {
  const r = el.getBoundingClientRect();
  const o = document.createElement("div");
  o.className = `motion-tmp ${cls}`;
  o.setAttribute("aria-hidden", "true");
  Object.assign(o.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  document.body.appendChild(o);
  return o;
}

/**
 * Viewfinder: the frame's corner brackets snap out from its centre with a small overshoot,
 * a few white shards drift off the corners, and (open: true) the frame opens from the centre.
 */
export function bracketsIn(frame: Element | null, opts: { duration?: number; arm?: number; open?: boolean; shards?: number } = {}) {
  if (!frame || motionOff()) return null;
  const el = frame as HTMLElement;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  if (!w || !h) return null;
  const css = getComputedStyle(el);
  const arm = opts.arm ?? (parseFloat(css.getPropertyValue("--hud-b")) || 14);
  el.classList.add("motion-bracketing");
  const box = overlayAt(el, "motion-brackets");
  box.style.setProperty("--arm", `${arm}px`);
  const colour = css.getPropertyValue("--hud-c").trim() || css.getPropertyValue("--h-br").trim();
  if (colour) box.style.setProperty("--c", colour);
  const corners = (["tl", "tr", "bl", "br"] as const).map((k) => {
    const c = document.createElement("span");
    c.className = `motion-corner motion-corner-${k}`;
    box.appendChild(c);
    return c;
  });
  const dx = w / 2 - arm / 2;
  const dy = h / 2 - arm / 2;
  const done = () => {
    box.remove();
    el.classList.remove("motion-bracketing");
  };
  const d = opts.duration ?? 0.55;
  const tl = gsap.timeline({ onComplete: done, onInterrupt: done });
  if (opts.open ?? true) {
    // The clip opens one arm behind the corners.
    const x0 = Math.max(0, w / 2 - arm);
    const y0 = Math.max(0, h / 2 - arm);
    tl.fromTo(
      el,
      { clipPath: `inset(${y0}px ${x0}px ${y0}px ${x0}px)` },
      { clipPath: "inset(0px 0px 0px 0px)", duration: d, ease: EASE, clearProps: "clipPath" },
      0,
    );
  }
  tl.fromTo(
    corners,
    { x: (i: number) => (i % 2 ? -dx : dx), y: (i: number) => (i < 2 ? dy : -dy), opacity: 0 },
    { x: 0, y: 0, opacity: 1, duration: d, ease: "back.out(1.7)" },
    0,
  );
  const n = opts.shards ?? 5;
  if (n) tl.add(shards(box, n), d * 0.45);
  return tl;
}

/** A few small white shards drift off the corners of a box and fade (≤ 0.6 s). */
export function shards(box: HTMLElement, count = 5) {
  const tl = gsap.timeline();
  for (let k = 0; k < count; k++) {
    const s = document.createElement("i");
    s.className = "motion-shard";
    const corner = k % 4;
    const left = corner % 2 ? 100 : 0;
    const top = corner < 2 ? 0 : 100;
    Object.assign(s.style, { left: `${left}%`, top: `${top}%` });
    box.appendChild(s);
    const ax = (corner % 2 ? 1 : -1) * (14 + Math.random() * 46);
    const ay = (corner < 2 ? -1 : 1) * (8 + Math.random() * 34);
    tl.fromTo(
      s,
      { opacity: 0.9, x: 0, y: 0, rotation: Math.random() * 90, scale: 0.6 + Math.random() * 0.9 },
      { opacity: 0, x: ax, y: ay, rotation: `+=${120 + Math.random() * 160}`, duration: 0.45 + Math.random() * 0.2, ease: "power2.out" },
      Math.random() * 0.08,
    );
  }
  return tl;
}

/** A line draws along its length (stroke-dashoffset on a mask, so a dashed or dotted line keeps its dashes). */
export function drawLine(targets: Targets, opts: { duration?: number; stagger?: number; width?: number; ease?: string } = {}) {
  if (motionOff()) return null;
  const els = list(targets).filter(isShape);
  if (!els.length) return null;
  const tl = gsap.timeline();
  els.forEach((el, k) => {
    const svg = el.ownerSVGElement!;
    let len = 0;
    try {
      len = el.getTotalLength();
    } catch {
      len = 0;
    }
    if (!len) return;
    const id = `mdraw${++seq}`;
    const mask = document.createElementNS(SVG_NS, "mask");
    mask.id = id;
    mask.setAttribute("class", "motion-tmp");
    mask.setAttribute("maskUnits", "userSpaceOnUse");
    const vb = svg.viewBox.baseVal;
    const [x, y, w, h] = vb && vb.width ? [vb.x, vb.y, vb.width, vb.height] : [0, 0, 1e4, 1e4];
    mask.setAttribute("x", String(x - w));
    mask.setAttribute("y", String(y - h));
    mask.setAttribute("width", String(w * 3));
    mask.setAttribute("height", String(h * 3));
    const pen = el.cloneNode(false) as SVGGeometryElement;
    for (const a of ["class", "clip-path", "mask", "style", "id", "aria-label", "role"]) pen.removeAttribute(a);
    pen.setAttribute("style", `fill:none;stroke:#fff;stroke-width:${opts.width ?? 8};stroke-linecap:round;stroke-linejoin:round`);
    mask.appendChild(pen);
    svg.appendChild(mask);
    el.setAttribute("mask", `url(#${id})`);
    const done = () => {
      el.removeAttribute("mask");
      mask.remove();
    };
    tl.fromTo(
      pen,
      { strokeDasharray: `${len} ${len}`, strokeDashoffset: len },
      { strokeDashoffset: 0, duration: opts.duration ?? DUR.draw, ease: opts.ease ?? EASE_LINE, onComplete: done, onInterrupt: done },
      k * (opts.stagger ?? 0),
    );
  });
  return tl;
}

/** Wipe a group in from the left (clip-path), with an optional 1 px scan head riding the edge (SVG). */
export function sweep(target: Element | null, opts: { duration?: number; scan?: boolean } = {}) {
  if (!target || motionOff()) return null;
  const d = opts.duration ?? DUR.draw;
  const tl = gsap.timeline();
  tl.fromTo(
    target,
    { clipPath: "inset(0% 100% 0% 0%)" },
    { clipPath: "inset(0% 0% 0% 0%)", duration: d, ease: "power2.inOut", clearProps: "clipPath" },
    0,
  );
  const svg = (target as SVGGraphicsElement).ownerSVGElement ?? null;
  if (opts.scan && svg && typeof (target as SVGGraphicsElement).getBBox === "function") {
    let box: DOMRect | null = null;
    try {
      box = (target as SVGGraphicsElement).getBBox();
    } catch {
      box = null;
    }
    if (box && box.width) {
      const head = document.createElementNS(SVG_NS, "line");
      head.setAttribute("class", "motion-tmp motion-scan");
      head.setAttribute("x1", String(box.x));
      head.setAttribute("x2", String(box.x));
      head.setAttribute("y1", String(box.y));
      head.setAttribute("y2", String(box.y + box.height));
      svg.appendChild(head);
      const done = () => head.remove();
      tl.fromTo(head, { x: 0, opacity: 1 }, { x: box.width, duration: d, ease: "power2.inOut", onInterrupt: done }, 0);
      tl.to(head, { opacity: 0, duration: 0.15, onComplete: done });
    }
  }
  return tl;
}

/**
 * Screen change: a starfield streaks past in the direction of travel and dissolves (≤ 0.3 s),
 * under the top bar and the time bar. Appended to `host` (default <body>), removes itself.
 */
export function screenWipe(host: Element | null = document.body, opts: { duration?: number; dir?: 1 | -1; stars?: number } = {}) {
  if (!host || motionOff()) return null;
  removeWipes();
  const d = opts.duration ?? DUR.wipe;
  const dir = opts.dir ?? 1;
  const wipe = document.createElement("div");
  wipe.className = "motion-tmp motion-wipe";
  wipe.setAttribute("aria-hidden", "true");
  const stars = Array.from({ length: opts.stars ?? 46 }, () => {
    const s = wipe.appendChild(document.createElement("i"));
    const size = Math.random() < 0.15 ? 2 : 1;
    Object.assign(s.style, { left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, width: `${size}px`, height: `${size}px` });
    if (Math.random() < 0.08) s.className = Math.random() < 0.5 ? "is-red" : "is-blue";
    return s;
  });
  host.appendChild(wipe);
  const done = () => wipe.remove();
  const tl = gsap.timeline({ onComplete: done, onInterrupt: done });
  const w = window.innerWidth;
  // Near stars move far and stretch long, far stars barely: parallax depth.
  tl.fromTo(
    stars,
    { x: 0, scaleX: 1, opacity: 0, transformOrigin: dir > 0 ? "100% 50%" : "0% 50%" },
    {
      x: () => -dir * w * (0.05 + Math.random() * 0.25),
      scaleX: () => 8 + Math.random() * 60,
      opacity: () => 0.35 + Math.random() * 0.65,
      duration: d * 0.6,
      ease: "power2.in",
    },
    0,
  );
  tl.to(stars, { opacity: 0, duration: d * 0.4, ease: "power1.out", stagger: { amount: d * 0.15 } }, d * 0.55);
  return tl;
}

/** Removes a running screen wipe at once (unmount, a faster next screen). */
export function removeWipes(): void {
  document.querySelectorAll(".motion-wipe").forEach((n) => n.remove());
}

/** A verdict stamp: scale down onto the card and settle (PASS / FAIL). */
export function stamp(targets: Targets, opts: { stagger?: number } = {}) {
  const els = list(targets);
  if (motionOff() || !els.length) return null;
  return gsap.fromTo(
    els,
    { opacity: 0, scale: 1.8 },
    { opacity: 1, scale: 1, duration: 0.32, ease: "power4.out", stagger: opts.stagger ?? STAGGER, clearProps: "opacity,transform" },
  );
}

/** Grid cells (rows of cells) appear in a diagonal wave from the top-left; opacity and clip only. */
export function gridWave(rows: Element[][], opts: { amount?: number; duration?: number } = {}) {
  const cells = rows.flat();
  if (motionOff() || !cells.length) return null;
  const span = Math.max(1, ...rows.map((r, i) => i + r.length - 1));
  const step = Math.min(0.02, (opts.amount ?? 0.55) / span);
  const delays = rows.flatMap((r, i) => r.map((_, j) => (i + j) * step));
  return gsap.fromTo(
    cells,
    { opacity: 0, clipPath: "inset(0% 100% 0% 0%)" },
    {
      opacity: 1,
      clipPath: "inset(0% 0% 0% 0%)",
      duration: opts.duration ?? 0.35,
      ease: EASE,
      stagger: (i: number) => delays[i],
      clearProps: "opacity,clipPath",
    },
  );
}

/**
 * SVG callout <g data-dir="±1">: the box locks on the target, the leader draws out,
 * then the label slides out along the leader.
 */
export function calloutOut(targets: Targets, opts: { stagger?: number } = {}) {
  const groups = list(targets);
  if (motionOff() || !groups.length) return null;
  const tl = gsap.timeline();
  groups.forEach((g, k) => {
    const at = k * (opts.stagger ?? 0.08);
    const dir = Number(g.getAttribute("data-dir") ?? 1) || 1;
    const box = g.querySelectorAll("rect");
    const leader = g.querySelector("polyline");
    const label = g.querySelector("text");
    tl.fromTo(box, { opacity: 0, scale: 2.2, transformOrigin: "50% 50%" }, { opacity: 1, scale: 1, duration: 0.45, ease: EASE, clearProps: "opacity,transform" }, at);
    if (isShape(leader)) {
      let len = 0;
      try {
        len = leader.getTotalLength();
      } catch {
        len = 0;
      }
      if (len)
        tl.fromTo(
          leader,
          { strokeDasharray: `${len} ${len}`, strokeDashoffset: len },
          { strokeDashoffset: 0, duration: 0.35, ease: EASE_LINE, clearProps: "strokeDasharray,strokeDashoffset" },
          at + 0.12,
        );
    }
    if (label)
      tl.fromTo(
        label,
        { opacity: 0, x: -dir * 18 },
        { opacity: 1, x: 0, duration: 0.45, ease: EASE, clearProps: "opacity,transform" },
        at + 0.3,
      );
  });
  return tl;
}

/** Decode every text node under the elements (≤ 0.5 s). */
export function scramble(targets: Targets, opts: { duration?: number; stagger?: number } = {}) {
  const nodes = textNodes(list(targets));
  if (motionOff() || !nodes.length) return null;
  const tl = gsap.timeline();
  nodes.forEach((n, k) => {
    const tw = scrambleText(n, { duration: opts.duration });
    if (tw) tl.add(tw, k * (opts.stagger ?? 0.02));
  });
  return tl;
}

/** Count every number under the elements up from zero. */
export function countUp(targets: Targets, opts: { duration?: number; stagger?: number } = {}) {
  const nodes = textNodes(list(targets));
  if (motionOff() || !nodes.length) return null;
  const tl = gsap.timeline();
  nodes.forEach((n, k) => {
    const tw = countText(n, { duration: opts.duration });
    if (tw) tl.add(tw, k * (opts.stagger ?? 0.03));
  });
  return tl;
}

/**
 * Crossfade an SVG shape to its new geometry: a ghost with the old `d`/`points` fades out over the
 * new shape fading in. Call after React wrote the new value; `old` is the value before.
 */
export function crossfade(el: Element, attr: "d" | "points", old: string, opts: { duration?: number } = {}) {
  if (motionOff() || !el.parentNode) return null;
  const prev = ghosts.get(el);
  if (prev) prev.remove();
  const ghost = el.cloneNode(false) as Element;
  ghost.setAttribute(attr, old);
  ghost.removeAttribute("aria-label");
  ghost.setAttribute("class", `${el.getAttribute("class") ?? ""} motion-tmp motion-ghost`);
  el.parentNode.insertBefore(ghost, el);
  ghosts.set(el, ghost);
  const d = opts.duration ?? 0.4;
  const done = () => {
    ghost.remove();
    if (ghosts.get(el) === ghost) ghosts.delete(el);
  };
  const tl = gsap.timeline({ onComplete: done, onInterrupt: done });
  tl.to(ghost, { opacity: 0, duration: d, ease: EASE_LINE }, 0);
  tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: d, ease: EASE_LINE, clearProps: "opacity" }, 0);
  return tl;
}
const ghosts = new WeakMap<Element, Element>();

/** Removes every helper node and class a primitive left under root (unmount, revert). */
export function clearTemp(root: Element | null): void {
  if (!root) return;
  root.querySelectorAll(".motion-tmp").forEach((n) => n.remove());
  root.querySelectorAll(".motion-bracketing").forEach((n) => n.classList.remove("motion-bracketing"));
  root.querySelectorAll('[mask^="url(#mdraw"]').forEach((n) => n.removeAttribute("mask"));
}
