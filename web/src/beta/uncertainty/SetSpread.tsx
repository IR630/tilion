// BETA horizon uncertainty (#379). Mounts: Sun and Earth tiles of the PlaceCard in navigator/Navigator.tsx,
// next to "Sunset in" / "Earthset in", behind BETA.uncertainty.
import { useEffect, useState } from "react";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { type EventsFile, fmtSpread, loadEvents, setSpread, spreadTip } from "./events";

/** "±N h": how far the next sunset (or Earthset) moves when the LOLA terrain is 1σ higher or lower. */
export function SetSpread({ siteId, atUtc, body, file }: {
  siteId: string; atUtc: string; body: "sun" | "earth"; file?: EventsFile | null;
}) {
  const [loaded, setLoaded] = useState<EventsFile | null>(null);
  useEffect(() => {
    if (file !== undefined) return;
    let live = true;
    loadEvents().then((f) => live && setLoaded(f));
    return () => {
      live = false;
    };
  }, [file]);
  const f = file !== undefined ? file : loaded;
  const row = f?.sites.find((s) => s.siteId === siteId);
  if (!f || !row) return null;
  const i = Math.floor((Date.parse(atUtc) - Date.parse(f.startUtc)) / (f.stepMin * 60000));
  const s = setSpread(row[body], i, f.hours);
  if (!s) return null;
  const what = body === "sun" ? "Sunset" : "Earthset";
  const tip =
    `${spreadTip(what, s.early, s.late, f.stepMin)} Assumption: ${f.sigma}. Hourly steps.`;
  return (
    <span className="beta-spread" aria-label={`${what} time range from DEM error`} title={tip}>
      <BetaTag />
      {fmtSpread(s.early, s.late, f.stepMin)}
    </span>
  );
}
