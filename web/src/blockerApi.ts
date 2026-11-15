import { getJson } from "./api";

/** blocker/<siteId>.json: same azimuth grid and terrain rays as the site's mask. */
export type BlockerData = { siteId: string; azStepDeg: number; distM: number[]; riseM: number[] };

export async function loadBlocker(siteId: string): Promise<BlockerData | null> {
  const data = await getJson<BlockerData>(`blocker/${siteId}.json`);
  return data && data.siteId === siteId && data.azStepDeg > 0
    && Array.isArray(data.distM) && Array.isArray(data.riseM)
    && data.distM.length === 360 / data.azStepDeg && data.riseM.length === data.distM.length
    && data.distM.every((v) => Number.isInteger(v) && v > 0) && data.riseM.every(Number.isInteger)
    ? data : null;
}
