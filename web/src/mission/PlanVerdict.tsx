// #210: the Windows verdict (OK / MARGINAL / FAIL and the rule) on the Mission plan card, next to the
// score. Same timeline, same scan and the same judge as the Windows panel (landing.ts): no second rule set.
import { useEffect, useMemo, useState } from "react";
import { loadFullTimeline } from "../api";
import type { Site, Timeline } from "../contracts";
import { type Conditions, type Verdict, scanWindows, verdictAt, verdictRule } from "../landing";
import { VIPER, energyVerdict, simulate, slicePeriod } from "../energy/energy";
import { Info } from "../ui/Info";

export const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));

/** #326: everything the verdict block says, as data: the plan card and the printed brief read this one object. */
export type PlanFacts = { verdict: Verdict | null; level: string; rule: string; note: string; battery: string | null; limits: Conditions };

/** The verdict facts of a landing; null on mock data (the Windows panel gives no verdict there either). */
export function planFacts(tl: Timeline, limits: Conditions, landingUtc: string, ws = scanWindows(tl, limits.days)): PlanFacts | null {
  if (tl.stub) return null;
  const v = verdictAt(tl, ws, limits, landingUtc);
  // #216: the battery over the mission, VIPER-class defaults (the site screen lets the user edit them).
  const part = slicePeriod(tl, landingUtc, limits.days);
  const battery = part ? energyVerdict(part, simulate(part, VIPER), VIPER.batteryWh, `the ${n(limits.days)} d mission`) : null;
  return {
    verdict: v,
    level: v ? v.level : "NO DATA",
    rule: v ? verdictRule(v, limits) : `A ${n(limits.days)} d mission from this landing does not fit the data`,
    note: `Windows check: ${n(limits.days)} d, night ≤ ${n(limits.maxNightH)} h, comm gap ≤ ${n(limits.maxGapH)} h.`,
    battery,
    limits,
  };
}

/** #424: the full timeline of a site; null while it loads, "failed" when it fails or has no file. */
export function useFullTimelineState(site: Site | undefined): Timeline | null | "failed" {
  const [tl, setTl] = useState<Timeline | null | "failed">(null);
  useEffect(() => {
    if (!site) return;
    let live = true;
    setTl(null);
    loadFullTimeline(site).then(
      (t) => live && setTl(t ?? "failed"),
      () => live && setTl("failed"),
    );
    return () => {
      live = false;
    };
  }, [site]);
  return tl;
}

/** The full timeline of a site; null while it loads or when it fails. */
export function useFullTimeline(site: Site | undefined): Timeline | null {
  const tl = useFullTimelineState(site);
  return tl === "failed" ? null : tl;
}

export function PlanVerdict({ site, landingUtc, limits }: { site: Site; landingUtc: string; limits: Conditions }) {
  const state = useFullTimelineState(site);
  const tl = state === "failed" ? null : state;
  const ws = useMemo(() => (tl ? scanWindows(tl, limits.days) : []), [tl, limits.days]);
  const f = tl ? planFacts(tl, limits, landingUtc, ws) : null;
  if (state === "failed")
    return (
      <p className="rp-verdict rp-verdict-note" role="alert">
        Windows verdict unavailable: timeline failed to load.
      </p>
    );
  if (!f) return null;
  const { verdict: v, battery } = f;
  return (
    <div className="rp-verdict" aria-label="Windows verdict">
      <p className="rp-verdict-line">
        <b className={`rp-verdict-tag is-${v ? v.level.toLowerCase() : "none"}`}>{f.level}</b> <span>{f.rule}</span>
        <Info label="What the verdict checks">
          {f.note} The score ranks options; the verdict checks hard limits. Mission limits are editable planning assumptions, not NASA mission
          requirements.
        </Info>
      </p>
      {battery && (
        <p className="rp-verdict-note" title="Panel 320 W tracking the Sun, battery 5,420 Wh, loads 174/108 W: VIPER, NASA NTRS 20240013903 and 20220013310. Edit them on the site screen.">
          Energy (VIPER-class): {battery}
        </p>
      )}
    </div>
  );
}
