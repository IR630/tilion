// BETA (#256): our Earth-above-5° share against NASA LCRNS on the NASA check screen.
// Removable: delete this folder, BETA.commsMargin in ../flags.ts and the mount lines in
// screens/Horizon.tsx and screens/Validation.tsx. Loads data itself (no api.ts), like the hindcast beta.
import { useEffect, useState } from "react";
import type { SitesFile, Timeline } from "../../contracts";
import { DATA_PERIOD, keepUnits } from "../../format";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { commsMargin, LCRNS_CASES, LCRNS_SRC, MARGIN_DEG } from "./margin";

export type Row = { siteId: string; name: string; nasaName: string; reference: number; match: string; ours: number; at4: number; at6: number };

async function getData<T>(path: string): Promise<T | null> {
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}data/${path}`, { signal: AbortSignal.timeout(15000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Build the rows from sites.json and the two timelines; null when any part is missing. */
export async function loadLcrnsRows(): Promise<Row[] | null> {
  const sites = await getData<SitesFile>("sites.json");
  if (!sites?.sites) return null;
  const rows: Row[] = [];
  for (const c of LCRNS_CASES) {
    const site = sites.sites.find((s) => s.id === c.siteId);
    const tl = site ? await getData<Timeline>(`timeline/${c.siteId}.json`) : null;
    const m = tl && commsMargin(tl);
    if (!site || !tl || !m) return null;
    rows.push({ ...c, name: site.name, ours: m.high * 100, at4: commsMargin(tl, 4)!.high * 100, at6: commsMargin(tl, 6)!.high * 100 });
  }
  return rows;
}

/** NASA check cards: our Earth-above-5° share against the LCRNS DTE coverage. INFO: no tolerance. */
export function LcrnsCheck({ rows }: { rows?: Row[] | null }) {
  const [loaded, setLoaded] = useState<Row[] | null>(null);
  useEffect(() => {
    if (rows !== undefined) return;
    let live = true;
    loadLcrnsRows().then((r) => live && setLoaded(r));
    return () => {
      live = false;
    };
  }, [rows]);
  const r = rows !== undefined ? rows : loaded;
  if (!r) return null;
  return (
    <section className="val-group" aria-label="Direct-to-Earth coverage vs NASA LCRNS (beta)">
      <h3>
        Direct-to-Earth coverage vs NASA LCRNS <BetaTag />
      </h3>
      <p className="note">
        {`NASA gives the yearly share of hours with direct-to-Earth contact at two south-pole landing sites. ` +
          `Ours: Earth centre above the LOLA terrain and more than ${MARGIN_DEG}° above the local level, hourly, ${DATA_PERIOD}.`}
      </p>
      <details className="hud-notes val-about">
        <summary>Method and limits</summary>
        <p className="note">
          {`NASA used a ten-year line-of-sight simulation to the Earth centre. The paper gives no elevation threshold and no ` +
            `coordinates. The ${MARGIN_DEG}° threshold is our assumption. The match depends on it: at 4° and 6° we get ` +
            r.map((x) => `${x.at4.toFixed(1)} % and ${x.at6.toFixed(1)} % (${x.name})`).join(", ") +
            `. Our period is 13 months, not ten years. So these rows are information, not a pass or fail.`}
        </p>
      </details>
      <div className="val-cards">
        {r.map((x) => (
          <article className="val-card hud-frame" key={x.siteId} aria-label={`${x.name}: LCRNS direct-to-Earth`} data-verdict="info">
            <header>
              <h4>{`Earth above ${MARGIN_DEG}° and in view, % of hours`}</h4>
              <span className="val-info" title="Information only: no tolerance, so no pass or fail">
                INFO
              </span>
            </header>
            <p className="val-site">{`${x.name} vs NASA ${x.nasaName}`}</p>
            <dl>
              <div className="val-big">
                <dt>Ours</dt>
                <dd>{keepUnits(`${x.ours.toFixed(1)} %`)}</dd>
              </div>
              <div className="val-big">
                <dt>NASA LCRNS</dt>
                <dd>{keepUnits(`${x.reference} %`)}</dd>
              </div>
              <div>
                <dt>Difference</dt>
                <dd>{keepUnits(`${(x.ours - x.reference).toFixed(1)} pp`)}</dd>
              </div>
              <div>
                <dt>Tolerance</dt>
                <dd>none</dd>
              </div>
            </dl>
            <p className="val-explanation">{x.match}</p>
            <a href={LCRNS_SRC.url} target="_blank" rel="noreferrer">
              {LCRNS_SRC.label}
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
