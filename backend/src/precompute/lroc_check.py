"""Model cast shadows against LROC NAC images (issue #217, eval case S8, D-017).

Images: the source NAC L/R images of three LROC NAC DTM orthoimages (PDS RDR LROLRC_2001). The
orthoimages themselves cannot serve: shadows there are null (no DTM), so we project the calibrated
CDR (I/F, not map-projected) ourselves. Camera: LRO SPK and CK, LROC IK (focal length, boresight,
radial distortion), line time from START/STOP_TIME of the label; each ray goes to the LOLA terrain.
One translation per image corrects the pointing: the shift that best correlates our projection with
the PDS orthoimage on its valid (lit) pixels. The orthoimage also fixes the grid.

Grid: cells of whole orthoimage pixels, ~20 m (the LOLA 20 m DEM), centre window up to 8 x 8 km.
A cell with an empty pixel is left out.
Image shadow: cell mean I/F below the Otsu threshold of all valid cells. No morphology.
Model shadow: the upper limb of the Sun (SPICE, MOON_ME, LT+S, at the middle of the exposure) is
below the terrain horizon along the Sun's azimuth. Terrain: LOLA 20 m window, 80 m, 240 m beyond;
observer 0 m. The horizon is taken flat over the disc width (0.53 deg): lit = disc fraction > 0
(D-010). Bare sphere (baseline): the same rule with the horizon at 0 deg.

S9 (photometric image shadow, `photometric_shadow`): Otsu also calls dim sunlit slopes under a
grazing Sun shadow. S9 divides I/F by the Lommel-Seeliger term cos i / (cos i + cos e) of the
LOLA slope and cuts at a share of the median albedo (eval/cases.json S9). It is tuned on the S8
images (split dev) and scored on new images (split test) fixed before their download.

Data under <data>/lroc: orthoimages <ortho>.IMG, LRO kernels in spice/, CDR line ranges are read
over HTTP and cached as <image>_<first>_<last>.raw. Kernels come from the NAIF LRO PDS archive
(`kernels`): FK, IK, SCLK, the SPK that covers the image, and a slice of the spacecraft CK (a 10-day
CK is ~264 MB; we keep +-30 s around the image as a type 3 CK and delete the full file).
Output: <out>/lroc/index.json, <ortho>.json, <ortho>.webp (image), <ortho>_mask.webp (overlay).
Output also: <ortho>_mask9.webp (S9 overlay; grey = cell left out).
Run: cd backend && uv run python -m precompute.lroc_check --data ../data --out ../web/public/data
     [--split dev|test] [--fine ../data/lola/LDEM_80S_20MPP_ADJ.TIF]
"""

import argparse
import json
import re
import urllib.request
import warnings
from pathlib import Path

import numpy as np
import spiceypy as sp

from .ephem import load_kernels, topo, utc_to_et
from .geo import FINE_DEM, FINE_HALF_M, Dem, R, Terrain, distances, frame, from_xy, to_xy, unit

