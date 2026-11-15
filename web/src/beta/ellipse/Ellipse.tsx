import { useEffect, useState } from "react";
import { BetaTag } from "../BetaTag";
import "./ellipse.css";

export interface Quantity { aim: number; p10: number; shareGe40: number }
export interface RadiusStats { n: number; sun: Quantity; earth: Quantity }
export interface EllipseDoc { thresholdPct: number; pixelM: number; sites: Record<string, Record<string, RadiusStats>> }

const base = `${import.meta.env.BASE_URL}data/`;
/** #206: the period of every number in this block, in words, so nobody compares it with "next 30 d". */
export const MEAN = "18.6-y mean";
export const radiusLabel = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/** Loads beta/ellipse.json once per mount; null = file missing or unreadable (block shows a note). */
export function useEllipse(): EllipseDoc | null | undefined {
  const [doc, setDoc] = useState<EllipseDoc | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(`${base}beta/ellipse.json`, { signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setDoc(d))
      .catch(() => live && setDoc(null));
    return () => { live = false; };
  }, []);
  return doc;
}

function Bars({ stats }: { stats: RadiusStats }) {
  const rows: [string, number, string][] = [
    ["Sun at aim", stats.sun.aim, "bar-sun"],
    ["Sun worst 10 %", stats.sun.p10, "bar-sun"],
    ["Earth at aim", stats.earth.aim, "bar-earth"],
    ["Earth worst 10 %", stats.earth.p10, "bar-earth"],
  ];
  return (
    <svg viewBox="0 0 420 100" role="img" aria-label={`Aim point against worst 10 % of the area, Sun and Earth, percent, ${MEAN}`}>
      {rows.map(([label, v, cls], k) => (
        <g key={label} transform={`translate(0 ${k * 24 + 4})`}>
          <text x="0" y="12">{label}</text>
          <rect className="bar-bg" x="110" y="2" width="260" height="14" />
          <rect className={cls} x="110" y="2" width={(260 * v) / 100} height="14"><title>{`${label}: ${v.toFixed(1)} %, ${MEAN}`}</title></rect>
          <text x="376" y="12">{v.toFixed(0)} %</text>
        </g>
      ))}
    </svg>
  );
}

/** Presentational part; `radii` is the per-radius map of one site. */
export function EllipseView({ radii, threshold }: { radii: Record<string, RadiusStats>; threshold: number }) {
  const keys = Object.keys(radii).map(Number).sort((a, b) => a - b);
  const [sel, setSel] = useState(keys[Math.min(2, keys.length - 1)]);
  const chosen = keys.includes(sel) ? sel : keys[keys.length - 1];
  const q = (x: Quantity) => (
    <>
      <td>{x.aim.toFixed(1)}</td>
      <td>{x.p10.toFixed(1)}</td>
      <td>{x.shareGe40.toFixed(0)}</td>
    </>
  );
  return (
    <>
      <table aria-label="Light across the landing area">
        <thead>
          <tr>
            <th rowSpan={2}>Radius</th>
            <th colSpan={3}>Sun, % ({MEAN})</th>
            <th colSpan={3}>Earth, % ({MEAN})</th>
          </tr>
          <tr>
            <th>aim</th><th>worst 10 %</th><th>area ≥ {threshold}</th>
            <th>aim</th><th>worst 10 %</th><th>area ≥ {threshold}</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((m) => (
            <tr key={m} aria-selected={m === chosen}>
              <td>{radiusLabel(m)}</td>
              {q(radii[m].sun)}
              {q(radii[m].earth)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="beta-radii" role="group" aria-label="Radius shown in the bars">
        {keys.map((m) => (
          <button key={m} type="button" aria-pressed={m === chosen} onClick={() => setSel(m)}>{radiusLabel(m)}</button>
        ))}
      </div>
      <p className="beta-note">Bars at {radiusLabel(chosen)}, {MEAN}:</p>
      <Bars stats={radii[chosen]} />
    </>
  );
}

export function EllipseBlock({ siteId }: { siteId: string }) {
  const doc = useEllipse();
  const radii = doc?.sites[siteId];
  return (
    <section className="beta-ellipse" aria-label="Landing ellipse light (beta)">
      <h3>Landing ellipse: light and Earth across the touchdown area <BetaTag /></h3>
      <p className="beta-note">
        PGDA 69 18.6-y mean, not for a date: do not compare it with the "next 30 d" or mission-window shares. 60 m pixels. Aim = the pixel under the site point. Worst 10 % = the
        value that 10 % of the disc area stays at or below.
      </p>
      {doc === undefined ? <p className="beta-note">Loading…</p>
        : !doc || !radii ? <p className="beta-note">No PGDA 69 85°S map coverage for this site (full disc must fit on the 60 m map).</p>
        : <EllipseView radii={radii} threshold={doc.thresholdPct} />}
    </section>
  );
}
