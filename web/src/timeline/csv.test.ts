import { describe, expect, it } from "vitest";
import type { Site, Timeline } from "../contracts";
import { timelineCsv } from "./csv";

const tl: Timeline = {
  siteId: "s", startUtc: "2026-12-01T00:00:00Z", stepMin: 60,
  sunAz: [10, 20], sunEl: [1.5, -0.25], sunVisible: [0.4, 0], earthAz: [5, 6], earthEl: [3, 4], earthVisible: [1, 0], dsnVisible: [1, 0],
};
const site = { id: "s", name: "S", lat: -89.5, lonE: 200, terrain: "lola80" } as unknown as Site;

describe("timelineCsv", () => {
  it("writes one row per step on the timeline clock, sun_lit = any visible share", () => {
    const rows = timelineCsv(site, tl).trim().split("\n").filter((l) => !l.startsWith("#"));
    expect(rows).toEqual([
      "utc,sun_az_deg,sun_el_deg,sun_visible,sun_lit,earth_az_deg,earth_el_deg,earth_visible,dsn",
      "2026-12-01T00:00Z,10.00,1.500,0.400,1,5.00,3.000,1,1",
      "2026-12-01T01:00Z,20.00,-0.250,0.000,0,6.00,4.000,0,0",
    ]);
  });
});
