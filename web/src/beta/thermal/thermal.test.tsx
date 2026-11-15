import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Timeline } from "../../contracts";
import { ThermalLine } from "./ThermalLine";
import { regolithTemps } from "./thermal";

const P_H = 29.53 * 24; // lunar day, hours
function equator(lunations: number): Timeline {
  const n = Math.round(P_H * lunations);
  const sunEl = Array.from({ length: n }, (_, i) => 90 * Math.sin((2 * Math.PI * i) / P_H));
  const z = sunEl.map(() => 0);
  return {
    siteId: "eq",
    startUtc: "2027-01-01T00:00:00Z",
    stepMin: 60,
    sunAz: z,
    sunEl,
    sunVisible: sunEl.map((e) => (e > 0 ? 1 : 0)),
    earthAz: z,
    earthEl: z,
    earthVisible: z,
  };
}

describe("regolith temperature", () => {
  it("anchor: equatorial noon 380-400 K and pre-dawn 90-110 K (Diviner, Vasavada 2012, doi:10.1029/2011JE003987)", () => {
    const T = regolithTemps(equator(2));
    const day = T.slice(Math.round(P_H), Math.round(2 * P_H));
    const noon = Math.max(...day);
    const dawn = Math.min(...day);
    console.log(`thermal anchor: noon ${noon.toFixed(1)} K, pre-dawn ${dawn.toFixed(1)} K`);
    expect(noon).toBeGreaterThan(380);
    expect(noon).toBeLessThan(400);
    expect(dawn).toBeGreaterThan(90);
    expect(dawn).toBeLessThan(110);
  });

  it("cools monotonically in permanent darkness", () => {
    const n = 500;
    const T = regolithTemps({ sunEl: Array(n).fill(-10), sunVisible: Array(n).fill(0), stepMin: 60 });
    for (let i = 1; i < n; i++) expect(T[i]).toBeLessThanOrEqual(T[i - 1]);
    expect(T[n - 1]).toBeLessThan(T[0]);
  });

  it("does not crash on an empty timeline", () => {
    expect(regolithTemps({ sunEl: [], sunVisible: [], stepMin: 60 })).toEqual([]);
  });

  it("runs a 9500-step timeline fast", () => {
    const t = equator(13.2);
    const t0 = performance.now();
    const T = regolithTemps(t);
    const ms = performance.now() - t0;
    console.log(`thermal run: ${T.length} steps in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1000);
  });
});

describe("regolith line", () => {
  const t = equator(1);
  it("shows now, min and max with the BETA tag and the honest note", () => {
    const html = renderToString(<ThermalLine tl={t} fullTl={null} i={Math.round(P_H / 4)} period="next 30 d" />);
    expect(html).toMatch(/Regolith surface: now \d+ K \(-?\d+ °C\), min \d+ K, max \d+ K over next 30 d/);
    expect(html).toContain("BETA");
    expect(html).toContain("not the lander temperature");
  });
  it("renders nothing on mock data", () => {
    expect(renderToString(<ThermalLine tl={{ ...t, stub: true }} fullTl={null} i={0} period="x" />)).toBe("");
  });
});

describe("real timeline", () => {
  it("runs on a polar site", () => {
    const tl = JSON.parse(readFileSync("public/data/timeline/cr1_connecting_ridge.json", "utf8")) as Timeline;
    const t0 = performance.now();
    const T = regolithTemps(tl);
    const ms = performance.now() - t0;
    const w = T.slice(0, 720);
    console.log(
      `thermal cr1: n=${T.length}, ${ms.toFixed(0)} ms, 30 d: now ${T[0].toFixed(1)} min ${Math.min(...w).toFixed(1)} max ${Math.max(...w).toFixed(1)}; all ${Math.min(...T).toFixed(1)}..${Math.max(...T).toFixed(1)}`,
    );
    expect(T.length).toBe(tl.sunEl.length);
  });
});
