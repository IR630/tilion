// The whole precomputed window of a site with its variant series (#162, #206): Compare and the Horizon
// view read time to sunset / Earthset from it, so both search to the data end.
import { loadFullTimeline, loadTimeline } from "./api";
import type { Site, Timeline } from "./contracts";

const fullWindows = new Map<string, Promise<Timeline | null>>();

/** The whole precomputed window of a site with the variant series (not a 30-day slice); null when stub. Cached. */
export function loadFullWindow(site: Site): Promise<Timeline | null> {
  let p = fullWindows.get(site.id);
  if (!p) {
    p = loadFullTimeline(site).then(async (full) => {
      if (!full) return null;
      const tl = await loadTimeline(site, full.startUtc, (full.sunEl.length * full.stepMin) / 1440);
      return tl.stub ? null : tl;
    });
    fullWindows.set(site.id, p);
    p.catch(() => fullWindows.delete(site.id));
  }
  return p;
}
