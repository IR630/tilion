// "NASA check" screen (#23): every number comes from data/validation.json (backend precompute.validation).
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { loadValidation } from "../api";
import type { ValidationFile, ValidationRow } from "../contracts";
import { fmtValue, maxError } from "./validationFmt";
import { EarthWindowExample } from "./EarthWindowExample";
import { EllipseExample } from "./EllipseExample";
import { BETA } from "../beta/flags";
import { Hindcast } from "../beta/hindcast/Hindcast";
import { LcrnsCheck } from "../beta/commsMargin/LcrnsCheck";
import { UncertaintyCheck } from "../beta/uncertainty/UncertaintyLine";
import { LrocCheck } from "./LrocCheck";
import { gsap, hudCascade, motionOff, stamp, useIntro } from "../motion";
import "./hud.css";
import "./validation.css";

/** NASA check entry (#126): cards open with their brackets, PASS / FAIL stamp in. */
function validationIntro(tl: gsap.core.Timeline, root: HTMLElement, ctx: { whip: boolean }) {
  const items = ":scope > :not(.hud-tiles):not(.val-group), :scope > .hud-tiles > *, :scope > .val-group > :not(.val-cards), .val-card";
  const times = hudCascade(tl, root, { items, whip: ctx.whip });
  for (const [item, t] of times) {
    const mark = item.matches(".val-card") ? item.querySelector(".val-pass, .val-fail, .val-info") : null;
    const a = stamp(mark);
    if (a) tl.add(a, t + 0.28);
  }
}

// #435: shared with the first screen (Hero), so one number reads the same on both.
export { fmtValue, maxError };

/** Rows of the site badge: checks that name this site. The thermal group compares our model with the
 * Diviner team's model, not with a NASA measurement or map, so it stays on this screen only (D-022). */
export function siteRows(v: ValidationFile, siteId: string): ValidationRow[] {
  return v.groups
    .filter((g) => g.id !== "thermal")
    .flatMap((g) => g.rows)
    .filter((r) => r.siteId === siteId && r.pass !== null);
}

/** Pass/fail counts of the checks that name this site; null when no check names it. */
export function siteChecks(v: ValidationFile, siteId: string): { pass: number; fail: number } | null {
  const rows = siteRows(v, siteId);
  if (!rows.length) return null;
  const pass = rows.filter((r) => r.pass).length;
  return { pass, fail: rows.length - pass };
}

export function fmtTolerance(r: ValidationRow): string {
  if (r.tolerance === null) return "—";
  return `± ${r.tolerance}${r.unit === "deg" ? "°" : r.unit === "%" ? " pp" : ` ${r.unit}`}`;
}

export function useValidation(): ValidationFile | null | undefined {
  const [v, setV] = useState<ValidationFile | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadValidation().then((x) => live && setV(x));
    return () => {
      live = false;
    };
  }, []);
  return v;
}

/** The three headline numbers, each from the rows of its own group; "—" when the group has no graded rows. */
export function headlineKpis(v: ValidationFile): { label: string; value: string; note: string }[] {
  const h = maxError(v, "ephemeris", ["deg"]);
  const p = maxError(v, "illumination", ["%", "pp"]);
  const e = maxError(v, "eclipse", ["s"]);
  return [
    { label: "Horizons, max error", value: h ? fmtValue(h.value, "deg") : "—", note: h ? `${h.n} graded checks, Sun and Earth` : "no rows" },
    { label: "PGDA 69, max error", value: p ? `${p.value.toFixed(1)} pp` : "—", note: p ? `worst of ${p.n} graded checks` : "no rows" },
    { label: "Eclipses, max error", value: e ? `${e.value.toFixed(1)} s` : "—", note: e ? `${e.n} contact times vs GSFC` : "no rows" },
  ];
}

/** Every failed check by name and site, in file order. */
export function failedChecks(v: ValidationFile): string[] {
  return v.groups.flatMap((g) => g.rows).filter((r) => r.pass === false).map((r) => `${r.check} (${r.site})`);
}

export type VerdictFilter = "all" | "pass" | "fail" | "info";

/** #337: a row matches when every word of the query is in its text and its verdict fits the filter. */
export function rowMatches(r: ValidationRow, groupTitle: string, query: string, verdict: VerdictFilter): boolean {
  const kind = r.pass === null ? "info" : r.pass ? "pass" : "fail";
  if (verdict !== "all" && verdict !== kind) return false;
  const text = [r.check, r.site, r.source, r.note, groupTitle].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));
}

function Verdict({ pass }: { pass: boolean | null }) {
  if (pass === null)
    return <span className="val-info" title="Information only: no tolerance, so no pass or fail">INFO</span>;
  return pass ? <span className="val-pass">PASS</span> : <span className="val-fail">FAIL</span>;
}

