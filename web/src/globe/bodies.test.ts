import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Site, Timeline } from "../contracts";
import { dirsAt, earthAxes, sepDeg, siteAzEl, sunFromMoonIau, tween, type Vec3 } from "./bodies";
import { lonLatToVec, type Subpoints } from "./geo";

const pub = (f: string) => resolve(__dirname, "../../public/data", f);
const json = <T,>(f: string) => JSON.parse(readFileSync(pub(f), "utf8")) as T;
const sub = json<Subpoints>("globe/subpoints.json");
const sites = json<{ sites: Site[] } | Site[]>("sites.json");
const siteList: Site[] = Array.isArray(sites) ? sites : sites.sites;
const H = 3600000;
const t0 = Date.parse(sub.startUtc);
const azDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("globe bodies (#157)", () => {
  it("at a whole hour the drawn Sun and Earth are the SPICE points; between hours on the unit sphere", () => {
    const i = 1234;
    const d = dirsAt(sub, t0 + i * H);
    expect(sepDeg(d.sun, lonLatToVec(sub.sunLonE[i], sub.sunLat[i]))).toBeLessThan(1e-6);
    expect(sepDeg(d.earth, lonLatToVec(sub.earthLonE[i], sub.earthLat[i]))).toBeLessThan(1e-6);
    const h = dirsAt(sub, t0 + (i + 0.5) * H);
    expect(Math.hypot(...h.sun)).toBeCloseTo(1, 9);
    // Half an hour: half the hourly step, no jump.
    expect(sepDeg(h.sun, d.sun)).toBeCloseTo(sepDeg(d.sun, dirsAt(sub, t0 + (i + 1) * H).sun) / 2, 4);
    expect(dirsAt(sub, t0 - 10 * H).clamped).toBe(true);
    expect(dirsAt(sub, t0 + 10 * H).clamped).toBe(false);
  });

  // The on-screen Sun and Earth (the directions the scene draws) give the site's timeline az/el.
  for (const id of ["a_haworth", "a_malapert_massif"]) {
    it(`on-screen Sun and Earth directions match timeline/${id}.json`, () => {
      const tl = json<Timeline>(`timeline/${id}.json`);
      const s = siteList.find((x) => x.id === id) as Site;
      expect(tl.startUtc).toBe(sub.startUtc);
      for (const i of [0, 777, 3000, 6100, 9000]) {
        const d = dirsAt(sub, t0 + i * H);
        const site: [number, number] = [s.lonE as number, s.lat as number];
        const sun = siteAzEl(site, d.sun);
        const earth = siteAzEl(site, d.earth, d.earthDistKm);
        // subpoints are rounded to 0.01°; site height and terrain do not change the direction here.
        expect(Math.abs(sun.el - tl.sunEl[i])).toBeLessThan(0.03);
        expect(azDiff(sun.az, tl.sunAz[i])).toBeLessThan(0.5);
        expect(Math.abs(earth.el - tl.earthEl[i])).toBeLessThan(0.05);
        expect(azDiff(earth.az, tl.earthAz[i])).toBeLessThan(0.5);
      }
    });
  }

  it("the IAU Moon model behind the Earth's spin puts the Sun where SPICE does (< 0.1°)", () => {
    for (const i of [0, 2000, 5000, 9000]) {
      const d = dirsAt(sub, t0 + i * H);
      expect(sepDeg(sunFromMoonIau(t0 + i * H, d.earth, d.earthDistKm), d.sun)).toBeLessThan(0.1);
    }
  });

  it("Earth's spin: the sub-lunar point on the Earth SPICE sub-lunar point; it returns after one lunar day", () => {
    const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const subLunar = (ms: number) => {
      const { pole, prime } = earthAxes(ms);
      const m = dirsAt(sub, ms).earth.map((x) => -x) as Vec3; // the Moon seen from the Earth
      const east: Vec3 = [pole[1] * prime[2] - pole[2] * prime[1], pole[2] * prime[0] - pole[0] * prime[2], pole[0] * prime[1] - pole[1] * prime[0]];
      return { lon: (Math.atan2(dot(m, east), dot(m, prime)) * 180) / Math.PI, lat: (Math.asin(dot(m, pole)) * 180) / Math.PI };
    };
    // SPICE subpnt(INTERCEPT/ELLIPSOID, EARTH, ITRF93, LT+S, MOON), earth_2026_260806_2126_predict.bpc.
    for (const [u, lon, lat] of [["2027-01-15T00:00:00Z", -102.78, 9.5], ["2027-06-03T07:00:00Z", 51.44, 23.05]] as const) {
      const p = subLunar(Date.parse(u));
      expect(azDiff(p.lon, lon)).toBeLessThan(0.6); // precession since J2000 is left out (~0.4°)
      expect(Math.abs(p.lat - lat)).toBeLessThan(0.3);
    }
    const a = earthAxes(t0);
    expect(dot(a.pole, a.prime)).toBeCloseTo(0, 9);
    expect(Math.hypot(...a.prime)).toBeCloseTo(1, 9);
    for (const i of [100, 4000, 8000]) {
      const p = subLunar(t0 + i * H);
      const q = subLunar(t0 + i * H + 24.84 * H);
      expect(Math.abs(p.lat)).toBeLessThan(29.5); // the Moon's declination
      expect(azDiff(p.lon, q.lon)).toBeLessThan(3);
      expect(azDiff(p.lon, subLunar(t0 + (i + 6) * H).lon)).toBeGreaterThan(80); // 6 h ≈ 87° of spin
    }
  });

  it("tween: short steps animate in full, long ones start 30 days before the target", () => {
    expect(tween(0, 3 * H, false)).toEqual({ from: 0, durMs: expect.any(Number) });
    expect(tween(0, 3 * H, true).durMs).toBe(0);
    expect(tween(0, 365 * 24 * H, false).from).toBe(335 * 24 * H);
    expect(tween(0, 365 * 24 * H, false).durMs).toBeLessThanOrEqual(1400);
  });
});
