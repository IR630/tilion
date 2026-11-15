// Long-term mean Sun and Earth visibility at any point (#148): numeric PGDA 69 grids written by
// scripts/illum_grid_assets.py (uint8 percent, 255 = no data, gzip). The basemap WebP overlays are
// colour images for display only and are never sampled. 85°S grid (240 m cells) first, then the
// 65°S grid (960 m cells); outside both: no data.
import { stereoXY } from "../format";

export type GridMeta = { id: string; kind: "sun" | "earth"; file: string; size: number; bounds: number[]; cellM: number };
export type Grid = GridMeta & { data: Uint8Array };
export const NODATA = 255;

/** Cell of a point: row 0 = +y (lon 0°E side), col 0 = −x, like the source GeoTIFF. */
export function cellOf(g: Pick<GridMeta, "size" | "bounds" | "cellM">, lat: number, lonE: number): [number, number] | null {
  const [x, y] = stereoXY(lat, lonE);
  const col = Math.floor((x - g.bounds[0]) / g.cellM);
  const row = Math.floor((g.bounds[3] - y) / g.cellM);
  return row >= 0 && row < g.size && col >= 0 && col < g.size ? [row, col] : null;
}

export type Sample = { pct: number; cellM: number };
/** Value of the finest grid of a kind that covers the point; null = no data. */
export function sample(grids: Grid[], kind: "sun" | "earth", lat: number, lonE: number): Sample | null {
  const own = grids.filter((g) => g.kind === kind).sort((a, b) => a.cellM - b.cellM);
  for (const g of own) {
    const rc = cellOf(g, lat, lonE);
    if (!rc) continue;
    const v = g.data[rc[0] * g.size + rc[1]];
    if (v !== NODATA) return { pct: v, cellM: g.cellM };
  }
  return null;
}

async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const b = new Uint8Array(buf);
  // A server may already have removed the gzip layer (Content-Encoding): then the bytes are raw.
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
  const stream = new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let meta: Promise<GridMeta[]> | null = null;
const files = new Map<string, Promise<Grid>>();
const base = () => `${import.meta.env.BASE_URL}data/illum/`;

function loadGrid(g: GridMeta): Promise<Grid> {
  let p = files.get(g.id);
  if (!p) {
    p = fetch(base() + g.file, { signal: AbortSignal.timeout(15000) })
      .then(async (r) => {
        if (!r.ok) throw new Error(`${g.file}: HTTP ${r.status}`);
        const data = await gunzip(await r.arrayBuffer());
        if (data.length !== g.size * g.size) throw new Error(`${g.file}: ${data.length} bytes`);
        return { ...g, data };
      })
      .catch((e) => {
        files.delete(g.id);
        throw e;
      });
    files.set(g.id, p);
  }
  return p;
}

/** Grids chosen by `pick` (default all, about 3 MB), each file fetched once on first use. Failed loads can be retried. */
export function loadIllumGrids(pick: (all: GridMeta[]) => GridMeta[] = (all) => all): Promise<Grid[]> {
  meta ??= fetch(`${base()}meta.json`, { signal: AbortSignal.timeout(15000) })
    .then((r) => {
      if (!r.ok) throw new Error(`illum/meta.json: HTTP ${r.status}`);
      return r.json() as Promise<{ grids: GridMeta[] }>;
    })
    .then((m) => m.grids)
    .catch((e) => {
      meta = null;
      throw e;
    });
  return meta.then((all) => Promise.all(pick(all).map(loadGrid)));
}

/** #372: only the finest grids that cover the point (near the pole the 85°S pair, 1.4 MB of 3.3 MB). */
export const coveringPoint = (lat: number, lonE: number) => (all: GridMeta[]) => {
  const cover = all.filter((g) => cellOf(g, lat, lonE));
  const finest = Math.min(...cover.map((g) => g.cellM));
  return cover.filter((g) => g.cellM === finest);
};
