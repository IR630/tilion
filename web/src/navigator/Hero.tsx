// The welcome screen (#72, #155, #158): shown once, on the first visit, over the globe with the
// navigator chrome hidden. It names the product, says what it computes, gives live numbers for one
// site and three ways in. After "Open navigator" it does not come back on its own; the logo in the
// rail reopens it. Every element is a readout or a control (#155): no decoration.
import { useEffect, useMemo, useRef, useState } from "react";
import { loadFullTimeline, loadValidation } from "../api";
import type { Site, Timeline, ValidationFile } from "../contracts";
import { CLEARANCE_TIP, fmtAbove, fmtElevation, fmtUntil, keepUnits } from "../format";
import { momentLine } from "../timeline/now";
import { useMask } from "../useMask";
import { fmtValue, maxError } from "../screens/validationFmt";
import { Wordmark } from "../ui/Wordmark";
import { liveState } from "./geo";
import "./hero.css";

/** localStorage key: "1" after the visitor entered the navigator once. */
export const ENTERED = "tilion-entered";

/** Show the welcome screen on load? Not for a shared link (?site, ?t) or ?hero=0; always for ?hero=1;
 *  else only until the visitor entered once. Blocked storage: show it (the visit still works). */
export function initialHero(search = window.location.search): boolean {
  const q = new URLSearchParams(search);
  if (q.get("hero") === "1") return true;
  if (q.get("hero") === "0" || q.has("site") || q.has("t")) return false;
  try {
    return localStorage.getItem(ENTERED) !== "1";
  } catch {
    return true;
  }
}

/** Remember that the visitor entered the navigator. Blocked storage: nothing to do. */
export function rememberEntered() {
  try {
    localStorage.setItem(ENTERED, "1");
  } catch {
    /* Storage can be disabled; the welcome screen then shows on the next visit too. */
  }
}

function useTimeline(site: Site | undefined): Timeline | null | undefined {
  const [tl, setTl] = useState<{ id: string; tl: Timeline | null } | null>(null);
  useEffect(() => {
    if (!site) return;
    let live = true;
    loadFullTimeline(site).then(
      (t) => live && setTl({ id: site.id, tl: t }),
      () => live && setTl({ id: site.id, tl: null }),
    );
    return () => {
      live = false;
    };
  }, [site]);
  return site && tl?.id === site.id ? tl.tl : undefined;
}

/** #271: three numbers from data/validation.json that say why terrain matters and how close we are to NASA. */
export function heroProofs(f: ValidationFile): { v: string; t: string }[] {
  const rows = (id: string) => f.groups.find((g) => g.id === id)?.rows ?? [];
  const out: { v: string; t: string }[] = [];
  const sph = rows("sphere").map((r) => r.ours).filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (sph.length) {
    const m = sph.length % 2 ? sph[(sph.length - 1) / 2] : (sph[sph.length / 2 - 1] + sph[sph.length / 2]) / 2;
    out.push({ v: `${m.toFixed(1)} h`, t: `median sunset error of a smooth-sphere Moon, ${sph.length} polar sites` });
  }
  // #435: the same value and precision as "Horizons, max error" on NASA check (headlineKpis).
  const eph = maxError(f, "ephemeris", ["deg"]);
  if (eph) out.push({ v: fmtValue(eph.value, "deg"), t: "max Sun and Earth error vs JPL Horizons" });
  out.push({
    v: `${f.summary.pass} / ${f.summary.checks}`,
    t: `numeric checks pass vs Horizons, PGDA 69 and GSFC; ${f.summary.fail} misses and the LROC photo checks are on NASA check`,
  });
  return out;
}

function useValidation(): ValidationFile | null | undefined {
  const [f, setF] = useState<ValidationFile | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    loadValidation().then((v) => live && setF(v));
    return () => {
      live = false;
    };
  }, []);
  return f;
}

const deg = (d: number) => fmtElevation(d).slice(0, -1); // the secondary value: the ° follows inside <small>

