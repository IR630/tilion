import type { Site, Timeline } from "../../contracts";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { buildIcs, timelineWindows } from "./ics";
import { buildCsv } from "./csv";

/** BETA: download the Sun / Earth / DSN windows of the shown period as an .ics file. */
export function IcsExport({ site, tl, fullTl }: { site: Site; tl: Timeline; fullTl: Timeline | null }) {
  if (tl.stub) return null;
  const count = timelineWindows(tl).length;
  const download = () => {
    const blob = new Blob([buildIcs(site, tl)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tilion-${site.id}-windows.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <p className="beta-row" aria-label="Export windows">
      <BetaTag />
      <button type="button" onClick={download} disabled={count === 0}>
        Export windows (.ics)
      </button>{" "}
      <button type="button" disabled={!fullTl} onClick={() => {
        if (!fullTl) return;
        const url = URL.createObjectURL(new Blob([buildCsv(site, fullTl)], { type: "text/csv;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `tilion-${site.id}-hourly.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }}>Download CSV</button>{" "}
      <span className="hud-foot">{count} windows, UTC, shown period</span>
    </p>
  );
}
