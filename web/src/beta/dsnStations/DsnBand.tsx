// BETA dsnStations (#259): a thin three-lane band under the time strip. One lane per DSN complex
// (Goldstone, Madrid, Canberra); a lane is filled in the hours that complex sees the Moon above 10°.
// Bright where the Earth is in view at the site, faint elsewhere. The band follows the strip through
// the "hudview" event that HudStrip sends on every paint ({centre, spanMs, w}).
import { useEffect, useRef, useState } from "react";
import { hoursLoader, EARTH, type Hours } from "../../route/hours";
import { BetaTag } from "../BetaTag";
import "../beta.css";
import { complexesAt, LANE_VARS, loadDsn, TITLE, type Dsn } from "./dsn";
import "./dsn.css";

export const LANE_H = 3;
const GAP = 1;
const BAND_H = 3 * LANE_H + 2 * GAP;
const FAINT = 0.28;

type View = { centre: number; spanMs: number; w: number };

export function DsnBand({ siteId }: { siteId: string | null }) {
  const [dsn, setDsn] = useState<Dsn | null>(null);
  const [hours, setHours] = useState<Hours | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View | null>(null);
  const data = useRef({ dsn, hours, siteId });
  data.current = { dsn, hours, siteId };

  useEffect(() => {
    let live = true;
    loadDsn().then((d) => live && setDsn(d));
    hoursLoader().then(
      (h) => live && setHours(h),
      () => live && setHours(null),
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const hud = rootRef.current?.closest(".hud");
    if (!hud) return;
    const onView = (e: Event) => {
      view.current = (e as CustomEvent<View>).detail;
      paint();
    };
    hud.addEventListener("hudview", onView);
    return () => hud.removeEventListener("hudview", onView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => paint(), [dsn, hours, siteId]);

  function paint() {
    const c = canvasRef.current;
    const v = view.current;
    const { dsn: d, hours: h, siteId: id } = data.current;
    const ctx = c?.getContext?.("2d");
    if (!c || !ctx || !v || !d || !v.w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(v.w * dpr)) {
      c.width = Math.round(v.w * dpr);
      c.height = Math.round(BAND_H * dpr);
      c.style.width = `${v.w}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, v.w, BAND_H);
    const ms = v.spanMs / v.w;
    const X = (t: number) => v.w / 2 + (t - v.centre) / ms;
    const i0 = Math.max(0, Math.floor((v.centre - v.spanMs / 2 - d.startMs) / d.stepMs));
    const i1 = Math.min(d.n, Math.ceil((v.centre + v.spanMs / 2 - d.startMs) / d.stepMs) + 1);
    const site = id && h ? h.sites.get(id) : undefined;
    // Site hours share the start and step of the DSN file (same precompute grid); else no dimming.
    const aligned = !!h && h.startMs === d.startMs && h.stepMin * 60_000 === d.stepMs;
    const cs = getComputedStyle(c);
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = cs.getPropertyValue(LANE_VARS[k]).trim() || "grey";
      const y = k * (LANE_H + GAP);
      // Runs of equal (in view, Earth up) state, drawn as one rect each.
      let runStart = -1;
      let runAlpha = 0;
      for (let i = i0; i <= i1; i++) {
        const on = i < i1 && ((d.codes[i] >> k) & 1) === 1;
        const earth = !site || !aligned || (i < i1 && (site.codes[i] & EARTH) !== 0);
        const alpha = on ? (earth ? 1 : FAINT) : 0;
        if (alpha !== runAlpha) {
          if (runAlpha) {
            ctx.globalAlpha = runAlpha;
            ctx.fillRect(X(d.startMs + runStart * d.stepMs), y, (i - runStart) * d.stepMs / ms, LANE_H);
          }
          runStart = i;
          runAlpha = alpha;
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const v = view.current;
    if (!v || !dsn) return;
    const t = v.centre + (e.nativeEvent.offsetX - v.w / 2) * (v.spanMs / v.w);
    const now = complexesAt(dsn, t);
    const d = new Date(t);
    const when = `${d.toISOString().slice(0, 13).replace("T", " ")}:00 UTC`;
    e.currentTarget.title = `${when}: ${now.length ? now.map((c) => c.name).join(", ") : "no complex"} sees the Moon above 10°`;
  };

  if (!dsn) return <div ref={rootRef} hidden />;
  return (
    <div ref={rootRef} className="hud-dsn" aria-label="DSN complexes in view" title={TITLE}>
      <div className="hud-dsn-legend">
        <BetaTag />
        <span className="hud-dsn-k">DSN</span>
        {dsn.complexes.map((c, k) => (
          <span key={c.id} className="hud-dsn-c" style={{ color: `var(${LANE_VARS[k]})` }} title={`${c.name}: ${c.dss}, 34 m K-band ${c.dss34}`}>
            {c.id}
          </span>
        ))}
      </div>
      <div className="hud-dsn-track">
        <canvas ref={canvasRef} height={BAND_H} onPointerMove={onMove} />
      </div>
    </div>
  );
}
