// Web Worker: the custom point computation off the UI thread (#31). Meta and ephemeris load once
// per worker; DEM tiles (#100) load only for a point with terrain, only those its rays reach,
// each once per worker.
import type { Site } from "../contracts";
import { type CustomMeta, decodeDem, decodeEphem, tilesFor } from "./assets";
import { computeCustom, type Ephem } from "./horizon";

export type CustomRequest = { id: number; site: Site; base: string }; // base = absolute URL of data/custom/
export type CustomReply = { id: number; result?: ReturnType<typeof computeCustom>; error?: string };

const ctx = self as unknown as { onmessage: (e: MessageEvent<CustomRequest>) => void; postMessage: (m: CustomReply) => void };

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

let meta: Promise<CustomMeta> | null = null;
let ephem: Promise<Ephem> | null = null;
const tiles = new Map<string, Promise<ArrayBuffer>>(); // gzip files by name

ctx.onmessage = async ({ data: { id, site, base } }) => {
  try {
    meta ??= get(base + "meta.json").then((r) => r.json() as Promise<CustomMeta>).catch((e) => { meta = null; throw e; });
    const m = await meta;
    ephem ??= get(base + m.ephemFile).then((r) => r.arrayBuffer()).then((b) => decodeEphem(b, m)).catch((e) => { ephem = null; throw e; });
    const e = await ephem;
    let dem = null;
    if (site.terrain !== "none") {
      const need = tilesFor(m, site.lat as number, site.lonE as number);
      const parts = need.map((t) => {
        let p = tiles.get(t.file);
        if (!p) {
          p = get(base + t.file).then((r) => r.arrayBuffer());
          p.catch(() => tiles.delete(t.file));
          tiles.set(t.file, p);
        }
        return p;
      });
      dem = await decodeDem(await Promise.all(parts), need, m);
    }
    const result = computeCustom(site, dem, e);
    ctx.postMessage({ id, result });
  } catch (e) {
    ctx.postMessage({ id, error: String(e) });
  }
};
