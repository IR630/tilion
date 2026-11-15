import { useEffect, useRef, useState } from "react";
import type { Site } from "../contracts";
import { inCustomDem } from "../custom/horizon";
import { MOON_R, fmtLatLon, stereoInv, stereoXY } from "../format";

type Range = 80 | 60;
type View = { cx: number; cy: number; w: number }; // centre and width, metres
const SIZE = 560; // nominal on-screen px
const extent = (r: Range) => 2 * 2 * MOON_R * Math.tan(((90 - r) * Math.PI) / 360) * 1.06;
const LEGEND: [Site["group"], string, string][] = [
  ["ridge", "Ridges", "var(--g-ridge)"],
  ["artemis", "Artemis", "var(--g-artemis)"],
  ["clps", "CLPS", "var(--g-clps)"],
  ["international", "Other", "var(--g-international)"],
  ["historic", "Historic", "var(--g-historic)"],
];

/** A point picked on the map. Its horizon and timeline are computed in the browser (custom/, #31). */
export function customSite(lat: number, lonE: number): Site {
  const dem = inCustomDem(lat, lonE);
  return {
    id: `custom-${lat.toFixed(4)}-${lonE.toFixed(4)}`,
    name: "Custom point",
    group: "international",
    status: "user-defined",
    kind: "point",
    lat,
    lonE,
    elevM: null,
    source: "map click",
    confidence: "unknown",
    terrain: dem ? "polar240" : "none",
    note: dem
      ? "Computed in your browser: horizon from the LOLA DEM 240 m (60–90°S, tiles within 300 km of the point; terrain beyond the DEM edge is not seen), Sun and Earth from SPICE DE440."
      : "Outside the in-browser LOLA DEM 240 m (60–90°S): bare sphere, no terrain. Sun and Earth from SPICE DE440.",
  };
}

