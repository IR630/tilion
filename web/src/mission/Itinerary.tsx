// Mission itinerary (#72): the turn-by-turn list of a landing window. A click on a step moves the
// shared moment there; the step the moment is in is marked.
import { CLEARANCE_TIP, fmtAbove } from "../format";
import { useEffect, useMemo, useState } from "react";
import { loadFullTimeline, loadMaskOnce } from "../api";
import type { Site } from "../contracts";
import { liveState, type LiveState } from "../navigator/geo";
import type { Hours } from "../route/hours";
import { Icon, type IconName } from "../ui/icons";
import { activeStep, fmtOffset, itinerary, STEP_LABEL, type StepKind } from "./itineraryEvents";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtStep = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;
};
/** #206 the angle above terrain when the mask is there, else above level. */
const fmtEl = (clear: number | null, el: number) => (clear === null ? fmtAbove(el, "level") : fmtAbove(clear, "terrain"));
const ICON: Record<StepKind, IconName> = {
  landing: "landing",
  sunrise: "sunrise",
  sunset: "sunset",
  earthrise: "earth",
  earthset: "earth",
  end: "flag",
};
const TONE: Record<StepKind, string> = {
  landing: "accent",
  sunrise: "sun",
  sunset: "sun off",
  earthrise: "earth",
  earthset: "earth off",
  end: "muted",
};

/** Sun and Earth elevation at landing from the site timeline (cached per site); null = no file. */
function useLanding(site: Site, utc: string): LiveState | null {
  const [st, setSt] = useState<LiveState | null>(null);
  useEffect(() => {
    let live = true;
    setSt(null);
    Promise.all([loadFullTimeline(site), site.terrain === "none" ? null : loadMaskOnce(site)]).then(
      ([tl, mask]) => live && setSt(tl ? liveState(tl, utc, mask) : null),
      () => live && setSt(null),
    );
    return () => {
      live = false;
    };
  }, [site, utc]);
  return st;
}

export function Itinerary(p: {
  hours: Hours;
  site: Site;
  what: string;
  landingUtc: string;
  days: number;
  atUtc: string;
  onAtUtc: (utc: string) => void;
  onOpenHorizon: (id: string) => void;
  onOpenView: (id: string) => void;
}) {
  const it = useMemo(() => itinerary(p.hours, p.site.id, p.landingUtc, p.days), [p.hours, p.site.id, p.landingUtc, p.days]);
  const landing = useLanding(p.site, p.landingUtc);
  if (!it) return null;
  const active = activeStep(it.steps, p.atUtc);
  const hasTerrain = p.site.terrain !== "none";

  return (
    <section className="itin" aria-label="Itinerary">
      <header className="itin-head">
        <div>
          <p className="rp-eyebrow">Itinerary: {p.what}</p>
          <h3>{p.site.name}</h3>
        </div>
        <div className="itin-views">
          <button type="button" className="icon-btn" title="Horizon view" aria-label="Horizon view" onClick={() => p.onOpenHorizon(p.site.id)}>
            <Icon name="mountain" size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={hasTerrain ? "View from site (3D)" : "No terrain model at this site"}
            aria-label="View from site"
            disabled={!hasTerrain}
            onClick={() => p.onOpenView(p.site.id)}
          >
            <Icon name="cube" size={16} />
          </button>
        </div>
      </header>
      <ol className="itin-list">
        {it.steps.map((s, k) => {
          const isLanding = s.kind === "landing";
          return (
            <li key={`${s.kind}@${s.utc}`} className={`itin-step t-${TONE[s.kind].replace(" ", " t-")}${k === active ? " is-active" : ""}`}>
              <button type="button" onClick={() => p.onAtUtc(s.utc)} aria-current={k === active ? "step" : undefined}>
                <span className="itin-icon" aria-hidden="true">
                  <Icon name={ICON[s.kind]} size={15} />
                </span>
                <span className="itin-body">
                  <span className="itin-title">
                    {STEP_LABEL[s.kind]}
                    {s.kind === "end" && it.clipped && <span className="itin-note"> (data end)</span>}
                  </span>
                  <span className="itin-sub" title={isLanding ? CLEARANCE_TIP : undefined}>
                    {fmtStep(s.utc)}
                    {isLanding && (
                      <>
                        {", "}
                        {it.sunUp ? "Sun up" : "Sun down"}
                        {landing && ` ${fmtEl(landing.sunClearDeg, landing.sunElDeg)}`}
                        {!it.sunUp && landing && landing.sunClearDeg === null && landing.sunElDeg > 0 && " (behind terrain)"}
                        {", "}
                        {it.earthUp ? "Earth in view" : "Earth hidden"}
                        {landing && ` ${fmtEl(landing.earthClearDeg, landing.earthElDeg)}`}
                      </>
                    )}
                  </span>
                </span>
                {!isLanding && <span className="itin-off">{fmtOffset(s.offsetH)}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {it.steps.length === 2 && (
        <p className="rp-muted">
          No Sun or Earth change in the window: {it.sunUp ? "light" : "darkness"} and {it.earthUp ? "a direct link" : "no direct link"} all
          the way.
        </p>
      )}
      {it.hidden > 0 && <p className="rp-muted">{it.hidden} more Sun and Earth events in the window are not listed.</p>}
    </section>
  );
}
