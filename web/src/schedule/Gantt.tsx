// Mission schedule (#73): the Gantt timeline. Lean SVG: one rect per colour run, memoised rows,
// the "now" line in its own layer so scrubbing re-renders only that layer.
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPE } from "react";
import type { Site } from "../contracts";
import { metricsAt, dayStrip } from "../route/route";
import type { Hours } from "../route/hours";
import type { ScheduledMission } from "./store";
import {
  addDays,
  DAY_MS,
  fmtDay,
  fmtUtc,
  KIND_COLOR,
  monthTicks,
  overlaps,
  pxPerDay,
  RANGE_END_MS,
  RANGE_START_MS,
  slipDays,
  slipLabel,
  snapSlip,
  stripRuns,
  totalWidth,
  utcAtX,
  weekTicks,
  xOf,
  type PublicMission,
  type Run,
  type Zoom,
} from "./layout";

const HEAD_H = 46;
const GROUP_H = 26;
const ROW_H = 44;
// #405: public and history rows wrap their name and note to two lines instead of cutting a word.
const PUB_H = 64;
const BAR_H = 14;

export type GanttProps = {
  missions: ScheduledMission[];
  activeId: string | null;
  sites: Map<string, Site>;
  hours: Hours | null;
  atUtc: string;
  onAtUtc: (utc: string) => void;
  zoom: Zoom;
  publicList: PublicMission[];
  historyNote: string | null;
  onActivate: (m: ScheduledMission) => void;
  onSlip: (m: ScheduledMission, landingUtc: string) => void;
};

// Day strips per (hours file, site, landing, duration): computed once, reused on every scrub frame.
const stripCache = new WeakMap<Hours, Map<string, Run[]>>();
function runsFor(hours: Hours, siteId: string, landingUtc: string, days: number): Run[] {
  let m = stripCache.get(hours);
  if (!m) stripCache.set(hours, (m = new Map()));
  const key = `${siteId}|${landingUtc}|${days}`;
  let r = m.get(key);
  if (!r) m.set(key, (r = stripRuns(dayStrip(hours, siteId, landingUtc, days))));
  return r;
}

