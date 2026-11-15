// #126 React side of the motion system: a screen intro played once when its data is ready,
// numbers that follow new values, chart shapes that crossfade. gsap.context (useGSAP) reverts all.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useGSAP } from "@gsap/react";
import { gsap, motionOff } from "./env";
import { bracketsIn, clearTemp, crossfade, removeWipes, reveal, screenWipe } from "./primitives";
import { dataBurst, fragmentIn, screenDirection, whipIn } from "./fx";
import { countText, finishText, followText, scrambleText, textNodes } from "./text";

gsap.registerPlugin(useGSAP);

/** Cascade items: the screen's direct children; a tile row cascades tile by tile. */
export const ITEMS = ":scope > :not(.hud-tiles):not(.motion-tmp), :scope > .hud-tiles > *";
/** Mono captions that decode on entry. Texts with a digit (dates, times, values) never decode: scrambleText skips them. */
export const LABELS = ".hud-label, .hud-corners, th, dt, summary, .horizon-axis, .calendar-month, .val-site";
/** Panels that assemble from UI fragments on entry; a .hud-frame also gets its viewfinder brackets. */
export const PANELS = ".hud-tile, .hud-frame";
/** Readouts whose numbers count up on entry and tween on change. */
// Sentences ("34 of 34 checks pass") stay still: a half-counted sentence states a false fact.
export const NUMBERS = ".hud-value, .cmp-v, .cmp-spread, .val-card dd, .calendar-runs dd";

type Add = gsap.core.Animation | null;
const put = (tl: gsap.core.Timeline, a: Add, at: number) => {
  if (a) tl.add(a, at);
};

/**
 * The HUD entry of one screen on a timeline, item by item 0.04–0.08 s apart: panels (tiles, frames)
 * assemble from UI fragments, frames open with snapping brackets, captions decode, numbers count up.
 * Plain items rise in — or, with `whip`, already arrive with the whip-pan of the whole screen.
 * Returns the start time of each item, so a screen can chain its own chart motion to it.
 */
export function hudCascade(
  tl: gsap.core.Timeline,
  root: Element,
  opts: { at?: number; items?: string; labels?: string; numbers?: string; spread?: number; whip?: boolean } = {},
): Map<Element, number> {
  const at = opts.at ?? 0.08;
  // Only what is on screen moves; items below the fold are already final when scrolled to.
  const fold = window.innerHeight + 40;
  const items = Array.from(root.querySelectorAll(opts.items ?? ITEMS)).filter(
    (e) => !e.classList.contains("motion-tmp") && e.getBoundingClientRect().top < fold,
  );
  const step = Math.min(0.08, Math.max(0.04, (opts.spread ?? 0.45) / Math.max(1, items.length)));
  const times = new Map<Element, number>();
  const numSel = opts.numbers ?? NUMBERS;
  const labelSel = opts.labels ?? LABELS;
  const seen = new Set<Text>();
  items.forEach((item, i) => {
    const t = at + i * step;
    times.set(item, t);
    const frames = [...(item.matches(".hud-frame") ? [item] : []), ...item.querySelectorAll(".hud-frame")];
    if (item.matches(PANELS)) put(tl, fragmentIn(item, { reveal: !frames.includes(item) }), t);
    else if (!opts.whip) put(tl, reveal(item, { stagger: 0 }), t);
    frames.forEach((f) => {
      if (f !== item) put(tl, fragmentIn(f, { reveal: false }), t + 0.05);
      put(tl, bracketsIn(f), t + (f === item ? 0.08 : 0.13));
    });
    const within = (sel: string) => [...(item.matches(sel) ? [item] : []), ...item.querySelectorAll(sel)];
    const nums = textNodes(within(numSel)).filter((n) => !seen.has(n) && seen.add(n));
    nums.forEach((n, k) => put(tl, countText(n), t + 0.05 + Math.min(0.15, k * 0.02)));
    const labels = textNodes(within(labelSel)).filter((n) => !seen.has(n) && seen.add(n));
    labels.forEach((n, k) => put(tl, scrambleText(n), t + Math.min(0.2, k * 0.015)));
  });
  return times;
}

/** Start time of the cascade item that contains `el` (or `fallback`). */
export function timeOf(times: Map<Element, number>, el: Element | null, fallback = 0.3): number {
  for (const [item, t] of times) if (el && item.contains(el)) return t;
  return fallback;
}

export type IntroBuild = (tl: gsap.core.Timeline, root: HTMLElement, ctx: { whip: boolean }) => void;

/**
 * Screen intro, once, when `ready` turns true: a starfield streak and a whip-pan from the side of the
 * previous tab (≤ 0.3 s), a burst of real telemetry (`words`), then `build` (default: hudCascade).
 * `wipe: false` — an inner block: no stars, whip or burst. Motion off: nothing runs, the screen is final.
 */
export function useIntro(
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
  build?: IntroBuild,
  opts: { wipe?: boolean; screen?: string; words?: () => string[] } = {},
): void {
  const played = useRef(false);
  const dir = useRef<1 | -1>(1);
  const whip = opts.wipe !== false;
  useGSAP(() => {
    if (whip) dir.current = screenDirection(opts.screen ?? "");
  });
  useGSAP(
    () => {
      const root = ref.current;
      if (!ready || played.current || !root || motionOff()) return;
      played.current = true;
      // Paused while it is built: building (DOM reads, hundreds of tweens) must not eat the first frames.
      const tl = gsap.timeline({ paused: true });
      // Build first: fragments, brackets and the burst measure the screen before the whip moves it.
      if (build) build(tl, root, { whip });
      else hudCascade(tl, root, { whip });
      if (whip) {
        put(tl, dataBurst(root, opts.words?.() ?? []), 0.08);
        put(tl, screenWipe(document.body, { dir: dir.current }), 0);
        put(tl, whipIn(root, dir.current), 0);
      }
      // Start on the next frame, after the commit has painted: a long commit must not eat the first frames.
      const raf = requestAnimationFrame(() => tl.play());
      return () => {
        cancelAnimationFrame(raf);
        played.current = false;
        finishText(root);
        clearTemp(root);
        clearTemp(document.body);
        removeWipes();
      };
    },
    { dependencies: [ready], scope: ref },
  );
}

/** A telemetry burst over the element when `key` changes after the first value (a new site). */
export function useBurst(ref: RefObject<Element | null>, key: string, words: () => string[]): void {
  const last = useRef<string | null>(null);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = key;
    if (before === null || before === key) return;
    dataBurst(ref.current, words());
  }, [key]);
}

/** After every commit: numbers under `selector` that React changed tween from the shown value. */
export function useFollowNumbers(ref: RefObject<Element | null>, selector: string = NUMBERS, duration?: number): void {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    for (const n of textNodes(root.querySelectorAll(selector))) followText(n, duration);
  });
}

/** After every commit: SVG shapes under `selector` whose `d`/`points` changed crossfade from the old shape. */
export function useCrossfade(ref: RefObject<Element | null>, selector: string): void {
  const last = useRef(new WeakMap<Element, string>());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    root.querySelectorAll(selector).forEach((el) => {
      if (el.classList.contains("motion-tmp")) return;
      const attr = el.hasAttribute("d") ? "d" : "points";
      const now = el.getAttribute(attr) ?? "";
      const before = last.current.get(el);
      last.current.set(el, now);
      if (before !== undefined && before !== now) crossfade(el, attr, before);
    });
  });
}
