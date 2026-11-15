import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Site } from "../contracts";
import { DEFAULT_PLAN, type MissionState } from "../mission/types";
import { resetHoursCache } from "../route/hours";
import { TimeSheet } from "./TimeSheet";

const site = { id: "a", name: "Alpha", group: "ridge", lat: -89, lonE: 200 } as Site;
const NONE: MissionState = { plan: null, original: null, selected: null };
const plan = { ...DEFAULT_PLAN, siteId: "a", landingUtc: "2027-03-10T06:00:00Z" };

function mount(props: Partial<Parameters<typeof TimeSheet>[0]>) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  const seen: string[] = [];
  const landed: string[] = [];
  act(() =>
    root.render(
      <TimeSheet
        atUtc="2027-01-15T00:00:00Z"
        onAtUtc={(t) => seen.push(t)}
        sites={[site]}
        mission={NONE}
        onMoveLanding={(t) => landed.push(t)}
        {...props}
      />,
    ),
  );
  const btn = (name: string) =>
    [...el.querySelectorAll("button")].find((b) => b.textContent === name || b.getAttribute("aria-label") === name)!;
  return { el, root, seen, landed, btn };
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetHoursCache();
  document.body.innerHTML = "";
});

describe("TimeSheet", () => {
  // #298: under the scale only the timeline: no Play, zoom, Now, steps, date field or DSN band.
  it("keys on the strip change the shared moment; no buttons under the scale", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const { el, root, seen } = mount({});
    expect(el.querySelectorAll(".hud button:not(.hud-legend-hint)")).toHaveLength(0);
    expect(el.querySelector(".hud-dsn")).toBeNull();
    const strip = el.querySelector<HTMLCanvasElement>('[role="slider"][aria-label="Scrub date"]')!;
    const key = (k: string, shiftKey = false) => act(() => strip.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true })));
    key("ArrowRight", true);
    expect(seen.at(-1)).toBe("2027-01-16T00:00:00Z");
    key("ArrowLeft");
    expect(seen.at(-1)).toBe("2027-01-14T23:00:00Z");
    key("PageDown");
    expect(seen.at(-1)).toBe("2027-02-13T13:00:00Z");
    const hint = el.querySelector(".hud-legend-hint")!; // #313: the T key is named under the band keys
    expect(hint.textContent).toBe("T set date");
    expect(hint.getAttribute("aria-keyshortcuts")).toBe("T");
    expect(hint.tagName).toBe("BUTTON"); // #461: SET DATE opens the picker by click too
    expect(el.querySelector(".hud-now")!.textContent).toBe("2027-01-15 00:00 UTC"); // #461: over the playhead
    const legend = el.querySelector(".hud-legend")!.textContent!.replace(hint.textContent!, "");
    expect(legend.replace(/\s+/g, " ").trim()).toBe("Alpha Sun-lit Earth in view");
    expect(el.textContent).toContain("2027-01-15 00:00 UTC");
    expect(strip.getAttribute("aria-valuetext")).toBe("JAN 15 2027 00:00 UTC");
    act(() => root.unmount());
  });

  it("date picker: days coloured by window quality, a click moves the landing inside the slip range", async () => {
    const n = 396 * 24 + 1;
    const codes = "3".repeat(24 * 100) + "1".repeat(n - 24 * 100); // both for 100 days (to Mar 11), then Sun only
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ startUtc: "2026-12-01T00:00:00Z", stepMin: 60, n, sites: { a: codes } })));
    const { el, root, seen, landed, btn } = mount({ mission: { plan, original: plan, selected: null } });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "t" })));
    const day = (iso: string) => el.querySelector<HTMLButtonElement>(`.dp-day[aria-label^="${iso}:"]`)!;
    expect(el.querySelector('[role="dialog"]')!.getAttribute("aria-label")).toBe("Date picker");
    expect(day("2027-03-10").className).toContain("is-landing");
    expect(day("2027-03-10").className).toContain("q-sun"); // under 1 day of both in a 14-day window
    expect(day("2027-03-01").className).toContain("q-both"); // both until Mar 11
    expect(day("2027-03-20").className).toContain("q-sun");
    expect(day("2027-03-20").getAttribute("aria-label")).toBe("2027-03-20: Sun + Earth 0 % of the window, mostly sun only");
    expect(day("2027-04-09").disabled).toBe(false); // +30 d
    expect(day("2027-04-10").disabled).toBe(true);
    act(() => day("2027-03-15").click());
    expect(landed.at(-1)).toBe("2027-03-15T06:00:00Z");
    expect(seen.at(-1)).toBe("2027-03-15T06:00:00Z");
    act(() => btn("Previous month").click());
    expect(day("2027-02-24").disabled).toBe(false); // −14 d
    expect(day("2027-02-23").disabled).toBe(true);
    act(() => btn("Done").click());
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });

  it("date picker of a moved plan: the new landing day, the slip range from the original", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const moved = { ...plan, landingUtc: "2027-03-13T06:00:00Z" };
    const { el, root } = mount({ mission: { plan: moved, original: plan, selected: null } });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "T" })));
    const day = (iso: string) => el.querySelector<HTMLButtonElement>(`.dp-day[aria-label^="${iso}:"]`)!;
    expect(day("2027-03-13").className).toContain("is-landing");
    expect(day("2027-04-09").disabled).toBe(false); // original + 30 d
    expect(day("2027-04-10").disabled).toBe(true);
    act(() => root.unmount());
  });

  // #484: the hour next to the date: arrows, wheel and typing set it, a day click keeps it, Enter applies it.
  it("date picker: hour 00-23 by arrows, wheel and typing; a day keeps it, Enter applies", () => {
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    const { el, root, seen, btn } = mount({});
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "t" })));
    const box = el.querySelector<HTMLInputElement>('[role="spinbutton"][aria-label="Hour (UTC)"]')!;
    expect(box.value).toBe("00");
    const key = (k: string) => act(() => box.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));
    key("ArrowDown");
    expect(box.value).toBe("23"); // wraps
    key("ArrowUp");
    key("ArrowUp");
    expect(box.getAttribute("aria-valuenow")).toBe("1");
    act(() => btn("Hour later").click());
    act(() => box.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true })));
    expect(box.value).toBe("03");
    const day = (iso: string) => el.querySelector<HTMLButtonElement>(`.dp-day[aria-label^="${iso}:"]`)!;
    act(() => day("2027-01-20").click());
    expect(seen.at(-1)).toBe("2027-01-20T03:00:00Z"); // the day keeps the hour
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(box, "17");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(box.getAttribute("aria-valuenow")).toBe("17");
    key("Enter");
    expect(seen.at(-1)).toBe("2027-01-15T17:00:00Z"); // the current day at the typed hour
    expect(el.querySelector('[role="dialog"]')).toBeNull();
    act(() => root.unmount());
  });

  // #229: the dock follows the site the user looks at, not the plan's site.
  it("follows the focused site: its name and next events, even when the plan is on another site", async () => {
    const n = 396 * 24 + 1;
    // Site "a": Sun up for 61 days, then down. Site "h": Sun up for 2 days, then down.
    const codes = (upH: number) => "1".repeat(upH) + "0".repeat(n - upH);
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ startUtc: "2026-12-01T00:00:00Z", stepMin: 60, n, sites: { a: codes(24 * 61), h: codes(24 * 2) } })),
    );
    const haworth = { id: "h", name: "Haworth", group: "ridge", lat: -87, lonE: 3 } as Site;
    const planA = { ...plan, siteId: "a" };
    const state: MissionState = { plan: planA, original: planA, selected: null };
    const { el, root } = mount({
      atUtc: "2026-12-01T00:00:00Z",
      sites: [site, haworth],
      catalog: [site, haworth],
      mission: state,
      focusId: "h",
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    const legend = () => el.querySelector(".hud-legend-site")!.textContent;
    const nextText = () => el.querySelector('[aria-label="Next events"]')!.textContent!.replace(/\s+/g, " ");
    expect(legend()).toBe("Haworth");
    expect(nextText()).toContain("Sunset in 2.0 d");
    // Another site in focus: the name and the event change with it.
    act(() =>
      root.render(
        <TimeSheet atUtc="2026-12-01T00:00:00Z" onAtUtc={() => {}} sites={[site, haworth]} catalog={[site, haworth]} mission={state} onMoveLanding={() => {}} focusId="a" />,
      ),
    );
    expect(legend()).toBe("Alpha");
    expect(nextText()).toContain("Sunset in 61.0 d");
    act(() => root.unmount());
  });

  // #369: the Earth eclipse of the focused site: a line from its timeline and a link to the S7 check.
  it("names the next Earth eclipse of the site and links to the NASA check", async () => {
    const n = 396 * 24 + 1;
    const i0 = 24 * 259 + 5; // 2027-08-17 05:00 UTC
    const vis = [0.91, 0.54, 0.66];
    const tl = {
      siteId: "e",
      startUtc: "2026-12-01T00:00:00Z",
      stepMin: 60,
      sunAz: new Array(n).fill(100),
      sunEl: new Array(n).fill(5),
      sunVisible: new Array(n).fill(1).map((v, i) => (i >= i0 && i < i0 + 3 ? vis[i - i0] : v)),
      earthAz: new Array(n).fill(100),
      earthEl: new Array(n).fill(0).map((_, i) => (i >= i0 && i < i0 + 3 ? 6 : 20)),
      earthVisible: new Array(n).fill(1),
    };
    const mask = { siteId: "e", observerHeightM: 2, terrain: "polar80", azStepDeg: 0.5, elevDeg: new Array(720).fill(2) };
    const hoursFile = { startUtc: "2026-12-01T00:00:00Z", stepMin: 60, n, sites: { e: "1".repeat(n) } };
    vi.stubGlobal("fetch", async (url: string) =>
      new Response(JSON.stringify(url.includes("timeline/e.json") ? tl : url.includes("mask/e.json") ? mask : hoursFile)),
    );
    const eSite = { id: "e", name: "Echo", group: "ridge", lat: -87, lonE: 3 } as Site;
    const popped: string[] = [];
    const onPop = () => popped.push(window.location.hash);
    window.addEventListener("popstate", onPop);
    const { el, root } = mount({ atUtc: "2027-08-01T00:00:00Z", sites: [eSite], catalog: [eSite], focusId: "e" });
    await act(async () => {
      for (let k = 0; k < 5; k++) await new Promise((r) => setTimeout(r, 0));
    });
    const line = el.querySelector('[aria-label="Earth eclipse"]')!;
    expect(line.querySelector(".hud-eclipse-text")!.textContent).toBe("Earth eclipse 2027-08-17: up to 46 % of the Sun hidden for ~3 h");
    const link = line.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("#step=check");
    act(() => link.click());
    expect(popped).toEqual(["#step=check"]);
    expect(el.querySelectorAll(".hud button:not(.hud-legend-hint)")).toHaveLength(0); // #298 still: no buttons under the scale
    // After the eclipse no line is left.
    act(() =>
      root.render(
        <TimeSheet atUtc="2027-08-18T00:00:00Z" onAtUtc={() => {}} sites={[eSite]} catalog={[eSite]} mission={NONE} onMoveLanding={() => {}} focusId="e" />,
      ),
    );
    expect(el.querySelector('[aria-label="Earth eclipse"]')).toBeNull();
    window.removeEventListener("popstate", onPop);
    history.replaceState(null, "", "#");
    act(() => root.unmount());
  });
});
