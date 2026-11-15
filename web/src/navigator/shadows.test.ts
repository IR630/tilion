import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { HorizonMask, Site } from "../contracts";
import { stereoInv, stereoXY } from "../format";
import { decodeField, litShare, type ShadowField, sunVector } from "./shadows";

const meta = (size: number, bins: number) => ({
  extentMeters: 1000,
  horizon: { file: "x", size, azimuthBins: bins, cellMeters: 2000 / size, decode: { offsetDeg: -8, stepDeg: 0.1 } },
});

describe("shadows", () => {
  it("finds the Sun's az/el back in a cell: half disc at el = horizon, only the Sun's azimuth bin is open", () => {
    const bins = 180;
    const f: ShadowField = { size: 1, cellM: 2000, extentM: 1000, bins, offsetDeg: -8, stepDeg: 0.1, horizon: new Uint8Array(bins).fill(250) };
    f.horizon[Math.floor(123 / 2)] = 80; // 0° only toward az 122–124°, 17° elsewhere
    const [lat, lonE] = stereoInv(0, 0);
    expect(litShare(f, sunVector(lat, lonE, 123, 0))[0]).toBeCloseTo(0.5, 3);
    expect(litShare(f, sunVector(lat + 0.0001, lonE, 200, 0))[0]).toBe(0);
  });

  it("decodes azimuth layers as running byte sums mod 256", () => {
    // 2×2 cells, 3 azimuths. Cell 0 goes 250 → 4 → 10 (wraps), cell 3 stays 7.
    const f = decodeField(meta(2, 3), Uint8Array.from([250, 1, 2, 7, 10, 0, 0, 0, 6, 0, 0, 0]));
    expect(Array.from(f.horizon)).toEqual([250, 1, 2, 7, 4, 1, 2, 7, 10, 1, 2, 7]);
  });
});

// Source of the legend line "agree within 1.2° median": the field against our 20 m LOLA masks at every
// terrain site inside its ±32 km.
const dir = "public/data";
const haveData = existsSync(`${dir}/shadow/field_pole.bin.gz`);
describe.skipIf(!haveData)("shadow field vs our LOLA masks", () => {
  it("has a median horizon difference ≤ 1.2° at each of the 3 sites inside ±32 km", () => {
    const m = JSON.parse(readFileSync(`${dir}/shadow/field_pole.json`, "utf8"));
    const f = decodeField(m, new Uint8Array(gunzipSync(readFileSync(`${dir}/shadow/field_pole.bin.gz`))));
    const sites: Site[] = JSON.parse(readFileSync(`${dir}/sites.json`, "utf8")).sites;
    const med: Record<string, number> = {};
    for (const s of sites) {
      if (s.lat === null || s.lonE === null || s.terrain === "none") continue;
      const [x, y] = stereoXY(s.lat, s.lonE);
      if (Math.abs(x) >= f.extentM || Math.abs(y) >= f.extentM) continue;
      const c = Math.floor((x + f.extentM) / f.cellM), r = Math.floor((f.extentM - y) / f.cellM);
      const mask: HorizonMask = JSON.parse(readFileSync(`${dir}/mask/${s.id}.json`, "utf8"));
      const n = mask.elevDeg.length;
      const d = Array.from({ length: f.bins }, (_, b) => {
        const az = ((b + 0.5) * 360) / f.bins;
        const field = f.horizon[b * f.size * f.size + r * f.size + c] * f.stepDeg + f.offsetDeg;
        return Math.abs(field - mask.elevDeg[Math.round(az / mask.azStepDeg) % n]);
      }).sort((a, b) => a - b);
      med[s.id] = (d[f.bins / 2 - 1] + d[f.bins / 2]) / 2;
    }
    expect(Object.keys(med).length).toBe(3);
    for (const v of Object.values(med)) expect(v).toBeLessThanOrEqual(1.2);
  });
});
