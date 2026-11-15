import { useEffect, useMemo, useState } from "react";
import type { Site } from "../contracts";
import { decodeDem, type CustomMeta } from "../custom/assets";
import type { Dem } from "../custom/horizon";
import { approachProfile, profilePath, profileTiles, type Point, type ProfilePoint } from "./profile";

const tileCache = new Map<string, Promise<ArrayBuffer>>();
async function loadDem(from: Point, to: Point): Promise<Dem | null> {
  const base = `${import.meta.env.BASE_URL}data/custom/`;
  const get = async (url: string) => { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r; };
  const meta = await (await get(`${base}meta.json`)).json() as CustomMeta;
  const tiles = profileTiles(meta, profilePath(from, to));
  if (!tiles.length) return null;
  const parts = await Promise.all(tiles.map((tile) => {
    let p = tileCache.get(tile.file);
    if (!p) { p = get(base + tile.file).then((r) => r.arrayBuffer()); p.catch(() => tileCache.delete(tile.file)); tileCache.set(tile.file, p); }
    return p;
  }));
  return decodeDem(parts, tiles, meta, -32768);
}

function line(points: ProfilePoint[], value: (p: ProfilePoint) => number | null, low: number, high: number): string {
  let gap = true;
  const maxDistance = points[points.length - 1].distanceM;
  return points.map((p) => {
    const v = value(p);
    if (v === null) { gap = true; return ""; }
    const cmd = gap ? "M" : "L"; gap = false;
    return `${cmd}${(10 + 580 * p.distanceM / maxDistance).toFixed(1)},${(190 - 180 * (v - low) / (high - low)).toFixed(1)}`;
  }).join(" ");
}