type Props = {
  site: Site | undefined;
  atUtc: string;
  /** The welcome screen is fading out (it unmounts after the fade). */
  leaving: boolean;
  /** The base view under it is the map, not the globe: a solid backdrop. */
  solid: boolean;
  onEnter: () => void;
  onPlan: () => void;
  /** Start the 1-minute tour (#382). */
  onTour: () => void;
};

export function Hero({ site, atUtc, leaving, solid, onEnter, onPlan, onTour }: Props) {
  const tl = useTimeline(site);
  const mask = useMask(site);
  const st = useMemo(() => (tl ? liveState(tl, atUtc, mask) : null), [tl, atUtc, mask]);
  const wait = st ? fmtUntil(st.sunChangeH ?? st.leftH, st.sunChangeH === null) : "—";
  const [num, unit] = wait.split(/ (?=[hd]$)/);
  const vf = useValidation();
  const proofs = useMemo(() => (vf ? heroProofs(vf) : []), [vf]);
  // #440: a failed load is one visible line, not dashes and a missing proof block.
  const failed = [tl === null && site?.lat !== null && "timeline", vf === null && "validation"].filter(Boolean).join(" and ");
  const enter = useRef<HTMLButtonElement>(null);
  useEffect(() => enter.current?.focus({ preventScroll: true }), []);

  return (
    <section
      className={`hero${leaving ? " is-leaving" : ""}${solid ? " is-solid" : ""}`}
      aria-label="Welcome"
      onKeyDown={(e) => {
        if (e.key === "Escape") onEnter();
      }}
    >
      <header className="hero-head">
        <h1 className="hero-title display">
          <Wordmark />
        </h1>
        <p className="hero-sub" aria-label="Lunar south pole landing site navigator">
          <span aria-hidden="true">
            Lunar <em>south pole</em> landing site navigator
          </span>
        </p>
        <p className="hero-lead">
          Sun and Earth above the real terrain horizon of a landing site, hour by hour, Dec 2026 – Dec 2027. LOLA
          relief and SPICE DE440 ephemeris, checked against JPL Horizons and NASA PGDA illumination maps.
        </p>
        <div className="hero-cta">
          <button ref={enter} type="button" className="hero-enter" onClick={onEnter}>
            Open navigator
          </button>
          <button type="button" className="hero-plan hero-tour" onClick={onTour}>
            Learn: 1-minute tour
          </button>
          <button type="button" className="hero-plan" onClick={onPlan}>
            Plan a landing
          </button>
        </div>
        {failed && <p role="alert" className="hero-lead">Navigator {failed} data failed to load. Reload the page.</p>}
        {proofs.length > 0 && (
          <dl className="hero-proof" aria-label="Checked against NASA">
            {proofs.map((p) => (
              <div key={p.t}>
                <dd>{p.v}</dd>
                <dt>{p.t}</dt>
              </div>
            ))}
          </dl>
        )}
      </header>
      <div className="hero-foot">
        <dl className="hero-stats" aria-label="At a glance">
          <div>
            <dt title={CLEARANCE_TIP}>
              {st?.sunClearDeg != null ? "Sun above terrain" : "Sun above level"}
            </dt>
            <dd>
              {st ? fmtElevation(st.sunClearDeg ?? st.sunElDeg) : "—"}
              {st?.sunClearDeg != null && <small>{fmtAbove(st.sunElDeg, "level")}</small>}
            </dd>
          </div>
          <div>
            <dt>{st && !st.sunUp ? "Next sunrise" : "Next sunset"}</dt>
            <dd>
              {num}
              {unit && <small>{unit}</small>}
            </dd>
          </div>
          <div>
            <dt>Earth visible</dt>
            <dd>
              {st ? (st.earthUp ? "Yes" : "No") : "—"}
              {st && <small>{st.earthClearDeg != null ? fmtAbove(st.earthClearDeg, "terrain") : `${deg(st.earthElDeg)}° above level`}</small>}
            </dd>
          </div>
        </dl>
        <p className="hero-at">
          <span className="hero-at-site">{site ? keepUnits(site.name) : "—"}</span>
          <span>{momentLine(atUtc)} The time dock in the navigator changes it.</span>
        </p>
      </div>
    </section>
  );
}
