// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Timeline } from "../contracts";
import { type EnergyInput, VIPER, energyMargin, energyVerdict, panelCos, simulate } from "./energy";

/** n hourly steps with the same Sun share, azimuth and elevation. */
function tl(n: number, sun: number, az = 0, el = 0): Timeline {
  const f = (v: number) => Array(n).fill(v);
  return {
    siteId: "t",
    startUtc: "2027-01-01T00:00:00Z",
    stepMin: 60,
    sunAz: f(az),
    sunEl: f(el),
    sunVisible: f(sun),
    earthAz: f(0),
    earthEl: f(0),
    earthVisible: f(0),
  };
}
const base: EnergyInput = { panelW: 300, batteryWh: 1000, dayLoadW: 100, nightLoadW: 100, panel: "tracking", panelAzDeg: 0, startSoc: 0.5 };

describe("battery charge", () => {
  it("stops at the capacity in a long sunny period", () => {
    const r = simulate(tl(48, 1), base); // +200 W from 500 Wh
    expect(Math.max(...r.wh)).toBe(1000);
    expect(r.emptyAtH).toBeNull();
  });

  it("stops at zero, says when it empties and counts the hours without power", () => {
    const r = simulate(tl(24, 0), { ...base, startSoc: 1 }); // 1000 Wh at 100 W: empty after 10 h
    expect(Math.min(...r.wh)).toBe(0);
    expect(r.emptyAtH).toBeCloseTo(10, 9);
    expect(r.deadH).toBeCloseTo(14, 9);
  });

  it("gets nothing from a fixed panel with the Sun behind it", () => {
    expect(panelCos(180, 0, "fixed", 0)).toBe(0);
    expect(panelCos(180, 0, "tracking", 0)).toBe(1);
  });

  it("scales the panel power by the visible share of the Sun", () => {
    const r = simulate(tl(1, 0.5), { ...base, dayLoadW: 0 }); // 300 W × 0.5 × cos 0° for 1 h
    expect(r.wh[1] - r.wh[0]).toBeCloseTo(150, 9);
  });
});

describe("one verdict rule for the site screen and the mission plan (#235)", () => {
  const stub = { ...tl(24, 0), stub: true };
  it("gives no verdict on mock data, a verdict on real data", () => {
    const real = tl(24, 0);
    expect(energyVerdict(stub, simulate(stub, base), base.batteryWh, "next 30 d")).toBeNull();
    expect(energyVerdict(real, simulate(real, base), base.batteryWh, "next 30 d")).toMatch(/^Battery empty at/);
  });
});

describe("energy margin of a mission variant (#235)", () => {
  // 24 h of dark at 108 W from 5,420 Wh (VIPER): lowest charge 5420 - 24 × 108 = 2828 Wh = 52 %.
  it("is the lowest charge, or the hour the battery empties", () => {
    expect(energyMargin(tl(48, 0), "2027-01-01T00:00:00Z", 1)).toBe("lowest charge 52\u00a0%");
    expect(energyMargin(tl(100, 0), "2027-01-01T00:00:00Z", 100 / 24)).toBe("battery empty after 50 h");
  });
  it("is null on mock data and when the data ends inside the window", () => {
    expect(energyMargin({ ...tl(48, 0), stub: true }, "2027-01-01T00:00:00Z", 1)).toBeNull();
    expect(energyMargin(tl(48, 0), "2027-01-01T00:00:00Z", 5)).toBeNull();
  });
});

describe("tilted and horizontal panel (#332)", () => {
  const d = Math.PI / 180;
  const azs = [0, 37, 90, 179, 180, 181, 270, 359];
  const els = [-5, -0.3, 0, 0.26, 1.7, 4.7, 22, 45, 89.77, 90];

  it("tilt 90° gives the vertical panel of the model before #332, bit for bit", () => {
    // The formula before #332, copied here as the reference.
    const before = (az: number, el: number, panel: "tracking" | "fixed", paz: number) => {
      const c = Math.cos(el * d) * (panel === "tracking" ? 1 : Math.cos((az - paz) * d));
      return c > 0 ? c : 0;
    };
    for (const az of azs)
      for (const el of els)
        for (const paz of [0, 135, 180]) {
          expect(panelCos(az, el, "fixed", paz, 90)).toBe(before(az, el, "fixed", paz));
          expect(panelCos(az, el, "tracking", paz, 90)).toBe(before(az, el, "tracking", paz));
          expect(panelCos(az, el, "fixed", paz)).toBe(before(az, el, "fixed", paz)); // 90° is the default
        }
  });

  it("tilt 0° (flat deck) gives sin(Sun elevation) for any azimuth, and 0 with the Sun below the horizon", () => {
    for (const az of azs)
      for (const el of els)
        for (const paz of [0, 135]) expect(panelCos(az, el, "fixed", paz, 0)).toBeCloseTo(Math.max(0, Math.sin(el * d)), 15);
  });

  it("matches the dot product of the panel normal and the Sun direction, clipped at 0", () => {
    // Independent judge: unit vectors in local east, north, up.
    const dir = (az: number, el: number) => [Math.cos(el * d) * Math.sin(az * d), Math.cos(el * d) * Math.cos(az * d), Math.sin(el * d)];
    for (const tilt of [0, 15, 30, 60, 75, 90])
      for (const paz of [0, 100, 225])
        for (const az of azs)
          for (const el of els) {
            const n = dir(paz, 90 - tilt); // the normal is tilt° away from the zenith, toward paz
            const s = dir(az, el);
            const dot = n[0] * s[0] + n[1] * s[1] + n[2] * s[2];
            expect(panelCos(az, el, "fixed", paz, tilt)).toBeCloseTo(Math.max(0, dot), 12);
          }
    expect(panelCos(20, 20, "fixed", 80, 30)).toBeCloseTo(0.531121, 6); // by hand: sin30 cos20 cos60 + cos30 sin20
  });

  it("gives 0 for a tilted panel with the Sun behind it", () => {
    expect(panelCos(180, 10, "fixed", 0, 60)).toBe(0); // sin60 cos10 (−1) + cos60 sin10 < 0
    expect(panelCos(180, 2, "fixed", 0, 89)).toBe(0);
  });

  it("at Haworth a flat deck gets 3.6 % of the energy of a vertical tracking panel and empties the battery after 34 h, not 190 h", () => {
    // Python recomputation from the same timeline (not this code): sums of sunVisible × max(0, sin el) and
    // × max(0, cos el) over 9,505 h are 137.9 and 3,856.7 Wh per W; VIPER battery empty at 34.14 h and 190.22 h.
    const t = JSON.parse(readFileSync("public/data/timeline/a_haworth.json", "utf8")) as Timeline;
    const gen = (tilt: number) =>
      t.sunVisible.reduce((a, v, i) => a + v * panelCos(t.sunAz[i], t.sunEl[i], "tracking", 0, tilt), 0);
    expect(gen(90)).toBeCloseTo(3856.7, 1);
    expect(gen(0)).toBeCloseTo(137.9, 1);
    expect(gen(0) / gen(90)).toBeCloseTo(0.0358, 4);
    expect(simulate(t, VIPER).emptyAtH).toBeCloseTo(190.22, 2);
    expect(simulate(t, { ...VIPER, panel: "fixed", panelTiltDeg: 0 }).emptyAtH).toBeCloseTo(34.14, 2);
  });
});
