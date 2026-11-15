// #126 motion switch and timing tokens. One place decides "animate or show the final state now".
import { gsap } from "gsap";

/** Timing tokens: precise HUD motion, no bounce. Seconds. */
export const EASE = "expo.out";
export const EASE_LINE = "power3.out";
export const DUR = { reveal: 0.7, count: 0.6, update: 0.35, scramble: 0.4, draw: 0.8, wipe: 0.28 } as const;
export const STAGGER = 0.05;
/**
 * #161 interface motion (selection indicators, menus, sheets): CSS transitions on transform/opacity only,
 * so the compositor runs them off the main thread. The CSS side is --ui-* in motion.css; keep both equal.
 * `ease` is GSAP "power3.out" written as a CSS cubic-bezier.
 */
export const UI = { slide: 0.22, menu: 0.14, sheet: 0.24, ease: "cubic-bezier(0.215, 0.61, 0.355, 1)" } as const;

let forced: boolean | null = null;

/** Tests only: true = always animate, false = never, null = follow the environment. */
export function setMotion(on: boolean | null): void {
  forced = on;
}

/**
 * True when motion must not run: prefers-reduced-motion, the vitest run, or no matchMedia (jsdom).
 * Then every primitive leaves the final state at once and returns null.
 */
export function motionOff(): boolean {
  if (forced !== null) return !forced;
  if (typeof window === "undefined") return true;
  if (import.meta.env.MODE === "test") return true;
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export { gsap };
