import { getJson } from "./api";
import type { Site, Skyline } from "./contracts";
import { isCustom } from "./custom/client";

/** data/skyline/<siteId>.json (#334, optional); null for a custom point, a site without terrain or a bad file.
 *  Separate from api.ts like blockerApi.ts: screen tests mock api.ts by name and need no new stub. */
export async function loadSkyline(site: Site): Promise<Skyline | null> {
  if (isCustom(site) || site.terrain === "none") return null;
  const s = await getJson<Skyline>(`skyline/${site.id}.json`);
  const n = s && s.azStepDeg > 0 ? 360 / s.azStepDeg : 0;
  return s && s.siteId === site.id && n > 0
    && [s.nearDeg, s.midDeg, s.fullDeg].every((a) => Array.isArray(a) && a.length === n && a.every(Number.isFinite))
    ? s : null;
}
