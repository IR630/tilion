import { useEffect, useState } from "react";
import { expandFlips, loadVariants } from "../api";
import type { HorizonMask, Site, Timeline, VisibilityVariants } from "../contracts";
function maskAt(mask: HorizonMask, az: number): number {
  const f = ((az % 360) + 360) % 360 / mask.azStepDeg;
  const k = Math.floor(f) % mask.elevDeg.length;
  return mask.elevDeg[k] * (1 - (f % 1)) + mask.elevDeg[(k + 1) % mask.elevDeg.length] * (f % 1);
}

type Window = [number, number]; // half-open indexes within the displayed timeline

/** The visible run containing the cursor, or the next run; clipped to the displayed period. */
export function selectedWindow(flags: number[], index: number): Window | null {
  let start = Math.max(0, index);
  while (start < flags.length && flags[start] !== 1) start++;
  if (start === flags.length) return null;
  while (start > 0 && flags[start - 1] === 1) start--;
  let end = start + 1;
  while (end < flags.length && flags[end] === 1) end++;
  return [start, end];
}

/** Parts of the reference window where all listed variants are visible. */
export function sharedWindows(reference: Window, series: number[][]): Window[] {
  if (!series.length || series.some((s) => s.length < reference[1] || s.some((v) => v !== 0 && v !== 1))) return [];
  const result: Window[] = [];
  let start: number | null = null;
  for (let i = reference[0]; i <= reference[1]; i++) {
    const visible = i < reference[1] && series.every((s) => s[i] === 1);
    if (visible && start === null) start = i;
    if (!visible && start !== null) { result.push([start, i]); start = null; }
  }
  return result;
}

export function EarthWindows({ site, tl, mask, index }: { site: Site; tl: Timeline; mask: HorizonMask; index: number }) {
  const [data, setData] = useState<VisibilityVariants | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    loadVariants(site).then((v) => { if (live) setData(v); }, () => { if (live) setData(null); });
    return () => { live = false; };
  }, [site]);
  const offset = data ? (Date.parse(tl.startUtc) - Date.parse(data.startUtc)) / (data.stepMin * 60000) : NaN;
  const valid = !tl.stub && data && data.siteId === site.id && data.stepMin === tl.stepMin && Number.isInteger(offset)
    && offset >= 0 && offset + tl.earthVisible.length <= data.n && data.variants.length > 0
    && data.variants.every((v) => Array.isArray(v.earth) && v.earth.every((x, j) => Number.isInteger(x) && x >= 0 && x < data.n && (j === 0 || x > v.earth[j - 1])));
  const series = valid ? data.variants.map((v) => expandFlips(v.earth, offset, tl.earthVisible.length)) : [];
  const ref = selectedWindow(tl.earthVisible, index);
  const labels = valid ? data.variants.map((v) => `${v.dem} DEM, ${v.heightM} m`) : [];
  const format = (w: Window) => {
    const utc = (k: number) => new Date(Date.parse(tl.startUtc) + k * tl.stepMin * 60000).toISOString().replace(".000Z", " UTC").replace("T", " ");
    return `${utc(w[0])} – ${utc(w[1])}${w[0] === 0 || w[1] === tl.earthVisible.length ? " (period boundary)" : ""}`;
  };
  const elevation = tl.earthEl[index];
  const horizon = maskAt(mask, tl.earthAz[index]);
  return <details className="hud-notes">
    <summary>Earth visibility: terrain and height sensitivity</summary>
    <p>Earth elevation {elevation.toFixed(1)}°; horizon {horizon.toFixed(1)}°; angular clearance {(elevation - horizon).toFixed(1)}°.</p>
    <p>Reference window: {ref ? format(ref) : "none in this period"}.</p>
    {!valid ? <p>Variant data unavailable or incompatible; shared visibility is unknown.</p> : <>
      <ul>{series.map((s, j) => {
        const windows = ref ? sharedWindows(ref, [s]) : [];
        return <li key={labels[j]}>{labels[j]} (within reference): {windows.map(format).join("; ") || "no overlap with reference"}</li>;
      })}</ul>
      <p>Common visibility within reference: {ref ? (sharedWindows(ref, series).map(format).join("; ") || "none") : "not calculated"}.</p>
      <p>Available observer heights: {[...new Set(data.variants.map((v) => v.heightM))].join(", ")} m. Other variants are unavailable.</p>
      <p>Intersection of listed variants only. This is not a complete uncertainty estimate or a measure of radio link reliability. Times use the source sampling interval.</p>
    </>}
  </details>;
}
