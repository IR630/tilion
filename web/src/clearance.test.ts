// #206: the headline angle is the clearance above the LOLA terrain horizon at the body's azimuth.
// It must agree with the visibility flags of the same timeline: the Sun is lit while any part of the
// 0.53° disc is above the mask, the Earth while its centre is above it.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { HorizonMask, Timeline } from "./contracts";
import { fmtAbove, fmtClearance } from "./format";
import { liveState, terrainClearance } from "./summary";

const SUN_RADIUS_DEG = 0.265;
const dir = "public/data";
const read = <T,>(p: string) => JSON.parse(readFileSync(`${dir}/${p}`, "utf8")) as T;
const RIDGE = "cr1_connecting_ridge";
const haveData = existsSync(`${dir}/mask/${RIDGE}.json`) && existsSync(`${dir}/timeline/${RIDGE}.json`);

describe("fmtClearance (#206)", () => {
  it("puts terrain first and level in brackets, the sign in words", () => {
    expect(fmtClearance(1.27, 0.3)).toBe("1.3° above terrain (0.3° above level)");
    expect(fmtClearance(-0.44, 0.3)).toBe("0.4° below terrain (0.3° above level)");
    expect(fmtAbove(-0.3, "level")).toBe("0.3° below level");
  });
  it("says the upper limb is visible when the Sun is lit but its centre is under the terrain", () => {
    expect(fmtClearance(-0.2, 1.1, true)).toBe("centre 0.2° below terrain, upper limb visible (1.1° above level)");
    expect(fmtClearance(-0.2, 1.1, false)).toBe("0.2° below terrain (1.1° above level)");
  });
  it("falls back to level only without terrain", () => {
    expect(fmtClearance(null, 0.3)).toBe("0.3° above level");
    const flat: HorizonMask = { siteId: "x", observerHeightM: 2, terrain: "none", azStepDeg: 1, elevDeg: Array(360).fill(0) };
    expect(terrainClearance(flat, 10, 0.3)).toBeNull();
  });
});

describe.skipIf(!haveData)("terrain clearance on the real ridge data (#206)", () => {
  const mask = haveData ? read<HorizonMask>(`mask/${RIDGE}.json`) : null;
  const tl = haveData ? read<Timeline>(`timeline/${RIDGE}.json`) : null;

  it("at the ridge 2027-01-15 12:00 UTC the Sun is about 1° higher above terrain than above level", () => {
    const st = liveState(tl!, "2027-01-15T12:00:00Z", mask)!;
    expect(st.sunUp).toBe(true);
    expect(st.sunElDeg).toBeCloseTo(0.3, 1);
    expect(st.sunClearDeg!).toBeGreaterThan(st.sunElDeg + 0.5); // skyline ≈ −1° toward the Sun
    expect(fmtClearance(st.sunClearDeg, st.sunElDeg, st.sunUp)).toMatch(/^\d\.\d° above terrain \(0\.3° above level\)$/);
  });

  it("agrees with the timeline flags: Sun = any limb above the mask, Earth = centre above it", () => {
    let sunOff = 0;
    let earthOff = 0;
    for (let i = 0; i < tl!.sunVisible.length; i++) {
      const s = terrainClearance(mask, tl!.sunAz[i], tl!.sunEl[i])!;
      const e = terrainClearance(mask, tl!.earthAz[i], tl!.earthEl[i])!;
      // A disagreement is allowed only within 0.02° of the rule edge (mask sampled every 0.5°).
      if (s + SUN_RADIUS_DEG > 0 !== tl!.sunVisible[i] > 0) {
        sunOff++;
        expect(Math.abs(s + SUN_RADIUS_DEG), `sun step ${i}`).toBeLessThan(0.02);
      }
      if (e > 0 !== tl!.earthVisible[i] > 0) {
        earthOff++;
        expect(Math.abs(e), `earth step ${i}`).toBeLessThan(0.02);
      }
    }
    expect(sunOff).toBeLessThan(10);
    expect(earthOff).toBeLessThan(10);
  });
});
