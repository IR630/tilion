#!/usr/bin/env bash
# Downloads NASA source data into data/ (outside git). Resumable: run again after a failure.
# Usage: bash scripts/fetch-data.sh [data dir]   (default: data/ of this checkout)
set -uo pipefail
D="${1:-$(git rev-parse --show-toplevel)/data}"
mkdir -p "$D/spice" "$D/lola" "$D/lola5" "$D/illum" "$D/lroc" "$D/diviner"
FAILED=0
remote_size() { curl -sS -m 60 -r 0-0 -D - -o /dev/null "$1" | tr -d '\r' | awk -F/ 'tolower($0) ~ /^content-range/ {print $2}'; }
get() { # url, target; the PGDA server drops long connections, so resume up to 8 times
  local i total have
  total="$(remote_size "$1")"
  for i in 1 2 3 4 5 6 7 8; do
    have="$(stat -c %s "$2" 2>/dev/null || echo 0)"
    [ -n "$total" ] && [ "$have" = "$total" ] && return 0
    curl -sS -L --fail -C - -m 3000 -o "$2" "$1" && return 0
    sleep 3
  done
  echo "FAIL $1" >&2; return 1
}
# getp url target [parts]: big file in parallel byte ranges (PGDA gives ~0.3 MB/s per connection).
# Each part resumes on its own; the parts are joined only when all are complete (#149).
getp() {
  local url="$1" out="$2" n="${3:-8}" total chunk i s e want pids=() bad=0
  total="$(remote_size "$url")"
  [ -n "$total" ] || { echo "FAIL size $url" >&2; return 1; }
  [ "$(stat -c %s "$out" 2>/dev/null || echo 0)" = "$total" ] && return 0
  chunk=$(( (total + n - 1) / n ))
  for i in $(seq 0 $((n - 1))); do
    s=$((i * chunk)); e=$((s + chunk - 1)); [ "$e" -ge "$total" ] && e=$((total - 1))
    want=$((e - s + 1))
    ( local k have
      for k in $(seq 1 30); do
        have="$(stat -c %s "$out.part$i" 2>/dev/null || echo 0)"
        [ "$have" -ge "$want" ] && exit 0
        curl -sS -L --fail -m 3000 -r "$((s + have))-$e" "$url" >>"$out.part$i" || sleep 3
      done
      exit 1 ) & pids+=($!)
  done
  for i in "${pids[@]}"; do wait "$i" || bad=1; done
  [ "$bad" -eq 0 ] || { echo "FAIL $url" >&2; return 1; }
  # Join part by part and drop each part at once: the disk needs ~1x the file, not 2x (#149).
  : >"$out.tmp"
  for i in $(seq 0 $((n - 1))); do cat "$out.part$i" >>"$out.tmp" && rm -f "$out.part$i" || return 1; done
  mv "$out.tmp" "$out"
  [ "$(stat -c %s "$out")" = "$total" ] || { echo "FAIL size $out" >&2; return 1; }
}
N=https://naif.jpl.nasa.gov/pub/naif/generic_kernels
P=https://pgda.gsfc.nasa.gov/data
# Same-DEM check (#270): the 120 m PGDA 69 map and the LOLA DEM its label names (PDS keeps file names lower case).
G=https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img
I=https://imbrium.mit.edu/EXTRAS/ILLUMINATION/IMG
# Thermal check (#277): Diviner South Polar Resource Product (Paige et al. 2010).
V=https://pds-geosciences.wustl.edu/lro/urn-nasa-pds-lro_diviner_derived1/data_derived_prp
# PGDA gives ~160 KB/s per connection: files go in parallel.
PIDS=()
while read -r url target; do
  get "$url" "$D/$target" & PIDS+=($!)
done <<LIST
$N/lsk/naif0012.tls spice/naif0012.tls
$N/pck/pck00011.tpc spice/pck00011.tpc
$N/pck/moon_pa_de440_200625.bpc spice/moon_pa_de440_200625.bpc
$N/fk/satellites/moon_de440_250416.tf spice/moon_de440_250416.tf
$N/spk/planets/de440s.bsp spice/de440s.bsp
$N/pck/earth_2026_260806_2126_predict.bpc spice/earth_2026_260806_2126_predict.bpc
$P/LOLA_20mpp/LDEM_80S_80MPP_ADJ.TIF lola/LDEM_80S_80MPP_ADJ.TIF
$P/LOLA_20mpp/LDEM_60S_240MPP_ADJ.TIF lola/LDEM_60S_240MPP_ADJ.TIF
$P/MoonIllumination/AVGVISIB_85S_060M_201608.TIF illum/AVGVISIB_85S_060M_201608.TIF
$P/MoonIllumination/AVGVISIB_85S_060M_201608_EARTH.TIF illum/AVGVISIB_85S_060M_201608_EARTH.TIF
$P/MoonIllumination/AVGVISIB_65S_240M_201608.TIF illum/AVGVISIB_65S_240M_201608.TIF
$P/MoonIllumination/AVGVISIB_65S_240M_201608_EARTH.TIF illum/AVGVISIB_65S_240M_201608_EARTH.TIF
$P/LOLA_5mpp/Site01/Site01_final_adj_5mpp_slp.tif lola5/Site01_final_adj_5mpp_slp.tif
$G/ldem_75s_120m.lbl lola/LDEM_75S_120M.LBL
$G/ldem_75s_120m.img lola/LDEM_75S_120M.IMG
$I/AVGVISIB_75S_120M_201608.IMG illum/AVGVISIB_75S_120M_201608.IMG
$I/AVGVISIB_75S_120M_201608.LBL illum/AVGVISIB_75S_120M_201608.LBL
$V/dlre_prp_south.xml diviner/dlre_prp_south.xml
LIST
# Map tiles (#149): LOLA 20 m and 10 m, all LOLA 5 m sites (PGDA 78), LROC WAC south polar mosaic 100 m.
L=https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/BDR/WAC_GLOBAL
getp "$P/LOLA_20mpp/LDEM_80S_20MPP_ADJ.TIF" "$D/lola/LDEM_80S_20MPP_ADJ.TIF" 12 & PIDS+=($!)
getp "$P/LOLA_20mpp/LDEM_83S_10MPP_ADJ.TIF" "$D/lola/LDEM_83S_10MPP_ADJ.TIF" 16 & PIDS+=($!)
getp "$V/dlre_prp_south.tab" "$D/diviner/dlre_prp_south.tab" 16 & PIDS+=($!)
getp "$L/WAC_GLOBAL_P900S0000_100M.IMG" "$D/lroc/WAC_GLOBAL_P900S0000_100M.IMG" 6 & PIDS+=($!)
for s in Site01 Site04 Site06 Site07 Site11 Site20 Site23 DM2 Haworth Shoemaker; do
  getp "$P/LOLA_5mpp/$s/${s}_final_adj_5mpp_surf.tif" "$D/lola5/${s}_final_adj_5mpp_surf.tif" 4 & PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid" || FAILED=1; done
[ "$FAILED" -eq 0 ] || exit 1
SUMS="$(cd "$(dirname "$0")" && pwd)/data.sha256"
if [ -f "$SUMS" ]; then (cd "$D" && sha256sum -c --quiet "$SUMS") || exit 1; fi
du -sh "$D"
