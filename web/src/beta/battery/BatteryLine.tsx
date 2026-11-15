import { useMemo, useState } from "react";
import type { Timeline } from "../../contracts";
import type { EnergyInput } from "../../energy/energy";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { RESERVE, fmtWh, longestDark, smallestBattery, smallestPanel, survives } from "./battery";

const SIZE_TIP = "Bisection over the entire shown period, including its longest night, with the selected starting charge. Each size holds the other component and loads fixed. The reserve is a planning floor, not a model of ageing, cold or faults.";
const DARK_TIP = "Longest run of hours with no panel output (Sun hidden or behind the panel) in the period, and the load energy over it.";

/** BETA: smallest battery that survives the shown period with a reserve, and the longest spell without charge.
 * Renders nothing on mock data. */
export function BatteryLine({ tl, input, period }: { tl: Timeline; input: EnergyInput; period: string }) {
  const { panelW, batteryWh, dayLoadW, nightLoadW, panel, panelAzDeg, panelTiltDeg, startSoc } = input;
  const [reserveText, setReserveText] = useState(String(RESERVE * 100));
  const reserve = reserveText.trim() ? Number(reserveText) / 100 : NaN;
  const validReserve = Number.isFinite(reserve) && reserve >= 0 && reserve < 1;
  const [wh, watts, dark, meetsReserve] = useMemo(() => {
    const p: EnergyInput = { panelW, batteryWh, dayLoadW, nightLoadW, panel, panelAzDeg, panelTiltDeg, startSoc };
    return validReserve ? [smallestBattery(tl, p, reserve), smallestPanel(tl, p, reserve), longestDark(tl, p), survives(tl, p, reserve)] as const : [NaN, NaN, null, false] as const;
  }, [tl, panelW, batteryWh, dayLoadW, nightLoadW, panel, panelAzDeg, panelTiltDeg, startSoc, reserve, validReserve]);
  if (tl.stub) return null; // no numbers on mock data, as the energy verdict
  return (
    <>
      <label className="beta-row" title={SIZE_TIP}>
        Reserve floor, % <input type="number" min="0" max="100" step="any" value={reserveText} onChange={(e) => setReserveText(e.target.value)} />
      </label>
      {!validReserve ? <p>Reserve must be at least 0 and less than 100 %.</p> : <>
      <p className="beta-row">{meetsReserve ? "Charge stays at or above the reserve floor." : "Charge falls below the reserve floor or the load is not met."}</p>
      <p className="beta-row" aria-label="Smallest battery" title={SIZE_TIP}>
        <BetaTag />
        {!Number.isFinite(wh) ? "No battery size found up to 2^50 Wh with this starting charge and reserve." : wh > 0
          ? `Smallest battery that survives ${period}: ${fmtWh(wh)} with a ${Number(reserveText)} % reserve`
          : `No battery needed for ${period}: the panel covers the load at every hour`}
      </p>
      <p className="beta-row" aria-label="Smallest panel" title={SIZE_TIP}>
        <BetaTag />
        {Number.isFinite(watts) ? `Smallest panel that survives ${period} with the selected battery: ${Math.ceil(watts)} W` : "No panel size found up to 2^50 W with the selected battery. The reserve may be impossible to maintain."}
      </p>
      <p className="beta-row">Sizes cover the shown period, including its longest night within that period, using the selected starting charge. A night cut off by the period may continue beyond it. Each size keeps the other component fixed. Estimates only; temperature, ageing and system losses are not modelled.</p>
      </>}
      {dark && dark.hours > 0 && (
        <p className="beta-row" aria-label="Longest dark spell" title={DARK_TIP}>
          <BetaTag />
          {`Longest spell without charge: ${Math.round(dark.hours)} h, the load takes ${fmtWh(dark.wh)}`}
        </p>
      )}
    </>
  );
}