export function Gantt(p: GanttProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(900);
  const [showPublic, setShowPublic] = useState(true);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const ppd = pxPerDay(p.zoom, viewW);
  const width = totalWidth(ppd);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth || 900);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A zoom change keeps the shared moment in the middle of the view.
  const atRef = useRef(p.atUtc);
  atRef.current = p.atUtc;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, xOf(Date.parse(atRef.current), ppd) - el.clientWidth / 2);
  }, [ppd]);

  const nMine = Math.max(1, p.missions.length);
  const mineTop = HEAD_H + GROUP_H;
  const publicTop = mineTop + nMine * ROW_H;
  const nPublic = showPublic ? p.publicList.length + (p.historyNote ? 1 : 0) : 0;
  const height = publicTop + GROUP_H + nPublic * PUB_H;

  // Drag on the empty body pans the view.
  const pan = useRef<{ x: number; left: number } | null>(null);
  const onBodyDown = (e: RPE<SVGRectElement>) => {
    const el = scroller.current;
    if (!el || e.button !== 0) return;
    pan.current = { x: e.clientX, left: el.scrollLeft };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onBodyMove = (e: RPE<SVGRectElement>) => {
    const el = scroller.current;
    if (el && pan.current) el.scrollLeft = pan.current.left - (e.clientX - pan.current.x);
  };
  const onBodyUp = () => (pan.current = null);

  const hovered = hover && p.missions.find((m) => m.id === hover.id);

  return (
    <div className="sch-gantt">
      <div className="sch-labels" style={{ height }}>
        <div className="sch-labels-head" style={{ height: HEAD_H }}>
          <span>UTC</span>
        </div>
        <div className="sch-group" style={{ height: GROUP_H }}>
          My missions <span className="sch-count">{p.missions.length}</span>
        </div>
        {p.missions.length === 0 && (
          <div className="sch-label sch-label-empty" style={{ height: ROW_H }}>
            No missions yet
          </div>
        )}
        {p.missions.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`sch-label${m.id === p.activeId ? " is-active" : ""}`}
            style={{ height: ROW_H }}
            onClick={() => p.onActivate(m)}
            aria-pressed={m.id === p.activeId}
            title={`Make ${m.plan.name} active`}
          >
            <span className="sch-label-name">{m.plan.name}</span>
            <span className="sch-label-sub">{p.sites.get(m.plan.siteId)?.name ?? m.plan.siteId}</span>
          </button>
        ))}
        <button
          type="button"
          className="sch-group sch-group-toggle"
          style={{ height: GROUP_H }}
          aria-expanded={showPublic}
          onClick={() => setShowPublic((v) => !v)}
        >
          <span className="sch-caret" aria-hidden="true">{showPublic ? "▾" : "▸"}</span> Public missions
          <span className="sch-count">{p.publicList.length}</span>
        </button>
        {showPublic &&
          p.publicList.map((pm) => (
            <div key={pm.site.id} className="sch-label is-public" style={{ height: PUB_H }} title={`${pm.site.name}: ${pm.site.status}. ${pm.site.note}`}>
              <span className="sch-label-name">{pm.site.name}</span>
              <span className="sch-label-sub">
                {/^https?:/.test(pm.site.source) ? (
                  <a href={pm.site.source} target="_blank" rel="noreferrer">
                    Source
                  </a>
                ) : (
                  // #405: a note already names a non-link source ("secondary source"); do not repeat it.
                  !pm.site.note && <span>Source: {pm.site.source || "unknown"}</span>
                )}
                {pm.site.note && <span className="sch-label-note">{pm.site.note}</span>}
              </span>
            </div>
          ))}
        {showPublic && p.historyNote && (
          <div className="sch-label is-history" style={{ height: PUB_H }} title={p.historyNote}>
            <span className="sch-label-name">History</span>
            <span className="sch-label-sub">{p.historyNote}</span>
          </div>
        )}
      </div>

      <div className="sch-scroll" ref={scroller} onPointerLeave={() => setHover(null)}>
        <svg width={width} height={height} className="sch-svg" role="img" aria-label="Mission timeline">
          <defs>
            <pattern id="sch-hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="8" height="8" className="sch-hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="8" className="sch-hatch-line" strokeWidth="2" />
            </pattern>
            <pattern id="sch-hatch-warn" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="sch-hatch-warn-line" strokeWidth="2.4" />
            </pattern>
          </defs>
          <rect
            className="sch-bg"
            x={0}
            y={HEAD_H}
            width={width}
            height={height - HEAD_H}
            onPointerDown={onBodyDown}
            onPointerMove={onBodyMove}
            onPointerUp={onBodyUp}
          />
          <Grid ppd={ppd} height={height} zoom={p.zoom} />
          <GroupBands width={width} mineTop={mineTop} publicTop={publicTop} />
          <MineRows
            missions={p.missions}
            activeId={p.activeId}
            hours={p.hours}
            ppd={ppd}
            top={mineTop}
            width={width}
            onActivate={p.onActivate}
            onSlip={p.onSlip}
            onHover={setHover}
          />
          <Overlaps missions={p.missions} ppd={ppd} y={HEAD_H + 4} />
          {showPublic && <PublicRows list={p.publicList} ppd={ppd} top={publicTop + GROUP_H} />}
          <NowLine atUtc={p.atUtc} onAtUtc={p.onAtUtc} ppd={ppd} height={height} width={width} />
        </svg>
        {hovered && hover && <Tip m={hovered} hours={p.hours} site={p.sites.get(hovered.plan.siteId)} x={hover.x} y={hover.y} />}
      </div>
    </div>
  );
}

/** Month headers, week ticks and faint vertical grid. */
const Grid = memo(function Grid({ ppd, height, zoom }: { ppd: number; height: number; zoom: Zoom }) {
  const months = useMemo(() => monthTicks(), []);
  const weeks = useMemo(() => weekTicks(), []);
  const weekLabels = ppd * 7 >= 34;
  return (
    <g className="sch-grid" aria-hidden="true">
      <rect className="sch-head" x={0} y={0} width={totalWidth(ppd)} height={HEAD_H} />
      {weeks.map((t) => {
        const x = xOf(t.ms, ppd);
        return (
          <g key={t.ms}>
            {zoom === "weeks" && <line className="sch-wline" x1={x} x2={x} y1={HEAD_H} y2={height} />}
            <line className="sch-wtick" x1={x} x2={x} y1={HEAD_H - 7} y2={HEAD_H} />
            {weekLabels && (
              <text className="sch-wlabel" x={x + 3} y={HEAD_H - 9}>
                {t.label}
              </text>
            )}
          </g>
        );
      })}
      {months.map((t) => {
        const x = xOf(t.ms, ppd);
        return (
          <g key={t.ms}>
            <line className="sch-mline" x1={x} x2={x} y1={0} y2={height} />
            <text className="sch-mlabel" x={x + 6} y={16}>
              {ppd * 30 >= 44 ? t.label : t.label[0]}
            </text>
          </g>
        );
      })}
    </g>
  );
});

