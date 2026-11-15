import { useEffect, useState } from "react";
import { loadVariants } from "../../api";
import type { Site, Timeline, VisibilityVariants } from "../../contracts";
import { DATA_PERIOD } from "../../format";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { mastEarth, mastShares, pct } from "./mast";

/** BETA: Sun share of the shown period with a 10 m mast against 2 m, and Earth share of the data window at 0, 2 and 10 m.
 * Renders nothing without 10 m data. */
export function MastLine({ site, tl, variants }: { site: Site; tl: Timeline; variants?: VisibilityVariants | null }) {
  const [loaded, setLoaded] = useState<VisibilityVariants | null>(null);
  useEffect(() => {
    if (variants !== undefined) return;
    let live = true;
    setLoaded(null);
    loadVariants(site).then((v) => live && setLoaded(v), () => live && setLoaded(null));
    return () => {
      live = false;
    };
  }, [site, variants]);
  const v = variants !== undefined ? variants : loaded;
  const m = mastShares(v, tl);
  const e = mastEarth(v);
  if (!m && !e) return null;
  return (
    <>
      {m && (
        <p className="beta-row" aria-label="Mast sun share">
          <BetaTag />
          {`Sun with 10 m mast: ${pct(m.m10)} (2 m: ${pct(m.m2)})`}
        </p>
      )}
      {e && (
        <p className="beta-row" aria-label="Mast Earth share" title="Earth centre above the terrain horizon, % of hours">
          <BetaTag />
          {`Earth in view, ${DATA_PERIOD}: 0 m ${pct(e.m0)} → 2 m ${pct(e.m2)} → 10 m ${pct(e.m10)} (+${((e.m10 - e.m2) * 100).toFixed(1)} pp)`}
        </p>
      )}
    </>
  );
}
