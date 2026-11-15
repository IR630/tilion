import { useEffect, useMemo, useState } from "react";
import { bottleneck } from "../bottleneck";
import type { BottleneckMetrics } from "../bottleneck";
import type { HorizonMask, Timeline } from "../contracts";
import { blockerSectors, blockerSentence } from "../blocker";
import { loadBlocker, type BlockerData } from "../blockerApi";

export function Bottleneck({ metrics, period }: { metrics: BottleneckMetrics; period?: string }) {
  return <p className="bottleneck">{bottleneck(metrics, period)}</p>;
}

/** #218 main blocker line. #251: it sits under the chart, next to the terrain effect, so the chart fits 1440×900 (#210). */
export function Blocker({ period, timeline, mask }: { period: string; timeline: Timeline; mask: HorizonMask }) {
  const hasTerrain = !timeline.stub && mask.terrain !== "none" && timeline.siteId === mask.siteId;
  const sector = useMemo(() => blockerSectors(timeline, mask)[0], [timeline, mask]);
  const siteId = sector ? mask.siteId : undefined;
  const [data, setData] = useState<BlockerData | null>(null);
  useEffect(() => {
    let active = true;
    if (siteId) loadBlocker(siteId).then((d) => { if (active) setData(d); });
    return () => { active = false; };
  }, [siteId]);
  const matching = data && data.siteId === siteId && data.azStepDeg === mask.azStepDeg ? data : null;
  if (!hasTerrain) return null;
  return <p className="horizon-blocker">{sector
    ? blockerSentence(sector, period, matching)
    : `Main blocker: none — terrain hides the Sun for 0 h, ${period}; any night here is the Sun under the level horizon.`}</p>;
}