# (orthoimage product id, place, CDR paths of the NAC L and R source images, split)
# dev: the S8 images; S9 tunes its photometric rule on them. test: S9 (fixed before download) —
# the earliest orthoimage (lowest product id) of every other south-polar NAC DTM in LROLRC_2001
# (INDEX.TAB, MAXIMUM_LATITUDE <= -80). NOBILE04 (2025) is left out: its CDR is in no CDR volume
# index we could reach (HEAD probes, ODE), checked before any download.
IMAGES = [
    (
        "NAC_DTM_SHACKRDGE02_M139797542_350CM",
        "Shackleton–de Gerlache ridge",
        [
            "LROLRC_1005/DATA/SCI/2010265/NAC/M139797542LC",
            "LROLRC_1005/DATA/SCI/2010265/NAC/M139797542RC",
        ],
        "dev",
    ),
    (
        "NAC_DTM_MALAPERT03_M141080135_4M",
        "Malapert massif",
        [
            "LROLRC_1005/DATA/SCI/2010280/NAC/M141080135LC",
            "LROLRC_1005/DATA/SCI/2010280/NAC/M141080135RC",
        ],
        "dev",
    ),
    (
        "NAC_DTM_NOBILE02_M1101040045_4M",
        "Nobile crater, NW rim",
        [
            "LROLRC_1012/DATA/SCI/2012244/NAC/M1101040045LC",
            "LROLRC_1012/DATA/SCI/2012244/NAC/M1101040045RC",
        ],
        "dev",
    ),
    (
        "NAC_DTM_MALAPERT02_M139906018_4M",
        "Malapert massif, west",
        [
            "LROLRC_1005/DATA/SCI/2010266/NAC/M139906018LC",
            "LROLRC_1005/DATA/SCI/2010266/NAC/M139906018RC",
        ],
        "test",
    ),
    (
        "NAC_DTM_NOBILE01_M1098725033_3M",
        "Nobile crater, south",
        [
            "LROLRC_1012/DATA/SCI/2012217/NAC/M1098725033LC",
            "LROLRC_1012/DATA/SCI/2012217/NAC/M1098725033RC",
        ],
        "test",
    ),
    (
        "NAC_DTM_NOBILE03_M1101075756_4M",
        "Nobile crater, NE rim",
        [
            "LROLRC_1012/DATA/SCI/2012244/NAC/M1101075756LC",
            "LROLRC_1012/DATA/SCI/2012244/NAC/M1101075756RC",
        ],
        "test",
    ),
]
ORTHO_URL = "https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/{dtm}/{pid}.IMG"
CDR_URL = "https://pds.lroc.im-ldi.com/data/LRO-L-LROC-3-CDR-V1.0/{path}.IMG"
PAGE_URL = "https://data.lroc.im-ldi.com/lroc/view_rdr_product/{pid}"
NAIF_URL = "https://naif.jpl.nasa.gov/pub/naif/pds/data/lro-l-spice-6-v1.0/lrosp_1000/data/{path}"
STATIC_KERNELS = [
    "fk/lro_frames_2012255_v02.tf",
    "ik/lro_lroc_v20.ti",
    "sclk/lro_clkcor_2026167_v00.tsc",
]
LRO_CK_ID = -85000  # LRO_SC_BUS
CK_PAD_S = 30.0
CK_STEP_S = 0.02
CASES = Path(__file__).resolve().parents[3] / "eval" / "cases.json"
CASE_ID = "S8"
CASE9_ID = "S9"
CELL_M = 20.0
WINDOW_M = 8000.0
MAX_RAY_M = 300e3  # as horizon_mask
SEARCH_M = 300.0  # largest pointing shift searched
DISPLAY_FACTOR = 2  # grid pixels per display pixel
WEBP_QUALITY = 80
CHUNK = 1500  # cells per ray-march batch
LINE_CHUNK = 400  # image lines per projection batch
NAC = {"LEFT": ("LRO_LROCNACL", -85600), "RIGHT": ("LRO_LROCNACR", -85610)}
# Overlay colours (RGBA): both shadow, model shadow only, image shadow only; both lit = clear.
COLOURS = {
    "both": (60, 140, 255, 200),
    "model": (255, 60, 60, 220),
    "image": (255, 210, 0, 220),
}
EXCLUDED = (150, 150, 150, 160)  # S9: cell left out (grazing light, photometry cannot decide)


def otsu(v: np.ndarray, bins: int = 256) -> float:
    """Otsu threshold: the cut of a histogram that maximises the between-class variance."""
    hist, edges = np.histogram(v, bins=bins)
    mid = (edges[:-1] + edges[1:]) / 2
    w0 = np.cumsum(hist)
    w1 = w0[-1] - w0
    m0 = np.cumsum(hist * mid)
    with np.errstate(divide="ignore", invalid="ignore"):
        between = w0 * w1 * (m0 / w0 - (m0[-1] - m0) / w1) ** 2
    return float(edges[1:][np.nanargmax(between)])


def scores(image_shadow: np.ndarray, model_shadow: np.ndarray) -> tuple[float, float]:
    """(share of cells where both agree, %; IoU of the shadow class)."""
    agree = 100.0 * float(np.mean(image_shadow == model_shadow))
    union = np.sum(image_shadow | model_shadow)
    iou = float(np.sum(image_shadow & model_shadow) / union) if union else 1.0
    return agree, iou


def photometric_shadow(iof, cos_i, cos_e, case: dict):
    """S9 image shadow from Lommel-Seeliger photometry on the LOLA slope.

    A lit cell has I/F = A * P with P = cos i / (cos i + cos e) (cos i < 0 -> 0). A: median of
    I/F / P over cells with P >= ref_p (sun-facing slopes). Shadow: I/F < tau * A * max(P, min_p).
    Cells with 0 < P < min_p are left out: lit, they would be no brighter than the shadow cut.
    Returns (shadow, scored, A). Uses no cast-shadow model, only the local LOLA slope.
    """
    ci = np.clip(cos_i, 0.0, None)
    p = ci / (ci + cos_e)
    valid = ~np.isnan(iof)
    with np.errstate(divide="ignore", invalid="ignore"):
        albedo = float(np.median((iof / p)[valid & (p >= case["ref_p"])]))
    shadow = valid & (iof < case["tau"] * albedo * np.maximum(p, case["min_p"]))
    scored = valid & ~((p > 0) & (p < case["min_p"]))
    return shadow, scored, albedo


