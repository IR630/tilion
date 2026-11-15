// #126 kinetic accents (reference video, adapted to a clean space HUD): whip-pan screen entry,
// stacked panel fragments that resolve into the panel, a burst of scattered telemetry, a light ribbon
// along a track. No glitch bars, no stripes.
// Entry moments only; the screen is still when idle. Motion off: each returns null and adds nothing.
import { EASE, gsap, motionOff } from "./env";
import { isShape, overlayAt } from "./primitives";

const SVG_NS = "http://www.w3.org/2000/svg";
const ORDER = ["navigator", "compare", "horizon", "calendar", "globe", "terrain", "validation"];
let lastScreen: string | null = null;

/** Direction of a screen change by tab order: +1 = the new screen comes from the right. */
export function screenDirection(screen: string): 1 | -1 {
  const from = lastScreen ? ORDER.indexOf(lastScreen) : -1;
  lastScreen = screen;
  return ORDER.indexOf(screen) >= from ? 1 : -1;
}

let smear: SVGFEGaussianBlurElement | null = null;
/** One shared horizontal-only blur filter (#motion-smear): CSS blur() has no direction. */
function smearFilter(): SVGFEGaussianBlurElement {
  if (smear?.isConnected) return smear;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("style", "position:absolute;pointer-events:none");
  svg.innerHTML =
    '<filter id="motion-smear" x="-10%" y="0" width="120%" height="100%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="0 0"/></filter>';
  document.body.appendChild(svg);
  smear = svg.querySelector("feGaussianBlur");
  return smear!;
}

/** Whip-pan entry (~0.24 s): the screen slides in from `dir` with a horizontal motion smear and a short stretch. */
export function whipIn(el: Element | null, dir: 1 | -1 = 1, opts: { duration?: number } = {}) {
  if (!el || motionOff()) return null;
  const blur = smearFilter();
  const node = el as HTMLElement;
  const d = opts.duration ?? 0.24;
  const p = { s: 28 };
  const done = () => {
    node.style.filter = "";
    blur.setAttribute("stdDeviation", "0 0");
  };
  node.style.filter = "url(#motion-smear)";
  blur.setAttribute("stdDeviation", `${p.s} 0`);
  const tl = gsap.timeline({ onComplete: done, onInterrupt: done });
  tl.to(p, { s: 0, duration: d, ease: "power2.out", onUpdate: () => blur.setAttribute("stdDeviation", `${p.s.toFixed(1)} 0`) }, 0);
  tl.fromTo(
    node,
    { x: dir * 120, scaleX: 1.08, opacity: 0.35, transformOrigin: dir > 0 ? "100% 50%" : "0% 50%" },
    { x: 0, scaleX: 1, opacity: 1, duration: d, ease: "power3.out", clearProps: "transform,opacity,transformOrigin" },
    0,
  );
  return tl;
}

/**
 * A panel assembles from clean stacked fragments (~0.45 s): two thin outlines fly in offset and
 * settle onto the panel, the panel wipes in behind them, the outlines fade.
 * `reveal: false` leaves the panel to another motion (a frame that opens with its brackets).
 */
export function fragmentIn(el: Element | null, opts: { reveal?: boolean } = {}) {
  if (!el || motionOff()) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height || r.top > window.innerHeight) return null;
  const o = overlayAt(el, "motion-frag");
  const wins = [0, 1].map(() => o.appendChild(document.createElement("i")));
  wins.forEach((w) => (w.className = "motion-frag-win"));
  const done = () => o.remove();
  const tl = gsap.timeline({ onComplete: done, onInterrupt: done });
  const sx = (Math.random() < 0.5 ? -1 : 1) * (18 + Math.random() * 26);
  tl.fromTo(
    wins,
    { x: (i: number) => sx * (i + 1), y: (i: number) => -8 * (i + 1), opacity: 0 },
    { x: 0, y: 0, opacity: 1, duration: 0.32, ease: EASE, stagger: 0.05 },
    0,
  );
  if (opts.reveal ?? true)
    tl.fromTo(
      el,
      { opacity: 0, clipPath: "inset(0% 100% 0% 0%)" },
      { opacity: 1, clipPath: "inset(0% 0% 0% 0%)", duration: 0.32, ease: EASE, clearProps: "opacity,clipPath" },
      0.16,
    );
  tl.to(o, { opacity: 0, duration: 0.18, ease: "power1.out" }, 0.3);
  return tl;
}

