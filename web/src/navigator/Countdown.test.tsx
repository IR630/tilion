import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { Timeline } from "../contracts";
import { Countdown } from "./Countdown";
import { nextVisibilityEvent, statusCard, sunsetDirection, sunsetTone } from "./countdownTime";

const tl: Timeline = {
  siteId: "t", startUtc: "2027-01-01T00:00:00Z", stepMin: 60,
  sunVisible: [1, 0.5, 0.1, 0, 0, 1], earthVisible: [0, 0, 1, 1, 1, 1],
  sunAz: [0, 0, 0, 160, 180, 200], sunEl: [2, 2, 2, 1, -1, 1],
  earthAz: [0, 0, 0, 0, 0, 0], earthEl: [0, 0, 1, 1, 1, 1],
};

describe("countdown", () => {
  it("builds status cards: state, countdown word, no DSN data", () => {
    const d = { ...tl, earthVisible: [0, 0, 1, 1, 0, 0], dsnVisible: [0, 0, 1, 1, 0, 0] };
    expect(statusCard(d, "2027-01-01T01:00:00Z", "sun")).toEqual({ state: "Up", up: true, when: "sets in 2 h" });
    expect(statusCard(d, "2027-01-01T03:00:00Z", "sun")).toEqual({ state: "Down", up: false, when: "rises in 2 h" });
    expect(statusCard(d, "2027-01-01T01:00:00Z", "earth")).toEqual({ state: "Hidden", up: false, when: "rises in 1 h" });
    expect(statusCard(d, "2027-01-01T02:00:00Z", "earth")).toEqual({ state: "In view", up: true, when: "sets in 2 h" });
    expect(statusCard(d, "2027-01-01T02:00:00Z", "dsn")).toEqual({ state: "Up", up: true, when: "ends in 2 h" });
    expect(statusCard(d, "2027-01-01T00:00:00Z", "dsn")).toEqual({ state: "Down", up: false, when: "opens in 2 h" });
    expect(statusCard(tl, "2027-01-01T00:00:00Z", "dsn").when).toBe("no DSN data");
  });
  it("counts from the shared moment and treats partial sunlight as visible", () => {
    expect(nextVisibilityEvent(tl, "2027-01-01T01:00:00Z", "sun")).toEqual({
      index: 3, hours: 2, utc: "2027-01-01T03:00:00Z", leftH: 4,
    });
    expect(nextVisibilityEvent(tl, "2027-01-01T01:00:00Z", "earth")?.hours).toBe(1);
    expect(nextVisibilityEvent(tl, "2026-12-31T23:00:00Z", "sun")).toBeNull();
  });
  it("gives a lower bound to the last sample when no event remains", () => {
    expect(nextVisibilityEvent(tl, "2027-01-01T03:00:00Z", "earth")).toEqual({
      index: null, hours: null, utc: null, leftH: 2,
    });
  });
  it("distinguishes terrain occultation from a disc below the horizon", () => {
    expect(sunsetDirection(tl, 3, "polar80")).toBe("behind terrain, SSE, az 160°");
    expect(sunsetDirection({ ...tl, sunEl: [2, 2, 2, -1] }, 3, "polar80")).toBe("below horizon");
    expect(sunsetDirection(tl, 3, "none")).toBe("below horizon");
    expect(sunsetDirection({ ...tl, sunEl: [2, 2, 2, -0.1] }, 3, "polar80")).toContain("behind terrain");
  });
  it.each([[11, "red"], [12, "yellow"], [48, "yellow"], [49, "green"], [null, "neutral"]] as const)(
    "uses the sunset warning boundary at %s hours", (hours, tone) => {
      expect(sunsetTone(hours)).toBe(tone);
    },
  );
  it("shows clickable event rows and moves the shared time to the event", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    const root = createRoot(el);
    let picked = "";
    const render = (body: "sun" | "earth", atUtc = "2027-01-01T01:00:00Z") =>
      root.render(<Countdown tl={tl} atUtc={atUtc} body={body} terrain="polar80" onChange={(t) => { picked = t; }} />);
    try {
      await act(async () => render("sun"));
      expect(el.textContent).toContain("Sunset in 2 h");
      expect(el.textContent).toContain("behind terrain, SSE, az 160°");
      expect(el.querySelector("button")?.className).toContain("red");
      act(() => el.querySelector("button")!.click());
      expect(picked).toBe("2027-01-01T03:00:00Z");
      await act(async () => render("earth"));
      expect(el.textContent).toContain("Earthrise in 1 h");
      expect(el.querySelector("button")?.className).toContain("neutral");
      act(() => el.querySelector("button")!.click());
      expect(picked).toBe("2027-01-01T02:00:00Z");
      await act(async () => render("earth", "2027-01-01T03:00:00Z"));
      expect(el.textContent).toContain("Earthset in > 2 h"); // #162: hours under 48 h, as everywhere
      expect(el.querySelector("button")?.disabled).toBe(true);
      await act(async () => render("sun", "2027-01-01T03:00:00Z"));
      expect(el.textContent).toContain("Sunrise in 2 h");
      expect(el.querySelector("button")?.className).toContain("neutral");
    } finally {
      act(() => root.unmount());
    }
  });
});

describe("low Sun note (#196)", () => {
  it("explains a low Sun that stays up for days, under the sunset countdown", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const n = 24 * 5;
    const low: Timeline = {
      siteId: "low", startUtc: "2027-01-01T00:00:00Z", stepMin: 60,
      sunVisible: Array.from({ length: n }, (_, i) => (i < n - 10 ? 1 : 0)), earthVisible: Array(n).fill(1),
      sunAz: Array.from({ length: n }, (_, i) => (i * 15) % 360), sunEl: Array(n).fill(0.3),
      earthAz: Array(n).fill(0), earthEl: Array(n).fill(5),
    };
    const el = document.createElement("div");
    const root = createRoot(el);
    try {
      await act(async () => root.render(<Countdown tl={low} atUtc="2027-01-01T00:00:00Z" body="sun" terrain="polar80" onChange={() => {}} />));
      expect(el.textContent).toContain("Sun circles low along the horizon; stays above terrain for 4.6 d");
      await act(async () => root.render(<Countdown tl={tl} atUtc="2027-01-01T01:00:00Z" body="sun" terrain="polar80" onChange={() => {}} />));
      expect(el.textContent).not.toContain("circles low");
    } finally {
      act(() => root.unmount());
    }
  });
});
