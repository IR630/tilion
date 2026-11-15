import { describe, expect, it } from "vitest";
import { buildNasaLinks } from "./nasaLinkUrls";

const site = { lat: -89.475, lonE: 222.56, elevM: 1200 };
const hash = (url: string) => new URLSearchParams(new URL(url).hash.slice(1));

describe("external site links", () => {
  it("builds the fixed Horizons request: Sun az/el every hour of the UTC day", () => {
    expect(buildNasaLinks(site, "2027-01-15T17:30:00Z").horizons).toBe(
      "https://ssd.jpl.nasa.gov/api/horizons.api?format=text&COMMAND=%2710%27" +
        "&OBJ_DATA=%27NO%27&MAKE_EPHEM=%27YES%27&EPHEM_TYPE=%27OBSERVER%27" +
        "&CENTER=%27coord%40301%27&COORD_TYPE=%27GEODETIC%27&SITE_COORD=%27222.56%2C-89.475%2C1.2%27" +
        "&START_TIME=%272027-01-15+00%3A00%27&STOP_TIME=%272027-01-15+23%3A00%27" +
        "&STEP_SIZE=%271+h%27&QUANTITIES=%274%27&APPARENT=%27AIRLESS%27&ANG_FORMAT=%27DEG%27",
    );
  });

  it("keeps the longitude 0-360 east and the day in UTC across a year boundary", () => {
    const url = new URL(buildNasaLinks({ ...site, lonE: -137.44, elevM: -3650 }, "2028-01-01T01:00:00+02:00").horizons!);
    expect(url.searchParams.get("SITE_COORD")).toBe("'222.56,-89.475,-3.65'");
    expect(url.searchParams.get("START_TIME")).toBe("'2027-12-31 00:00'");
    expect(url.searchParams.get("STOP_TIME")).toBe("'2027-12-31 23:00'");
  });

  it("uses height 0 when the site has no elevation (sites.json has none yet)", () => {
    const url = new URL(buildNasaLinks({ ...site, elevM: null }, "2027-01-15").horizons!);
    expect(url.searchParams.get("SITE_COORD")).toBe("'222.56,-89.475,0'");
  });

  it("opens QuickMap on a lon/lat window around the site", () => {
    const url = new URL(buildNasaLinks(site, "2027-01-15").quickMap!);
    expect(url.origin + url.pathname).toBe("https://quickmap.lroc.asu.edu/");
    expect(url.searchParams.get("extent")).toBe("-164.7241,-89.725,-110.1559,-89.225");
  });

  it("clips the QuickMap window at the pole and at the date line", () => {
    const pole = new URL(buildNasaLinks({ ...site, lat: -90, lonE: 0 }, "2027-01-15").quickMap!);
    expect(pole.searchParams.get("extent")).toBe("-90,-90,90,-89.75");
    const edge = new URL(buildNasaLinks({ ...site, lat: -70, lonE: 179.9 }, "2027-01-15").quickMap!);
    const [lo, , hi] = edge.searchParams.get("extent")!.split(",").map(Number);
    expect(lo).toBeGreaterThanOrEqual(-180);
    expect(hi).toBeLessThanOrEqual(180);
  });

  it("uses Moon Trek south polar metres south of 80 S", () => {
    const h = hash(buildNasaLinks({ ...site, lat: -89, lonE: 90 }, "2027-01-15").moonTrek!);
    expect(h.get("v")).toBe("0.1");
    expect(h.get("p")).toBe("urn:ogc:def:crs:IAU2000::30120");
    expect(Number(h.get("x"))).toBeCloseTo(30324.1, 1);
    expect(Number(h.get("y"))).toBeCloseTo(0, 1);
    const h2 = hash(buildNasaLinks({ ...site, lat: -85, lonE: 25 }, "2027-01-15").moonTrek!);
    expect(Number(h2.get("x"))).toBeCloseTo(64116.7, 1);
    expect(Number(h2.get("y"))).toBeCloseTo(137498.7, 1);
  });

  it("uses Moon Trek degrees (-180..180) at 80 S and farther north", () => {
    for (const lat of [-80, 18.5623]) {
      const h = hash(buildNasaLinks({ ...site, lat }, "2027-01-15").moonTrek!);
      expect(h.get("p")).toBe("urn:ogc:def:crs:EPSG::104903");
      expect(Number(h.get("x"))).toBeCloseTo(-137.44);
      expect(Number(h.get("y"))).toBe(lat);
    }
  });

  it("does not invent coordinates and keeps the maps for a bad date", () => {
    const none = { quickMap: null, moonTrek: null, horizons: null };
    expect(buildNasaLinks({ ...site, lat: null }, "2027-01-15")).toEqual(none);
    for (const bad of [{ ...site, lat: 91 }, { ...site, lonE: NaN }, { ...site, lonE: null }]) {
      expect(buildNasaLinks(bad, "2027-01-15")).toEqual(none);
    }
    const links = buildNasaLinks(site, "invalid");
    expect(links.horizons).toBeNull();
    expect(links.quickMap).not.toBeNull();
    expect(links.moonTrek).not.toBeNull();
  });
});
