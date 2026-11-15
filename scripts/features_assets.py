"""Official IAU lunar feature names for the navigator map and search (#147).

Usage (from backend/):
    uv run --frozen python ../scripts/features_assets.py --data <repo>/data

Source: IAU Gazetteer of Planetary Nomenclature (USGS Astrogeology, public domain),
https://planetarynames.wr.usgs.gov/ — the Moon centre-point shapefile bundle
https://planetarynames.wr.usgs.gov/shapefiles/MOON_nomenclature_center_pts.zip, downloaded once
into data/gazetteer/ (see data/README.md). Only the .dbf table is read (stdlib: zipfile + struct).
In the table center_lon is already 0-360 degE; the script still normalises it.

Output: web/public/data/features.json
    {"source", "url", "file", "downloadedUtc", "count",
     "features": [{"id", "name", "type", "lat", "lonE", "diameterKm", "url"}]}
Filter: approval "Adopted by IAU", center_lat <= -60. Sorted by diameter, largest first.
"""

import argparse
import json
import struct
import zipfile
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_DATA = ROOT / "web" / "public" / "data"
BUNDLE = "gazetteer/MOON_nomenclature_center_pts.zip"
BUNDLE_URL = "https://planetarynames.wr.usgs.gov/shapefiles/MOON_nomenclature_center_pts.zip"
LAT_MAX = -60.0

# Gazetteer descriptor ("Crater, craters") -> short type for the map.
TYPES = {
    "Crater, craters": "crater",
    "Satellite Feature": "satellite crater",
    "Mons, montes": "mons",
    "Montes": "montes",
    "Rupes, rupēs": "rupes",
    "Vallis, valles": "vallis",
    "Lacus, lacūs": "lacus",
    "Statio": "statio",
    "Dorsum, dorsa": "dorsum",
    "Rima, rimae": "rima",
    "Catena, catenae": "catena",
    "Promontorium, promontoria": "promontorium",
    "Mare, maria": "mare",
    "Planitia, planitiae": "planitia",
    "Sinus, sinūs": "sinus",
}


def read_dbf(data: bytes) -> list[dict[str, str]]:
    """dBASE III table -> list of {field: stripped text}. Deleted records are skipped."""
    n, header_len, rec_len = struct.unpack("<IHH", data[4:12])
    fields, o = [], 32
    while data[o] != 0x0D:
        name = data[o : o + 11].split(b"\0")[0].decode("ascii")
        fields.append((name, data[o + 16]))
        o += 32
    rows = []
    for i in range(n):
        r = data[header_len + i * rec_len : header_len + (i + 1) * rec_len]
        if r[:1] == b"*":
            continue
        p, row = 1, {}
        for name, length in fields:
            row[name] = r[p : p + length].decode("utf-8", "replace").strip()
            p += length
        rows.append(row)
    return rows


def short_type(descriptor: str) -> str:
    return TYPES.get(descriptor, descriptor.split(",")[0].strip().lower())


def polar_features(rows: list[dict[str, str]], lat_max: float = LAT_MAX) -> list[dict]:
    """Approved names at lat <= lat_max, compact records, largest first."""
    out = []
    for r in rows:
        if r.get("approval") != "Adopted by IAU":
            continue
        lat = float(r["center_lat"])
        if lat > lat_max:
            continue
        lon = float(r["center_lon"]) % 360.0
        link = r.get("link", "").replace("http://", "https://")
        fid = link.rstrip("/").rsplit("/", 1)[-1] if "/Feature/" in link else r["clean_name"]
        out.append(
            {
                "id": fid,
                "name": r["name"] or r["clean_name"],
                "type": short_type(r["type"]),
                "lat": round(lat, 4),
                "lonE": round(lon, 4),
                "diameterKm": round(float(r["diameter"] or 0), 2),
                "url": link,
            }
        )
    out.sort(key=lambda f: (-f["diameterKm"], f["name"]))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "data")
    ap.add_argument("--out", type=Path, default=WEB_DATA)
    a = ap.parse_args()
    src = a.data / BUNDLE
    with zipfile.ZipFile(src) as z:
        dbf = next(n for n in z.namelist() if n.lower().endswith(".dbf"))
        rows = read_dbf(z.read(dbf))
    feats = polar_features(rows)
    downloaded = datetime.fromtimestamp(src.stat().st_mtime, UTC).strftime("%Y-%m-%dT%H:%MZ")
    doc = {
        "source": "IAU Gazetteer of Planetary Nomenclature, USGS Astrogeology (public domain)",
        "url": BUNDLE_URL,
        "file": dbf,
        "downloadedUtc": downloaded,
        "filter": f"approval = Adopted by IAU, center_lat <= {LAT_MAX:g}",
        "count": len(feats),
        "features": feats,
    }
    out = a.out / "features.json"
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    out.write_text(text.replace('},{"id"', '},\n{"id"') + "\n", encoding="utf-8")
    print(f"features.json: {len(feats)} of {len(rows)} names, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
