// URL builders for checking a site against NASA services. Pure functions, no network.
// Formats, checked against the services (2026-11):
//  - Horizons API: https://ssd-api.jpl.nasa.gov/doc/horizons.html (CENTER='coord@301', SITE_COORD =
//    'E-lon deg, lat deg, altitude km', QUANTITIES 4 = apparent az/el). Probe: task/_arch/00b-probe/hz_fetch.sh.
//  - QuickMap: the page reads `extent=lonMin,latMin,lonMax,latMax` (degrees) from the query string.
//  - Moon Trek: permalink in the hash `#v=0.1&x&y&z&p`; p is the projection URN from
//    trek.nasa.gov/moon/jpl/config/config.json (equirect EPSG::104903, south pole IAU2000::30120, metres).
import { stereoXY } from "./format";

export type LinkSite = { lat: number | null; lonE: number | null; elevM: number | null };
export type NasaLinks = { quickMap: string | null; moonTrek: string | null; horizons: string | null };

const HORIZONS = "https://ssd.jpl.nasa.gov/api/horizons.api";
const QUICKMAP = "https://quickmap.lroc.asu.edu/";
const TREK = "https://trek.nasa.gov/moon/";
const TREK_EQUIRECT = "urn:ogc:def:crs:EPSG::104903";
const TREK_SOUTH_POLE = "urn:ogc:def:crs:IAU2000::30120";
/** Moon Trek uses polar x/y south of this latitude (task #63). */
const POLAR_LAT = -80;
const TREK_ZOOM = 6;
/** QuickMap window: half-height in degrees of latitude. */
const WINDOW_DEG = 0.25;

const num = (v: number, digits: number) => Number(v.toFixed(digits));
const wrap360 = (lon: number) => ((lon % 360) + 360) % 360;
const wrap180 = (lon: number) => wrap360(lon + 180) - 180;

/** Horizons: Sun az/el, hourly, for the UTC day of `atUtc`. Height is km above the 1737.4 km sphere. */
function horizonsUrl(lat: number, lonE: number, elevM: number | null, atUtc: string): string | null {
  const t = new Date(atUtc);
  if (Number.isNaN(t.getTime())) return null;
  const day = t.toISOString().slice(0, 10);
  const q = new URLSearchParams({
    format: "text",
    COMMAND: "'10'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@301'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${num(wrap360(lonE), 6)},${num(lat, 6)},${num((elevM ?? 0) / 1000, 6)}'`,
    START_TIME: `'${day} 00:00'`,
    STOP_TIME: `'${day} 23:00'`,
    STEP_SIZE: "'1 h'",
    QUANTITIES: "'4'",
    APPARENT: "'AIRLESS'",
    ANG_FORMAT: "'DEG'",
  });
  return `${HORIZONS}?${q}`;
}

/** QuickMap: a lon/lat window around the site; the window is wider in longitude near the pole. */
function quickMapUrl(lat: number, lonE: number): string {
  const lon = wrap180(lonE);
  const dLon = Math.min(WINDOW_DEG / Math.max(Math.cos((lat * Math.PI) / 180), 1e-6), 90);
  const box = [
    Math.max(-180, lon - dLon),
    Math.max(-90, lat - WINDOW_DEG),
    Math.min(180, lon + dLon),
    Math.min(90, lat + WINDOW_DEG),
  ];
  return `${QUICKMAP}?extent=${box.map((v) => num(v, 4)).join(",")}`;
}

/** Moon Trek: polar stereographic metres south of 80°S, longitude/latitude degrees elsewhere. */
function moonTrekUrl(lat: number, lonE: number): string {
  const polar = lat < POLAR_LAT;
  const [x, y] = polar ? stereoXY(lat, lonE) : [wrap180(lonE), lat];
  const q = new URLSearchParams({
    v: "0.1",
    x: String(num(x, polar ? 1 : 4)),
    y: String(num(y, polar ? 1 : 4)),
    z: String(TREK_ZOOM),
    p: polar ? TREK_SOUTH_POLE : TREK_EQUIRECT,
  });
  return `${TREK}#${q}`;
}

/** null links mean "cannot build"; the maps need coordinates, Horizons also needs a valid date. */
export function buildNasaLinks(site: LinkSite, atUtc: string): NasaLinks {
  const { lat, lonE } = site;
  if (lat === null || lonE === null || !Number.isFinite(lat) || !Number.isFinite(lonE) || Math.abs(lat) > 90) {
    return { quickMap: null, moonTrek: null, horizons: null };
  }
  return {
    quickMap: quickMapUrl(lat, lonE),
    moonTrek: moonTrekUrl(lat, lonE),
    horizons: horizonsUrl(lat, lonE, site.elevM, atUtc),
  };
}
