// Drive elevation profile (#164): a side view of the LOLA terrain under the rover drive from the
// landing site through the mission waypoints. X = drive distance, Y = height above the 1737.4 km
// sphere (vertical scale stated). Steep along-track runs are marked; Sun and Earth bands follow
// the drive timeline; the rover moves with the shared moment. Canvas, sized to the device pixels.
import { type MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { decodeDem, type CustomMeta, type Tile } from "../custom/assets";
import type { Dem } from "../custom/horizon";
import { fmtDuration } from "../format";
import { ROVER_M_PER_H } from "../mission/traverse";
import { clampUtc } from "../timeline/time";
import {
  DEFAULT_SLOPE_LIMIT,
  distanceAtTime,
  drivePath,
  driveTiles,
  heightAt,
  indexBefore,
  profileStats,
  sampleProfile,
  SLOPE_LIMITS,
  steepRuns,
  ticks,
  timeAtDistance,
  visibilityAt,
  type DrivePoint,
  type DriveSample,
  type ProfileSample,
} from "./elevation";
import { indexAt } from "./route";
import type { Hours } from "./hours";
import { Info } from "../ui/Info";
import "./elevation-profile.css";

export type ElevationProfileProps = {
  /** The landing site first, then the waypoints in drive order. */
  points: DrivePoint[];
  hours: Hours | null;
  /** Site whose hourly Sun/Earth series colours the bands (the landing site). */
  siteId: string;
  /** The drive starts at the landing. */
  departUtc: string;
  atUtc: string;
  onAtUtc?: (utc: string) => void;
};

// Layout, CSS px.
const H = 214;
const L = 46; // left margin: height labels
const RM = 10;
const TOP = 16;
const PLOT_B = 136;
const XLAB = 150;
const SUN_Y = 162;
const EARTH_Y = 178;
const BAND_H = 8;
const HOUR = 3_600_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtT = (ms: number) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
};
const km = (m: number) => (m / 1000).toFixed(m < 10_000 ? 2 : 1);
const fmtH = (h: number | null) => (h === null ? "no data" : `${Math.round(h)} m`);

// DEM: the 240 m tiles of the custom point, cached per page like the approach profile.
const tileCache = new Map<string, Promise<ArrayBuffer>>();
let metaP: Promise<CustomMeta> | null = null;
const MAX_BOX_TILES = 49; // decodeDem fills the tile bounding box: 7 × 7 tiles ≈ 14 MB
async function get(url: string): Promise<Response> {
  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}
async function loadDriveDem(path: DriveSample[]): Promise<Dem | null> {
  const base = `${import.meta.env.BASE_URL}data/custom/`;
  metaP ??= get(`${base}meta.json`).then((r) => r.json() as Promise<CustomMeta>);
  metaP.catch(() => (metaP = null));
  const meta = await metaP;
  const tiles: Tile[] = driveTiles(meta, path);
  if (!tiles.length) return null;
  const span = (k: "row" | "col") => Math.max(...tiles.map((t) => t[k])) - Math.min(...tiles.map((t) => t[k])) + 1;
  if (span("row") * span("col") > MAX_BOX_TILES) throw new Error("the drive spans too much terrain for the browser; shorten it");
  const parts = await Promise.all(
    tiles.map((t) => {
      let p = tileCache.get(t.file);
      if (!p) {
        p = get(base + t.file).then((r) => r.arrayBuffer());
        p.catch(() => tileCache.delete(t.file));
        tileCache.set(t.file, p);
      }
      return p;
    }),
  );
  return decodeDem(parts, tiles, meta, -32768);
}

type Colors = Record<"fg" | "muted" | "dim" | "line" | "lineStrong" | "sun" | "earth" | "warn" | "ground" | "bg" | "panel", string>;
function readColors(el: Element): Colors {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    fg: v("--fg", "#e6e6e2"),
    muted: v("--muted", "#8a8c8f"),
    dim: v("--dim", "#575a5e"),
    line: v("--line", "#25272a"),
    lineStrong: v("--line-strong", "#3b3e42"),
    sun: v("--red", "#ff5a1f"),
    earth: v("--blue", "#4a90e2"),
    warn: v("--warn", "#c9a45a"),
    ground: v("--ground", "#2b2c2e"),
    bg: v("--bg", "#08090a"),
    panel: v("--panel", "#101112"),
  };
}

