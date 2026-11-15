import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Guide, TOUR_STEP_MS } from "./Guide";

describe("Guide tour (#382)", () => {
  let el: HTMLDivElement;
  let root: Root;
  const count = () => el.querySelector(".guide-count")!.textContent;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    el = document.createElement("div");
    document.body.append(el);
    root = createRoot(el);
  });
  afterEach(() => {
    act(() => root.unmount());
    el.remove();
    vi.useRealTimers();
  });

  const show = (autoplay: boolean) => act(() => root.render(<Guide onStep={() => {}} onClose={() => {}} autoplay={autoplay} />));

  it("moves one step every 8 s and reaches the last step (NASA check) within 60 s", () => {
    expect(TOUR_STEP_MS).toBe(8000);
    show(true);
    expect(count()).toBe("1 / 6");
    act(() => vi.advanceTimersByTime(TOUR_STEP_MS - 1));
    expect(count()).toBe("1 / 6");
    act(() => vi.advanceTimersByTime(1));
    expect(count()).toBe("2 / 6");
    for (let i = 3; i <= 6; i++) {
      act(() => vi.advanceTimersByTime(TOUR_STEP_MS));
      expect(count()).toBe(`${i} / 6`);
    }
    expect(el.querySelector("h2")!.textContent).toBe("Check the evidence");
    act(() => vi.advanceTimersByTime(60_000)); // the last step stays
    expect(count()).toBe("6 / 6");
  });

  it("stops for good on a user interaction", () => {
    show(true);
    act(() => vi.advanceTimersByTime(TOUR_STEP_MS));
    expect(count()).toBe("2 / 6");
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    for (let i = 0; i < 5; i++) act(() => vi.advanceTimersByTime(TOUR_STEP_MS));
    expect(count()).toBe("2 / 6");
    expect(el.textContent).toContain("Tour paused");
  });

  it("does not play by itself when opened from the rail", () => {
    show(false);
    for (let i = 0; i < 3; i++) act(() => vi.advanceTimersByTime(TOUR_STEP_MS));
    expect(count()).toBe("1 / 6");
  });
});
