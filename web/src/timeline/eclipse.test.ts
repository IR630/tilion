// #369: the Earth-eclipse rule. Light lost with the disc clear of the terrain and the Earth on the Sun
// is an eclipse; light lost to the terrain (or with the Earth far away) is not.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HorizonMask, Timeline } from "../contracts";
import { eclipseAt, eclipseLine, findEclipses, MIN_HIDDEN, OVERLAP_DEG, SUN_R_DEG } from "./eclipse";

const MASK: HorizonMask = { siteId: "t", observerHeightM: 2, terrain: "polar80", azStepDeg: 0.5, elevDeg: new Array(720).fill(2) };

// One step per row: Sun elevation, visible share, Sun–Earth separation (Earth straight above the Sun).
function timeline(rows: [number, number, number][]): Timeline {
  return {
    siteId: "t",
    startUtc: "2027-08-17T04:00:00Z",
    stepMin: 60,
    sunAz: rows.map(() => 100),
    sunEl: rows.map((r) => r[0]),
    sunVisible: rows.map((r) => r[1]),
    earthAz: rows.map(() => 100),
    earthEl: rows.map((r) => r[0] + r[2]),
    earthVisible: rows.map(() => 1),
  };
}

describe("Earth eclipse rule (#369)", () => {
  it("counts loss of light only with the disc clear of the terrain and the Earth on the Sun", () => {
    const clear = 2 + SUN_R_DEG + 0.05; // lower limb 0.05° above the 2° mask
    const grazing = 2 + SUN_R_DEG - 0.05; // centre above the mask, lower limb behind the terrain
    const tl = timeline([
      [5, 1, 3], //                         04 h: full Sun
      [5, 0.91, 1.08], //                   05 h: eclipse
      [clear, 0.54, 0.92], //               06 h: eclipse, peak 46 %
      [5, 0.66, 0.97], //                   07 h: eclipse
      [5, 1, 1.2], //                       08 h: Earth near, nothing hidden
      [grazing, 0.6, 1.0], //               09 h: terrain trap: the ridge may hide it
      [5, 0.9, OVERLAP_DEG + 0.01], //      10 h: Earth too far to touch the Sun
      [5, 1 - MIN_HIDDEN / 2, 1.0], //      11 h: under 1 % hidden
      [5, 0.8, 1.0], //                     12 h: second eclipse, one step
    ]);
    const ev = findEclipses(tl, MASK);
    expect(ev).toHaveLength(2);
    expect(new Date(ev[0].startMs).toISOString()).toBe("2027-08-17T05:00:00.000Z");
    expect(new Date(ev[0].endMs).toISOString()).toBe("2027-08-17T08:00:00.000Z");
    expect(new Date(ev[0].peakMs).toISOString()).toBe("2027-08-17T06:00:00.000Z");
    expect(ev[0].maxHidden).toBeCloseTo(0.46, 9);
    expect(ev[0].hours).toBe(3);
    expect(eclipseLine(ev[0])).toBe("Earth eclipse 2027-08-17: up to 46 % of the Sun hidden for ~3 h");
    expect(ev[1].hours).toBe(1);

    // The one in progress, then the next one, then none.
    expect(eclipseAt(ev, Date.parse("2027-08-17T07:30:00Z"))).toBe(ev[0]);
    expect(eclipseAt(ev, Date.parse("2027-08-17T09:00:00Z"))).toBe(ev[1]);
    expect(eclipseAt(ev, Date.parse("2027-08-17T13:00:00Z"))).toBeNull();

    // A missing or foreign file (e.g. hours.json in its place) gives no events, not an error.
    expect(findEclipses(null, MASK)).toEqual([]);
    expect(findEclipses({ startUtc: "2026-12-01T00:00:00Z", stepMin: 60 } as unknown as Timeline, MASK)).toEqual([]);
    expect(findEclipses(tl, { azStepDeg: 0.5 } as HorizonMask)).toEqual([]);
  });

  const dir = "public/data";
  const have = existsSync(`${dir}/timeline/a_haworth.json`) && existsSync(`${dir}/mask/a_haworth.json`);
  it.skipIf(!have)("finds the 2027-08-17 eclipse at Haworth in the shipped data, and only eclipse dates", () => {
    const read = <T,>(p: string) => JSON.parse(readFileSync(`${dir}/${p}`, "utf8")) as T;
    const ev = findEclipses(read<Timeline>("timeline/a_haworth.json"), read<HorizonMask>("mask/a_haworth.json"));
    expect(ev.map(eclipseLine)).toEqual(["Earth eclipse 2027-08-17: up to 45 % of the Sun hidden for ~3 h"]);
  });
});
