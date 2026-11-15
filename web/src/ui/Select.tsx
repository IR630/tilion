// #161 Select: a button that opens a listbox in the site style (replaces the native select element).
// ARIA select-only combobox: focus stays on the button, aria-activedescendant names the active option.
// Keys: ↑/↓, Home/End, PageUp/PageDown, type-ahead, Enter/Space choose, Esc closes, Tab chooses and moves on.
// The list is a portal on <body>: a panel's overflow or transform does not clip it, and a click on an
// option does not reach a <label> around the button. It opens below, or above when there is no room.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { UI, motionOff } from "../motion/env";
import "./ui.css";

export type SelectOption<V extends string | number> = {
  value: V;
  label: ReactNode;
  /** Text for type-ahead when `label` is not a string. */
  text?: string;
  disabled?: boolean;
};

const GAP = 4; // px between the button and the list
const MARGIN = 8; // px kept free at the viewport edge
const MAX_H = 300; // px, list height before it scrolls
const TYPE_MS = 600; // type-ahead buffer reset
const PAGE = 8; // options per PageUp/PageDown

const textOf = <V extends string | number>(o: SelectOption<V>) =>
  (o.text ?? (typeof o.label === "string" || typeof o.label === "number" ? String(o.label) : String(o.value))).toLowerCase();

/** Next enabled index from `from` in direction `dir`, clamped at the ends (no wrap). */
function step<V extends string | number>(opts: readonly SelectOption<V>[], from: number, dir: 1 | -1): number {
  for (let i = from + dir; i >= 0 && i < opts.length; i += dir) if (!opts[i].disabled) return i;
  return from;
}
const firstEnabled = <V extends string | number>(opts: readonly SelectOption<V>[]) => step(opts, -1, 1);
const lastEnabled = <V extends string | number>(opts: readonly SelectOption<V>[]) => step(opts, opts.length, -1);

type Place = { left: number; top?: number; bottom?: number; minWidth: number; maxHeight: number; above: boolean };

