// BETA horizon uncertainty (#258). Mounts: PlaceCard in navigator/Navigator.tsx and screens/Validation.tsx, behind BETA.uncertainty.
import { useEffect, useState } from "react";
import { DATA_PERIOD } from "../../format";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { fmtBand, loadUncertainty, type UncertaintyFile, widest } from "./uncertainty";

function useUncertainty(given?: UncertaintyFile | null) {
  const [loaded, setLoaded] = useState<UncertaintyFile | null>(null);
  useEffect(() => {
    if (given !== undefined) return;
    let live = true;
    loadUncertainty().then((f) => live && setLoaded(f));
    return () => {
      live = false;
    };
  }, [given]);
  return given !== undefined ? given : loaded;
}

const tip = (f: UncertaintyFile) =>
  `Range = shares with the terrain 1σ higher and 1σ lower. Assumption: ${f.sigma}. ` +
  "The horizon-setting point stays the same; the site's own height error is not included. Hourly steps.";

/** Place card: Sun-lit and Earth-in-view shares of the data window with the LOLA height error range. */
export function UncertaintyLine({ siteId, file }: { siteId: string; file?: UncertaintyFile | null }) {
  const f = useUncertainty(file);
  const r = f?.sites.find((s) => s.siteId === siteId);
  if (!f || !r) return null;
  return (
    <p className="beta-row" aria-label="DEM error range" title={tip(f)}>
      <BetaTag />
      {`Terrain ±1σ (LOLA error ${r.sigmaMedianM} m), ${DATA_PERIOD}: Sun ${fmtBand(r.sun)}, Earth ${fmtBand(r.earth)}`}
    </p>
  );
}

/** NASA check: one line, the widest range over all sites. */
export function UncertaintyCheck({ file }: { file?: UncertaintyFile | null }) {
  const f = useUncertainty(file);
  const sun = f && widest(f, "sun");
  const earth = f && widest(f, "earth");
  if (!f || !sun || !earth) return null;
  return (
    <p className="beta-row" aria-label="DEM error range check" title={tip(f)}>
      <BetaTag />
      {`LOLA height error ±1σ, ${f.sites.length} sites: Sun share moves at most ±${sun.pp.toFixed(1)} pp (${sun.name}), Earth ±${earth.pp.toFixed(1)} pp. ` +
        "The tolerance against PGDA 69 is ±5 pp, so DEM height error does not explain a larger miss."}
    </p>
  );
}
