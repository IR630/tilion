// Static assets of the custom point (#31, #100), written by backend `python -m precompute.custom`
// to web/public/data/custom/. Tile choice and decoders are shared by the Web Worker and the test.
import { type Dem, type Ephem, MAX_M, R, distances, toXY, unit } from "./horizon";

/** data/custom/meta.json */
export type CustomMeta = {
  startUtc: string;
  stepMin: number;
  n: number; // time steps in ephem.bin
  frame: "MOON_ME";
  abcorr: "LT+S";
  /** float32 LE, n × [Sun x, y, z, Earth x, y, z] km, selenocentric apparent vectors. */
  ephemFile: string;
  sunRadiusKm: number;
  earthRadiusKm: number;
  /**
   * The whole DEM grid (width × height px, top-left corner x0, y0) in tiles × tiles square tiles of
   * tilePx px: file `${dir}${row}-${col}.bin`, row 0 at the top. Each file is gzip of int16 LE 2D
   * differences inside the tile (value − left − up + up-left); height = value × scaleM.
   * A point takes terrain south of minLat.
   */
  dem: {
    dir: string;
    tilePx: number;
    tiles: number;
    minLat: number;
    source: string;
    width: number;
    height: number;
    x0: number;
    y0: number;
    dx: number;
    dy: number;
    scaleM: number;
  };
};

export type Tile = { row: number; col: number; file: string };

export function decodeEphem(buf: ArrayBuffer, m: CustomMeta): Ephem {
  const n = m.n * 6;
  if (buf.byteLength !== n * 4) throw new Error(`custom ephem: ${buf.byteLength} bytes, want ${n * 4}`);
  const dv = new DataView(buf);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = dv.getFloat32(i * 4, true);
  return { startUtc: m.startUtc, stepMin: m.stepMin, n: m.n, v, sunRadiusKm: m.sunRadiusKm, earthRadiusKm: m.earthRadiusKm };
}

/**
 * Tiles the horizon rays of a point can sample. The rays reach the cap of radius maxD around the
 * point; stereographic maps it to a circle whose diameter lies on the radial line from the pole.
 * A tile is taken when it comes within 2 px of that circle (the bilinear sample reads 1 px around).
 */
export function tilesFor(m: CustomMeta, lat: number, lonE: number): Tile[] {
  const g = m.dem;
  const d = distances(Math.abs(g.dx) / 2, MAX_M);
  const a = d[d.length - 1] / R; // cap radius, rad
  const th = ((90 + lat) * Math.PI) / 180; // colatitude from the south pole
  const r1 = 2 * R * Math.tan((th - a) / 2);
  const r2 = 2 * R * Math.tan((th + a) / 2);
  const [px, py] = toXY(...unit(lonE, lat));
  const rp = Math.hypot(px, py);
  const [ux, uy] = rp > 0 ? [px / rp, py / rp] : [0, 1];
  const cx = (ux * (r1 + r2)) / 2;
  const cy = (uy * (r1 + r2)) / 2;
  const rad = (r2 - r1) / 2 + 2 * Math.abs(g.dx);
  const size = g.tilePx * g.dx;
  const out: Tile[] = [];
  for (let row = 0; row < g.tiles; row++) {
    for (let col = 0; col < g.tiles; col++) {
      const xa = g.x0 + col * size;
      const ya = g.y0 - (row + 1) * size;
      const nx = Math.min(Math.max(cx, xa), xa + size);
      const ny = Math.min(Math.max(cy, ya), ya + size);
      if (Math.hypot(cx - nx, cy - ny) <= rad) out.push({ row, col, file: `${g.dir}${row}-${col}.bin` });
    }
  }
  return out;
}

/** One tile from its gzip file: heights in scaleM units, tilePx × tilePx. */
async function decodeTile(b: ArrayBuffer, px: number): Promise<Int16Array> {
  const s = new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(s).arrayBuffer();
  if (buf.byteLength !== px * px * 2) throw new Error(`custom DEM tile: ${buf.byteLength} bytes, want ${px * px * 2}`);
  const dv = new DataView(buf);
  const q = new Int16Array(px * px);
  for (let i = 0; i < q.length; i++) q[i] = dv.getInt16(i * 2, true);
  // Undo the 2D differences: sum down the columns, then along the rows. Int16Array stores wrap
  // like the numpy int16 cumulative sums of the encoder.
  for (let i = px; i < q.length; i++) q[i] += q[i - px];
  for (let i = 0; i < q.length; i++) if (i % px) q[i] += q[i - 1];
  return q;
}

/**
 * The DEM over the bounding box of the given tiles (parts[k] = file of tiles[k]). Pixels of tiles
 * not given hold `fill` (in scaleM units); tilesFor keeps the rays off them.
 */
export async function decodeDem(parts: ArrayBuffer[], tiles: Tile[], m: CustomMeta, fill = 0): Promise<Dem> {
  const g = m.dem;
  const px = g.tilePx;
  const r0 = Math.min(...tiles.map((t) => t.row));
  const c0 = Math.min(...tiles.map((t) => t.col));
  const width = (Math.max(...tiles.map((t) => t.col)) - c0 + 1) * px;
  const height = (Math.max(...tiles.map((t) => t.row)) - r0 + 1) * px;
  const q = new Int16Array(width * height).fill(fill);
  const decoded = await Promise.all(parts.map((b) => decodeTile(b, px)));
  tiles.forEach((t, k) => {
    const src = decoded[k];
    const off = (t.row - r0) * px * width + (t.col - c0) * px;
    for (let r = 0; r < px; r++) q.set(src.subarray(r * px, (r + 1) * px), off + r * width);
  });
  return {
    q,
    width,
    height,
    x0: g.x0 + c0 * px * g.dx,
    y0: g.y0 + r0 * px * g.dy,
    dx: g.dx,
    dy: g.dy,
    scaleM: g.scaleM,
  };
}
