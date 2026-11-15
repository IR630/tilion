// BETA (#174): our sunset/sunrise at real polar landers vs events the missions announced.
// Removable: delete web/src/beta/hindcast/ and its one mount line in screens/Validation.tsx.
// Data: data/beta/hindcast.json from backend precompute.beta_hindcast.
import { useEffect, useState } from "react";
import { fmtLatLon } from "../../format";
import { BetaTag } from "../BetaTag";
import "./hindcast.css";

export type HindcastRow = {
  id: string;
  mission: string;
  siteId: string;
  site: string;
  lat: number;
  lonE: number;
  event: "sunset" | "sunrise";
  oursUtc: string;
  oursCentreUtc: string;
  reported: string;
  reportedUtc: string;
  precision: "time" | "day";
  deltaH: number;
  delta: string;
  consistency: string;
  source: string;
  url: string;
};

export type HindcastFile = { beta: true; generatedUtc: string; command: string; method: string; note: string; rows: HindcastRow[] };

const fmtUtc = (s: string) => s.replace("T", " ").replace(/Z$/, " UTC");

async function loadHindcast(): Promise<HindcastFile | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/beta/hindcast.json`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const f = (await r.json()) as HindcastFile;
    return Array.isArray(f?.rows) ? f : null;
  } catch {
    return null;
  }
}

/** Table view; renders the given file (tests) or loads data/beta/hindcast.json. Nothing while loading or on error. */
export function Hindcast({ file }: { file?: HindcastFile }) {
  const [f, setF] = useState<HindcastFile | null>(file ?? null);
  useEffect(() => {
    if (file) return;
    let live = true;
    loadHindcast().then((x) => live && setF(x));
    return () => {
      live = false;
    };
  }, [file]);
  if (!f) return null;
  return (
    <section className="beta-hindcast" aria-label="Hindcast: real polar missions (beta)">
      <h3>
        Hindcast: real polar missions <BetaTag />
      </h3>
      <p className="note">
        Our sunset and sunrise at two real landing sites, set against events the missions announced. A row
        shows our time is consistent with the reported event. It is not a match to telemetry.
      </p>
      <div className="beta-wrap">
        <table>
          <thead>
            <tr>
              <th>Mission</th>
              <th>Site</th>
              <th>Event</th>
              <th>Our time</th>
              <th>Reported event</th>
              <th>Δ ours − reported</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {f.rows.map((r) => (
              <tr key={r.id}>
                <td>{r.mission}</td>
                <td>
                  {fmtLatLon(r.lat, r.lonE)}
                  <small>{r.site}</small>
                </td>
                <td>{r.event === "sunset" ? "Sunset (last light)" : "Sunrise (first light)"}</td>
                <td>
                  {fmtUtc(r.oursUtc)}
                  <small>Sun centre {fmtUtc(r.oursCentreUtc)}</small>
                </td>
                <td>
                  {r.reported}
                  <small>{r.consistency}</small>
                </td>
                <td>{r.delta}</td>
                <td>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.source}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details className="hud-notes">
        <summary>Method and limits</summary>
        <p className="note">{f.method}</p>
        <p className="note">{f.note}</p>
        <p className="note">
          <code>{f.command}</code>
        </p>
      </details>
    </section>
  );
}
