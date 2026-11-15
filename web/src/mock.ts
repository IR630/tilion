// Synthetic data with the contract shape. Used until the precompute pipeline writes
// data/mask/*.json and data/timeline/*.json. Every object has stub: true and the UI says so.
// The geometry is only plausible, not real: do not use these numbers anywhere.
import type { HorizonMask, Site, SiteSummary, Timeline } from "./contracts";
import { windowRuns } from "./summary";

function seed(id: string): number {
  let h = 2166136261;
  for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
}

export function mockMask(site: Site): HorizonMask {
  const s = seed(site.id);
  const azStepDeg = 1;
  const elevDeg = Array.from({ length: 360 }, (_, i) => {
    const a = (i * Math.PI) / 180;
    if (site.terrain === "none") return 0;
    return 1.2 * Math.sin(a * 2 + s * 6) + 0.8 * Math.sin(a * 5 + s * 11) + 0.4 * Math.sin(a * 13 + s * 3);
  });
  return { siteId: site.id, observerHeightM: 2, terrain: site.terrain, azStepDeg, elevDeg };
}

const SYNODIC_MIN = 29.530589 * 24 * 60;

export function mockTimeline(site: Site, startUtc: string, days = 30, stepMin = 60): Timeline {
  const mask = mockMask(site);
  const s = seed(site.id);
  const lat = site.lat ?? -85;
  const n = Math.round((days * 24 * 60) / stepMin);
  const t0 = Date.parse(startUtc);
  const out: Timeline = {
    siteId: site.id,
    startUtc,
    stepMin,
    sunAz: [],
    sunEl: [],
    sunVisible: [],
    earthAz: [],
    earthEl: [],
    earthVisible: [],
    stub: true,
  };
  const colat = 90 + lat; // degrees from the south pole
  for (let i = 0; i < n; i++) {
    const tMin = (t0 / 60000 + i * stepMin) % SYNODIC_MIN;
    const ph = (tMin / SYNODIC_MIN) * 2 * Math.PI + s * 6;
    const sunAz = ((ph * 180) / Math.PI + 360) % 360;
    const sunEl = colat * Math.cos(ph) + 1.5 * Math.sin(ph / 13);
    const m = mask.elevDeg[Math.floor(sunAz) % 360];
    // Mock only: linear area share, not the limb-darkened flux of D-010.
    const vis = Math.min(1, Math.max(0, (sunEl - m + 0.265) / 0.53));
    const eAz = (((site.lonE ?? 0) + 180 + 6 * Math.sin(ph / 1.1)) % 360 + 360) % 360;
    const eEl = 6.5 * Math.sin(ph * 1.03 + 1) - colat * 0.5 + colat;
    const em = mask.elevDeg[Math.floor(eAz) % 360];
    out.sunAz.push(sunAz);
    out.sunEl.push(sunEl);
    out.sunVisible.push(vis);
    out.earthAz.push(eAz);
    out.earthEl.push(eEl);
    out.earthVisible.push(eEl > em ? 1 : 0);
  }
  return out;
}

function hoursUntil(flags: number[], stepMin: number): number | null {
  if (!(flags[0] > 0)) return null;
  const k = flags.findIndex((v) => !(v > 0));
  return ((k < 0 ? flags.length : k) * stepMin) / 60;
}

export function mockSummary(site: Site, atUtc: string): SiteSummary {
  const tl = mockTimeline(site, atUtc);
  const mean = (a: number[]) => a.reduce((x, y) => x + (y > 0 ? 1 : 0), 0) / a.length;
  const spread = (v: number, f: number) => ({ value: v, lo: v * (1 - f), hi: v * (1 + f) });
  const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
  const fraction = (v: number, f: number) => {
    const i = spread(v, f);
    return { value: clamp01(i.value), lo: clamp01(i.lo), hi: clamp01(i.hi) };
  };
  const sun = hoursUntil(tl.sunVisible, tl.stepMin);
  const earth = hoursUntil(tl.earthVisible, tl.stepMin);
  return {
    siteId: site.id,
    atUtc,
    sunElDeg: tl.sunEl[0],
    hoursToSunset: sun === null ? null : spread(sun, 0.08),
    hoursToEarthset: earth === null ? null : spread(earth, 0.05),
    lightFraction: fraction(mean(tl.sunVisible), 0.05),
    earthFraction: fraction(mean(tl.earthVisible), 0.03),
    ...windowRuns(tl), // mock window only; the row carries the mock badge
    stub: true,
  };
}