def best_shift(a: np.ndarray, b: np.ndarray, r: int, centre=(0, 0)) -> tuple[int, int, float]:
    """(dy, dx, correlation): a[y + dy, x + dx] matches b[y, x] best. NaN = no data."""
    h, w = b.shape
    best = (0, 0, -2.0)
    for dy in range(centre[0] - r, centre[0] + r + 1):
        for dx in range(centre[1] - r, centre[1] + r + 1):
            sa = a[max(dy, 0) : h + min(dy, 0), max(dx, 0) : w + min(dx, 0)]
            sb = b[max(-dy, 0) : h + min(-dy, 0), max(-dx, 0) : w + min(-dx, 0)]
            ok = ~(np.isnan(sa) | np.isnan(sb))
            if ok.sum() < 100:
                continue
            c = float(np.corrcoef(sa[ok], sb[ok])[0, 1])
            if c > best[2]:
                best = (dy, dx, c)
    return best


def shifted(a: np.ndarray, dy: int, dx: int) -> np.ndarray:
    """out[y, x] = a[y + dy, x + dx]; NaN where that is outside a."""
    h, w = a.shape
    out = np.full_like(a, np.nan)
    out[max(-dy, 0) : h + min(-dy, 0), max(-dx, 0) : w + min(-dx, 0)] = a[
        max(dy, 0) : h + min(dy, 0), max(dx, 0) : w + min(dx, 0)
    ]
    return out


