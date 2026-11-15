import { describe, expect, it } from "vitest";
import type { Timeline } from "../contracts";
import { slipRows } from "./slip";

// 10 days hourly: Sun lit only on day 5, Earth always.
const n = 240;
const tl = {
  siteId: "s", startUtc: "2027-01-01T00:00:00Z", stepMin: 60,
  sunVisible: Array.from({ length: n }, (_, k) => (k >= 120 && k < 144 ? 1 : 0)),
  earthVisible: Array(n).fill(1),
} as unknown as Timeline;

describe("slipRows", () => {
  it("shifts the window by whole days, counts shares and the longest dark run, null past the data", () => {
    const [a, b, c] = slipRows(tl, "2027-01-04T00:00:00Z", 2, [0, 1, 6]);
    expect(a).toEqual({ slipD: 0, atUtc: "2027-01-04T00:00:00Z", sun: 0, earth: 1, longestDarkH: 48 });
    expect(b).toMatchObject({ slipD: 1, sun: 0.5, longestDarkH: 24 });
    expect(c).toBeNull();
  });
});
