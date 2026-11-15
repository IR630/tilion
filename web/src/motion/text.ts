// #126 text motion: numbers count to their value, mono captions decode from random glyphs.
// Both write only Text.nodeValue of the node React rendered, so React keeps its node and its
// next update wins. The last frame always writes the exact final text.
import { DUR, EASE_LINE, gsap, motionOff } from "./env";

// A number not glued to a letter, digit, dot, hyphen or colon: "C1", "DE440", dates "2027-01-15"
// and times "05:00" stay text. A sign counts only after a space or the start: "−7 d", "+0.38°".
const NUM = /(?<![\p{L}\d.:\-])([+\-−]?)(\d+(?:\.\d+)?)(?![\d.]|[\-:]\d)/gu;

export type NumberText = {
  /** Static text around the numbers: parts.length = values.length + 1. */
  parts: string[];
  values: number[];
  decimals: number[];
  /** Sign style per number: "+" keeps a plus on positives; minus is the character the text uses. */
  plus: boolean[];
  minus: string[];
};

export function parseNumbers(text: string): NumberText {
  const out: NumberText = { parts: [], values: [], decimals: [], plus: [], minus: [] };
  let last = 0;
  for (const m of text.matchAll(NUM)) {
    const at = m.index ?? 0;
    out.parts.push(text.slice(last, at));
    const [, sign, digits] = m;
    out.values.push((sign === "-" || sign === "−" ? -1 : 1) * Number(digits));
    out.decimals.push(digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0);
    out.plus.push(sign === "+");
    out.minus.push(sign === "-" ? "-" : "−");
    last = at + m[0].length;
  }
  out.parts.push(text.slice(last));
  return out;
}

/** The text with new numbers in the same places, each with its own decimals and sign style. */
export function formatNumbers(t: NumberText, values: number[]): string {
  let s = t.parts[0];
  values.forEach((v, k) => {
    const abs = Math.abs(v).toFixed(t.decimals[k]);
    const zero = Number(abs) === 0;
    const sign = v < 0 && !zero ? t.minus[k] : t.plus[k] ? "+" : "";
    s += sign + abs + t.parts[k + 1];
  });
  return s;
}

/** Same words and the same count of numbers: the text can tween number by number. */
export function sameShape(a: NumberText, b: NumberText): boolean {
  return a.values.length === b.values.length && a.parts.every((p, k) => p === b.parts[k]);
}

/** The text at progress p (0…1) between two texts of the same shape. */
export function lerpText(from: NumberText, to: NumberText, p: number): string {
  return formatNumbers(
    to,
    to.values.map((v, k) => from.values[k] + (v - from.values[k]) * p),
  );
}

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/<>_=+";

/** Decode frame: the first `p` share of characters is final, the rest are glyphs; spaces stay. */
export function scrambleFrame(text: string, p: number, seed: number): string {
  const shown = Math.floor(text.length * p);
  let s = "";
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (k < shown || /\s|[·,.:;()°%/–—-]/.test(c)) s += c;
    else s += GLYPHS[(k * 7 + seed * 13) % GLYPHS.length];
  }
  return s;
}

type TextState = { node: Text; final: string; written: string | null; tween: gsap.core.Tween | null };
const states = new WeakMap<Text, TextState>();
const active = new Set<TextState>();

function stateOf(node: Text): TextState {
  let st = states.get(node);
  if (!st) states.set(node, (st = { node, final: node.nodeValue ?? "", written: null, tween: null }));
  return st;
}

function stop(st: TextState, writeFinal: boolean) {
  st.tween?.kill();
  st.tween = null;
  if (writeFinal && st.written !== null && st.node.nodeValue === st.written) st.node.nodeValue = st.final;
  st.written = null;
  if (active.delete(st)) busy(st.node, -1);
}

// A live region waits while its numbers move: screen readers read only the final value.
const busyCount = new WeakMap<Element, number>();
function busy(node: Text, d: 1 | -1) {
  const region = node.parentElement?.closest('[role="status"], [aria-live]');
  if (!region) return;
  const n = Math.max(0, (busyCount.get(region) ?? 0) + d);
  busyCount.set(region, n);
  if (n) region.setAttribute("aria-busy", "true");
  else region.removeAttribute("aria-busy");
}