export function ApproachProfile({ site }: { site: Site }) {
  const [open, setOpen] = useState(false);
  const [dem, setDem] = useState<Dem | null>(null);
  const [error, setError] = useState("");
  const [inputs, setInputs] = useState({ lat1: String(Math.min(89.9, Math.max(-89.9, (site.lat ?? -89.4) + 0.05))), lon1: String(site.lonE ?? 222.83), lat2: String(site.lat ?? -89.4398), lon2: String(site.lonE ?? 222.83), alt1: "", alt2: "" });
  useEffect(() => { setInputs({ lat1: String(Math.min(89.9, Math.max(-89.9, (site.lat ?? -89.4) + 0.05))), lon1: String(site.lonE ?? 222.83), lat2: String(site.lat ?? -89.4398), lon2: String(site.lonE ?? 222.83), alt1: "", alt2: "" }); }, [site.id, site.lat, site.lonE]);
  const number = (s: string) => s.trim() ? Number(s) : NaN;
  const from = useMemo(() => ({ lat: number(inputs.lat1), lon: number(inputs.lon1) }), [inputs.lat1, inputs.lon1]);
  const to = useMemo(() => ({ lat: number(inputs.lat2), lon: number(inputs.lon2) }), [inputs.lat2, inputs.lon2]);
  const pathError = useMemo(() => { try { profilePath(from, to); return ""; } catch (e) { return String(e instanceof Error ? e.message : e); } }, [from, to]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open || pathError) return;
    let live = true;
    setLoaded(false); setDem(null); setError("");
    const timer = setTimeout(() => {
      loadDem(from, to).then((d) => { if (live) { setDem(d); setLoaded(true); } }, (e) => { if (live) { setError(String(e)); setLoaded(true); } });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [open, from, to, pathError]);
  const result = useMemo(() => {
    if (!loaded || error || pathError) return null;
    try {
      const alt = inputs.alt1.trim() && inputs.alt2.trim() ? [number(inputs.alt1), number(inputs.alt2)] as [number, number] : null;
      if (!!inputs.alt1.trim() !== !!inputs.alt2.trim()) throw new Error("Enter both trajectory heights or leave both empty.");
      // An empty grid marks a line wholly outside the DEM as unknown.
      const empty: Dem = { q: new Int16Array(), width: 0, height: 0, x0: 0, y0: 0, dx: 1, dy: -1, scaleM: 1 };
      return { points: approachProfile(dem ?? empty, from, to, alt), error: "" };
    } catch (e) { return { points: [], error: String(e instanceof Error ? e.message : e) }; }
  }, [loaded, dem, from, to, inputs.alt1, inputs.alt2, error, pathError]);
  const points = result?.points ?? [];
  const known = points.filter((p) => p.heightM !== null);
  const values = points.flatMap((p) => [p.heightM, p.trajectoryM].filter((v): v is number => v !== null));
  const low = values.length ? Math.min(...values) : 0, high = values.length ? Math.max(...values, low + 1) : 1;
  const field = (key: keyof typeof inputs, label: string) => <label>{label} <input type="number" step="any" value={inputs[key]} onChange={(e) => setInputs({ ...inputs, [key]: e.target.value })} /></label>;
  return <details className="hud-notes" onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary>Approach terrain profile</summary>
    <p>Great-circle line from start to end. LOLA 240 m DEM, 0.5 m height quantisation; heights above the 1737.4 km lunar reference sphere. NoData is a gap. Data covers 60–90° S; other areas are unknown.</p>
    {open && <>
      <div>{field("lat1", "Start latitude (°)")} {field("lon1", "Start longitude (°E)")} {field("lat2", "End latitude (°)")} {field("lon2", "End longitude (°E)")}</div>
      <div>{field("alt1", "Optional start trajectory height (m)")} {field("alt2", "Optional end trajectory height (m)")}</div>
      {error && <p role="alert">DEM unavailable: {error}</p>}
      {!loaded && !error && !pathError && <p>Loading DEM…</p>}
      {pathError && <p role="alert">{pathError}</p>}
      {result?.error && <p role="alert">{result.error}</p>}
      {!!known.length && <><p>Distance {(points[points.length - 1].distanceM / 1000).toFixed(2)} km, sampled coverage {known.length}/{points.length} points, range {low.toFixed(0)} to {high.toFixed(0)} m.</p>
        <svg viewBox="0 0 600 200" role="img" aria-label="Surface profile: horizontal distance, vertical height; gaps are missing data" style={{ width: "100%", height: 200 }}>
          <path d={line(points, (p) => p.heightM, low, high)} fill="none" stroke="currentColor" />
          {points[0].trajectoryM !== null && <path d={line(points, (p) => p.trajectoryM, low, high)} fill="none" stroke="var(--sun)" strokeDasharray="5 4" />}
        </svg>
        <p>White: terrain; dashed: user trajectory. The profile is a sampled environmental model, not a landing-safety assessment or a prediction of a sensor or spacecraft software.</p>
        <table><thead><tr><th>Distance km</th><th>Surface m</th>{points[0].trajectoryM !== null && <><th>Trajectory m</th><th>Clearance m</th></>}</tr></thead><tbody>
          {points.filter((_, i) => i === points.length - 1 || i % Math.max(1, Math.ceil((points.length - 1) / 10)) === 0).map((p) => <tr key={p.distanceM}><td>{(p.distanceM / 1000).toFixed(2)}</td><td>{p.heightM === null ? "NoData" : p.heightM.toFixed(1)}</td>{points[0].trajectoryM !== null && <><td>{p.trajectoryM?.toFixed(1)}</td><td>{p.clearanceM === null ? "unknown" : p.clearanceM.toFixed(1)}</td></>}</tr>)}
        </tbody></table>
      </>}
      {points.length > 0 && known.length === 0 && <p>No DEM coverage along this line; heights and clearance are unknown.</p>}
      <p>Example: CR-1 Connecting Ridge, 89.4398° S, 222.83° E, in <a href="https://pgda.gsfc.nasa.gov/products/90">NASA LOLA PGDA 90</a>; the app uses the 240 m polar DEM, not the high-resolution landing-hazard model.</p>
    </>}
  </details>;
}
