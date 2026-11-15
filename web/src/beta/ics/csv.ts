import type { Site, Timeline } from "../../contracts";
import { BUILD_LABEL } from "../../buildInfo";

const metadata = (s: string) => s.replace(/[\r\n]+/g, " ");

/** Export the stored samples without recomputing visibility. Missing DSN data stays empty. */
export function buildCsv(site: Site, tl: Timeline): string {
  const lon = site.lonE == null ? "unknown" : String(((site.lonE % 360) + 360) % 360);
  const lines = [
    `# site: ${metadata(site.name)}; latitude: ${site.lat ?? "unknown"}; longitude: ${lon} E; source: SPICE DE440 and ${site.terrain === "none" ? "sphere" : "LOLA DEM"}; site source: ${metadata(site.source)}; build: ${BUILD_LABEL}`,
    "time_utc,sun_el_deg,sun_az_deg,sun_visible_frac,earth_el_deg,earth_az_deg,earth_visible,dsn_visible",
  ];
  const start = Date.parse(tl.startUtc);
  for (let i = 0; i < tl.sunVisible.length; i++) {
    lines.push([new Date(start + i * tl.stepMin * 60000).toISOString(), tl.sunEl[i], tl.sunAz[i], tl.sunVisible[i], tl.earthEl[i], tl.earthAz[i], tl.earthVisible[i], tl.dsnVisible?.[i] ?? ""].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
