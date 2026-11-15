// Real-data check: build hours.json (D-006) from data/timeline/*.json, then search all sites.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SitesFile, Timeline } from "../contracts";
import { decodeHours, encodeCodes, type HoursFile } from "./hours";
import { DEFAULT_OPTIONS, findRoutes, metricsAt, tieDeciders } from "./route";
import { calloutText } from "../mission/routeMap";
import { scoreOf } from "./score";
import { levelOf, planTraverse, ROVER_M_PER_H, type Series } from "../mission/traverse";
import { distanceKm as wpDistanceKm } from "../mission/waypoints";

// vitest runs from web/ (make check does `cd web`); jsdom makes import.meta.url non-file.
const dataDir = join(process.cwd(), "public", "data");
const timelineDir = join(dataDir, "timeline");
const haveData = existsSync(timelineDir);

function buildHoursFile(): HoursFile {
  const sites: Record<string, string> = {};
  let startUtc = "";
  let n = 0;
  for (const f of readdirSync(timelineDir).filter((x) => x.endsWith(".json"))) {
    const t = JSON.parse(readFileSync(join(timelineDir, f), "utf8")) as Timeline;
    startUtc ||= t.startUtc;
    n = Math.max(n, t.sunVisible.length);
    sites[t.siteId] = encodeCodes(t.sunVisible, t.earthVisible);
  }
  return { startUtc, stepMin: 60, n, sites };
}

