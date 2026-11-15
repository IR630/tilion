// "Next windows" (#196): the Sun-lit and Earth-in-view windows of a site over the next 30 days, with
// start – end UTC and duration. Same hours.json codes and the same run helper (bandRuns) as the
// time strip's bands, so each row is a band on the strip. A click sets the shared moment to the start.
import { useEffect, useState } from "react";
import { fmtDuration } from "../format";
import { hoursLoader, type Hours } from "../route/hours";
import { BETA } from "../beta/flags";
import { DsnVia } from "../beta/dsnStations/DsnVia";
import { DAY, isoUtc, nextWindows, type BandWindow } from "./time";
import { GEO_CAVEAT, Info } from "../ui/Info";
import "./timeline.css";

export const NEXT_DAYS = 30;
const MAX_ROWS = 4;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Jan 15 12:00" (UTC). */
export function fmtWhen(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, "0")} ${String(d.getUTCHours()).padStart(2, "0")}:00`;
}

/** #210: the row text of a window. The list covers [at, at + 30 d); a window that runs past day 30 is
 *  cut there with an arrow and says where it really ends, so it does not read as a conflict with the
 *  30-day share. */
export function windowText(w: BandWindow): { range: string; cont: string | null } {
  const start = w.ongoing ? "now" : fmtWhen(w.startMs);
  const end = w.openEnd ? "data end" : fmtWhen(w.endMs);
  if (w.endMs <= w.clipEndMs) return { range: `${start} – ${end}`, cont: null };
  return { range: `${start} – ${fmtWhen(w.clipEndMs)} →`, cont: `continues to ${end}` };
}

/** compact: the Sun and Earth rows side by side, two windows each (Horizon view, Windows panel; #207). */
export function NextWindows({ siteId, atUtc, onPick, compact = false }: { siteId: string; atUtc: string; onPick: (utc: string) => void; compact?: boolean }) {
  const [hours, setHours] = useState<Hours | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    hoursLoader().then(
      (h) => live && setHours(h),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  if (failed) return <p role="alert">Next windows unavailable</p>;
  if (!hours || !hours.sites.has(siteId)) return null;
  const at = Date.parse(atUtc);
  const shown = compact ? 2 : MAX_ROWS;
  const rows: [string, string, BandWindow[]][] = [
    ["sun", "Sun-lit", nextWindows(hours, siteId, at, NEXT_DAYS * DAY, 1)],
    ["earth", "Earth in view", nextWindows(hours, siteId, at, NEXT_DAYS * DAY, 2)],
  ];
  return (
    <section className={`nwin${compact ? " is-compact" : ""}`} aria-label="Next windows">
      <h3 className="nwin-head">
        Next windows <span>in the next {NEXT_DAYS}&nbsp;d from {fmtWhen(at)} UTC. Click one to go there.</span>
      </h3>
      {rows.map(([kind, name, ws]) => (
        <div key={kind} className={`nwin-row k-${kind}`}>
          <span className="nwin-k">
            <i aria-hidden="true" /> {name}
            {kind === "earth" && <Info label="What Earth in view means">{GEO_CAVEAT}</Info>}
          </span>
          {ws.length === 0 ? (
            <span className="nwin-none">none in {NEXT_DAYS} d</span>
          ) : (
            <ul aria-label={name}>
              {ws.slice(0, shown).map((w) => {
                const t = windowText(w);
                return (
                  <li key={w.startMs}>
                    <button
                      type="button"
                      data-start={isoUtc(w.startMs)}
                      title={w.ongoing ? "Open now" : "Set the time to this window's start"}
                      disabled={w.ongoing}
                      onClick={() => onPick(isoUtc(w.startMs))}
                    >
                      <span>
                        {t.range}
                        {BETA.dsnStations && kind === "earth" && <DsnVia startMs={w.ongoing ? at : w.startMs} endMs={w.endMs} compact={compact} />}
                        {t.cont && <small className="nwin-cont"> {t.cont}</small>}
                      </span>
                      <b>
                        {w.openEnd ? "> " : ""}
                        {fmtDuration(w.hours)}
                        {w.ongoing ? " left" : ""}
                      </b>
                    </button>
                  </li>
                );
              })}
              {ws.length > shown && <li className="nwin-more">+{ws.length - shown} more in {NEXT_DAYS} d</li>}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
