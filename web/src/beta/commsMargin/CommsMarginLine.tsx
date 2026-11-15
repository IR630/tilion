// BETA (#256): Earth above 5° on the site panel (Horizon screen).
// Removable: delete this folder, BETA.commsMargin in ../flags.ts and the mount lines in
// screens/Horizon.tsx and screens/Validation.tsx.
import { useEffect, useState } from "react";
import { loadFullTimeline } from "../../api";
import type { Site, Timeline } from "../../contracts";
import { DATA_PERIOD } from "../../format";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import "./commsMargin.css";
import { commsMargin, MARGIN_DEG, MULTIPATH_SRC, pct1 } from "./margin";

/** Site panel rows: usual Earth share, the share above 5°, and the low-margin share, over the data window. */
export function CommsMarginLine({ site, tl }: { site: Site; tl?: Timeline | null }) {
  const [loaded, setLoaded] = useState<Timeline | null>(null);
  useEffect(() => {
    if (tl !== undefined) return;
    let live = true;
    setLoaded(null);
    loadFullTimeline(site).then((t) => live && setLoaded(t), () => live && setLoaded(null));
    return () => {
      live = false;
    };
  }, [site, tl]);
  const full = tl !== undefined ? tl : loaded;
  const m = full ? commsMargin(full) : null;
  if (!m || m.inView === 0) return null;
  return (
    <div aria-label="Earth link margin">
      <p className="beta-row" title="Share of hours, Earth centre geometry">
        <BetaTag />
        {`Earth in view, ${DATA_PERIOD}: ${pct1(m.inView)} of hours. Above ${MARGIN_DEG}°: ${pct1(m.high)}. ` +
          `Low margin (in view, ${MARGIN_DEG}° or lower): ${pct1(m.low)}.`}
      </p>
      <p className="beta-row beta-note">
        {`${MARGIN_DEG}° is our assumption for multipath near the horizon (`}
        <a href={MULTIPATH_SRC.url} target="_blank" rel="noreferrer">
          {MULTIPATH_SRC.label}
        </a>
        {" names the risk, not the angle)."}
      </p>
    </div>
  );
}