describe.skipIf(!haveData)("route on real timelines", () => {
  const file = buildHoursFile();
  const t0 = performance.now();
  const hours = decodeHours(file);
  const decodeMs = performance.now() - t0;
  const sites = (JSON.parse(readFileSync(join(dataDir, "sites.json"), "utf8")) as SitesFile).sites;
  const plan = { siteId: "a_haworth", landingUtc: "2027-03-01T12:00:00Z" };

  it("searches all sites × 45 slips in under 150 ms (median of 7 runs)", () => {
    const times: number[] = [];
    let options = 0;
    for (const mode of ["energy", "comms", "balanced"] as const) {
      for (let run = 0; run < 3; run++) {
        findRoutes(hours, sites, plan, { ...DEFAULT_OPTIONS, mode });
      }
      // 150 ms leaves headroom for parallel workers while guarding against large search regressions.
      const samples: number[] = [];
      for (let run = 0; run < 7; run++) {
        const t = performance.now();
        const r = findRoutes(hours, sites, plan, { ...DEFAULT_OPTIONS, mode });
        samples.push(performance.now() - t);
        options = r.options.length;
        expect(r.plan).not.toBeNull();
      }
      samples.sort((a, b) => a - b);
      times.push(samples[3]);
    }
    console.log(`[route] decode ${decodeMs.toFixed(1)} ms; findRoutes ${times.map((x) => x.toFixed(1)).join(" / ")} ms`);
    expect(options).toBe(6);
    expect(Math.max(...times)).toBeLessThan(150);
  });

  it("gives plausible values: a ridge site has more Sun than Haworth on average", () => {
    const mean = (id: string) => {
      let sum = 0;
      let k = 0;
      for (let d = 0; d < 330; d += 3) {
        const m = metricsAt(hours, id, new Date(Date.parse(file.startUtc) + d * 86_400_000).toISOString(), 14)!;
        sum += m.sunH;
        k++;
      }
      return sum / k;
    };
    const ridge = mean("cr1_connecting_ridge");
    const haworth = mean("a_haworth");
    expect(ridge).toBeGreaterThan(haworth);
    expect(ridge).toBeLessThanOrEqual(336);
  });

  it("returns diverse options inside the tolerances", () => {
    const r = findRoutes(hours, sites, plan, { ...DEFAULT_OPTIONS, mode: "energy", radiusKm: 150 });
    const perSite = new Map<string, number>();
    for (const o of r.options) {
      perSite.set(o.siteId, (perSite.get(o.siteId) ?? 0) + 1);
      expect(o.distanceKm).toBeLessThanOrEqual(150);
      expect(o.slipDays).toBeGreaterThanOrEqual(-14);
      expect(o.slipDays).toBeLessThanOrEqual(30);
      expect(o.windowH).toBe(336);
      expect(o.bothH).toBeLessThanOrEqual(Math.min(o.sunH, o.earthH));
    }
    expect(Math.max(...perSite.values())).toBeLessThanOrEqual(2);
    expect(perSite.has("a_haworth")).toBe(true);
    expect(r.options[0].tags).toContain("best");
  });

  it("scores a lit ridge above a crater floor over the year (known good vs known bad)", () => {
    const scores = (id: string) => {
      const out: number[] = [];
      for (let d = 0; d < 330; d += 3) {
        const m = metricsAt(hours, id, new Date(Date.parse(file.startUtc) + d * 86_400_000).toISOString(), 14)!;
        out.push(scoreOf(m).total);
      }
      return out;
    };
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const ridge = scores("cr1_connecting_ridge");
    const haworth = scores("a_haworth");
    console.log(`[score] mean ridge ${mean(ridge).toFixed(1)}, Haworth ${mean(haworth).toFixed(1)}; range ${Math.min(...ridge, ...haworth).toFixed(0)}–${Math.max(...ridge, ...haworth).toFixed(0)}`);
    expect(mean(ridge)).toBeGreaterThan(mean(haworth) + 5);
    for (const x of [...ridge, ...haworth]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
    }
  });

  it("colours a real traverse leg by the Earth share of the hours driven, read from the nearer end", () => {
    const tl = (id: string) => JSON.parse(readFileSync(join(timelineDir, `${id}.json`), "utf8")) as Timeline;
    const ids = ["cr1_connecting_ridge", "shackleton_rim"];
    const tls = ids.map(tl);
    const pts = ids.map((id) => sites.find((s) => s.id === id)!);
    const series: Series[] = tls.map((t) => ({ startMs: Date.parse(t.startUtc), stepMin: t.stepMin, sun: t.sunVisible, earth: t.earthVisible, dsn: t.dsnVisible, terrain: true }));
    const landing = Date.parse("2027-03-01T12:00:00Z");
    const tr = planTraverse(pts.map((s) => ({ name: s.name, lat: s.lat!, lonE: s.lonE! })), series, landing);
    const leg = tr.legs[0];
    const km = wpDistanceKm(pts[0].lat!, pts[0].lonE!, pts[1].lat!, pts[1].lonE!);
    expect(leg.hours).toBe(Math.round((km * 1000) / ROVER_M_PER_H));
    // Independent count: hour k reads the start timeline in the first half of the leg, the end one after.
    const i0 = (landing - Date.parse(tls[0].startUtc)) / 3_600_000;
    let earth = 0;
    for (let k = 0; k < leg.hours; k++) earth += (k + 0.5 < leg.hours / 2 ? tls[0] : tls[1]).earthVisible[i0 + k] > 0 ? 1 : 0;
    console.log(`[traverse] CR1 → Shackleton rim ${km.toFixed(1)} km, ${leg.hours} h, Earth ${(100 * leg.earthShare!).toFixed(0)} %, ${leg.level}`);
    expect(leg.counted).toBe(leg.hours);
    expect(leg.earthShare).toBeCloseTo(earth / leg.hours, 12);
    expect(leg.level).toBe(levelOf(earth / leg.hours));
    expect(leg.dsnShare).not.toBeNull();
    expect(leg.dsnShare!).toBeLessThanOrEqual(leg.earthShare! + 1e-12);
  });

  // #204: the demo plan (Shackleton–de Gerlache ridge, 2027-01-22, Balanced) showed "score 100" on
  // four of five bubbles. That is the formula, not a display clamp: these windows have Sun and Earth
  // every hour, so every term is 1. The bubbles must still tell the options apart.
  it("keeps tied 100-point options apart on the map by rank and the deciding slip", () => {
    const rivals = sites.filter((s) => s.terrain !== "none" || s.id === "cr1_connecting_ridge");
    const plan204 = { siteId: "cr1_connecting_ridge", landingUtc: "2027-01-22T00:00:00Z" };
    const r = findRoutes(hours, rivals, plan204, { ...DEFAULT_OPTIONS, rank: "score" }, 6);
    const scores = r.options.map((o) => scoreOf(o, "balanced"));
    const full = scores.filter((s) => s.total >= 99.5);
    expect(full.length).toBeGreaterThanOrEqual(4);
    for (const s of full) expect(s.terms.every((t) => t.value >= 0.98)).toBe(true); // saturated, not clamped totals
    expect(scoreOf(r.plan!, "balanced").total).toBeLessThan(80); // the plan itself is not at the cap
    const deciders = tieDeciders(r.options, "balanced");
    const texts = r.options.map((o, i) => calloutText(scores[i].total, o.slipDays, i + 1, deciders[i], o.distanceKm));
    texts.forEach((t, i) => {
      if (t.metric !== "score 100") return;
      expect(deciders[i]).not.toBeNull(); // a tie says what ranks it
      expect(t.tie).not.toBe("");
    });
    expect(new Set(texts.map((t) => `${t.metric} ${t.slip}`)).size).toBe(texts.length);
  });
});