function write(st: TextState, s: string): boolean {
  // React wrote a new value since our last frame: its value wins, this tween stops.
  if (st.written !== null && st.node.nodeValue !== st.written) {
    stop(st, false);
    return false;
  }
  st.node.nodeValue = s;
  st.written = s;
  return true;
}

function run(st: TextState, duration: number, delay: number, ease: string, frame: (p: number, t: number) => string) {
  const proxy = { p: 0 };
  if (st.tween) stop(st, false);
  active.add(st);
  busy(st.node, 1);
  st.written = st.node.nodeValue;
  const tw = gsap.to(proxy, {
    p: 1,
    duration,
    delay,
    ease,
    onStart: () => void write(st, frame(0, 0)),
    onUpdate: () => void write(st, frame(proxy.p, tw.time())),
    onComplete: () => {
      write(st, st.final);
      stop(st, false);
    },
  });
  st.tween = tw;
  // Before the delay ends the node already shows the first frame (no flash of the final value).
  write(st, frame(0, 0));
  return tw;
}

/**
 * Count the numbers of a text node from `from` (default: zeros) to its current text.
 * Null and no change when motion is off or the text has no number.
 */
export function countText(
  node: Text,
  opts: { from?: string; duration?: number; delay?: number; ease?: string } = {},
): gsap.core.Tween | null {
  const st = stateOf(node);
  st.final = node.nodeValue ?? "";
  if (motionOff()) return null;
  const to = parseNumbers(st.final);
  if (!to.values.length) return null;
  const from = opts.from !== undefined ? parseNumbers(opts.from) : { ...to, values: to.values.map(() => 0) };
  if (!sameShape(from, to) || from.values.every((v, k) => v === to.values[k])) return null;
  return run(st, opts.duration ?? DUR.count, opts.delay ?? 0, opts.ease ?? EASE_LINE, (p) => lerpText(from, to, p));
}

/**
 * Decode a text node from glyphs to its current text in ≤ duration s. Null when motion is off, and for
 * any text with a digit: a date, a time or a value in glyphs reads as a data error.
 */
export function scrambleText(node: Text, opts: { duration?: number; delay?: number } = {}): gsap.core.Tween | null {
  const st = stateOf(node);
  st.final = node.nodeValue ?? "";
  if (motionOff() || !st.final.trim() || /\d/.test(st.final)) return null;
  const text = st.final;
  // New glyphs every 40 ms, not every frame: reads as a decoder, not as noise.
  return run(st, opts.duration ?? DUR.scramble, opts.delay ?? 0, "none", (p, t) => scrambleFrame(text, p, Math.floor(t / 0.04)));
}

/**
 * After a React commit: a text node whose value React changed tweens from the shown value to the new one.
 * First sight only records the value. Words without numbers, or a changed shape, switch at once.
 */
export function followText(node: Text, duration: number = DUR.update): void {
  const st = states.get(node);
  const now = node.nodeValue ?? "";
  if (!st) {
    stateOf(node);
    return;
  }
  if (st.tween && now === st.written) return; // our own frame, React did not touch it
  if (now === st.final) return;
  const shown = st.tween && st.written !== null ? st.written : st.final;
  if (st.tween) stop(st, false);
  st.final = now;
  if (motionOff()) return;
  const from = parseNumbers(shown);
  const to = parseNumbers(now);
  if (!to.values.length || !sameShape(from, to)) return;
  node.nodeValue = shown;
  run(st, duration, 0, EASE_LINE, (p) => lerpText(from, to, p));
}

/** Text nodes under the elements, skipping empty ones. */
export function textNodes(els: Iterable<Element>): Text[] {
  const out: Text[] = [];
  for (const el of els) {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) if ((n.nodeValue ?? "").trim()) out.push(n as Text);
  }
  return out;
}

/** Stops every text tween under root and writes the final text: unmount, revert, tests. */
export function finishText(root?: Node): void {
  for (const st of [...active]) if (!root || root.contains(st.node)) stop(st, true);
}
