// #271: the site's own rows of the NASA check on the place card — ours vs PGDA 69 with the verdict, and
// how far a bare sphere misses sunset here. Rows come from data/validation.json by siteId; no new numbers.
import { useEffect, useState } from "react";
import { loadValidation } from "../api";
import type { ValidationFile, ValidationRow } from "../contracts";
import { fmtDuration } from "../format";

/** `same`: our model on the DEM the PGDA 69 map was made from (#270), the verdict of the method (#311). `sun`: one map
 *  pixel against our own DEM; on a sharp ridge a one-pixel shift changes it by tens of pp, so it is a reference only. */
export type SiteEvidence = { same60: ValidationRow | null; same: ValidationRow | null; sun: ValidationRow | null; earth: ValidationRow | null; sphere: ValidationRow | null };

/** The site's PGDA 69 Sun and Earth rows and its bare-sphere row; null when the site has none of them. */
export function siteEvidence(f: ValidationFile, siteId: string): SiteEvidence | null {
  const rows = (id: string) => f.groups.find((g) => g.id === id)?.rows.filter((r) => r.siteId === siteId) ?? [];
  const ill = rows("illumination");
  const e: SiteEvidence = {
    same60: ill.find((r) => r.check.startsWith("Same 60 m DEM: visible solar disc")) ?? null,
    same: ill.find((r) => r.check.startsWith("Same DEM: visible solar disc")) ?? null,
    sun: ill.find((r) => r.check.startsWith("Mean visible solar disc")) ?? null,
    earth: ill.find((r) => r.check.startsWith("Earth visible")) ?? null,
    sphere: rows("sphere")[0] ?? null,
  };
  return e.same60 || e.same || e.sun || e.earth || e.sphere ? e : null;
}

/** The row that gives the site's sunlight verdict: the finest map on its own grid (60 m, then 120 m), else the
 *  single-pixel row (#311, D-023). */
export function verdictRow(e: SiteEvidence | null): ValidationRow | null {
  return e?.same60 ?? e?.same ?? e?.sun ?? null;
}

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)} %`);

function Check({ label, r }: { label: string; r: ValidationRow }) {
  const off = r.diff === null ? "" : `, off by ${Math.abs(r.diff).toFixed(1)}\u00a0pp (tolerance ±${r.tolerance ?? "—"})`;
  return (
    <li className={`evi-row ${r.pass ? "pass" : "fail"}`} title={r.note}>
      <b>{r.pass ? "PASS" : "FAIL"}</b>
      <span>
        {label}: ours {pct(r.ours)}, <a href={r.url} target="_blank" rel="noreferrer">PGDA 69</a> {pct(r.reference)}
        {off}
      </span>
    </li>
  );
}

/** The map's spread over the 3×3 pixels around the site, from the row note; null when the note has none. */
export function mapSpread(r: ValidationRow): string | null {
  return /Map 3×3 neighbourhood: ([\d.]+–[\d.]+ %)/.exec(r.note)?.[1] ?? null;
}

/** The single-pixel row on our own DEM as a reference: the DEM difference, not a verdict (#311). */
function OwnDem({ r }: { r: ValidationRow }) {
  const spread = mapSpread(r);
  return (
    <li className="evi-row info" title={r.note}>
      <b>OUR DEM</b>
      <span>
        Same 18.6 y on our LOLA relief: {pct(r.ours)}; <a href={r.url} target="_blank" rel="noreferrer">PGDA 69</a> map pixel {pct(r.reference)}
        {spread && `, its 3×3 neighbours ${spread}`}.
      </span>
    </li>
  );
}

export function SiteEvidenceBlock({ siteId, file }: { siteId: string; file?: ValidationFile | null }) {
  const [loaded, setLoaded] = useState<ValidationFile | null | undefined>(undefined);
  useEffect(() => {
    if (file !== undefined) return;
    let live = true;
    loadValidation().then((f) => live && setLoaded(f));
    return () => {
      live = false;
    };
  }, [file]);
  const f = file !== undefined ? file : loaded;
  const e = f ? siteEvidence(f, siteId) : null;
  if (!e) return null;
  return (
    <section className="evi" aria-label="Checked against NASA">
      <p className="evi-k">Checked against NASA, this site</p>
      <ul>
        {e.same60 && <Check label="Sunlight, 60 m map on its own grid, 18.6 y" r={e.same60} />}
        {e.same && <Check label="Sunlight, 120 m map on its own grid, 18.6 y" r={e.same} />}
        {e.sun && (e.same || e.same60 ? <OwnDem r={e.sun} /> : <Check label="Sunlight, 18.6 y" r={e.sun} />)}
        {e.earth && <Check label="Earth in view, 18.6 y" r={e.earth} />}
        {e.sphere?.ours != null && (
          <li className="evi-row info" title={e.sphere.note}>
            <b>WHY LOLA</b>
            <span>A smooth-sphere model misses sunset here by {fmtDuration(e.sphere.ours)} (median, 2027).</span>
          </li>
        )}
      </ul>
    </section>
  );
}
