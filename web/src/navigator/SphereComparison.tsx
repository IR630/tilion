import { useEffect, useState } from "react";
import { loadValidation } from "../api";
import type { Timeline, ValidationFile } from "../contracts";
import { sphereTimeline } from "../summary";
import { siteEvidence } from "./SiteEvidence";

/** A 30-day window starting at the selected hour, limited by the available data. */
export function comparisonWindow(tl: Timeline, atUtc: string) {
  const start = Math.max(0, Math.floor((Date.parse(atUtc) - Date.parse(tl.startUtc)) / (tl.stepMin * 60000)));
  const end = Math.min(tl.sunVisible.length, start + Math.ceil((30 * 24 * 60) / tl.stepMin));
  return { start, end };
}

function Band({ values, start, end, label }: { values: number[]; start: number; end: number; label: string }) {
  const runs: { start: number; end: number }[] = [];
  for (let i = start; i < end; i++) {
    if (values[i] > 0) {
      const last = runs[runs.length - 1];
      if (last?.end === i) last.end = i + 1;
      else runs.push({ start: i, end: i + 1 });
    }
  }
  const n = end - start;
  return <div className="sphere-band-row"><span>{label}</span><svg viewBox={`0 0 ${n} 10`} preserveAspectRatio="none" role="img" aria-label={`${label}: coloured means visible`}>
    <rect width={n} height="10" className="sphere-band-off" />
    {runs.map((run) => <rect key={run.start} x={run.start - start} width={run.end - run.start} height="10" className="sphere-band-on" />)}
  </svg></div>;
}

export function SphereComparison({ tl, siteId, atUtc }: { tl: Timeline; siteId: string; atUtc: string }) {
  const [open, setOpen] = useState(false);
  const [validation, setValidation] = useState<ValidationFile | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    loadValidation().then((f) => { if (live) setValidation(f); }, () => { if (live) setValidation(null); });
    return () => { live = false; };
  }, [open]);
  const { start, end } = comparisonWindow(tl, atUtc);
  const sphere = sphereTimeline(tl);
  const error = validation ? siteEvidence(validation, siteId)?.sphere?.ours : null;
  const startTime = Date.parse(tl.startUtc) + start * tl.stepMin * 60000;
  const endTime = Date.parse(tl.startUtc) + end * tl.stepMin * 60000;
  const date = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");
  return <section className="sphere-comparison" aria-label="Terrain and sphere comparison">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Compare LOLA with smooth sphere</button>
    {open && (end > start ? <div>
      <p>Visibility from {date(startTime)} to {date(endTime)} UTC. Colour means visible.</p>
      <div className="sphere-band k-sun"><Band label="Sun LOLA" values={tl.sunVisible} start={start} end={end} /><Band label="Sun sphere" values={sphere.sunVisible} start={start} end={end} /></div>
      <div className="sphere-band k-earth"><Band label="Earth LOLA" values={tl.earthVisible} start={start} end={end} /><Band label="Earth sphere" values={sphere.earthVisible} start={start} end={end} /></div>
      <p>Sphere: flat 0° horizon. Sun: any disc visible; Earth: centre visible.</p>
      {error != null ? <p>Sphere sunset error here: {error} h median in 2027, compared with the nearest LOLA sunset.</p> : <p>Site-specific sunset error is unavailable.</p>}
    </div> : <p>No timeline data at this moment.</p>)}
  </section>;
}