export function PolarMap({
  sites,
  picked,
  onPick,
  onAddCustom,
}: {
  sites: Site[];
  picked: string[];
  onPick: (id: string) => void;
  onAddCustom: (s: Site) => void;
}) {
  const [range, setRange] = useState<Range>(80);
  const [view, setView] = useState<View>({ cx: 0, cy: 0, w: extent(80) });
  const [hover, setHover] = useState<string | null>(null);
  const [cp, setCp] = useState<[number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);
  const u = view.w / SIZE; // metres per px
  const maxW = extent(60);

  const setRangeAndReset = (r: Range) => {
    setRange(r);
    setView({ cx: 0, cy: 0, w: extent(r) });
  };

  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const b = svgRef.current!.getBoundingClientRect();
    return [view.cx + ((clientX - b.left) / b.width - 0.5) * view.w, view.cy - ((clientY - b.top) / b.height - 0.5) * view.w];
  };

  const viewRef = useRef(view);
  viewRef.current = view;
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const w = Math.min(maxW, Math.max(2000, v.w * Math.exp(e.deltaY * 0.0015)));
      const b = el.getBoundingClientRect();
      const fx = (e.clientX - b.left) / b.width - 0.5;
      const fy = (e.clientY - b.top) / b.height - 0.5;
      setView({ cx: v.cx + fx * (v.w - w), cy: v.cy - fy * (v.w - w), w });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [maxW]);

  const onClick = (e: React.MouseEvent) => {
    if (drag.current && drag.current.moved > 4) return;
    const id = (e.target as Element).closest("[data-site]")?.getAttribute("data-site");
    if (id) return onPick(id);
    const [x, y] = toWorld(e.clientX, e.clientY);
    const [lat, lonE] = stereoInv(x, y);
    if (lat > -60 || lat < -90) return;
    setCp([lat, lonE]);
  };

  const lats: number[] = [];
  for (let l = -89; l >= -(range === 80 ? 80 : 60); l--) lats.push(l);
  const rOf = (lat: number) => Math.hypot(...stereoXY(lat, 0));
  const rEdge = rOf(-range);
  const labelStep = range === 80 ? 2 : 5;
  const pts = sites.filter((s) => s.lat !== null && s.lonE !== null && s.lat <= -range);
  const hov = pts.find((s) => s.id === hover);

  return (
    <section className="polarmap" aria-label="Polar map">
      <div className="toolbar">
        <span>Range:</span>
        <button aria-pressed={range === 80} onClick={() => setRangeAndReset(80)}>
          80–90°S
        </button>
        <button aria-pressed={range === 60} onClick={() => setRangeAndReset(60)}>
          60–90°S
        </button>
        <button onClick={() => setView({ cx: 0, cy: 0, w: extent(range) })}>Reset view</button>
        <span className="legend">
          {LEGEND.map(([g, n, c]) => (
            <span key={g}>
              <i style={{ background: c }} />
              {n}
            </span>
          ))}
        </span>
      </div>
      <svg
        ref={svgRef}
        viewBox={`${view.cx - view.w / 2} ${-view.cy - view.w / 2} ${view.w} ${view.w}`}
        width={SIZE}
        role="img"
        aria-label={`South polar map ${range}–90°S`}
        onClick={onClick}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !(e.buttons & 1)) return;
          const b = svgRef.current!.getBoundingClientRect();
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          d.moved += Math.abs(dx) + Math.abs(dy);
          d.x = e.clientX;
          d.y = e.clientY;
          if (d.moved > 4) setView((v) => ({ ...v, cx: v.cx - (dx / b.width) * v.w, cy: v.cy + (dy / b.height) * v.w }));
        }}
      >
        <circle r={rEdge} style={{ fill: "var(--panel)" }} />
        {lats.map((l) => (
          <circle key={l} r={rOf(l)} className={l % 5 === 0 ? "grid major" : "grid"} />
        ))}
        {Array.from({ length: 12 }, (_, i) => i * 30).map((lon) => {
          const [x, y] = stereoXY(-range, lon);
          const [lx, ly] = stereoXY(-range - 0.0, lon);
          const [tx, ty] = [lx * 1.04, ly * 1.04];
          return (
            <g key={lon}>
              <line x1={0} y1={0} x2={x} y2={-y} className="meridian" />
              <text x={tx} y={-ty} style={{ fontSize: 11 * u }} textAnchor="middle" dominantBaseline="middle">
                {lon}°E
              </text>
            </g>
          );
        })}
        {lats
          .filter((l) => -l % labelStep === 0)
          .map((l) => (
            <text key={l} x={rOf(l) * Math.SQRT1_2 + 2 * u} y={-rOf(l) * Math.SQRT1_2} style={{ fontSize: 10 * u }}>
              {-l}°S
            </text>
          ))}
        {pts.map((s) => {
          const [x, y] = stereoXY(s.lat!, s.lonE!);
          const on = picked.includes(s.id);
          return (
            <circle
              key={s.id}
              data-site={s.id}
              aria-label={s.name}
              cx={x}
              cy={-y}
              r={(on ? 6 : 4) * u}
              className={`site ${s.id.startsWith("custom-") ? "custom" : s.group}${on ? " picked" : ""}`}
              onPointerEnter={() => setHover(s.id)}
              onPointerLeave={() => setHover(null)}
            />
          );
        })}
        {hov && (() => {
          const [x, y] = stereoXY(hov.lat!, hov.lonE!);
          return (
            <text className="label" x={x + 9 * u} y={-y - 7 * u} style={{ fontSize: 12 * u }}>
              {hov.name}
            </text>
          );
        })()}
        {cp && (() => {
          const [x, y] = stereoXY(cp[0], cp[1]);
          return <circle data-testid="custom-marker" cx={x} cy={-y} r={6 * u} className="custom" pointerEvents="none" />;
        })()}
      </svg>
      <p>
        South polar stereographic, {range}–90°S. Wheel to zoom, drag to pan, click empty map to pick a point.
      </p>
      {cp && (
        <p role="status" data-testid="custom-readout">
          Custom point: {fmtLatLon(cp[0], cp[1])}{" "}
          <button onClick={() => onAddCustom(customSite(cp[0], cp[1]))}>Add to comparison</button>
        </p>
      )}
    </section>
  );
}