const GroupBands = memo(function GroupBands({ width, mineTop, publicTop }: { width: number; mineTop: number; publicTop: number }) {
  return (
    <g aria-hidden="true">
      <rect className="sch-groupband" x={0} y={mineTop - GROUP_H} width={width} height={GROUP_H} />
      <rect className="sch-groupband" x={0} y={publicTop} width={width} height={GROUP_H} />
    </g>
  );
});

type RowsProps = {
  missions: ScheduledMission[];
  activeId: string | null;
  hours: Hours | null;
  ppd: number;
  top: number;
  width: number;
  onActivate: (m: ScheduledMission) => void;
  onSlip: (m: ScheduledMission, landingUtc: string) => void;
  onHover: (h: { id: string; x: number; y: number } | null) => void;
};

const MineRows = memo(function MineRows(p: RowsProps) {
  return (
    <g>
      {p.missions.map((m, i) => (
        <MissionRow key={m.id} {...p} m={m} y={p.top + i * ROW_H} active={m.id === p.activeId} />
      ))}
    </g>
  );
});

function MissionRow({
  m,
  y,
  active,
  hours,
  ppd,
  width,
  onActivate,
  onSlip,
  onHover,
}: RowsProps & { m: ScheduledMission; y: number; active: boolean }) {
  const { plan, baseLandingUtc } = m;
  const [drag, setDrag] = useState<{ x0: number; slip0: number; slip: number } | null>(null);
  const slip = drag ? drag.slip : slipDays(baseLandingUtc, plan.landingUtc);
  const landingUtc = drag ? addDays(baseLandingUtc, drag.slip) : plan.landingUtc;
  const land = Date.parse(landingUtc);
  const x = xOf(land, ppd);
  const w = plan.durationDays * ppd;
  const cy = y + ROW_H / 2 + 4;
  const barY = cy - BAR_H / 2;
  const gx0 = xOf(Date.parse(baseLandingUtc) + plan.slipMinDays * DAY_MS, ppd);
  const gx1 = xOf(Date.parse(baseLandingUtc) + (plan.slipMaxDays + plan.durationDays) * DAY_MS, ppd);
  const baseX = xOf(Date.parse(baseLandingUtc), ppd);
  const runs = hours ? runsFor(hours, plan.siteId, landingUtc, plan.durationDays) : null;
  const lo = Math.max(plan.slipMinDays, Math.ceil((RANGE_START_MS - Date.parse(baseLandingUtc)) / DAY_MS));
  const hi = Math.min(plan.slipMaxDays, Math.floor((RANGE_END_MS - DAY_MS - Date.parse(baseLandingUtc)) / DAY_MS));

  const commit = (s: number) => {
    const utc = addDays(baseLandingUtc, s);
    if (utc !== plan.landingUtc) onSlip(m, utc);
  };
  const onDown = (e: RPE<SVGGElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ x0: e.clientX, slip0: slip, slip });
  };
  const onMove = (e: RPE<SVGGElement>) => {
    if (drag) setDrag({ ...drag, slip: snapSlip(drag.slip0, e.clientX - drag.x0, ppd, lo, hi) });
  };
  const onUp = () => {
    if (!drag) return;
    const moved = drag.slip !== drag.slip0;
    setDrag(null);
    if (moved) commit(drag.slip);
    else onActivate(m);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (d) {
      e.preventDefault();
      commit(Math.min(hi, Math.max(lo, slip + d)));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate(m);
    }
  };
  const chip = slip !== 0 ? slipLabel(slip) : null;

  return (
    <g
      className={`sch-row${active ? " is-active" : ""}`}
      data-mission={m.id}
      onPointerMove={(e) => {
        const r = (e.currentTarget.ownerSVGElement as SVGSVGElement | null)?.getBoundingClientRect();
        onHover({ id: m.id, x: e.clientX - (r?.left ?? 0), y: cy + 16 });
      }}
      onPointerLeave={() => onHover(null)}
    >
      <rect className="sch-rowbg" x={0} y={y} width={width} height={ROW_H} />
      <rect className="sch-ghost" x={gx0} y={y + 6} width={Math.max(0, gx1 - gx0)} height={ROW_H - 10} rx={4}>
        <title>
          Allowed slip {slipLabel(plan.slipMinDays)} … {slipLabel(plan.slipMaxDays)}
        </title>
      </rect>
      <g className="sch-bar" onClick={() => onActivate(m)}>
        {runs ? (
          runs.map((r) => (
            <rect key={r.from} className={`sch-day k-${r.kind}`} x={x + r.from * ppd} y={barY} width={r.days * ppd} height={BAR_H} style={{ fill: KIND_COLOR[r.kind] }} />
          ))
        ) : (
          <rect className="sch-day k-none" x={x} y={barY} width={w} height={BAR_H} style={{ fill: KIND_COLOR.none }} />
        )}
        <rect className="sch-bar-edge" x={x} y={barY} width={w} height={BAR_H} rx={2} />
      </g>
      {chip && (
        <g className="sch-orig" aria-hidden="true">
          <line x1={baseX} x2={baseX} y1={y + 8} y2={y + ROW_H - 6} />
          <circle cx={baseX} cy={y + 11} r={4} />
        </g>
      )}
      {chip && (
        <g className={`sch-chip${slip > 0 ? " late" : ""}`} transform={`translate(${x + w + 6} ${cy - 8})`}>
          <rect width={chip.length * 6.6 + 12} height={16} rx={8} />
          <text x={6} y={11.5}>
            {chip}
          </text>
        </g>
      )}
      <g
        className={`sch-pin${drag ? " is-dragging" : ""}`}
        transform={`translate(${x} 0)`}
        role="slider"
        tabIndex={0}
        aria-label={`Landing of ${plan.name}`}
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={slip}
        aria-valuetext={`${fmtUtc(landingUtc)}, ${slipLabel(slip)}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={onKey}
      >
        <rect className="sch-pin-hit" x={-9} y={y + 2} width={18} height={ROW_H - 4} />
        <line x1={0} x2={0} y1={y + 6} y2={y + ROW_H - 6} />
        <path d={`M0 ${y + 4} l6 6 l-6 6 l-6 -6 Z`} />
      </g>
    </g>
  );
}

function Overlaps({ missions, ppd, y }: { missions: ScheduledMission[]; ppd: number; y: number }) {
  const list = useMemo(
    () => overlaps(missions.map((m) => ({ id: m.id, landingUtc: m.plan.landingUtc, durationDays: m.plan.durationDays }))),
    [missions],
  );
  const name = (id: string) => missions.find((m) => m.id === id)?.plan.name ?? id;
  return (
    <g className="sch-overlaps">
      {list.map((o) => {
        const x0 = xOf(o.fromMs, ppd);
        return (
          <g key={`${o.a}-${o.b}`} className="sch-overlap" data-overlap={`${o.a} ${o.b}`}>
            <title>
              Windows overlap: {name(o.a)} and {name(o.b)}, {fmtDay(o.fromMs)} – {fmtDay(o.toMs)}
            </title>
            <rect x={x0} y={y + GROUP_H - 4} width={Math.max(2, xOf(o.toMs, ppd) - x0)} height={GROUP_H - 10} rx={3} fill="url(#sch-hatch-warn)" />
            <rect className="sch-overlap-edge" x={x0} y={y + GROUP_H - 4} width={Math.max(2, xOf(o.toMs, ppd) - x0)} height={GROUP_H - 10} rx={3} />
          </g>
        );
      })}
    </g>
  );
}

const PublicRows = memo(function PublicRows({ list, ppd, top }: { list: PublicMission[]; ppd: number; top: number }) {
  return (
    <g>
      {list.map((pm, i) => {
        const y = top + i * PUB_H;
        const x0 = xOf(pm.fromMs, ppd);
        const w = xOf(pm.toMs, ppd) - x0;
        return (
          <g key={pm.site.id} className="sch-public" data-site={pm.site.id}>
            <rect x={x0} y={y + 9} width={w} height={PUB_H - 18} rx={4} fill="url(#sch-hatch)" className="sch-public-band" />
            <rect className="sch-public-pill" x={x0 + 6} y={y + PUB_H / 2 - 9} width={214} height={18} rx={9} />
            <text x={x0 + 16} y={y + PUB_H / 2 + 4}>
              Planned {pm.year} — date not published
            </text>
          </g>
        );
      })}
    </g>
  );
});

/** The shared moment: a line through every row; drag its head (or anywhere on the header) to scrub. */
function NowLine({ atUtc, onAtUtc, ppd, height, width }: { atUtc: string; onAtUtc: (u: string) => void; ppd: number; height: number; width: number }) {
  const x = xOf(Date.parse(atUtc), ppd);
  const dragging = useRef(false);
  const toUtc = (e: RPE<SVGElement>) => {
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement | null)?.getBoundingClientRect();
    return utcAtX(e.clientX - (r?.left ?? 0), ppd);
  };
  const down = (e: RPE<SVGElement>) => {
    if (e.button !== 0) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    onAtUtc(toUtc(e));
  };
  const move = (e: RPE<SVGElement>) => {
    if (dragging.current) onAtUtc(toUtc(e));
  };
  const up = () => (dragging.current = false);
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 24;
    const d = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    if (!d) return;
    e.preventDefault();
    onAtUtc(utcAtX(x + (d / 24) * ppd, ppd));
  };
  const label = `${fmtDay(Date.parse(atUtc))} ${atUtc.slice(11, 16)}`;
  const lw = label.length * 6.4 + 14;
  return (
    <g className="sch-now">
      <rect className="sch-scrub" x={0} y={0} width={width} height={HEAD_H} onPointerDown={down} onPointerMove={move} onPointerUp={up} />
      <line x1={x} x2={x} y1={HEAD_H - 4} y2={height} />
      <g
        transform={`translate(${Math.min(width - lw, Math.max(0, x - lw / 2))} ${HEAD_H - 20})`}
        className="sch-now-head"
        role="slider"
        tabIndex={0}
        aria-label="Shared moment"
        aria-valuetext={fmtUtc(atUtc)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((100 * x) / width)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onKeyDown={key}
      >
        <rect width={lw} height={17} rx={8.5} />
        <text x={7} y={12.5}>
          {label}
        </text>
      </g>
    </g>
  );
}

function Tip({ m, hours, site, x, y }: { m: ScheduledMission; hours: Hours | null; site: Site | undefined; x: number; y: number }) {
  const { plan } = m;
  const met = hours ? metricsAt(hours, plan.siteId, plan.landingUtc, plan.durationDays) : null;
  const end = addDays(plan.landingUtc, plan.durationDays);
  const h = (v: number) => `${Math.round(v)} h`;
  return (
    <div className="sch-tip" role="tooltip" style={{ left: x + 14, top: y }}>
      <div className="sch-tip-title">{plan.name}</div>
      <div className="sch-tip-sub">{site?.name ?? plan.siteId}</div>
      <dl>
        <dt>Landing</dt>
        <dd>{fmtUtc(plan.landingUtc)}</dd>
        <dt>Window</dt>
        <dd>
          {plan.durationDays} d, until {fmtUtc(end)}
        </dd>
        {met ? (
          <>
            <dt className="k-sun">Sun</dt>
            <dd>{h(met.sunH)}</dd>
            <dt className="k-earth">Earth</dt>
            <dd>{h(met.earthH)}</dd>
            <dt className="k-both">Both</dt>
            <dd>{h(met.bothH)}</dd>
            <dt>Longest dark</dt>
            <dd>{h(met.longestDarkH)}</dd>
          </>
        ) : (
          <>
            <dt>Light</dt>
            <dd>{hours ? "no data for this site or date" : "loading…"}</dd>
          </>
        )}
      </dl>
      {met?.windowClipped && <p className="sch-tip-note">The data ends inside the window.</p>}
    </div>
  );
}
