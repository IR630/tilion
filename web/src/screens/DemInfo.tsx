// Terrain data panel (#85): which DEM built this site's horizon mask, its limits, and the terrain
// horizon toward the Sun at the current moment. Numbers come only from the loaded mask and timeline.
import type { HorizonMask, Site, Terrain, Timeline } from "../contracts";
import { isCustom, rayCompleteness } from "../custom/client";
import { bodyState } from "../custom/horizon";

/** Sun angular radius (deg) for the ray check under the disc (#330). */
const SUN_HALF_DEG = 0.27;

/** What precompute uses per terrain kind (backend/src/precompute/__main__.py, site_terrain). */
export const DEM_SOURCE: Record<Terrain, { source: string; resolution: string; coverage: string }> = {
  polar80: {
    source: "LOLA polar DEM (NASA PGDA 90), nested grid as in Barker et al. 2021",
    resolution: "20 m within 5 km of the site, 80 m to the 80°S edge, 240 m beyond",
    coverage: "Inside LOLA 80–90°S coverage (80 m grid)",
  },
  polar240: {
    source: "LOLA polar DEM (NASA PGDA 90)",
    resolution: "240 m",
    coverage: "Inside LOLA 60–90°S coverage (240 m grid)",
  },
  none: {
    source: "No terrain model",
    resolution: "—",
    coverage: "No terrain — bare sphere (flat 0° horizon)",
  },
};

/** Mask value at or below this is "no DEM in this direction" (precompute writes -90°). */
const NO_DATA_DEG = -89;

/** Terrain horizon at an azimuth: linear between mask samples, wraps at 0/360; null = no DEM there. */
export function horizonToward(mask: HorizonMask, az: number): number | null {
  const n = mask.elevDeg.length;
  const a = ((az % 360) + 360) % 360;
  const f = a / mask.azStepDeg;
  const k = Math.floor(f) % n;
  const t = f - Math.floor(f);
  const e0 = mask.elevDeg[k];
  const e1 = mask.elevDeg[(k + 1) % n];
  if (e0 <= NO_DATA_DEG || e1 <= NO_DATA_DEG) return null;
  return e0 * (1 - t) + e1 * t;
}

/** "disc hidden" / "disc partly visible (40 % of sunlight)" / "disc fully visible", from the timeline flag. */
function discWord(v: number): string {
  if (!(v > 0)) return "disc hidden";
  if (v >= 1) return "disc fully visible";
  return `disc partly visible (${Math.max(1, Math.round(v * 100))} % of sunlight)`;
}

/**
 * One line: the horizon toward the Sun against the Sun elevation, at timeline index i.
 * complete = ray completeness of a custom point (#330): a Sun above the known terrain on an
 * incomplete ray is "visibility unknown", not "visible".
 */
export function sunDirectionText(mask: HorizonMask, tl: Timeline, i: number, complete?: boolean[] | null): string {
  const az = Math.round(((tl.sunAz[i] % 360) + 360) % 360) % 360;
  const sun = tl.sunEl[i];
  const hz = horizonToward(mask, tl.sunAz[i]);
  const state = bodyState(tl.sunAz[i], sun, tl.sunVisible[i], complete, mask.azStepDeg, SUN_HALF_DEG);
  if (state === "unknown") {
    const known = hz === null ? "no DEM data in this direction" : `known horizon ${hz.toFixed(1)}°`;
    return `Toward the Sun (az ${az}°): ${known}, the ray leaves the DEM coverage. Sun ${sun.toFixed(1)}° → visibility unknown`;
  }
  const hzText = hz === null ? "no DEM data in this direction" : `horizon ${hz.toFixed(1)}°`;
  return `Toward the Sun (az ${az}°): ${hzText}, Sun ${sun.toFixed(1)}° → ${discWord(tl.sunVisible[i])}`;
}

/** #330: warning for a custom point whose horizon rays leave the DEM coverage; null = all rays complete. */
export function incompleteRaysText(mask: HorizonMask, tl: Timeline, i: number, complete: boolean[] | null | undefined): string | null {
  if (!complete) return null;
  const bad = complete.filter((c) => !c).length;
  if (bad === 0) return null;
  const earth = bodyState(tl.earthAz[i], tl.earthEl[i], tl.earthVisible[i], complete, mask.azStepDeg);
  return (
    `Warning: ${bad} of ${complete.length} horizon rays leave the DEM coverage before 300 km. ` +
    "In these directions the real horizon can be higher than shown. " +
    "A Sun or Earth above the known terrain there has the state unknown, not visible." +
    (earth === "unknown" ? " Now the Earth is in such a direction: Earth visibility unknown." : "")
  );
}

/** Coverage text: the terrain kind, or why there is no terrain. */
function coverageText(site: Site, terrain: Terrain): string {
  if (terrain !== "none") return DEM_SOURCE[terrain].coverage;
  if (site.lat === null) return "No terrain — no published point for this site; bare sphere (flat 0° horizon)";
  if (site.lat > -60) return "No terrain — outside LOLA 60–90°S coverage; bare sphere (flat 0° horizon)";
  return DEM_SOURCE.none.coverage;
}

/**
 * mask = the DEM mask of the site (source facts); view = the mask on screen (terrain or the
 * bare-sphere comparison); tl = the timeline on screen; i = its index.
 */
export function DemInfo({
  site,
  mask,
  view,
  tl,
  i,
  complete,
}: {
  site: Site;
  mask: HorizonMask;
  view: HorizonMask;
  tl: Timeline;
  i: number;
  /** Ray completeness (#330); default = the computed custom point, none for catalogue sites. */
  complete?: boolean[] | null;
}) {
  const dem = DEM_SOURCE[mask.terrain];
  const comparing = view.terrain === "none" && mask.terrain !== "none";
  const rays = comparing ? null : complete !== undefined ? complete : isCustom(site) ? rayCompleteness(site.id) : null;
  const warning = incompleteRaysText(view, tl, i, rays);
  return (
    <section className="dem-info" aria-label="Terrain data">
      <h3>Terrain data</h3>
      <dl>
        <dt>Source</dt>
        <dd>{dem.source}</dd>
        <dt>Resolution</dt>
        <dd>{dem.resolution}</dd>
        <dt>Observer height</dt>
        <dd>{mask.observerHeightM} m above the ground</dd>
        <dt>Coverage</dt>
        <dd>{coverageText(site, mask.terrain)}</dd>
        <dt>Horizon mask</dt>
        <dd>
          {mask.elevDeg.length} azimuths, {mask.azStepDeg}° step
          {mask.terrain !== "none" ? "; rays to 300 km; points outside the DEM are skipped, not filled with a flat surface" : ""}
        </dd>
      </dl>
      <p className="dem-info-sun" aria-label="Horizon toward the Sun">
        {sunDirectionText(view, tl, i, rays)}
        {comparing ? " (bare sphere comparison)" : ""}
      </p>
      {warning ? (
        <p className="dem-info-warning" role="note" aria-label="Incomplete terrain">
          {warning}
        </p>
      ) : null}
      <p className="dem-info-limits">
        Limits: the 80/240 m DEM (20 m near polar sites) cannot show boulders or landing hazards. This is not a landing-safety assessment. The
        horizon value is the highest terrain along the ray; the panel does not locate the blocking feature.
      </p>
    </section>
  );
}
