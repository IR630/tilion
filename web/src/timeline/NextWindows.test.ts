import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeHours, type Hours } from "../route/hours";
import { drawBands, EARTH_Y, type Palette, SUN_Y } from "./HudStrip";
import { bandRuns, HOUR, nextWindows } from "./time";
import { windowText } from "./NextWindows";

// #196: the "Next windows" list and the strip's two bands come from one helper (bandRuns) over the
// same hours.json codes, so a window in the list is exactly a band drawn on the strip.

const START = "2027-01-15T00:00:00Z";
const T = Date.parse(START);
// 0 none, 1 Sun, 2 Earth, 3 both; 60 hourly steps.
const CODES = "3333300011112222333333000000111111222222000033330000111122221";
const hours: Hours = decodeHours({ startUtc: START, stepMin: 60, n: CODES.length, sites: { s: CODES } });

/** Rectangles drawBands puts into each band's path, as [x0, x1) in px, clipped to the canvas. */
function drawnRuns(atMs: number, pw: number): Record<"sun" | "earth", [number, number][]> {
  const out: Record<"sun" | "earth", [number, number][]> = { sun: [], earth: [] };
  class FakePath {
    rects: [number, number, number][] = [];
    rect(x: number, y: number, w: number) {
      this.rects.push([x, y, w]);
    }
  }
  vi.stubGlobal("Path2D", FakePath);
  const ctx = {
    fillStyle: "",
    globalAlpha: 1,
    fillRect: () => {},
    fill: (p: FakePath) => {
      for (const [x, y, w] of p.rects) {
        const a = Math.max(0, x);
        const b = Math.min(pw, x + w);
        if (b > a) (y === SUN_Y ? out.sun : y === EARTH_Y ? out.earth : []).push([a, b]);
      }
    },
  } as unknown as CanvasRenderingContext2D;
  const P = { line: "#111", sun: "#f60", earth: "#36f" } as Palette;
  drawBands(ctx, { start: atMs, msPerPx: HOUR }, pw, hours, "s", P); // one hour per pixel
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe("next windows (#196)", () => {
  it("bandRuns: runs of a bit as [start, end) steps", () => {
    expect(bandRuns(hours.sites.get("s")!.codes, 2, 0, 20)).toEqual([[0, 5], [12, 20]]);
    expect(bandRuns(hours.sites.get("s")!.codes, 1, 0, 12)).toEqual([[0, 5], [8, 12]]);
  });

  it("the list equals the bands drawn on the strip over the same period", () => {
    for (const [atH, spanH] of [[0, 60], [3, 30], [17, 20], [40, 20]]) {
      const at = T + atH * HOUR;
      const drawn = drawnRuns(at, spanH);
      for (const [kind, bit] of [["sun", 1], ["earth", 2]] as const) {
        const list = nextWindows(hours, "s", at, spanH * HOUR, bit).map((w) => [(w.startMs - at) / HOUR, (w.clipEndMs - at) / HOUR]);
        expect(list, `${kind} from h${atH} over ${spanH} h`).toEqual(drawn[kind]);
      }
    }
  });

  it("marks a window already open at the moment and gives the true end past the period", () => {
    const at = T + 2 * HOUR;
    const [first] = nextWindows(hours, "s", at, 10 * HOUR, 2);
    expect(first.ongoing).toBe(true);
    expect(first.startMs).toBe(at);
    expect(first.endMs).toBe(T + 5 * HOUR);
    expect(first.hours).toBe(3);
    const late = nextWindows(hours, "s", T + 13 * HOUR, 2 * HOUR, 2)[0];
    expect(late.clipEndMs).toBe(T + 15 * HOUR);
    expect(late.endMs).toBe(T + 22 * HOUR); // Earth "2222" + "333333": steps 12..21
    expect(late.openEnd).toBe(false);
  });

  it("an unknown site or a moment outside the data gives no windows", () => {
    expect(nextWindows(hours, "nope", T, 10 * HOUR, 1)).toEqual([]);
    expect(nextWindows(hours, "s", T + 100 * HOUR, 10 * HOUR, 1)).toEqual([]);
  });

  // #210: tester №4 read "Feb 06 05:00 – Feb 20 08:00" under "next 30 d" (day 30 = Feb 14) as a conflict
  // with the 30-day share. A window past the period is cut there with an arrow and names its true end.
  it("a window past the period is cut at its end and says where it continues", () => {
    const late = nextWindows(hours, "s", T + 10 * HOUR, 8 * HOUR, 2)[0]; // Earth steps 12..21, period ends at 18
    expect(windowText(late)).toEqual({ range: "Jan 15 12:00 – Jan 15 18:00 →", cont: "continues to Jan 15 22:00" });
    const inside = nextWindows(hours, "s", T, 60 * HOUR, 2)[1];
    expect(inside.endMs).toBeLessThanOrEqual(inside.clipEndMs);
    expect(windowText(inside)).toEqual({ range: "Jan 15 12:00 – Jan 15 22:00", cont: null });
    const open = nextWindows(hours, "s", T + 2 * HOUR, 60 * HOUR, 2)[0];
    expect(windowText(open).range).toBe("now – Jan 15 05:00");
  });
});
