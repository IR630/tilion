"""BETA (#175): nearest cold-trap candidate for each site, from PGDA 69 average illumination.

Run from backend/:

    uv run python -m precompute.beta_psr --data <nasa data dir> --out ../web/public/data

A cold-trap candidate is a PGDA 69 AVGVISIB pixel equal to 0: the 18.6-year mean visible fraction
of the solar disc is 0 at the map precision (int16 x 4e-5). Permanent shadow, not detected ice.
Grids: 60 m square around the pole (85 S at the edge mid-points, AVGVISIB_85S_060M); 240 m where
the 60 m grid ends or a nearer patch may lie past its edge (AVGVISIB_65S_240M).
Distances are true distances: the stereographic chord divided by k at its mid-point.
Patches are 4-connected pixel regions. Areas are true areas: the pixel area divided by the
squared stereographic scale k = 1 + r^2 / 4R^2 (lat_ts = -90 deg).

Output (the beta UI in web/src/beta/psr/ is the only reader):
  beta/psr.json - per site: distance to the nearest patch edge pixel, its area, bearing, centroid.
  beta/psr_polygons.json - GeoJSON patches, polar stereographic metres, Douglas-Peucker simplified.
"""

import argparse
import json
from pathlib import Path

import numpy as np

from .geo import R, from_xy, to_xy, unit

GRIDS = (
    # name, file, minimum patch area km2, simplification tolerance m
    ("60m", "AVGVISIB_85S_060M_201608.TIF", 0.1, 60.0),
    ("240m", "AVGVISIB_65S_240M_201608.TIF", 1.0, 240.0),
)
SEARCH_KM = (5.0, 20.0, 80.0, 200.0)
LABEL = "cold-trap candidate (PGDA 69, never lit in 18.6 yr)"


class Grid:
    """PSR patches of one AVGVISIB grid: label raster, per-patch area and centroid."""

    def __init__(self, name: str, path: Path, min_km2: float, tol_m: float):
        import rasterio
        from rasterio import features
        from rasterio.transform import Affine

        with rasterio.open(path) as ds:
            a = ds.read(1)
            self.t = ds.transform
            nodata = ds.nodata
        self.name, self.file, self.min_km2, self.tol = name, path.name, min_km2, tol_m
        self.res = abs(self.t.a)
        self.valid = a != nodata if nodata is not None else np.ones(a.shape, bool)
        psr = (a == 0) & self.valid
        ny, nx = a.shape
        # Pixel centre coordinates and the true area of each pixel (km2).
        xs = self.t.c + (np.arange(nx) + 0.5) * self.t.a
        ys = self.t.f + (np.arange(ny) + 0.5) * self.t.e
        k = 1 + (xs[None, :] ** 2 + ys[:, None] ** 2) / (4 * R * R)
        px_km2 = (self.res / 1000.0) ** 2 / k**2
        # 4-connected regions in pixel coordinates; holes are lit pixels inside a patch.
        shapes = features.shapes(
            psr.astype(np.uint8), mask=psr, connectivity=4, transform=Affine.identity()
        )
        geoms = [g for g, _ in shapes]
        lab = features.rasterize(
            ((g, i + 1) for i, g in enumerate(geoms)),
            out_shape=a.shape,
            transform=Affine.identity(),
            dtype="int32",
        )
        n = len(geoms) + 1
        flat = lab.ravel()
        area = np.bincount(flat, px_km2.ravel(), n)
        cx = np.bincount(flat, (px_km2 * xs[None, :]).ravel(), n)
        cy = np.bincount(flat, (px_km2 * ys[:, None]).ravel(), n)
        keep = area >= min_km2
        keep[0] = False
        # Renumber: kept patches 1..m, the rest 0.
        remap = np.zeros(n, np.int32)
        remap[keep] = np.arange(1, keep.sum() + 1)
        self.lab = remap[lab]
        idx = np.flatnonzero(keep)
        self.area = np.concatenate([[0.0], area[idx]])
        self.cx = np.concatenate([[0.0], cx[idx] / area[idx]])
        self.cy = np.concatenate([[0.0], cy[idx] / area[idx]])
        self.geoms = [geoms[i - 1] for i in idx]
        self.total_km2 = float(area[idx].sum())
        self.all_km2 = float(area[1:].sum())

    def rc(self, x: float, y: float) -> tuple[int, int] | None:
        col, row = ~self.t @ (x, y)
        r, c = int(np.floor(row)), int(np.floor(col))
        if 0 <= r < self.lab.shape[0] and 0 <= c < self.lab.shape[1] and self.valid[r, c]:
            return r, c
        return None

    def nearest(self, x: float, y: float) -> tuple[float, int, float, float, float] | None:
        """(distance m, patch, px, py, edge m) - nearest patch pixel centre from (x, y).

        edge m = distance to the nearest pixel without data: a patch beyond it may be closer.
        """
        if self.rc(x, y) is None:
            return None
        for km in SEARCH_KM:
            h = int(km * 1000 / self.res)
            col, row = ~self.t @ (x, y)
            r0, r1 = max(int(row) - h, 0), min(int(row) + h + 1, self.lab.shape[0])
            c0, c1 = max(int(col) - h, 0), min(int(col) + h + 1, self.lab.shape[1])
            win = self.lab[r0:r1, c0:c1]
            rr, cc = np.nonzero(win)
            if len(rr) == 0:
                continue
            px = self.t.c + (c0 + cc + 0.5) * self.t.a
            py = self.t.f + (r0 + rr + 0.5) * self.t.e
            d = np.hypot(px - x, py - y) / scale((px + x) / 2, (py + y) / 2)
            i = int(np.argmin(d))
            # Only trust a hit closer than the window half-size (a nearer one may be just outside).
            if d[i] > h * self.res and km != SEARCH_KM[-1]:
                continue
            br, bc = np.nonzero(~self.valid[r0:r1, c0:c1])
            edge = float("inf")
            if len(br):
                bx = self.t.c + (c0 + bc + 0.5) * self.t.a
                by = self.t.f + (r0 + br + 0.5) * self.t.e
                edge = float((np.hypot(bx - x, by - y) / scale((bx + x) / 2, (by + y) / 2)).min())
            if r0 == 0 or c0 == 0 or r1 == self.lab.shape[0] or c1 == self.lab.shape[1]:
                edge = min(edge, self._frame_dist(x, y) / float(scale(x, y)))
            return float(d[i]), int(win[rr[i], cc[i]]), float(px[i]), float(py[i]), edge
        return None

    def _frame_dist(self, x: float, y: float) -> float:
        x0, y0 = self.t.c, self.t.f
        x1 = x0 + self.lab.shape[1] * self.t.a
        y1 = y0 + self.lab.shape[0] * self.t.e
        return float(min(x - x0, x1 - x, y0 - y, y - y1))

    def ring_m(self, ring) -> list[list[int]]:
        """Pixel-corner ring -> simplified ring in stereographic metres (rounded to 1 m)."""
        p = np.asarray(ring, float)
        xy = np.column_stack([self.t.c + p[:, 0] * self.t.a, self.t.f + p[:, 1] * self.t.e])
        s = douglas_peucker(xy, self.tol)
        return np.round(s).astype(int).tolist()


