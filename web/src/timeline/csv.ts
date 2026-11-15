// #274: the site's precomputed timeline as an hourly CSV for a planner's own tools. The same arrays the
// UI draws (data/timeline/<id>.json, D-001); no new numbers. Lines starting with # are the header notes.
import type { Site, Timeline } from "../contracts";
import { fmtLatLon } from "../format";

export function timelineCsv(site: Site, tl: Timeline): string {
  const dsn = tl.dsnVisible;
  const head = [
    `# Tilion hourly Sun and Earth, ${site.name}, ${fmtLatLon(site.lat, site.lonE)} (MOON_ME, longitude 0-360 E)`,
    `# SPICE DE440, apparent (LT+S); horizon: ${site.terrain === "none" ? "bare sphere, no terrain" : "LOLA terrain mask, observer 2 m"}.${tl.stub ? " SYNTHETIC DATA." : ""} Not a landing certification.`,
    "# sun_visible = share of solar flux above terrain (limb darkened); sun_lit = any part of the disc; earth_visible = Earth centre above terrain; dsn = a DSN station clears the site's terrain horizon and sees the Moon above 10 deg",
    `utc,sun_az_deg,sun_el_deg,sun_visible,sun_lit,earth_az_deg,earth_el_deg,earth_visible${dsn ? ",dsn" : ""}`,
  ];
  const rows = tl.sunEl.map((_, i) => {
    const t = new Date(Date.parse(tl.startUtc) + i * tl.stepMin * 60_000).toISOString().slice(0, 16) + "Z";
    const r = [t, tl.sunAz[i].toFixed(2), tl.sunEl[i].toFixed(3), tl.sunVisible[i].toFixed(3), tl.sunVisible[i] > 0 ? 1 : 0,
      tl.earthAz[i].toFixed(2), tl.earthEl[i].toFixed(3), tl.earthVisible[i]];
    if (dsn) r.push(dsn[i]);
    return r.join(",");
  });
  return [...head, ...rows].join("\n") + "\n";
}

export function downloadCsv(site: Site, tl: Timeline) {
  const url = URL.createObjectURL(new Blob([timelineCsv(site, tl)], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `tilion-${site.id}-${tl.startUtc.slice(0, 10)}-hourly.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
