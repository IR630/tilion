import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { Info } from "./Info";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
});

// jsdom has no Popover API: a minimal stand-in that keeps :popover-open and fires toggle.
function stubPopover(el: HTMLElement) {
  let open = false;
  const fire = (state: string) => el.dispatchEvent(Object.assign(new Event("toggle"), { newState: state, oldState: open ? "open" : "closed" }));
  Object.assign(el, {
    showPopover: () => {
      open = true;
      fire("open");
    },
    hidePopover: () => {
      open = false;
      fire("closed");
    },
  });
  const matches = el.matches.bind(el);
  Object.assign(el, { matches: (q: string) => (q === ":popover-open" ? open : matches(q)) });
  return () => open;
}

it("shows only the mark; the note is in the DOM; a click pins it open, a second click or a click outside closes it", () => {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  act(() => root.render(<Info label="About the share">Gläser 2018 gives the mean visible fraction.</Info>));
  const mark = el.querySelector<HTMLButtonElement>("button.info-mark")!;
  expect(mark.textContent).toBe("?");
  expect(mark.getAttribute("aria-label")).toBe("About the share");
  const pop = document.getElementById(mark.getAttribute("aria-controls")!)!;
  expect(pop.getAttribute("popover")).toBe("manual");
  expect(pop.textContent).toBe("Gläser 2018 gives the mean visible fraction.");
  const isOpen = stubPopover(pop);

  act(() => mark.click());
  expect(isOpen()).toBe(true);
  expect(mark.getAttribute("aria-expanded")).toBe("true");
  act(() => mark.click());
  expect(isOpen()).toBe(false);

  act(() => mark.click());
  act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
  expect(isOpen()).toBe(false);
  expect(mark.getAttribute("aria-expanded")).toBe("false");
  act(() => root.unmount());
});

function mount() {
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  act(() => root.render(<Info label="About the share">Note.</Info>));
  const mark = el.querySelector<HTMLButtonElement>("button.info-mark")!;
  const isOpen = stubPopover(document.getElementById(mark.getAttribute("aria-controls")!)!);
  return { mark, isOpen, root };
}

it("Esc closes the popover and stops there, so the sheet under it stays open", () => {
  const { mark, isOpen, root } = mount();
  const sheet = vi.fn();
  window.addEventListener("keydown", sheet);
  act(() => mark.click());
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(isOpen()).toBe(false);
  expect(sheet).not.toHaveBeenCalled();
  window.removeEventListener("keydown", sheet);
  act(() => root.unmount());
});

it("a scroll that takes the mark off screen closes it; a resize keeps it open", () => {
  const { mark, isOpen, root } = mount();
  act(() => mark.click());
  act(() => window.dispatchEvent(new Event("resize")));
  expect(isOpen()).toBe(true);
  mark.getBoundingClientRect = () => ({ top: -40, bottom: -25, left: 0, right: 15, width: 15, height: 15, x: 0, y: -40, toJSON: () => ({}) });
  act(() => document.dispatchEvent(new Event("scroll")));
  expect(isOpen()).toBe(false);
  act(() => root.unmount());
});

it("hover opens after a short delay and leaving closes it unless pinned", () => {
  vi.useFakeTimers();
  const { mark, isOpen, root } = mount();
  act(() => mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
  expect(isOpen()).toBe(false);
  act(() => vi.advanceTimersByTime(150));
  expect(isOpen()).toBe(true);
  act(() => mark.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
  act(() => vi.advanceTimersByTime(250));
  expect(isOpen()).toBe(false);
  act(() => root.unmount());
});
