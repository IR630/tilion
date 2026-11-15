// #161 sliding selection indicator. Drop <SlideMark /> as the last child of a group of toggle buttons:
// one mark slides under the pressed button (transform only, --ui-slide, reduced motion = jump).
// The group keeps its own buttons and aria-pressed, so tests and keyboard behaviour stay the same.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import "./ui.css";

/** Width (axis x) or height (axis y) of the mark before scaling, px. CSS uses the same number. */
const BASE = 100;
const PRESSED = ':scope > [aria-pressed="true"], :scope > [aria-selected="true"]';

/** Position of `el` inside `host` in layout pixels (ignores transforms on the ancestors). */
function boxIn(el: HTMLElement, host: HTMLElement) {
  if (el.offsetParent === host) return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
  const a = el.getBoundingClientRect();
  const b = host.getBoundingClientRect();
  return { x: a.left - b.left - host.clientLeft + host.scrollLeft, y: a.top - b.top - host.clientTop + host.scrollTop, w: a.width, h: a.height };
}

/**
 * The sliding mark. `axis` "x": a row (the mark scales in width, the bar is at the bottom);
 * "y": a column (the mark scales in height, the bar is on the left, as on the rail).
 */
export function SlideMark({ axis = "x", selector = PRESSED }: { axis?: "x" | "y"; selector?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  const place = () => {
    const mark = ref.current;
    const host = mark?.parentElement;
    if (!mark || !host) return;
    const target = host.querySelector<HTMLElement>(selector);
    if (!target || target.offsetParent === null) {
      mark.dataset.on = "";
      return;
    }
    const { x, y, w, h } = boxIn(target, host);
    const scale = axis === "x" ? `scaleX(${w / BASE})` : `scaleY(${h / BASE})`;
    const first = mark.dataset.on !== "1";
    if (first) mark.style.transition = "none";
    if (axis === "x") mark.style.height = `${h}px`;
    else mark.style.width = `${w}px`;
    mark.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) ${scale}`;
    mark.dataset.on = "1";
    if (first) {
      void mark.offsetWidth; // commit the jump before the transition comes back
      mark.style.transition = "";
    }
  };

  // Every render of the group can move the pressed button.
  useLayoutEffect(place);
  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const mo = new MutationObserver(place);
    mo.observe(host, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "aria-selected"] });
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => place()) : null;
    ro?.observe(host);
    for (const c of Array.from(host.children)) ro?.observe(c);
    return () => {
      mo.disconnect();
      ro?.disconnect();
    };
    // place() reads only the ref and props that stay the same for one mounted group.
  }, []);

  return <span ref={ref} className={`ui-slide ui-slide-${axis}`} aria-hidden="true" />;
}

export type SegOption<V extends string | number> = { value: V; label: ReactNode; title?: string; disabled?: boolean };

/** A row of toggle buttons with one sliding selection mark (aria-pressed on the chosen one). */
export function Segmented<V extends string | number>(p: {
  options: readonly SegOption<V>[];
  value: V;
  onChange: (v: V) => void;
  label: string;
  className?: string;
}) {
  return (
    <div className={`ui-seg${p.className ? ` ${p.className}` : ""}`} role="group" aria-label={p.label}>
      {p.options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === p.value} title={o.title} disabled={o.disabled} onClick={() => p.onChange(o.value)}>
          {o.label}
        </button>
      ))}
      <SlideMark />
    </div>
  );
}