def blocks(a: np.ndarray, k: int, strict: bool) -> np.ndarray:
    """k x k block means; strict: NaN if any pixel is NaN, else the mean of the valid pixels."""
    h, w = a.shape[0] // k * k, a.shape[1] // k * k
    b = a[:h, :w].reshape(h // k, k, w // k, k)
    if strict:
        return b.mean(axis=(1, 3))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-empty blocks
        return np.nanmean(b, axis=(1, 3))


def read_ortho(path: Path) -> dict:
    """Centre window of the orthoimage: I/F (NaN = null), grid geometry, cell size."""
    import rasterio
    from rasterio.windows import Window

    with rasterio.open(path) as ds:
        px = ds.transform.a
        k = round(CELL_M / px)
        cells = [min(n, round(WINDOW_M / px)) // k // 2 * 2 for n in (ds.height, ds.width)]
        h, w = cells[0] * k, cells[1] * k
        win = Window((ds.width - w) // 2, (ds.height - h) // 2, w, h)
        dn = ds.read(1, window=win)
        t = ds.window_transform(win)
        iof = np.where(dn != 0, dn * ds.scales[0] + ds.offsets[0], np.nan)  # DN 0 = CORE_NULL
    return {
        "iof": iof,
        "px": px,
        "k": k,
        "x0": t.c,
        "y0": t.f,
        "bounds": [t.c, t.f - h * px, t.c + w * px, t.f],
    }


def fetch(url: str, path: Path, first: int | None = None, last: int | None = None) -> bytes:
    """Bytes first..last of a URL (all if None), cached in path."""
    if not path.exists():
        req = urllib.request.Request(url)
        if first is not None:
            req.add_header("Range", f"bytes={first}-{last}")
        with urllib.request.urlopen(req, timeout=600) as r:
            data = r.read()
        if first is not None and len(data) != last - first + 1:
            raise OSError(f"{url}: got {len(data)} bytes, asked {last - first + 1}")
        path.write_bytes(data)
    return path.read_bytes()


def cdr_label(url: str, cache: Path) -> dict:
    """Keys of the attached PDS3 label of a NAC CDR."""
    text = fetch(url, cache / (url.rsplit("/", 1)[1][:-4] + ".LBL"), 0, 30000).decode(
        "ascii", "replace"
    )
    text = text.split("\nEND\r\n")[0].split("\nEND\n")[0]

    def key(k):
        return re.search(rf"^\s*{k}\s*=\s*\"?([^\"\s<]+)", text, re.MULTILINE).group(1)

    return {
        "start": key("START_TIME"),
        "stop": key("STOP_TIME"),
        "lines": int(key("LINES")),
        "samples": int(key("LINE_SAMPLES")),
        "summing": int(key("CROSSTRACK_SUMMING")),
        "frame": key("FRAME_ID"),
        "scale": float(key("SCALING_FACTOR")),
        "valid_min": int(key("VALID_MINIMUM")),
        "offset": (int(key(r"\^IMAGE")) - 1) * int(key("RECORD_BYTES")),
    }


def covering(kind: str, prefix: str, et: float) -> str:
    """Name of the NAIF LRO kernel <prefix>_<yyyyddd>_<yyyyddd>_vNN in data/<kind>/ that holds et."""
    with urllib.request.urlopen(NAIF_URL.format(path=f"{kind}/"), timeout=120) as r:
        names = set(re.findall(rf"{prefix}_\d{{7}}_\d{{7}}_v\d\d\.b\w+", r.read().decode()))
    day = sp.timout(et, "YYYYDOY ::UTC")
    hits = sorted(n for n in names if n.split("_")[1] <= day < n.split("_")[2])
    if not hits:
        raise ValueError(f"no {prefix} kernel for {day}")
    return hits[-1]  # highest version


def kernels(spice: Path, start: str, stop: str) -> None:
    """Load LRO kernels for an image taken start..stop (UTC); download and cache what is missing."""
    spice.mkdir(parents=True, exist_ok=True)
    for k in STATIC_KERNELS:
        path = spice / k.rsplit("/", 1)[1]
        fetch(NAIF_URL.format(path=k), path)
        sp.furnsh(str(path))
    t0, t1 = utc_to_et(start) - CK_PAD_S, utc_to_et(stop) + CK_PAD_S
    spk = covering("spk", "lrorg", t0)
    fetch(NAIF_URL.format(path=f"spk/{spk}"), spice / spk)
    sp.furnsh(str(spice / spk))
    tag = sp.timout(t0, "YYYYDOYHRMNSC ::UTC").replace(" ", "")
    part = spice / f"lrosc_slice_{tag}.bc"
    if not part.exists():
        ck = covering("ck", "lrosc", t0)
        full = spice / ck
        fetch(NAIF_URL.format(path=f"ck/{ck}"), full)
        sp.furnsh(str(full))
        ets = np.arange(t0, t1, CK_STEP_S)
        quats = np.array([sp.m2q(sp.pxform("J2000", "LRO_SC_BUS", t)) for t in ets])
        sclk = np.array([sp.sce2c(-85, t) for t in ets])
        sp.unload(str(full))
        handle = sp.ckopn(str(part), "CK", 0)
        sp.ckw03(handle, sclk[0], sclk[-1], LRO_CK_ID, "J2000", False, "lrosc slice",
                 len(ets), sclk, quats, np.zeros((len(ets), 3)), 1, [sclk[0]])  # fmt: skip
        sp.ckcls(handle)
        full.unlink()
    sp.furnsh(str(part))


def cdr_lines(url: str, lab: dict, first: int, last: int, cache: Path) -> np.ndarray:
    """I/F of image lines first..last (1-based, inclusive); NaN for null and special pixels."""
    row = lab["samples"] * 2
    name = f"{url.rsplit('/', 1)[1][:-4]}_{first}_{last}.raw"
    b = fetch(url, cache / name, lab["offset"] + (first - 1) * row, lab["offset"] + last * row - 1)
    dn = np.frombuffer(b, "<i2").reshape(last - first + 1, lab["samples"]).astype(np.float32)
    return np.where(dn >= lab["valid_min"], dn * lab["scale"], np.nan)


def nac_rays(lab: dict, lines: np.ndarray, samples: np.ndarray):
    """Spacecraft position (m) and unit look vectors in MOON_ME for image lines x samples (1-based).

    Line time: START_TIME + (line - 0.5) * (STOP - START) / LINES. Detector sample of a summed pixel:
    (sample - 0.5) * summing + 0.5. Focal plane y = TRANSY * (detector - boresight), radial
    distortion y / (1 + k y^2), look (0, y, f) in the NAC frame (LROC IK).
    """
    name, code = NAC[lab["frame"]]
    bs = sp.gdpool(f"INS{code}_BORESIGHT_SAMPLE", 0, 1)[0]
    f = sp.gdpool(f"INS{code}_FOCAL_LENGTH", 0, 1)[0]
    k = sp.gdpool(f"INS{code}_OD_K", 0, 1)[0]
    ty = sp.gdpool(f"INS{code}_TRANSY", 0, 3)[1]
    t0, t1 = utc_to_et(lab["start"]), utc_to_et(lab["stop"])
    dt = (t1 - t0) / lab["lines"]
    y = ty * ((samples - 0.5) * lab["summing"] + 0.5 - bs)
    y = y / (1 + k * y * y)
    look = np.stack([np.zeros_like(y), y, np.full_like(y, f)], axis=1)
    look /= np.linalg.norm(look, axis=1)[:, None]
    pos, rays = [], []
    for ln in lines:
        t = t0 + (ln - 0.5) * dt
        pos.append(sp.spkpos("LRO", t, "MOON_ME", "NONE", "MOON")[0] * 1000.0)
        rays.append(look @ sp.pxform(name, "MOON_ME", t).T)
    return np.array(pos), np.array(rays)


def hit(pos: np.ndarray, rays: np.ndarray, terrain: Terrain, h0: float, steps: int = 6):
    """Map x, y (m) where rays from pos meet the terrain (sphere R + h, h updated from the DEM)."""
    h = np.full(rays.shape[:-1], h0)
    p = pos[:, None, :] if rays.ndim == 3 else pos
    for _ in range(steps):
        rh = R + h
        b = np.sum(p * rays, axis=-1)
        tau = -b - np.sqrt(b * b - (np.sum(p * p, axis=-1) - rh * rh))
        q = p + tau[..., None] * rays
        x, y = to_xy(q / np.linalg.norm(q, axis=-1)[..., None])
        hn = sample(terrain, x.ravel(), y.ravel()).reshape(x.shape)
        h = np.where(np.isnan(hn), h, hn)
    return x, y


def project(url: str, g: dict, terrain: Terrain, cache: Path):
    """Mean I/F of one NAC CDR on the window grid (NaN = no image pixel), and the sum and count of
    spacecraft positions (m, MOON_ME) over the pixels that land in the window."""
    lab = cdr_label(url, cache)
    xmin, ymin, xmax, ymax = g["bounds"]
    cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2
    h0 = float(sample(terrain, np.array([cx]), np.array([cy]))[0])
    # Lines whose first, middle or last pixel lands in the window (every 50th line, then padded).
    probe = np.arange(1, lab["lines"] + 1, 50)
    edge = np.array([1.0, lab["samples"] / 2, lab["samples"]])
    x, y = hit(*nac_rays(lab, probe, edge), terrain, h0, steps=2)
    inside = ((x > xmin) & (x < xmax) & (y > ymin) & (y < ymax)).any(axis=1)
    if not inside.any():
        raise ValueError(f"{url}: no line over the window")
    first = max(1, int(probe[inside][0]) - 100)
    last = min(lab["lines"], int(probe[inside][-1]) + 100)
    px = g["px"]
    shape = g["iof"].shape
    total = np.zeros(shape[0] * shape[1])
    count = np.zeros_like(total)
    samples = np.arange(1, lab["samples"] + 1, dtype=float)
    iof_all = cdr_lines(url, lab, first, last, cache)
    pos_sum, n = np.zeros(3), 0
    for a in range(first, last + 1, LINE_CHUNK):
        b = min(last, a + LINE_CHUNK - 1)
        pos, rays = nac_rays(lab, np.arange(a, b + 1), samples)
        x, y = hit(pos, rays, terrain, h0)
        col = np.floor((x - g["x0"]) / px).astype(int)
        row = np.floor((g["y0"] - y) / px).astype(int)
        v = iof_all[a - first : b - first + 1]
        ok = (col >= 0) & (col < shape[1]) & (row >= 0) & (row < shape[0]) & ~np.isnan(v)
        idx = row[ok] * shape[1] + col[ok]
        total += np.bincount(idx, v[ok], total.size)
        count += np.bincount(idx, minlength=total.size)
        pos_sum += (pos * ok.sum(axis=1)[:, None]).sum(axis=0)
        n += int(ok.sum())
    with np.errstate(invalid="ignore"):
        return (total / count).reshape(shape), pos_sum, n


def sample(terrain: Terrain, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Terrain.sample that reads a coarser DEM only where the finer one has no data."""
    v = terrain.dems[0].sample(x, y)
    for d in terrain.dems[1:]:
        m = np.isnan(v)
        if m.any():
            v[m] = d.sample(x[m], y[m])
    return v


def sun_horizon(terrain: Terrain, x, y, sun: np.ndarray, max_m: float = MAX_RAY_M):
    """Sun elevation and terrain horizon elevation along the Sun's azimuth (deg) for points x, y.

    sun: unit vector to the Sun in MOON_ME. Rays follow great circles; observer on the ground.
    Missing terrain counts as -90 deg.
    """
    x, y = np.asarray(x, float).ravel(), np.asarray(y, float).ravel()
    up = unit(*from_xy(x, y)).T
    sin_el = up @ sun
    d = sun[None, :] - sin_el[:, None] * up
    d /= np.linalg.norm(d, axis=1)[:, None]
    psi = distances(terrain.step / 2, max_m) / R
    ro = R + sample(terrain, x, y)
    hz = np.empty_like(x)
    for i in range(0, len(x), CHUNK):
        s = slice(i, i + CHUNK)
        p = np.cos(psi)[None, :, None] * up[s, None, :] + np.sin(psi)[None, :, None] * d[s, None, :]
        px, py = to_xy(p)
        rq = R + sample(terrain, px.ravel(), py.ravel()).reshape(px.shape)
        r0 = ro[s, None]
        vert = rq * np.cos(psi) - r0
        dist = np.sqrt(rq**2 + r0**2 - 2 * rq * r0 * np.cos(psi))
        el = np.degrees(np.arcsin(vert / dist))
        hz[s] = np.where(np.isnan(el), -90.0, el).max(axis=1)
    return np.degrees(np.arcsin(sin_el)), hz


def incidence(terrain: Terrain, x, y, sun: np.ndarray, craft: np.ndarray, d: float = 20.0):
    """cos i and cos e of the LOLA surface at points x, y (normal from +-d m central differences).

    sun: unit vector to the Sun; craft: spacecraft position (m), both MOON_ME.
    """

    def point(px, py):
        h = sample(terrain, px.ravel(), py.ravel()).reshape(px.shape)
        return (R + h)[..., None] * unit(*from_xy(px, py)).transpose(*range(1, px.ndim + 1), 0)

    x, y = np.asarray(x, float), np.asarray(y, float)
    n = np.cross(point(x + d, y) - point(x - d, y), point(x, y + d) - point(x, y - d))
    n /= np.linalg.norm(n, axis=-1)[..., None]
    p = point(x, y)
    n *= np.sign(np.sum(n * p, axis=-1))[..., None]  # outward
    v = craft - p
    v /= np.linalg.norm(v, axis=-1)[..., None]
    return n @ sun, np.sum(n * v, axis=-1)


def sun_vector(az: float, el: float, lon_e: float, lat: float) -> np.ndarray:
    """Unit vector in MOON_ME from local azimuth and elevation at (lon_e, lat)."""
    up, east, north = frame(lon_e, lat)
    a, e = np.radians(az), np.radians(el)
    return np.cos(e) * (np.cos(a) * north + np.sin(a) * east) + np.sin(e) * up


def to_grey(show: np.ndarray) -> np.ndarray:
    """Stretch the 1..99 percentiles of valid pixels to 8 bit; empty pixels black."""
    lo, hi = np.nanpercentile(show, [1, 99])
    g = np.clip((show - lo) / max(hi - lo, 1e-9), 0, 1) * 255
    return np.where(np.isnan(show), 0, g).round().astype(np.uint8)


def write_webp(bands: np.ndarray, path: Path, lossless: bool = False) -> None:
    """(h, w, n) uint8 as WebP; n = 3 (RGB) or 4 (RGBA)."""
    import rasterio
    from rasterio.errors import NotGeoreferencedWarning

    h, w, n = bands.shape
    opts = {"LOSSLESS": "TRUE"} if lossless else {"QUALITY": WEBP_QUALITY}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", NotGeoreferencedWarning)  # a picture, not a GeoTIFF
        with rasterio.open(
            path, "w", driver="WEBP", width=w, height=h, count=n, dtype="uint8", **opts
        ) as ds:
            for b in range(n):
                ds.write(bands[..., b], b + 1)


def overlay(image_shadow, model_shadow, valid, excluded=None) -> np.ndarray:
    rgba = np.zeros((*valid.shape, 4), np.uint8)
    if excluded is not None:
        rgba[excluded] = EXCLUDED
    for name, m in (
        ("both", image_shadow & model_shadow),
        ("model", model_shadow & ~image_shadow),
        ("image", image_shadow & ~model_shadow),
    ):
        rgba[m & valid] = COLOURS[name]
    return rgba


def verdict(agree: float, iou: float, sphere: float, case: dict) -> tuple[bool, str]:
    need_a, need_i = case["min_agreement"], case["min_iou"]
    fails = []
    if agree < need_a:
        fails.append(f"agreement {agree:.1f} % < {need_a:g} %")
    if iou < need_i:
        fails.append(f"shadow IoU {iou:.2f} < {need_i:g}")
    if agree <= sphere:
        fails.append(f"no better than the bare sphere ({sphere:.1f} %)")
    if fails:
        return False, "; ".join(fails)
    return True, (
        f"agreement {agree:.1f} % ≥ {need_a:g} %, shadow IoU {iou:.2f} ≥ {need_i:g}, "
        f"bare sphere {sphere:.1f} %"
    )


def verdict9(agree: float, iou: float, sphere: float, excluded: float, case: dict):
    ok, reason = verdict(agree, iou, sphere, case)
    if excluded > case["max_excluded"]:
        bad = f"left out {excluded:.1f} % > {case['max_excluded']:g} %"
        return False, bad if ok else f"{reason}; {bad}"
    return ok, f"{reason}, left out {excluded:.1f} %" if ok else reason


def check_image(pid, place, cdrs, split, data: Path, out: Path, fine, dems, case, case9) -> dict:
    cache = data / "lroc"
    fetch(ORTHO_URL.format(dtm=pid.split("_")[2], pid=pid), cache / f"{pid}.IMG")
    g = read_ortho(cache / f"{pid}.IMG")
    xmin, ymin, xmax, ymax = g["bounds"]
    cx, cy = (xmin + xmax) / 2, (ymin + ymax) / 2
    half = max(xmax - xmin, ymax - ymin) / 2
    terrain = Terrain(Dem(fine, (cx, cy, half + FINE_HALF_M)), *dems)

    # Our projection of the L and R images; L wins where they overlap.
    labs = [cdr_label(CDR_URL.format(path=p), cache) for p in cdrs]
    kernels(cache / "spice", min(b["start"] for b in labs), max(b["stop"] for b in labs))
    img = np.full(g["iof"].shape, np.nan)
    pos_sum, n_pos = np.zeros(3), 0
    for path in cdrs:
        url = CDR_URL.format(path=path)
        part, ps, n = project(url, g, terrain, cache)
        img = np.where(np.isnan(img), part, img)
        pos_sum, n_pos = pos_sum + ps, n_pos + n
    craft = pos_sum / n_pos  # mean LRO position over the window pixels
    # One pointing shift: coarse on 4 x 4 blocks, then fine on grid pixels.
    r = int(SEARCH_M / g["px"] / 4)
    cy4, cx4, _ = best_shift(blocks(img, 4, False), blocks(g["iof"], 4, False), r)
    dy, dx, corr = best_shift(img, g["iof"], 4, (cy4 * 4, cx4 * 4))
    img = shifted(img, dy, dx)

    start = min(lab["start"] for lab in labs)
    stop = max(lab["stop"] for lab in labs)
    et = (utc_to_et(start) + utc_to_et(stop)) / 2
    mid = sp.et2utc(et, "ISOC", 1)
    lon, lat = (float(v) for v in from_xy(cx, cy))
    az, el, rad = (float(v[0]) for v in topo("SUN", [et], lon, lat))
    sun = sun_vector(az, el, lon, lat)

    cell = blocks(img, g["k"], True)
    k_m = g["k"] * g["px"]
    xs = xmin + (np.arange(cell.shape[1]) + 0.5) * k_m
    ys = ymax - (np.arange(cell.shape[0]) + 0.5) * k_m
    xx, yy = np.meshgrid(xs, ys)
    sun_el, hz = sun_horizon(terrain, xx, yy, sun)
    model_shadow = (sun_el + rad <= hz).reshape(xx.shape)
    sphere_shadow = (sun_el + rad <= 0).reshape(xx.shape)
    cos_i, cos_e = incidence(terrain, xx, yy, sun, craft)
    np.savez(cache / f"{pid}_cells.npz", cell=cell, cast=model_shadow, sphere=sphere_shadow,
             cos_i=cos_i, cos_e=cos_e)  # fmt: skip
    valid = ~np.isnan(cell)
    t = otsu(cell[valid])
    image_shadow = np.where(valid, cell < t, False)
    agree, iou = scores(image_shadow[valid], model_shadow[valid])
    sphere, _ = scores(image_shadow[valid], sphere_shadow[valid])
    ok, reason = verdict(agree, iou, sphere, case)
    # Diagnostic, not the pass rule (added after run 2): share of model-shadow cells that are dark.
    n_model = int(model_shadow[valid].sum())
    precision = (
        100.0 * float((image_shadow & model_shadow)[valid].sum()) / n_model if n_model else None
    )
    # S9: photometric image shadow, scored on the cells photometry can decide.
    shadow9, scored9, albedo = photometric_shadow(cell, cos_i, cos_e, case9)
    agree9, iou9 = scores(shadow9[scored9], model_shadow[scored9])
    sphere9, _ = scores(shadow9[scored9], sphere_shadow[scored9])
    excluded9 = 100.0 * (1.0 - float(scored9.sum()) / float(valid.sum()))
    ok9, reason9 = verdict9(agree9, iou9, sphere9, excluded9, case9)

    grey = to_grey(blocks(img, DISPLAY_FACTOR, False))
    write_webp(np.repeat(grey[..., None], 3, axis=2), out / f"{pid}.webp")
    write_webp(overlay(image_shadow, model_shadow, valid), out / f"{pid}_mask.webp", lossless=True)
    rgba9 = overlay(shadow9, model_shadow, scored9, valid & ~scored9)
    write_webp(rgba9, out / f"{pid}_mask9.webp", lossless=True)
    ids = sorted({p.rsplit("/", 1)[1] for p in cdrs})
    meta = {
        "id": pid,
        "place": place,
        "split": split,
        "images": ids,
        "imageUrls": [CDR_URL.format(path=p) for p in cdrs],
        "orthoUrl": ORTHO_URL.format(dtm=pid.split("_")[2], pid=pid),
        "page": PAGE_URL.format(pid=pid),
        "startUtc": start,
        "stopUtc": stop,
        "midUtc": mid,
        "pixelM": g["px"],
        "cellM": round(k_m, 2),
        "bounds": [round(v, 2) for v in g["bounds"]],
        "centre": {"lonE": round(lon, 4), "lat": round(lat, 4)},
        "sun": {"az": round(az, 3), "el": round(el, 3), "radius": round(rad, 4)},
        "shiftM": [round(dx * g["px"], 1), round(-dy * g["px"], 1)],
        "shiftCorrelation": round(corr, 3),
        "cells": int(valid.sum()),
        "otsuIof": round(t, 5),
        "imageShadowPct": round(100.0 * float(image_shadow[valid].mean()), 1),
        "modelShadowPct": round(100.0 * float(model_shadow[valid].mean()), 1),
        "agreementPct": round(agree, 1),
        "shadowIou": round(iou, 3),
        "sphereAgreementPct": round(sphere, 1),
        "modelShadowDarkPct": None if precision is None else round(precision, 1),
        "minAgreementPct": case["min_agreement"],
        "minIou": case["min_iou"],
        "pass": ok,
        "reason": reason,
        "image": f"{pid}.webp",
        "mask": f"{pid}_mask.webp",
        "terrain": "LOLA 20 m window, 80 m, 240 m beyond (PGDA 90)",
        "s9": {
            "albedo": round(albedo, 4),
            "excludedPct": round(excluded9, 1),
            "imageShadowPct": round(100.0 * float(shadow9[scored9].mean()), 1),
            "modelShadowPct": round(100.0 * float(model_shadow[scored9].mean()), 1),
            "agreementPct": round(agree9, 1),
            "shadowIou": round(iou9, 3),
            "sphereAgreementPct": round(sphere9, 1),
            "pass": ok9,
            "reason": reason9,
            "mask": f"{pid}_mask9.webp",
        },
    }
    (out / f"{pid}.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    return meta


def run(data: Path, out: Path, fine=FINE_DEM, split: str = "all") -> list[dict]:
    cases = {c["id"]: c for c in json.loads(CASES.read_text(encoding="utf-8"))}
    case, case9 = cases[CASE_ID], cases[CASE9_ID]
    load_kernels(data / "spice")
    dems = [
        Dem(data / "lola" / "LDEM_80S_80MPP_ADJ.TIF"),
        Dem(data / "lola" / "LDEM_60S_240MPP_ADJ.TIF"),
    ]
    out = out / "lroc"
    out.mkdir(parents=True, exist_ok=True)
    metas = []
    for pid, place, cdrs, part in IMAGES:
        if split not in ("all", part):
            continue
        m = check_image(pid, place, cdrs, part, data, out, fine, dems, case, case9)
        m9 = m["s9"]
        print(
            f"{part:4s} {pid:38s} sun el {m['sun']['el']:6.3f}  shift {m['shiftM']} m "
            f"r {m['shiftCorrelation']}\n"
            f"  S8 agree {m['agreementPct']:5.1f} %  IoU {m['shadowIou']:.3f}  "
            f"sphere {m['sphereAgreementPct']:5.1f} %  {'PASS' if m['pass'] else 'FAIL'}\n"
            f"  S9 agree {m9['agreementPct']:5.1f} %  IoU {m9['shadowIou']:.3f}  "
            f"sphere {m9['sphereAgreementPct']:5.1f} %  left out {m9['excludedPct']:.1f} %  "
            f"A {m9['albedo']}  {'PASS' if m9['pass'] else 'FAIL'}: {m9['reason']}"
        )
        metas.append(m)
    index = {
        "ids": [p for p, *_ in IMAGES if (out / f"{p}.json").exists()],
        "rule": case["rule"],
        "rule9": case9["rule"],
    }
    (out / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1))
    return metas


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--fine", default=FINE_DEM, help="LOLA 20 m DEM (local path or /vsicurl/ URL)")
    ap.add_argument("--split", default="all", choices=["all", "dev", "test"])
    a = ap.parse_args()
    run(a.data, a.out, a.fine, a.split)
