// #322: a note folds behind a small "?" mark: only the mark is visible. Hover or a click opens the text
// in a popover (the top layer, so a scrolling panel never clips it); a click pins it, a click outside or
// Esc closes it. The popover is "manual": with "auto" a click on the mark would first light-dismiss it. The text stays in the DOM (screen readers, tests).
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./ui.css";

/** One text for every "Earth in view" on screen: what the geometry does and does not say. */
export const GEO_CAVEAT =
  "Earth centre above terrain: geometric visibility only. No antenna schedule or link budget checked; contact is not confirmed. Sun + Earth is a geometric overlap, not mission readiness.";

const GAP = 6;
const EDGE = 8;

export function Info({ children, label = "More about this", className }: { children: ReactNode; label?: string; className?: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);
  const pinned = useRef(false);
  const timer = useRef(0);
  const [open, setOpen] = useState(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const close = () => {
      pinned.current = false;
      if (isOpen()) pop.current?.hidePopover?.();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !pop.current?.contains(t)) close();
    };
    // Esc closes the popover only, not the sheet under it: capture on window, stop there.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    // A scroll or a resize moves the mark: the popover follows it and closes once the mark leaves the screen.
    // A resize does not close it outright: a phone's address bar resizes the window on every scroll.
    const follow = () => {
      const b = btn.current?.getBoundingClientRect();
      if (!b || b.bottom < 0 || b.top > innerHeight) close();
      else place();
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", follow);
    document.addEventListener("scroll", follow, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", follow);
      document.removeEventListener("scroll", follow, true);
    };
  }, [open]);

  const isOpen = () => !!pop.current?.matches?.(":popover-open");
  const place = () => {
    const b = btn.current?.getBoundingClientRect();
    const p = pop.current;
    if (!b || !p) return;
    const w = Math.min(340, innerWidth - 2 * EDGE);
    p.style.width = `${w}px`;
    p.style.left = `${Math.max(EDGE, Math.min(b.left + b.width / 2 - w / 2, innerWidth - w - EDGE))}px`;
    const below = b.bottom + GAP;
    p.style.top = `${below + p.offsetHeight > innerHeight - EDGE ? Math.max(EDGE, b.top - GAP - p.offsetHeight) : below}px`;
  };
  const show = () => {
    if (isOpen()) return;
    pop.current?.showPopover?.();
    place();
  };
  const hide = () => {
    if (!pinned.current && isOpen()) pop.current?.hidePopover?.();
  };
  const later = (f: () => void, ms: number) => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(f, ms);
  };

  return (
    <span className={`info${className ? ` ${className}` : ""}`}>
      <button
        ref={btn}
        type="button"
        className="info-mark"
        aria-label={label}
        aria-controls={id}
        aria-expanded={open}
        onClick={() => {
          clearTimeout(timer.current);
          if (isOpen() && pinned.current) {
            pinned.current = false;
            pop.current?.hidePopover?.();
          } else {
            pinned.current = true;
            show();
          }
        }}
        onMouseEnter={() => later(show, 120)}
        onMouseLeave={() => later(hide, 200)}
      >
        ?
      </button>
      <span
        ref={pop}
        id={id}
        className="info-pop"
        popover="manual"
        role="note"
        onMouseEnter={() => clearTimeout(timer.current)}
        onMouseLeave={() => later(hide, 200)}
        onToggle={(e) => {
          const now = e.newState === "open";
          setOpen(now);
          if (!now) pinned.current = false;
        }}
      >
        {children}
      </span>
    </span>
  );
}