type Geo = { w: number; lo: number; hi: number; x: (d: number) => number; y: (h: number) => number; d: (x: number) => number; ve: number };
function geometry(w: number, lengthM: number, minM: number, maxM: number): Geo {
  const range = Math.max(maxM - minM, 20);
  const pad = range * 0.12;
  const lo = minM - pad;
  const hi = minM + range + pad;
  const pw = Math.max(1, w - L - RM);
  const ph = PLOT_B - TOP;
  return {
    w,
    lo,
    hi,
    x: (d) => L + (d / lengthM) * pw,
    y: (h) => PLOT_B - ((h - lo) / (hi - lo)) * ph,
    d: (x) => Math.min(lengthM, Math.max(0, ((x - L) / pw) * lengthM)),
    ve: ph / (hi - lo) / (pw / lengthM),
  };
}

export function ElevationProfile(p: ElevationProfileProps) {
  const [open, setOpen] = useState(true);
  const [limit, setLimit] = useState<number>(DEFAULT_SLOPE_LIMIT);
  const speed = ROVER_M_PER_H; // m/h: the traverse speed (#195)
  const [dem, setDem] = useState<{ key: string; dem: Dem | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoverD, setHoverD] = useState<number | null>(null);

  const key = p.points.map((q) => `${q.lat},${q.lonE}`).join(";");
  const path = useMemo(() => {
    try {
      return { s: drivePath(p.points), err: null };
    } catch (e) {
      return { s: null, err: e instanceof Error ? e.message : String(e) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!open || !path.s || dem?.key === key) return;
    let live = true;
    setError(null);
    loadDriveDem(path.s).then(
      (d) => live && setDem({ key, dem: d }),
      (e) => live && setError(String(e instanceof Error ? e.message : e)),
    );
    return () => {
      live = false;
    };
  }, [open, path, key, dem?.key]);

  const samples = useMemo<ProfileSample[] | null>(() => {
    if (!path.s || !dem || dem.key !== key) return null;
    const empty: Dem = { q: new Int16Array(), width: 0, height: 0, x0: 0, y0: 0, dx: 1, dy: -1, scaleM: 1 };
    return sampleProfile(dem.dem ?? empty, path.s);
  }, [path, dem, key]);
  const stats = useMemo(() => (samples ? profileStats(samples) : null), [samples]);
  const steep = useMemo(() => (samples ? steepRuns(samples, limit) : []), [samples, limit]);
  const steepM = steep.reduce((a, [f, t]) => a + Math.max(t - f, 120), 0);
  const departMs = Date.parse(p.departUtc);
  const atMs = Date.parse(p.atUtc);
  const lengthM = stats?.lengthM ?? 0;
  const driveH = lengthM / speed;
  const legEnds = useMemo(() => {
    if (!path.s) return [];
    const out: number[] = [];
    path.s.forEach((q, i) => {
      const n = path.s![i + 1];
      if (n && n.leg !== q.leg) out.push(q.dM);
    });
    out.push(path.s[path.s.length - 1].dM);
    return out;
  }, [path]);

  // Canvas: a static layer redrawn on data / size change, a frame layer (rover, hover) per rAF.
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLCanvasElement | null>(null);
  const geo = useRef<Geo | null>(null);
  const [ve, setVe] = useState<number | null>(null); // vertical exaggeration of the drawn plot
  const size = useRef({ w: 0, dpr: 1 });
  const shown = useRef<number | null>(null); // rover distance on screen, eased to the target
  const target = useRef(0);
  const hoverRef = useRef<number | null>(null);
  const raf = useRef(0);
  const last = useRef(0);
  const [w, setW] = useState(0);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => setW(Math.round(el.getBoundingClientRect().width));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, samples]);

  const known = !!stats && stats.known > 1;

  // Static layer.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !samples || !stats || !known || w < 80) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    size.current = { w, dpr };
    c.width = Math.round(w * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${H}px`;
    const off = layer.current ?? document.createElement("canvas");
    layer.current = off;
    off.width = c.width;
    off.height = c.height;
    const g = geometry(w, stats.lengthM, stats.minM, stats.maxM);
    geo.current = g;
    setVe(g.ve);
    const col = readColors(c);
    const ctx = off.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, H);
    ctx.font = `10px ${getComputedStyle(c).getPropertyValue("--font-mono") || "monospace"}`;
    ctx.textBaseline = "middle";

    // Height grid and labels.
    for (const t of ticks(g.lo, g.hi, 4)) {
      const y = Math.round(g.y(t)) + 0.5;
      if (y < TOP - 2 || y > PLOT_B + 2) continue;
      ctx.strokeStyle = col.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(w - RM, y);
      ctx.stroke();
      ctx.fillStyle = col.muted;
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(t)}`, L - 6, y);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = col.dim;
    ctx.fillText("m", 4, TOP - 8);

    // Steep runs: a tint behind the terrain.
    for (const [f, t] of steep) {
      const x0 = g.x(f) - 1;
      const x1 = Math.max(g.x(t) + 1, x0 + 2);
      ctx.fillStyle = col.warn;
      ctx.globalAlpha = 0.14;
      ctx.fillRect(x0, TOP, x1 - x0, PLOT_B - TOP);
      ctx.globalAlpha = 1;
    }

    // Terrain: area and line, split at gaps.
    const runs: ProfileSample[][] = [];
    let cur: ProfileSample[] = [];
    for (const s of samples) {
      if (s.heightM === null) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else cur.push(s);
    }
    if (cur.length) runs.push(cur);
    for (const r of runs) {
      ctx.beginPath();
      ctx.moveTo(g.x(r[0].dM), PLOT_B);
      for (const s of r) ctx.lineTo(g.x(s.dM), g.y(s.heightM as number));
      ctx.lineTo(g.x(r[r.length - 1].dM), PLOT_B);
      ctx.closePath();
      ctx.fillStyle = col.ground;
      ctx.fill();
      ctx.beginPath();
      r.forEach((s, i) => (i ? ctx.lineTo(g.x(s.dM), g.y(s.heightM as number)) : ctx.moveTo(g.x(s.dM), g.y(s.heightM as number))));
      ctx.strokeStyle = col.fg;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    // Steep runs: the terrain line in the warning colour on top.
    ctx.strokeStyle = col.warn;
    ctx.lineWidth = 2.5;
    for (const [f, t] of steep) {
      ctx.beginPath();
      let started = false;
      for (let i = Math.max(0, indexBefore(samples, f) - 1); i < samples.length && samples[i].dM <= t + 1; i++) {
        const s = samples[i];
        if (s.heightM === null) {
          started = false;
          continue;
        }
        if (started) ctx.lineTo(g.x(s.dM), g.y(s.heightM));
        else ctx.moveTo(g.x(s.dM), g.y(s.heightM));
        started = true;
      }
      ctx.stroke();
    }
    // Plot base line.
    ctx.strokeStyle = col.lineStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, PLOT_B + 0.5);
    ctx.lineTo(w - RM, PLOT_B + 0.5);
    ctx.stroke();

    // Waypoints: thin markers at the turn points and the end.
    ctx.setLineDash([2, 3]);
    legEnds.forEach((d, k) => {
      const x = Math.round(g.x(d)) + 0.5;
      ctx.strokeStyle = col.lineStrong;
      ctx.beginPath();
      ctx.moveTo(x, TOP);
      ctx.lineTo(x, PLOT_B);
      ctx.stroke();
      ctx.fillStyle = col.muted;
      ctx.textAlign = x > w - 30 ? "right" : "center";
      ctx.fillText(`WP${k + 1}`, x > w - 30 ? w - RM : x, TOP - 8);
    });
    ctx.setLineDash([]);

    // Distance labels.
    ctx.fillStyle = col.muted;
    const xt = ticks(0, stats.lengthM / 1000, Math.max(2, Math.floor((w - L) / 70)));
    xt.forEach((t) => {
      const x = g.x(t * 1000);
      ctx.textAlign = x < L + 10 ? "left" : x > w - RM - 20 ? "right" : "center";
      ctx.fillText(`${t}${t === xt[xt.length - 1] ? " km" : ""}`, x, XLAB);
    });

    // Sun and Earth bands along the drive timeline (hourly cells of the site series).
    ctx.textAlign = "right";
    ctx.fillStyle = col.muted;
    ctx.fillText("SUN", L - 6, SUN_Y + BAND_H / 2);
    ctx.fillText("EARTH", L - 6, EARTH_Y + BAND_H / 2);
    const endMs = timeAtDistance(departMs, stats.lengthM, speed);
    const bandAt = (y: number) => {
      ctx.fillStyle = col.panel;
      ctx.fillRect(L, y, w - L - RM, BAND_H);
    };
    bandAt(SUN_Y);
    bandAt(EARTH_Y);
    if (p.hours && Number.isFinite(departMs)) {
      const hrs = p.hours;
      const stepMs = hrs.stepMin * 60_000;
      for (let i = indexAt(hrs, departMs); hrs.startMs + i * stepMs < endMs; i++) {
        const t0 = Math.max(departMs, hrs.startMs + i * stepMs);
        const t1 = Math.min(endMs, hrs.startMs + (i + 1) * stepMs);
        const d0 = ((t0 - departMs) / HOUR) * speed;
        const d1 = ((t1 - departMs) / HOUR) * speed;
        const x0 = g.x(d0);
        const x1 = g.x(d1);
        const v = visibilityAt(hrs, p.siteId, t0);
        if (!v) continue;
        ctx.fillStyle = v.sun ? col.sun : col.ground;
        ctx.fillRect(x0, SUN_Y, Math.max(0.5, x1 - x0), BAND_H);
        ctx.fillStyle = v.earth ? col.earth : col.ground;
        ctx.fillRect(x0, EARTH_Y, Math.max(0.5, x1 - x0), BAND_H);
      }
    }
    // Time labels under the bands: departure and arrival.
    ctx.fillStyle = col.dim;
    ctx.textAlign = "left";
    ctx.fillText(`dep ${fmtT(departMs)}`, L, EARTH_Y + BAND_H + 12);
    ctx.textAlign = "right";
    ctx.fillText(`arr ${fmtT(endMs)}`, w - RM, EARTH_Y + BAND_H + 12);

    shown.current ??= target.current;
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, samples, stats, steep, w, legEnds, p.hours, p.siteId, departMs, speed, known]);

  // The frame: static layer + rover + hover. Eases the rover to the target with rAF.
  const tick = (now: number) => {
    raf.current = 0;
    const c = canvas.current;
    const off = layer.current;
    const g = geo.current;
    if (!c || !off || !g || !samples) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dt = last.current ? Math.min(100, now - last.current) : 16;
    last.current = now;
    const goal = target.current;
    let d = shown.current ?? goal;
    d += (goal - d) * (1 - Math.exp(-dt / 140));
    if (Math.abs(goal - d) < lengthM * 1e-4) d = goal;
    shown.current = d;

    const { dpr } = size.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(off, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = readColorsCached(c);

    // Hover crosshair.
    const hv = hoverRef.current;
    if (hv !== null) {
      const x = Math.round(g.x(hv)) + 0.5;
      ctx.strokeStyle = col.muted;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, TOP);
      ctx.lineTo(x, EARTH_Y + BAND_H);
      ctx.stroke();
      const h = heightAt(samples, hv);
      if (h !== null) {
        ctx.fillStyle = col.fg;
        ctx.beginPath();
        ctx.arc(x, g.y(h), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Rover: a cursor line through the bands and a small rover tilted with the drawn terrain.
    const x = g.x(d);
    ctx.strokeStyle = col.fg;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, TOP);
    ctx.lineTo(Math.round(x) + 0.5, EARTH_Y + BAND_H);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const h = heightAt(samples, d);
    if (h !== null) {
      const ha = heightAt(samples, Math.max(0, d - 60)) ?? h;
      const hb = heightAt(samples, Math.min(lengthM, d + 60)) ?? h;
      const ang = Math.atan2(g.y(hb) - g.y(ha), g.x(Math.min(lengthM, d + 60)) - g.x(Math.max(0, d - 60)));
      const i = indexBefore(samples, d);
      const steepHere = samples[i].slopeDeg > limit;
      drawRover(ctx, x, g.y(h), ang, steepHere ? col.warn : col.fg, col.bg);
    }
    if (d !== goal) raf.current = requestAnimationFrame(tick);
  };
  const tickRef = useRef(tick);
  tickRef.current = tick;
  function request() {
    if (!raf.current) {
      last.current = 0;
      raf.current = requestAnimationFrame((t) => tickRef.current(t));
    }
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // Target distance from the shared moment.
  useEffect(() => {
    target.current = lengthM ? distanceAtTime(departMs, atMs, speed, lengthM) : 0;
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atMs, departMs, speed, lengthM]);
  useEffect(() => {
    hoverRef.current = hoverD;
    request();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverD]);

  const pointer = (e: MouseEvent<HTMLCanvasElement>) => {
    const g = geo.current;
    if (!g) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    return x < L - 4 || x > r.width - RM + 4 ? null : g.d(x);
  };

  const roverD = lengthM ? distanceAtTime(departMs, atMs, speed, lengthM) : 0;
  const roverState = !Number.isFinite(atMs) || !lengthM ? null : atMs < departMs ? "waiting" : roverD >= lengthM ? "arrived" : "driving";
  const roverVis = p.hours ? visibilityAt(p.hours, p.siteId, atMs) : null;
  const tip = (() => {
    if (hoverD === null || !samples) return null;
    const i = indexBefore(samples, hoverD);
    const h = heightAt(samples, hoverD);
    const t = timeAtDistance(departMs, hoverD, speed);
    const v = p.hours ? visibilityAt(p.hours, p.siteId, t) : null;
    return { d: hoverD, h, slope: samples[i].slopeDeg, t, v, x: geo.current?.x(hoverD) ?? 0 };
  })();

  return (
    <details className="elev" open={open} onToggle={(e) => setOpen(e.currentTarget.open)} aria-label="Drive elevation profile">
      <summary>
        <span className="rp-eyebrow">Drive profile: landing site → {p.points.length - 1} waypoint{p.points.length > 2 ? "s" : ""}</span>
      </summary>
      {path.err && (
        <p className="rp-alert" role="alert">
          {path.err}
        </p>
      )}
      {error && (
        <p className="rp-alert" role="alert">
          Terrain failed to load: {error}
        </p>
      )}
      {path.s && !samples && !error && <p className="rp-muted">Loading LOLA terrain along the drive…</p>}
      {samples && !known && <p className="rp-muted">No LOLA terrain along this drive (the DEM covers 60–90°S).</p>}
      {samples && stats && known && (
        <>
          <dl className="elev-stats">
            <div>
              <dt>Length</dt>
              <dd>{km(stats.lengthM)} km</dd>
            </div>
            <div>
              <dt>Climb</dt>
              <dd>↑ {Math.round(stats.climbM)} m</dd>
            </div>
            <div>
              <dt>Descent</dt>
              <dd>↓ {Math.round(stats.descentM)} m</dd>
            </div>
            <div>
              <dt>Max slope</dt>
              <dd className={stats.maxSlopeDeg > limit ? "is-warn" : ""}>{stats.maxSlopeDeg.toFixed(1)}°</dd>
            </div>
            <div>
              <dt>Over {limit}°</dt>
              <dd className={steep.length ? "is-warn" : ""}>{steep.length ? `${km(steepM)} km` : "none"}</dd>
            </div>
            <div>
              <dt>Drive time</dt>
              <dd>{fmtDuration(driveH)}</dd>
            </div>
          </dl>
          <div className="elev-plot" ref={wrap}>
            <canvas
              ref={canvas}
              role="img"
              data-testid="elevation-profile"
              data-samples={samples.length}
              aria-label={`Elevation profile: ${km(stats.lengthM)} km, ${Math.round(stats.minM)} to ${Math.round(stats.maxM)} m, max slope ${stats.maxSlopeDeg.toFixed(1)}°`}
              onPointerMove={(e) => setHoverD(pointer(e))}
              onPointerLeave={() => setHoverD(null)}
              onClick={(e) => {
                const d = pointer(e);
                if (d !== null && p.onAtUtc) p.onAtUtc(clampUtc(timeAtDistance(departMs, d, speed)));
              }}
              style={{ cursor: p.onAtUtc ? "pointer" : "crosshair" }}
            />
            {tip && (
              <div className={`elev-tip${tip.x > w / 2 ? " is-left" : ""}`} style={{ left: tip.x }} role="status">
                <b>{km(tip.d)} km</b>
                <span>{tip.h === null ? "no data" : fmtH(tip.h)}</span>
                <span className={tip.slope > limit ? "is-warn" : ""}>{Number.isNaN(tip.slope) ? "slope —" : `slope ${tip.slope.toFixed(1)}°`}</span>
                <span>{fmtT(tip.t)}</span>
                <span className={tip.v?.sun ? "is-sun" : ""}>{tip.v ? (tip.v.sun ? "Sun lit" : "Sun hidden") : "Sun —"}</span>
                <span className={tip.v?.earth ? "is-earth" : ""}>{tip.v ? (tip.v.earth ? "Earth in view" : "no Earth") : "Earth —"}</span>
              </div>
            )}
          </div>
          <div className="elev-foot">
            <p className="elev-rover" data-testid="elevation-rover">
              {roverState === "waiting" && <>Rover at the landing site, departs {fmtT(departMs)}</>}
              {roverState === "driving" && (
                <>
                  Rover at {km(roverD)} of {km(lengthM)} km, {fmtH(heightAt(samples, roverD))}
                </>
              )}
              {roverState === "arrived" && <>Rover at WP{p.points.length - 1}, arrived {fmtT(timeAtDistance(departMs, lengthM, speed))}</>}
              {roverVis && (
                <>
                  {", "}
                  <span className={roverVis.sun ? "is-sun" : ""}>{roverVis.sun ? "Sun lit" : "Sun hidden"}</span>
                  {", "}
                  <span className={roverVis.earth ? "is-earth" : ""}>{roverVis.earth ? "Earth in view" : "no Earth"}</span>
                </>
              )}
            </p>
            <div className="elev-controls">
              <label>
                Slope limit
                <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
                  {SLOPE_LIMITS.map((v) => (
                    <option key={v} value={v}>
                      {v}°
                    </option>
                  ))}
                </select>
              </label>
              <Info label="About the elevation profile">
                LOLA 240 m DEM (PGDA 90), height above the 1737.4 km sphere; vertical scale ×{ve === null ? "—" : fmtVe(ve)}. Along-track
                slope over ~240 m; cross slope is not included. The default slope limit {DEFAULT_SLOPE_LIMIT}° and the speed {ROVER_M_PER_H} m/h
                follow{" "}
                <a href="https://science.nasa.gov/mission/viper/lunar-operations/" target="_blank" rel="noreferrer">
                  NASA VIPER operations
                </a>{" "}
                (up to 15°; 10–20 cm/s while moving, with a stop every ~4.5 m, so ~1 cm/s on average, as in the traverse above); for your rover
                they are assumptions. Constant speed from the landing is an assumption. Sun and Earth bands use the landing site's hourly series,
                not recomputed along the route. Click the profile to move the time there.
              </Info>
            </div>
          </div>
        </>
      )}
    </details>
  );
}

const fmtVe = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1));

let colorCache: { el: Element; c: Colors } | null = null;
function readColorsCached(el: Element): Colors {
  if (colorCache?.el !== el) colorCache = { el, c: readColors(el) };
  return colorCache.c;
}

/** A small six-wheel rover in side view: body, wheels, mast. (cx, cy) = ground contact. */
function drawRover(ctx: CanvasRenderingContext2D, cx: number, cy: number, ang: number, fill: string, edge: string) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = edge;
  ctx.fillStyle = fill;
  // Wheels.
  for (const wx of [-6, 0, 6]) {
    ctx.beginPath();
    ctx.arc(wx, -2.5, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  // Body and mast.
  ctx.beginPath();
  ctx.rect(-8, -10, 16, 5);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(3, -17, 2, 7);
  ctx.rect(1.5, -19, 5, 3);
  ctx.fill();
  ctx.restore();
}
