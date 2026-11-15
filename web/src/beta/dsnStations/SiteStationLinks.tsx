import { useEffect, useState } from "react";
import { StationPanel } from "./StationPanel";
import { loadStationLinks, stationSnapshot, type StationLinks } from "./stationLinks";

export function SiteStationLinks({ siteId, atUtc }: { siteId: string; atUtc: string }) {
  const [data, setData] = useState<StationLinks | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadStationLinks().then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, []);
  if (data === undefined) return <p>Loading DSN station data…</p>;
  const result = data && stationSnapshot(data, siteId, Date.parse(atUtc));
  if (!result) return <section className="station-panel" aria-label="DSN station links"><h3>DSN stations</h3><p>Station data unavailable for this site or time.</p></section>;
  return <StationPanel {...result} />;
}