def scale(x, y):
    """Stereographic scale k = 1 + r^2 / 4R^2 (lat_ts = -90 deg): map metres per true metre."""
    return 1 + (np.square(x) + np.square(y)) / (4 * R * R)


def coverage(g: Grid) -> str:
    half = g.lab.shape[0] * g.res / 2
    mid = from_xy(half, 0.0)[1]
    corner = from_xy(half, half)[1]
    return (
        f"square grid: {abs(mid):.1f} S at the edge mid-points, {abs(corner):.1f} S at the corners"
    )


def douglas_peucker(pts: np.ndarray, tol: float) -> np.ndarray:
    """Douglas-Peucker on a closed ring (first point == last); keeps at least 4 points."""
    n = len(pts)
    if n <= 4:
        return pts
    keep = np.zeros(n, bool)
    # Split the closed ring at the point farthest from the start: two open chains.
    far = int(np.argmax(np.hypot(*(pts - pts[0]).T)))
    keep[[0, far, n - 1]] = True
    stack = [(0, far), (far, n - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2:
            continue
        a, b = pts[i], pts[j]
        seg = b - a
        ln = np.hypot(*seg)
        q = pts[i + 1 : j] - a
        d = np.abs(seg[0] * q[:, 1] - seg[1] * q[:, 0]) / ln if ln > 0 else np.hypot(*q.T)
        k = int(np.argmax(d))
        if d[k] > tol:
            m = i + 1 + k
            keep[m] = True
            stack += [(i, m), (m, j)]
    out = pts[keep]
    return out if len(out) >= 4 else pts[[0, n // 3, 2 * n // 3, n - 1]]


def ring_area(r: list[list[int]]) -> float:
    a = np.asarray(r, float)
    return 0.5 * abs(np.dot(a[:-1, 0], a[1:, 1]) - np.dot(a[1:, 0], a[:-1, 1]))


def bearing(x: float, y: float, tx: float, ty: float) -> float:
    """Azimuth (deg, from local north through east) from (x, y) to (tx, ty).

    South polar stereographic: north points away from the pole, east = (y, -x) / r.
    """
    r = np.hypot(x, y)
    dx, dy = tx - x, ty - y
    north = (dx * x + dy * y) / r
    east = (dx * y - dy * x) / r
    return float(np.degrees(np.arctan2(east, north)) % 360)


def latlon(x: float, y: float) -> dict:
    lon, lat = from_xy(x, y)
    return {"lat": round(float(lat), 4), "lonE": round(float(lon), 4)}


def site_entry(site: dict, grids: list[Grid]) -> dict | None:
    """Nearest patch from the finest grid that can see it; None outside both grids."""
    x, y = (float(v) for v in to_xy(unit(site["lonE"], site["lat"])))
    for g in grids:
        hit = g.nearest(x, y)
        if hit is None:
            continue
        d, p, px, py, edge = hit
        # A closer patch can hide past the edge of this grid: then ask the coarser grid.
        if edge < d and g is not grids[-1]:
            continue
        return {
            "grid": g.name,
            "distanceKm": round(d / 1000, 2),
            "areaKm2": round(float(g.area[p]), 2),
            "bearingDeg": round(bearing(x, y, px, py), 1) if d > 0 else None,
            "patch": f"{g.name}-{p}",
            "nearest": latlon(px, py),
            "centroid": latlon(g.cx[p], g.cy[p]),
        }
    return None


def polygons(grids: list[Grid]) -> dict:
    """GeoJSON patches. The 240 m grid adds only patches outside the 60 m grid coverage."""
    feats = []
    fine = grids[0]
    for g in grids:
        for i, geom in enumerate(g.geoms, start=1):
            if g is not fine and fine.rc(g.cx[i], g.cy[i]) is not None:
                continue
            rings = [g.ring_m(r) for r in geom["coordinates"]]
            outer, holes = rings[0], rings[1:]
            # Lit holes smaller than the minimum patch area are not drawn.
            holes = [h for h in holes if ring_area(h) / 1e6 >= g.min_km2]
            feats.append(
                {
                    "type": "Feature",
                    "properties": {"id": f"{g.name}-{i}", "areaKm2": round(float(g.area[i]), 2)},
                    "geometry": {"type": "Polygon", "coordinates": [outer, *holes]},
                }
            )
    return {
        "type": "FeatureCollection",
        "projection": "south polar stereographic, metres, R=1737400",
        "features": feats,
    }


def build(data: Path, out: Path) -> dict:
    grids = [Grid(n, data / "illum" / f, a, t) for n, f, a, t in GRIDS]
    sites = json.loads((out / "sites.json").read_text())["sites"]
    entries = {}
    for s in sites:
        if s.get("lat") is None or s.get("lonE") is None:
            continue
        e = site_entry(s, grids)
        if e is not None:
            entries[s["id"]] = e
    doc = {
        "label": LABEL,
        "definition": "PGDA 69 AVGVISIB pixel = 0: the 18.6-year mean visible fraction of the solar "
        "disc above the LOLA horizon is 0 at the map precision (4e-5). Permanent shadow, "
        "not detected ice.",
        "source": "https://pgda.gsfc.nasa.gov/products/69",
        "grids": [
            {
                "id": g.name,
                "file": g.file,
                "coverage": coverage(g),
                "minPatchKm2": g.min_km2,
                "patches": len(g.geoms),
                "patchAreaKm2": round(g.total_km2),
            }
            for g in grids
        ],
        "distance": "true distance to the nearest pixel centre of a patch; 0 = site in shadow",
        "polygons": "beta/psr_polygons.json",
        "sites": entries,
    }
    (out / "beta").mkdir(parents=True, exist_ok=True)
    (out / "beta" / "psr.json").write_text(json.dumps(doc, indent=1) + "\n")
    geo = polygons(grids)
    (out / "beta" / "psr_polygons.json").write_text(json.dumps(geo, separators=(",", ":")))
    return doc


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    doc = build(a.data, a.out)
    for g in doc["grids"]:
        print(
            f"{g['id']}: {g['patches']} patches >= {g['minPatchKm2']} km2, {g['patchAreaKm2']} km2"
        )
    for sid, e in doc["sites"].items():
        print(f"  {sid:24s} {e['grid']:4s} {e['distanceKm']:6.2f} km  {e['areaKm2']:8.2f} km2")


if __name__ == "__main__":
    main()
