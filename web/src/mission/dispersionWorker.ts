// #327: landing dispersion off the UI thread. Each point gets its own terrain horizon and timeline from
// the custom point path (custom/horizon.ts computeCustom, LOLA 240 m tiles), only for the mission
// window, then the mission verdict (dispersion.ts pointVerdict). One run per worker; cancel = terminate.
import type { Site } from "../contracts";
import type { Conditions, Verdict } from "../landing";
import { type CustomMeta, type Tile, decodeDem, decodeEphem, tilesFor } from "../custom/assets";
import { AZ_STEP, type Ephem, bodyState, computeCustom, inCustomDem } from "../custom/horizon";
import { missionSpan, pointVerdict } from "./dispersion";

export type DispersionRequest = { site: Site; points: { lat: number; lonE: number }[]; landingUtc: string; limits: Conditions; base: string };
export type PointResult = { verdict: Verdict | null; why?: string };
export type DispersionReply = { done: number; total: number; results?: PointResult[]; error?: string };

const SUN_HALF_DEG = 0.27; // Sun disc half-width, as screens/DemInfo.tsx

const ctx = self as unknown as { onmessage: (e: MessageEvent<DispersionRequest>) => void; postMessage: (m: DispersionReply) => void };

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

ctx.onmessage = async ({ data: { site, points, landingUtc, limits, base } }) => {
  const total = points.length;
  try {
    const m = (await (await get(base + "meta.json")).json()) as CustomMeta;
    const full = decodeEphem(await (await get(base + m.ephemFile)).arrayBuffer(), m);
    const span = missionSpan(full.startUtc, full.stepMin, full.n, landingUtc, limits.days);
    if (!span) {
      ctx.postMessage({ done: total, total, results: points.map(() => ({ verdict: null, why: "mission window outside the data" })) });
      return;
    }
    const e: Ephem = {
      ...full,
      startUtc: new Date(Date.parse(full.startUtc) + span.at * full.stepMin * 60000).toISOString().replace(".000Z", "Z"),
      n: span.len,
      v: full.v.subarray(6 * span.at, 6 * (span.at + span.len)),
    };
    // One DEM for all points: the union of the tiles their rays reach.
    const inside = points.map((p) => inCustomDem(p.lat, p.lonE));
    const need = new Map<string, Tile>();
    points.forEach((p, i) => inside[i] && tilesFor(m, p.lat, p.lonE).forEach((t) => need.set(t.file, t)));
    const tiles = [...need.values()];
    const parts = await Promise.all(tiles.map((t) => get(base + t.file).then((r) => r.arrayBuffer())));
    const dem = tiles.length ? await decodeDem(parts, tiles, m) : null;
    const results: PointResult[] = [];
    points.forEach((p, i) => {
      if (!inside[i] || !dem) results.push({ verdict: null, why: "no LOLA terrain here" });
      else {
        try {
          const { timeline: t, complete } = computeCustom({ ...site, id: `${site.id}-d${i}`, lat: p.lat, lonE: p.lonE, terrain: "polar240" }, dem, e);
          // #330: a ray that leaves the DEM gives a lower bound only; a body above it makes the point unknown.
          const blind = t.sunVisible.some(
            (v, k) =>
              bodyState(t.sunAz[k], t.sunEl[k], v, complete, AZ_STEP, SUN_HALF_DEG) === "unknown" ||
              bodyState(t.earthAz[k], t.earthEl[k], t.earthVisible[k], complete, AZ_STEP) === "unknown",
          );
          const verdict = blind ? null : pointVerdict(t, limits, landingUtc);
          results.push(verdict ? { verdict } : { verdict: null, why: blind ? "horizon ray leaves the terrain data" : "mission window outside the data" });
        } catch (err) {
          results.push({ verdict: null, why: String(err) });
        }
      }
      ctx.postMessage({ done: i + 1, total });
    });
    ctx.postMessage({ done: total, total, results });
  } catch (err) {
    ctx.postMessage({ done: 0, total, error: String(err) });
  }
};
