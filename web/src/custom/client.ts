// Main-thread side of the custom point (#31): one shared Web Worker, one computation per site.
import type { HorizonMask, Site, Timeline } from "../contracts";
import type { CustomReply, CustomRequest } from "./worker";

/** complete = per-azimuth ray completeness (#330), outside the data contract; null without terrain. */
export type CustomResult = { mask: HorizonMask; timeline: Timeline; complete: boolean[] | null };

export const isCustom = (s: Site) => s.id.startsWith("custom-");

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { ok: (r: CustomResult) => void; fail: (e: Error) => void }>();
const results = new Map<string, Promise<CustomResult>>();
const rays = new Map<string, boolean[] | null>(); // site id -> ray completeness, set before the result resolves

/** #330: ray completeness of a computed custom point; undefined = not computed (or a catalogue site). */
export const rayCompleteness = (siteId: string): boolean[] | null | undefined => rays.get(siteId);

function start(): Worker {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = ({ data }: MessageEvent<CustomReply>) => {
    const p = pending.get(data.id);
    pending.delete(data.id);
    if (data.result) {
      rays.set(data.result.mask.siteId, data.result.complete);
      p?.ok(data.result);
    }
    else p?.fail(new Error(data.error));
  };
  w.onerror = (e) => {
    for (const p of pending.values()) p.fail(new Error(`custom point worker: ${e.message}`));
    pending.clear();
    worker = null;
  };
  return w;
}

/** Mask and timeline of a custom point, computed in the worker; `base` = absolute URL of data/custom/. */
export function computeCustomSite(site: Site, base: string): Promise<CustomResult> {
  let p = results.get(site.id);
  if (!p) {
    p = new Promise<CustomResult>((ok, fail) => {
      worker ??= start();
      const id = ++seq;
      pending.set(id, { ok, fail });
      worker.postMessage({ id, site, base } satisfies CustomRequest);
    });
    results.set(site.id, p);
    p.catch(() => results.delete(site.id));
  }
  return p;
}
