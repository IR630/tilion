// BETA dsnStations (#259): "via Madrid, Canberra" under an Earth-in-view window of Next windows.
// compact (Horizon view, Windows panel): the complex letters in the lane colours on the same line,
// so the panel keeps its height (the Horizon chart must fit 1440×900, #210); the full text and the
// BETA mark are in the tooltip, the letters match the BETA band legend under the time strip.
import { useEffect, useState } from "react";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { LANE_VARS, loadDsn, TITLE, viaComplexes, viaText, type Dsn } from "./dsn";
import "./dsn.css";

export function DsnVia({ startMs, endMs, compact = false, dsn: given }: { startMs: number; endMs: number; compact?: boolean; dsn?: Dsn | null }) {
  const [loaded, setLoaded] = useState<Dsn | null>(null);
  useEffect(() => {
    if (given !== undefined) return;
    let live = true;
    loadDsn().then((d) => live && setLoaded(d));
    return () => {
      live = false;
    };
  }, [given]);
  const d = given !== undefined ? given : loaded;
  const v = d && viaComplexes(d, startMs, endMs);
  if (!v) return null;
  if (compact)
    return (
      <span className="dsn-via-inline" title={`BETA: ${viaText(v)}. ${TITLE}`} aria-label={viaText(v)}>
        {v.order.map((c) => (
          <b key={c.id} style={{ color: `var(${LANE_VARS[d!.complexes.indexOf(c)]})` }}>
            {c.id}
          </b>
        ))}
      </span>
    );
  return (
    <small className="nwin-cont dsn-via" title={TITLE}>
      <BetaTag />
      {viaText(v)}
    </small>
  );
}