export function Select<V extends string | number>(p: {
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (v: V) => void;
  /** Accessible name of the button and the list. */
  label: string;
  className?: string;
  disabled?: boolean;
  /** Button text when no option has `value`. */
  placeholder?: ReactNode;
}) {
  const { options, value } = p;
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null); // the popover: scroll box around the listbox
  const hl = useRef<HTMLSpanElement>(null);
  const typed = useRef({ s: "", t: 0 });
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [active, setActive] = useState(-1);
  const [place, setPlace] = useState<Place | null>(null);

  const selIdx = options.findIndex((o) => o.value === value);
  const shown = open || closing;

  const show = (at: number) => {
    if (p.disabled || !options.length) return;
    setClosing(false);
    setActive(at >= 0 && !options[at]?.disabled ? at : firstEnabled(options));
    setOpen(true);
  };
  const hide = (focus = true) => {
    if (!open) return;
    setOpen(false);
    setPlace(null);
    if (!motionOff()) setClosing(true);
    if (focus) btn.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (o && !o.disabled && o.value !== value) p.onChange(o.value);
    hide();
  };

  /** Type-ahead: the buffer grows while keys come within TYPE_MS; one repeated letter cycles. */
  const typeAhead = (ch: string, from: number): number => {
    const now = Date.now();
    const t = typed.current;
    t.s = now - t.t > TYPE_MS ? ch : t.s + ch;
    t.t = now;
    const same = t.s.split("").every((c) => c === t.s[0]);
    const q = same ? t.s[0] : t.s;
    const start = same ? from + 1 : Math.max(from, 0);
    for (let k = 0; k < options.length; k++) {
      const i = (start + k) % options.length;
      if (!options[i].disabled && textOf(options[i]).startsWith(q)) return i;
    }
    return -1;
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const k = e.key;
    const printable = k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
    if (!open) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") show(selIdx);
      else if (k === "Home") show(firstEnabled(options));
      else if (k === "End") show(lastEnabled(options));
      else if (printable) {
        const i = typeAhead(k.toLowerCase(), selIdx);
        if (i >= 0) show(i);
      } else return;
      e.preventDefault();
      return;
    }
    if (k === "ArrowDown") setActive((a) => step(options, a, 1));
    else if (k === "ArrowUp") setActive((a) => step(options, a, -1));
    else if (k === "Home") setActive(firstEnabled(options));
    else if (k === "End") setActive(lastEnabled(options));
    else if (k === "PageDown") setActive((a) => { let i = a; for (let n = 0; n < PAGE; n++) i = step(options, i, 1); return i; });
    else if (k === "PageUp") setActive((a) => { let i = a; for (let n = 0; n < PAGE; n++) i = step(options, i, -1); return i; });
    else if (k === " " && Date.now() - typed.current.t < TYPE_MS) {
      const i = typeAhead(k, active); // a space inside a typed name ("malapert b") searches on
      if (i >= 0) setActive(i);
    } else if (k === "Enter" || k === " ") choose(active);
    else if (k === "Escape") hide();
    else if (k === "Tab") {
      choose(active); // APG: Tab keeps the active option and lets focus move on
      return;
    } else if (printable) {
      const i = typeAhead(k.toLowerCase(), active);
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
    e.stopPropagation(); // Esc must not close the panel under the list
  };

  // Placement: below the button, or above when the list does not fit below and there is more room above.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const b = btn.current?.getBoundingClientRect();
      if (!b) return;
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const want = Math.min(list.current?.scrollHeight ?? MAX_H, MAX_H);
      const below = vh - b.bottom - GAP - MARGIN;
      const roomAbove = b.top - GAP - MARGIN;
      const above = below < want && roomAbove > below;
      const listW = Math.max(b.width, list.current?.offsetWidth ?? 0);
      const left = Math.max(MARGIN, Math.min(b.left, vw - MARGIN - listW));
      setPlace(
        above
          ? { left, bottom: vh - b.top + GAP, minWidth: b.width, maxHeight: Math.min(MAX_H, roomAbove), above }
          : { left, top: b.bottom + GAP, minWidth: b.width, maxHeight: Math.min(MAX_H, below), above },
      );
    };
    measure();
    let raf = 0;
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", later);
    window.addEventListener("scroll", later, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", later);
      window.removeEventListener("scroll", later, true);
    };
  }, [open]);

  // A press outside the button and the list closes it without a change.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !list.current?.contains(t)) hide(false);
    };
    document.addEventListener("pointerdown", down, true);
    return () => document.removeEventListener("pointerdown", down, true);
  });

  // The closing list stays for one --ui-menu fade, then unmounts.
  useEffect(() => {
    if (!closing) return;
    const t = window.setTimeout(() => setClosing(false), UI.menu * 1000 + 20);
    return () => window.clearTimeout(t);
  }, [closing]);

  // The highlight slides to the active option (transform only); the active option scrolls into view.
  useLayoutEffect(() => {
    const ul = list.current;
    const mark = hl.current;
    if (!open || !ul || !mark) return;
    const li = ul.querySelector<HTMLElement>(`[data-i="${active}"]`);
    if (!li) {
      mark.dataset.on = "";
      return;
    }
    const first = mark.dataset.on !== "1";
    if (first) mark.style.transition = "none";
    mark.style.height = `${li.offsetHeight}px`;
    mark.style.transform = `translateY(${li.offsetTop}px)`;
    mark.dataset.on = "1";
    if (first) {
      void mark.offsetWidth;
      mark.style.transition = "";
    }
    li.scrollIntoView?.({ block: "nearest" });
  }, [open, active, place]);

  const cur = options[selIdx];
  const optId = (i: number) => `${id}-o${i}`;

  return (
    <>
      <button
        ref={btn}
        type="button"
        role="combobox"
        className={`ui-select${p.className ? ` ${p.className}` : ""}`}
        aria-label={p.label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={shown ? `${id}-list` : undefined}
        aria-activedescendant={open && active >= 0 ? optId(active) : undefined}
        disabled={p.disabled}
        onClick={() => (open ? hide() : show(selIdx))}
        onKeyDown={onKey}
        onBlur={(e) => {
          if (!list.current?.contains(e.relatedTarget as Node)) hide(false);
        }}
      >
        <span className="ui-select-value">{cur ? cur.label : (p.placeholder ?? "—")}</span>
        <svg className="ui-select-chev" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">
          <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      {shown &&
        createPortal(
          <div
            ref={list}
            className={`ui-listbox${place?.above ? " is-above" : ""}${open ? "" : " is-closing"}`}
            style={
              place
                ? { left: place.left, top: place.top, bottom: place.bottom, minWidth: place.minWidth, maxHeight: place.maxHeight }
                : { left: 0, top: 0, visibility: "hidden" }
            }
            // Keep focus on the button: a press on the list must not blur it.
            onMouseDown={(e) => e.preventDefault()}
          >
            <span ref={hl} className="ui-listbox-hl" aria-hidden="true" />
            <ul id={`${id}-list`} role="listbox" aria-label={p.label}>
              {options.map((o, i) => (
                <li
                  key={String(o.value)}
                  id={optId(i)}
                  data-i={i}
                  role="option"
                  aria-selected={i === selIdx}
                  aria-disabled={o.disabled || undefined}
                  className={i === active ? "is-active" : undefined}
                  onPointerMove={() => !o.disabled && i !== active && setActive(i)}
                  onClick={() => !o.disabled && choose(i)}
                >
                  {o.label}
                </li>
              ))}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
