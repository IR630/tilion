// BETA date-slip report (#335). Mount: screens/Compare.tsx under the "Date slip delta" table, behind BETA.slipReport.
// The sentences and the copied text come from screens/slipReport.ts (pure, tested).
import { useEffect, useMemo, useState } from "react";
import { loadFullTimeline } from "../../api";
import type { Site, Timeline } from "../../contracts";
import { type Conditions, scanWindows, verdictAt } from "../../landing";
import { MARK_SYMBOL, reportText, SAME_NOTE, siteReport } from "../../screens/slipReport";
import { sphereTimeline, type SummaryRow } from "../../summary";
import { BetaTag } from "../BetaTag";
import "../beta.css";

type Props = {
  sites: Site[];
  base: SummaryRow[];
  now: SummaryRow[];
  atUtc: string;
  slippedUtc: string;
  slip: number;
  sphere: boolean;
  limits: Conditions;
};

/** Whole timelines of the sites, for the Windows check (the same scan as the Windows panel and PlanVerdict). */
function useFull(sites: Site[]): (Timeline | null)[] | null {
  const ids = sites.map((s) => s.id).join(",");
  const [st, setSt] = useState<{ ids: string; tls: (Timeline | null)[] } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all(sites.map((s) => loadFullTimeline(s).catch(() => null))).then((tls) => live && setSt({ ids, tls }));
    return () => {
      live = false;
    };
  }, [ids]); // eslint-disable-line react-hooks/exhaustive-deps
  return st && st.ids === ids ? st.tls : null;
}

export function SlipReport({ sites, base, now, atUtc, slippedUtc, slip, sphere, limits }: Props) {
  const full = useFull(sites);
  const scans = useMemo(
    () => full?.map((tl) => (tl && !tl.stub ? (sphere ? sphereTimeline(tl) : tl) : null)).map((tl) => (tl ? { tl, ws: scanWindows(tl, limits.days) } : null)),
    [full, sphere, limits.days],
  );
  const [copied, setCopied] = useState<{ text: string; msg: string } | null>(null);
  const reports = sites.map((s, i) => {
    const sc = scans?.[i];
    const verdicts = sc ? { before: verdictAt(sc.tl, sc.ws, limits, atUtc), after: verdictAt(sc.tl, sc.ws, limits, slippedUtc), limits } : undefined;
    return siteReport(s.name, s.lat, s.lonE, base[i], now[i], slip, verdicts);
  });
  const text = reportText(reports, atUtc, slippedUtc, slip, sphere);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied({ text, msg: "Copied" });
    } catch {
      setCopied({ text, msg: "Copy blocked by the browser" });
    }
  };
  return (
    <section className="slip-report" aria-label="What the slip changes">
      <h3>
        <BetaTag /> What the slip changes
        <button type="button" onClick={copy} title="Copy the report as text: dates, sites, these lines, the model and the threshold">
          Copy
        </button>
        {copied?.text === text && <span className="slip-report-note" role="status">{copied.msg}</span>}
      </h3>
      {reports.map((r) => (
        <div key={r.name} className="slip-report-site">
          <p className="slip-report-name">{r.name}</p>
          {r.mock ? (
            <p className="slip-report-note">Synthetic mock data at one of the dates: no report.</p>
          ) : (
            <ul>
              {r.lines.map((l) => (
                <li key={l.key} className={`is-${l.mark ?? "none"}`}>
                  <span className="slip-report-mark" aria-hidden="true">{l.mark ? MARK_SYMBOL[l.mark] : "?"}</span> {l.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="compare-hint">{SAME_NOTE} The overall line is the Windows check (hard limits), not a count of better lines.</p>
    </section>
  );
}
