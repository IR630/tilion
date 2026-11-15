import type { Timeline } from "./contracts";
import { longestRun, onShare } from "./summary";

export type BottleneckMetrics = { sunPct: number; earthPct: number; longestNightH: number };

export function bottleneckMetrics(timeline: Timeline): BottleneckMetrics {
  return {
    sunPct: onShare(timeline.sunVisible) * 100,
    earthPct: onShare(timeline.earthVisible) * 100,
    longestNightH: longestRun(timeline, (i) => !(timeline.sunVisible[i] > 0))?.hours ?? 0,
  };
}

/** `period` names the span of the shares (#196: every share says its period), e.g. "next 30 d". */
export function bottleneck(m: BottleneckMetrics, period?: string): string {
  let condition: string;
  if (m.earthPct === 0) {
    condition = "Earth centre hidden throughout; assess relay geometry";
  } else if (m.sunPct === 0) {
    condition = "no sunlight in this period";
  } else if (m.sunPct >= 95 && m.earthPct >= 95) {
    condition = "both geometric conditions hold";
  } else if (Math.abs(m.sunPct - m.earthPct) >= 15) {
    condition = m.sunPct < m.earthPct
      ? "sunlight is the tighter geometric constraint"
      : "Earth visibility is the tighter geometric constraint";
  } else {
    condition = "both partial";
  }
  const night = m.longestNightH >= 48 ? ` Longest night ${(m.longestNightH / 24).toFixed(1)} d.` : "";
  return `Sun ${Math.round(m.sunPct)} %, Earth ${Math.round(m.earthPct)} %${period ? ` of ${period}` : ""}: ${condition}.${night}`;
}
