import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { playTick } from "./timeline/time";
import { TimeSheet } from "./timeline/TimeSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const el = document.createElement("div");
let root = createRoot(el);
afterEach(() => {
  act(() => root.unmount());
  root = createRoot(el);
  document.querySelector(".globe")?.remove();
  window.history.replaceState({}, "", "/");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const render = (atUtc = "2027-01-15T00:00:00Z", onAtUtc = vi.fn()) => {
  vi.stubGlobal("fetch", () => new Promise(() => {})); // hours.json: not needed here
  act(() =>
    root.render(
      <TimeSheet
        atUtc={atUtc}
        onAtUtc={onAtUtc}
        sites={[]}
        mission={{ plan: null, original: null, selected: null }}
        onMoveLanding={vi.fn()}
      />,
    ),
  );
  return onAtUtc;
};
const button = () => [...el.querySelectorAll("button")].find((b) => b.textContent === "Rec");

it("hides recording unless rec=1", () => {
  for (const query of ["", "?rec=0", "?rec=1"]) {
    window.history.replaceState({}, "", "/" + query);
    render();
    expect(!!button()).toBe(query === "?rec=1");
  }
});

it.each(["vp9", "vp8"])("records at 60 fps with %s and downloads WebM with a UTC name", (codec) => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-15T00:10:20Z"));
  window.history.replaceState({}, "", "/?rec=1");
  const canvas = document.createElement("canvas");
  const scene = document.createElement("section");
  scene.className = "globe";
  canvas.dataset.ready = "1";
  canvas.setAttribute("aria-label", "3D globe of the Moon");
  scene.append(canvas);
  document.body.append(scene);
  const stopTrack = vi.fn();
  const stream = { getTracks: () => [{ stop: stopTrack }] };
  const capture = vi.fn(() => stream);
  Object.defineProperty(canvas, "captureStream", { value: capture });
  let recorder: FakeRecorder;
  class FakeRecorder {
    static isTypeSupported = (type: string) => type === `video/webm;codecs=${codec}`;
    state = "inactive";
    ondataavailable?: (event: { data: Blob }) => void;
    onstop?: () => void;
    mimeType: string;
    constructor(public stream: unknown, options: MediaRecorderOptions) {
      recorder = this;
      this.mimeType = options.mimeType!;
    }
    start() { this.state = "recording"; }
    stop() {
      this.state = "inactive";
      this.ondataavailable?.({ data: new Blob(["encoded frames"]) });
      this.onstop?.();
    }
  }
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  const createURL = vi.fn((_blob: Blob) => "blob:recording");
  const revokeURL = vi.fn();
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = createURL;
    static revokeObjectURL = revokeURL;
  });
  let download: HTMLAnchorElement | undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { download = this; });
  const onAtUtc = render();
  act(() => button()!.click());
  expect(capture).toHaveBeenCalledWith(60);
  expect(recorder!.mimeType).toBe(`video/webm;codecs=${codec}`);
  const tick = playTick(6);
  act(() => vi.advanceTimersByTime(tick.ms)); // time plays while it records (#298: no Play button)
  expect(onAtUtc).toHaveBeenLastCalledWith(`2027-01-15T${String(tick.hours).padStart(2, "0")}:00:00Z`);
  act(() => [...el.querySelectorAll("button")].find((b) => b.textContent === "Stop recording")!.click());
  onAtUtc.mockClear();
  render("2027-01-15T02:00:00Z", onAtUtc); // the app's next moment: a playing dock would step on from it
  act(() => vi.advanceTimersByTime(tick.ms * 4));
  expect(onAtUtc).not.toHaveBeenCalled(); // the stop ends playback
  expect(download?.download).toBe("tilion-2026-11-15T00-10-20Z.webm");
  expect(createURL.mock.calls[0][0].type).toBe(`video/webm;codecs=${codec}`);
  expect(stopTrack).toHaveBeenCalledOnce();
  act(() => vi.runOnlyPendingTimers());
  expect(revokeURL).toHaveBeenCalledWith("blob:recording");
});

it("asks for a ready 3D canvas without starting playback", () => {
  window.history.replaceState({}, "", "/?rec=1");
  vi.useFakeTimers();
  const onAtUtc = render();
  act(() => button()!.click());
  expect(el.querySelector('[role="alert"]')?.textContent).toContain("Open Globe or 3D terrain");
  act(() => vi.advanceTimersByTime(4000));
  expect(onAtUtc).not.toHaveBeenCalled();
});