export function Validation() {
  const v = useValidation();
  const root = useRef<HTMLElement>(null);
  useIntro(root, !!v, validationIntro, { screen: "validation" });
  const [query, setQuery] = useState("");
  const [verdict, setVerdict] = useState<VerdictFilter>("all");
  if (v === undefined) return <p>Loading…</p>;
  if (v === null) return <p role="alert">Validation data failed to load. Reload the page.</p>;
  const s = v.summary;
  // #246: the fail count is a button: it brings the first failed card into view and focuses it.
  const toFirstFail = () => {
    // A filter may hide the failed card: clear it first.
    flushSync(() => {
      setQuery("");
      setVerdict("all");
    });
    const card = root.current?.querySelector<HTMLElement>('.val-card[data-verdict="fail"]');
    if (!card) return;
    card.scrollIntoView?.({ block: "center", behavior: motionOff() ? "auto" : "smooth" });
    card.focus({ preventScroll: true });
  };
  const failed = failedChecks(v);
  const groups = v.groups
    .map((g) => ({ ...g, rows: g.rows.filter((r) => rowMatches(r, g.title, query, verdict)) }))
    .filter((g) => g.rows.length);
  const total = v.groups.reduce((n, g) => n + g.rows.length, 0);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const filtered = query.trim() !== "" || verdict !== "all";
  return (
    <section className="validation hud-screen" aria-label="NASA check" ref={root}>
      <p className="hud-label">Generated {v.generatedUtc.slice(0, 16).replace("T", " ")} UTC</p>
      <div className="val-head">
        <p className="val-summary hud-verdict" role="status">
          {s.pass} of {s.checks} checks pass
        </p>
        {s.fail > 0 && (
          <button type="button" className="val-jump" onClick={toFirstFail} title="Go to the first failed check">
            {s.fail} fail
          </button>
        )}
      </div>
      <div className="val-kpis">
        {headlineKpis(v).map((k) => (
          <div className="val-kpi hud-frame" key={k.label}>
            <span className="hud-label">{k.label}</span>
            <strong>{k.value}</strong>
            <span className="val-kpi-note">{k.note}</span>
          </div>
        ))}
      </div>
      <p className="val-failed">
        {failed.length ? `Failed ${failed.length === 1 ? "check" : "checks"}: ${failed.join("; ")}.` : "No failed checks."}
      </p>
      <p className="val-howto">A check passes when our number matches the NASA reference within the stated tolerance.</p>
      <div className="val-filter" role="search">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a check: site, source, quantity…"
          aria-label="Find a check"
        />
        <div className="val-chips" role="group" aria-label="Verdict">
          {(["all", "pass", "fail", "info"] as const).map((k) => (
            <button type="button" key={k} aria-pressed={verdict === k} onClick={() => setVerdict(k)}>
              {k === "all" ? "All" : k.toUpperCase()}
            </button>
          ))}
        </div>
        {filtered && (
          <p className="val-shown" aria-live="polite">
            {shown} of {total} shown
          </p>
        )}
      </div>
      {filtered && shown === 0 && <p className="note">No check matches.</p>}
      {groups.map((g) => (
        <section className="val-group" key={g.id} aria-label={g.title}>
          <h3>{g.title}</h3>
          <details className="hud-notes val-about">
            <summary>Method</summary>
            <p className="note">{g.explanation}</p>
          </details>
          <div className="val-cards">
            {g.rows.map((r, i) => (
              <article
                className="val-card hud-frame"
                key={i}
                aria-label={`${r.site}: ${r.check}`}
                data-verdict={r.pass === null ? "info" : r.pass ? "pass" : "fail"}
                tabIndex={r.pass === false ? -1 : undefined}
              >
                <header>
                  <h4>{r.check}</h4>
                  <Verdict pass={r.pass} />
                </header>
                <p className="val-site">{r.site}</p>
                {r.check.startsWith("Trap check:") && r.pass !== null ? (
                  <p className="val-explanation">
                    trap {r.pass ? "caught" : "NOT caught"}: error {fmtValue(r.diff, r.unit)} {r.pass ? ">" : "≤"} tolerance {fmtTolerance(r).replace(/^± /, "")}
                  </p>
                ) : <dl>
                  <div className="val-big"><dt>Ours</dt><dd>{fmtValue(r.ours, r.unit)}</dd></div>
                  <div className="val-big"><dt>Reference</dt><dd>{fmtValue(r.reference, r.unit)}</dd></div>
                  <div><dt>Difference</dt><dd>{fmtValue(r.diff, r.unit)}</dd></div>
                  <div><dt>{g.id === "barker" ? "Corridor B–C" : "Tolerance"}</dt>
                    <dd>{g.id === "barker" ? "B ≤ ours ≤ C (see explanation)" : fmtTolerance(r)}</dd></div>
                </dl>}
                {r.note && <p className="val-explanation">{r.note}</p>}
                <a href={r.url} target="_blank" rel="noreferrer">{r.source}</a>
              </article>
            ))}
          </div>
        </section>
      ))}
      <LrocCheck />
      <EarthWindowExample />
      <EllipseExample />
      {BETA.hindcast && <Hindcast />}
      {BETA.commsMargin && <LcrnsCheck />}
      {BETA.uncertainty && <UncertaintyCheck />}
      <details className="hud-notes">
        <summary>Reproduce</summary>
        <p className="note">
          <code>{v.command}</code>
        </p>
      </details>
    </section>
  );
}
