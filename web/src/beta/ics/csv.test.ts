import { expect, it } from "vitest";
import type { Site, Timeline } from "../../contracts";
import { buildCsv } from "./csv";

it("exports each sample with UTC time, normalized longitude and missing DSN", () => {
  const site = { name: "Custom", lat: -85, lonE: -10, source: "LOLA" } as Site;
  const tl = { startUtc: "2027-01-01T00:00:00Z", stepMin: 60, sunEl: [1, 2], sunAz: [3, 4], sunVisible: [0.5, 0], earthEl: [5, 6], earthAz: [7, 8], earthVisible: [1, 0] } as Timeline;
  const lines = buildCsv(site, tl).trim().split("\r\n");
  expect(lines[0]).toContain("longitude: 350 E");
  expect(lines[1]).toBe("time_utc,sun_el_deg,sun_az_deg,sun_visible_frac,earth_el_deg,earth_az_deg,earth_visible,dsn_visible");
  expect(lines.slice(2)).toEqual(["2027-01-01T00:00:00.000Z,1,3,0.5,5,7,1,", "2027-01-01T01:00:00.000Z,2,4,0,6,8,0,"]);
});
