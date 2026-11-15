import { useMemo } from "react";
import type { Timeline } from "../../contracts";
import { stepIndex } from "../../summary";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { CHECKED_NOTE, kelvinToC, regolithTemps } from "./thermal";

const NOTE =
  "Flat horizontal regolith, 1D heat conduction (thermal inertia 55, albedo 0.12). No reflected or thermal light from nearby slopes. " +
  "This is not the lander temperature. " + CHECKED_NOTE;

/** BETA: regolith surface temperature now, with min and max over the shown period.
 * The model runs on the whole data window (`fullTl`) when it fits, so the period does not start cold. Nothing on mock data. */
export function ThermalLine({ tl, fullTl, i, period }: { tl: Timeline; fullTl: Timeline | null; i: number; period: string }) {
  const full = !!fullTl && !fullTl.stub && fullTl.stepMin === tl.stepMin;
  const src = full ? fullTl : tl;
  const off = full ? stepIndex(fullTl, tl.startUtc) : 0;
  const T = useMemo(() => (tl.stub ? [] : regolithTemps(src)), [src, tl.stub]);
  const fits = off >= 0 && off + tl.sunEl.length <= T.length;
  const win = fits ? T.slice(off, off + tl.sunEl.length) : full ? regolithTemps(tl) : [];
  const now = win[i];
  if (tl.stub || !Number.isFinite(now)) return null;
  const k = (v: number) => `${Math.round(v)} K`;
  return (
    <p className="beta-row" aria-label="Regolith surface temperature" title={NOTE}>
      <BetaTag />
      {`Regolith surface: now ${k(now)} (${Math.round(kelvinToC(now))} °C), min ${k(Math.min(...win))}, max ${k(Math.max(...win))} over ${period}`}
      <span className="hud-foot"> Flat regolith, not the lander temperature; no light from nearby slopes.</span>
    </p>
  );
}
