// #327: landing dispersion on the Mission plan card. "The lander never lands on the exact point: does the
// plan still hold?" Scatter points around the target, judge each with the plan verdict rule, show the share.
import { useEffect, useRef, useState } from "react";
import { loadFullTimeline } from "../api";
import type { Site } from "../contracts";
import { type Conditions, type Verdict, verdictRule } from "../landing";
import { Info } from "../ui/Info";
import { DEFAULT_N, DEFAULT_SEED, DEFAULT_SIGMA_M, type Sample, offsetPoint, outcome, pointVerdict, scatter, summarize } from "./dispersion";
import type { DispersionReply, DispersionRequest } from "./dispersionWorker";
import "./dispersion.css";

type Run =
  | { state: "idle" }
  | { state: "busy"; done: number; total: number; slow: boolean }
  | { state: "done"; samples: Sample[]; centre: Verdict | null }
  | { state: "error"; error: string };

const pct = (x: number) => `${Math.round(x * 100)} %`;
const clampInt = (s: string, lo: number, hi: number, dflt: number) => {
  const v = Math.round(Number(s));
  return Number.isFinite(v) && s.trim() !== "" ? Math.min(hi, Math.max(lo, v)) : dflt;
};
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const where = (s: Sample) => {
  const d = Math.hypot(s.e, s.n);
  return d < 1 ? "at the target" : `${Math.round(d)} m ${COMPASS[Math.round(((Math.atan2(s.e, s.n) * 180) / Math.PI + 360) / 45) % 8]} of the target`;
};

