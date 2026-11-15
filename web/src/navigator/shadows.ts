// #288: "Shadows now" map layer. Terrain shadows over ±32 km around the pole at the chosen hour.
// Horizon field: Lunar Window (adqm0001/lunar-window, commit 13d45a98, web/public/data/field_pole.*),
// computed by their C++ engine from LOLA, 250 m cells, 180 azimuths, observer 2 m; cropped by us to ±32 km. The decoder follows
// their web/src/data/field.ts. The Sun direction is ours: SPICE DE440 az/el of one of our timelines.
// Same projection as ours (D-005): south polar stereographic, R = 1737.4 km, row 0 = +y.
import { stereoInv } from "../format";

export type ShadowField = { size: number; cellM: number; extentM: number; bins: number; offsetDeg: number; stepDeg: number; horizon: Uint8Array };

const BASE = `${import.meta.env.BASE_URL}data/shadow/`;
const SUN_DISC_DEG = 0.53;

async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes; // the server already decoded it
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type FieldMeta = {
  extentMeters: number;
  horizon: { file: string; size: number; azimuthBins: number; cellMeters: number; decode: { offsetDeg: number; stepDeg: number } };
};

/** Layers are stored as byte deltas between consecutive azimuths (mod 256); undo them in place. */
export function decodeField(meta: FieldMeta, h: Uint8Array): ShadowField {
  const { size, azimuthBins: bins } = meta.horizon;
  const layer = size * size;
  if (h.length !== bins * layer) throw new Error(`shadow field: ${h.length} bytes, expected ${bins * layer}`);
  for (let a = 1; a < bins; a++) for (let i = a * layer; i < (a + 1) * layer; i++) h[i] = (h[i] + h[i - layer]) & 255;
  return { size, cellM: meta.horizon.cellMeters, extentM: meta.extentMeters, bins, offsetDeg: meta.horizon.decode.offsetDeg, stepDeg: meta.horizon.decode.stepDeg, horizon: h };
}

async function get(name: string): Promise<Response> {
  const res = await fetch(BASE + name, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`shadow field: ${name} HTTP ${res.status}`);
  return res;
}

let field: Promise<ShadowField> | null = null;

/** Load and decode once. */
export function loadShadowField(): Promise<ShadowField> {
  field ??= (async () => {
    const meta: FieldMeta = await (await get("field_pole.json")).json();
    const h = await gunzip(new Uint8Array(await (await get(meta.horizon.file)).arrayBuffer()));
    return decodeField(meta, h);
  })();
  field.catch(() => (field = null));
  return field;
}

const RAD = Math.PI / 180;

/** Unit vector to the Sun in the Moon body-fixed frame from az/el seen at (lat, lonE). Az from north to east. */
export function sunVector(lat: number, lonE: number, azDeg: number, elDeg: number): [number, number, number] {
  const la = lat * RAD, lo = lonE * RAD, az = azDeg * RAD, el = elDeg * RAD;
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const east = [-Math.sin(lo), Math.cos(lo), 0];
  const north = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const n = Math.cos(el) * Math.cos(az), e = Math.cos(el) * Math.sin(az), u = Math.sin(el);
  return [0, 1, 2].map((k) => n * north[k] + e * east[k] + u * up[k]) as [number, number, number];
}

/** Visible share of the Sun disc per cell (0..1, linear across the 0.53° disc), row-major.
 * Optional sinElOut receives sin(Sun elevation) per cell (#325, thermal layer). */
export function litShare(f: ShadowField, sun: [number, number, number], sinElOut?: Float32Array): Float32Array {
  const out = new Float32Array(f.size * f.size);
  for (let r = 0; r < f.size; r++) {
    const y = f.extentM - (r + 0.5) * f.cellM;
    for (let c = 0; c < f.size; c++) {
      const x = -f.extentM + (c + 0.5) * f.cellM;
      const [lat, lonE] = stereoInv(x, y);
      const la = lat * RAD, lo = lonE * RAD;
      const cl = Math.cos(la), sl = Math.sin(la), co = Math.cos(lo), so = Math.sin(lo);
      const u = cl * co * sun[0] + cl * so * sun[1] + sl * sun[2];
      const e = -so * sun[0] + co * sun[1];
      const n = -sl * co * sun[0] - sl * so * sun[1] + cl * sun[2];
      if (sinElOut) sinElOut[r * f.size + c] = u;
      if (sinElOut) sinElOut[r * f.size + c] = u;
      const el = Math.asin(Math.max(-1, Math.min(1, u))) / RAD;
      const az = ((Math.atan2(e, n) / RAD) % 360 + 360) % 360;
      const bin = Math.floor((az / 360) * f.bins) % f.bins;
      const hz = f.horizon[bin * f.size * f.size + r * f.size + c] * f.stepDeg + f.offsetDeg;
      out[r * f.size + c] = Math.max(0, Math.min(1, (el - hz) / SUN_DISC_DEG + 0.5));
    }
  }
  return out;
}

/** Paint shadow dark and sunlit ground warm onto a size×size canvas; the outer `fade` cells fade out. */
export function paintShadows(canvas: HTMLCanvasElement, f: ShadowField, lit: Float32Array, fade = 10) {
  canvas.width = f.size;
  canvas.height = f.size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(f.size, f.size);
  for (let r = 0; r < f.size; r++) {
    for (let c = 0; c < f.size; c++) {
      const i = r * f.size + c;
      const edge = Math.min(1, (Math.min(r, c, f.size - 1 - r, f.size - 1 - c) + 0.5) / fade);
      const l = lit[i];
      // Shadow: near-black blue; light: warm, faint, so the relief stays readable.
      img.data[i * 4 + 0] = Math.round(4 + l * 251);
      img.data[i * 4 + 1] = Math.round(6 + l * 164);
      img.data[i * 4 + 2] = Math.round(14 + l * 76);
      img.data[i * 4 + 3] = Math.round(edge * ((1 - l) * 215 + l * 70));
    }
  }
  ctx.putImageData(img, 0, 0);
}
