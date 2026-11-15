import type { HorizonMask, Timeline } from "./contracts";
import type { BlockerData } from "./blockerApi";

export type BlockerSector = {
  startAzDeg: number;
  endAzDeg: number; // exclusive; below startAzDeg when the sector crosses north
  maxElevationDeg: number;
  peakAzDeg: number;
  lostHours: number;
  share: number;
};

/** Attribute sphere-visible, terrain-hidden steps to [az, az + step) bins. */
export function blockerSectors(tl: Timeline, mask: HorizonMask): BlockerSector[] {
  if (tl.stub || mask.terrain === "none" || tl.siteId !== mask.siteId) return [];
  const step = mask.azStepDeg;
  const n = mask.elevDeg.length;
  const hours = Array<number>(n).fill(0);
  for (let i = 0; i < tl.sunVisible.length; i++) {
    if (tl.sunEl[i] + 0.265 > 0 && tl.sunVisible[i] === 0) {
      const bin = Math.floor(((tl.sunAz[i] % 360 + 360) % 360) / step);
      hours[bin] += tl.stepMin / 60;
    }
  }
  const bins = hours.flatMap((h, k) => h > 0 ? [k] : []);
  if (!bins.length) return [];
  const total = hours.reduce((a, b) => a + b, 0);
  // Cut the circle at a gap > 2 degrees. All other gaps belong to the sector.
  const cut = bins.findIndex((b, i) => (bins[(i + 1) % bins.length] + (i === bins.length - 1 ? n : 0) - b - 1) * step > 2);
  const ordered = cut < 0 ? bins : [...bins.slice(cut + 1), ...bins.slice(0, cut + 1)];
  const groups: number[][] = [];
  for (const bin of ordered) {
    const last = groups.at(-1);
    if (last && ((bin - last[last.length - 1] + n) % n - 1) * step <= 2) last.push(bin);
    else groups.push([bin]);
  }
  return groups.map((group) => {
    const first = cut < 0 ? 0 : group[0];
    const last = cut < 0 ? n - 1 : group[group.length - 1];
    let peak = first;
    for (let k = first; ; k = (k + 1) % n) {
      if (mask.elevDeg[k] > mask.elevDeg[peak]) peak = k;
      if (k === last) break;
    }
    const lostHours = group.reduce((sum, k) => sum + hours[k], 0);
    return {
      startAzDeg: first * step, endAzDeg: (last + 1) * step,
      maxElevationDeg: mask.elevDeg[peak], peakAzDeg: peak * step,
      lostHours, share: lostHours / total,
    };
  }).sort((a, b) => b.lostHours - a.lostHours);
}

const LOCAL_M = 300;

export function blockerSentence(sector: BlockerSector, period: string, data: BlockerData | null): string {
  const k = data ? Math.round(sector.peakAzDeg / data.azStepDeg) : 0;
  const d = data ? data.distM[k] : null;
  // A horizon point closer than LOCAL_M is the ground slope at the site, not a distant ridge.
  const what = d !== null && d < LOCAL_M ? "local slope" : "ridge";
  const away = d === null ? "" : d < 1000 ? `${Math.round(d / 10) * 10} m away` : `${(d / 1000).toFixed(1)} km away`;
  const distance = data
    ? `, ${away}, ${Math.abs(data.riseM[k])} m ${data.riseM[k] < 0 ? "below" : "above"} the site`
    : "";
  return `Main blocker: ${what} at ${sector.startAzDeg}–${sector.endAzDeg}° az, peak ${sector.maxElevationDeg.toFixed(1)}° elevation${distance} — costs ${Math.round(sector.lostHours)} h of sunlight (${Math.round(sector.share * 100)} % of terrain losses), ${period}.`;
}