export function DispersionPanel({ site, landingUtc, limits }: { site: Site; landingUtc: string; limits: Conditions }) {
  const [sigma, setSigma] = useState(String(DEFAULT_SIGMA_M));
  const [count, setCount] = useState(String(DEFAULT_N));
  const [seed, setSeed] = useState(String(DEFAULT_SEED));
  const [run, setRun] = useState<Run>({ state: "idle" });
  const worker = useRef<Worker | null>(null);
  const sigmaM = clampInt(sigma, 1, 2000, DEFAULT_SIGMA_M);
  const n = clampInt(count, 10, 1000, DEFAULT_N);
  const seedN = clampInt(seed, 0, 2 ** 31 - 1, DEFAULT_SEED);
  const key = `${site.id}|${landingUtc}|${limits.days}|${limits.maxNightH}|${limits.maxGapH}|${sigmaM}|${n}|${seedN}`;

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
  };
  // New inputs make the old result wrong: drop it and stop a run in progress.
  useEffect(() => {
    setRun({ state: "idle" });
    return stop;
  }, [key]);

  const start = () => {
    if (site.lat === null || site.lonE === null) return;
    stop();
    const offsets = scatter(n, sigmaM, seedN);
    // Point 0 is the target itself on the 240 m terrain: a cross-check against the site data, not counted.
    const pts = [{ e: 0, n: 0 }, ...offsets].map((o) => ({ ...o, ...offsetPoint(site.lat as number, site.lonE as number, o.e, o.n) }));
    const w = new Worker(new URL("./dispersionWorker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    const t0 = performance.now();
    setRun({ state: "busy", done: 0, total: pts.length, slow: false });
    const official = loadFullTimeline(site).then((tl) => (tl && !tl.stub ? pointVerdict(tl, limits, landingUtc) : null), () => null);
    w.onmessage = ({ data }: MessageEvent<DispersionReply>) => {
      if (worker.current !== w) return;
      if (data.error) {
        stop();
        setRun({ state: "error", error: data.error });
      } else if (data.results) {
        const res = data.results;
        stop();
        const samples = pts.map((p, i) => ({ ...p, verdict: res[i].verdict, why: res[i].why }));
        official.then((v) => worker.current === null && setRun((r) => (r.state === "busy" ? { state: "done", samples, centre: v } : r)));
      } else {
        // The progress line appears only for a run longer than 1 s.
        setRun({ state: "busy", done: data.done, total: data.total, slow: performance.now() - t0 > 1000 });
      }
    };
    w.onerror = (e) => {
      stop();
      setRun({ state: "error", error: e.message || "dispersion worker failed" });
    };
    w.postMessage({ site, points: pts, landingUtc, limits, base: new URL(`${import.meta.env.BASE_URL}data/custom/`, location.href).href } satisfies DispersionRequest);
  };
  const cancel = () => {
    stop();
    setRun({ state: "idle" });
  };

  if (site.lat === null || site.lonE === null) return null;
  if (site.terrain === "none") {
    return (
      <section className="ld" aria-label="Landing dispersion">
        <h3 className="ld-title">Landing dispersion</h3>
        <p className="ld-muted">No LOLA terrain here (60–90°S only): every scattered point would see the same bare sphere.</p>
      </section>
    );
  }
  const busy = run.state === "busy";
  return (
    <section className="ld" aria-label="Landing dispersion">
      <h3 className="ld-title">
        Landing dispersion
        <Info label="How the dispersion works">
          Scatters touchdown points around the target: Gaussian, the same sigma east and north, fixed seed (the same seed gives the same
          points). Each point gets its own LOLA 240 m horizon and the same mission verdict as above for these dates. Pass = OK or MARGINAL.
          Points outside the terrain data, or with the Sun or Earth over a horizon ray that leaves it, count as unknown and stay in the total. The interval is the Wilson 95 % interval of the pass share.
        </Info>
      </h3>
      <div className="ld-inputs" role="group" aria-label="Dispersion inputs">
        <label>
          <span>Sigma, m</span>
          <input type="number" inputMode="numeric" min={1} max={2000} value={sigma} disabled={busy} onChange={(e) => setSigma(e.target.value)} />
        </label>
        <label>
          <span>Points</span>
          <input type="number" inputMode="numeric" min={10} max={1000} value={count} disabled={busy} onChange={(e) => setCount(e.target.value)} />
        </label>
        <label>
          <span>Seed</span>
          <input type="number" inputMode="numeric" min={0} value={seed} disabled={busy} onChange={(e) => setSeed(e.target.value)} />
        </label>
        {busy ? (
          <button type="button" className="rp-btn" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="rp-btn" onClick={start}>
            Scatter {n} points
          </button>
        )}
      </div>
      {busy && run.slow && (
        <p className="ld-progress" role="status">
          <span>
            Horizons: {Math.max(0, run.done - 1)} of {run.total - 1} points
          </span>
          <progress max={run.total} value={run.done} />
        </p>
      )}
      {run.state === "error" && (
        <p className="rp-alert" role="alert">
          Dispersion failed: {run.error}
        </p>
      )}
      {run.state === "done" && <Result samples={run.samples} centre={run.centre} limits={limits} sigmaM={sigmaM} />}
    </section>
  );
}

function Result({ samples, centre, limits, sigmaM }: { samples: Sample[]; centre: Verdict | null; limits: Conditions; sigmaM: number }) {
  const [target, ...points] = samples;
  const s = summarize(points, limits);
  const worst = s.worst >= 0 ? points[s.worst] : null;
  const tag = (v: Verdict | null) => (v ? v.level : "NO DATA");
  const differs = centre && target.verdict && (centre.level === "FAIL") !== (target.verdict.level === "FAIL");
  return (
    <div className="ld-result">
      <p className="ld-share">
        <b>{pct(s.share)}</b> of points pass
        <span>
          95 % interval {pct(s.lo)}–{pct(s.hi)}
        </span>
      </p>
      <p className="ld-counts">
        <span className="is-pass">Pass {s.pass}</span>
        {s.marginal > 0 && <span className="is-marginal">({s.marginal} marginal)</span>}
        <span className="is-fail">Fail {s.fail}</span>
        <span className="is-unknown">Unknown {s.unknown}</span>
        <span>of {s.total}</span>
      </p>
      <Plot points={points} limits={limits} sigmaM={sigmaM} worst={s.worst} />
      <p className="ld-caption">Dashed rings: 1 and 2 sigma ({sigmaM} m). Cross: target. Ring: worst point.</p>
      {worst?.verdict && (
        <p className="ld-line">
          Worst point, {where(worst)}: <b className={`ld-tag is-${worst.verdict.level.toLowerCase()}`}>{worst.verdict.level}</b>{" "}
          {verdictRule(worst.verdict, limits)}
        </p>
      )}
      <p className="ld-line">
        Target: site data <b>{tag(centre)}</b>, LOLA 240 m <b>{tag(target.verdict)}</b>
        {differs && <span className="ld-warn"> The two terrain models disagree at the target: the counts use 240 m.</span>}
      </p>
      <p className="ld-note" role="note">
        Share of sampled points, not landing-success probability.
      </p>
    </div>
  );
}

/** East/north scatter of the points around the target (cross), the worst point ringed. */
function Plot({ points, limits, sigmaM, worst }: { points: Sample[]; limits: Conditions; sigmaM: number; worst: number }) {
  const far = Math.max(3 * sigmaM, ...points.map((p) => Math.max(Math.abs(p.e), Math.abs(p.n))));
  const r = far * 1.08;
  const dot = r / 70;
  return (
    <svg className="ld-plot" viewBox={`${-r} ${-r} ${2 * r} ${2 * r}`} role="img" aria-label="Scattered points around the target, north up">
      <circle className="ld-ring" cx={0} cy={0} r={sigmaM} />
      <circle className="ld-ring" cx={0} cy={0} r={2 * sigmaM} />
      {points.map((p, i) => {
        const o = outcome(p, limits);
        const cls = o === "pass" && p.verdict?.level === "MARGINAL" ? "is-marginal" : `is-${o}`;
        return <circle key={i} className={`ld-dot ${cls}`} cx={p.e} cy={-p.n} r={dot} />;
      })}
      {worst >= 0 && <circle className="ld-worst" cx={points[worst].e} cy={-points[worst].n} r={dot * 2.6} />}
      <path className="ld-cross" d={`M${-dot * 3} 0H${dot * 3}M0 ${-dot * 3}V${dot * 3}`} />
      <text className="ld-axis" x={0} y={-r + dot * 8} textAnchor="middle" style={{ fontSize: dot * 7 }}>
        N
      </text>
    </svg>
  );
}