/**
 * Telemetry burst (~0.55 s): short mono labels from the real data pop in at scattered places
 * over the element, then drift off and fade. For a screen entry or a site change only.
 */
export function dataBurst(el: Element | null, words: string[], opts: { max?: number } = {}) {
  if (!el || motionOff() || !words.length) return null;
  const r = el.getBoundingClientRect();
  const top = Math.max(r.top, 64);
  const bottom = Math.min(r.bottom, window.innerHeight - 90);
  if (bottom - top < 80) return null;
  const o = document.createElement("div");
  o.className = "motion-tmp motion-burst";
  o.setAttribute("aria-hidden", "true");
  Object.assign(o.style, { left: `${r.left}px`, top: `${top}px`, width: `${r.width}px`, height: `${bottom - top}px` });
  document.body.appendChild(o);
  const list = words.slice(0, opts.max ?? 14);
  const spans = list.map((w, k) => {
    const s = o.appendChild(document.createElement("span"));
    s.textContent = w;
    s.className = k % 5 === 1 ? "is-red" : k % 7 === 3 ? "is-blue" : k % 3 === 0 ? "is-dim" : "";
    Object.assign(s.style, { left: `${4 + Math.random() * 82}%`, top: `${4 + Math.random() * 86}%` });
    return s;
  });
  const done = () => o.remove();
  const tl = gsap.timeline({ onComplete: done, onInterrupt: done });
  tl.fromTo(spans, { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.1, ease: "steps(2)", stagger: 0.025 }, 0);
  tl.to(
    spans,
    { opacity: 0, x: () => (Math.random() - 0.5) * 60, y: () => -10 - Math.random() * 24, duration: 0.24, ease: "power2.in", stagger: 0.015 },
    0.26,
  );
  return tl;
}

/**
 * Light ribbon: a bright head with a soft tail sweeps along an SVG track and leaves the track behind.
 * `cls` colours it (motion-ribbon-sun / -earth); `width` is the head stroke in user units.
 */
export function ribbon(path: Element | null, opts: { cls?: string; width?: number; duration?: number } = {}) {
  if (!path || motionOff() || !isShape(path)) return null;
  let len = 0;
  try {
    len = path.getTotalLength();
  } catch {
    len = 0;
  }
  if (!len) return null;
  const w = opts.width ?? 4;
  const make = (seg: number, width: number, cls: string) => {
    const c = path.cloneNode(false) as SVGGeometryElement;
    for (const a of ["class", "style", "mask", "aria-label", "id"]) c.removeAttribute(a);
    c.setAttribute("class", `motion-tmp motion-ribbon ${opts.cls ?? "motion-ribbon-sun"} ${cls}`);
    c.style.strokeWidth = String(width);
    c.style.strokeDasharray = `${seg} ${len + seg}`;
    path.parentNode?.insertBefore(c, path.nextSibling);
    return { c, seg };
  };
  const tail = make(len * 0.3, w * 0.55, "is-tail");
  const head = make(len * 0.05, w, "is-head");
  const parts = [tail, head];
  const done = () => parts.forEach((p) => p.c.remove());
  const d = opts.duration ?? 0.6;
  const tl = gsap.timeline({ onComplete: done, onInterrupt: done });
  parts.forEach(({ c, seg }) =>
    tl.fromTo(c, { strokeDashoffset: seg }, { strokeDashoffset: -len, duration: d, ease: "power1.inOut" }, 0),
  );
  tl.to(parts.map((p) => p.c), { opacity: 0, duration: 0.15 }, d - 0.12);
  return tl;
}

/** A short hex tag from a string (site id → "#7C3A"), for the telemetry burst. */
export function hexTag(s: string): string {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return `#${(h >>> 0).toString(16).slice(0, 5).toUpperCase()}`;
}
