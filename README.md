# Tilion — lunar landing site navigator

Tilion shows where the Sun and the Earth stand above the real terrain horizon of a lunar
landing site, and compares sites and landing dates. It is for a CLPS-style mission planner
at the lunar south pole. When the landing date slips, the planner must find an alternative
site or date fast. Today this means manual queries in JPL Horizons, QuickMap and Moon Trek.
Tilion puts the answers on one screen: Sun elevation, time to sunset, Earth windows and a
ranked list of site × date alternatives. Sun and Earth positions and terrain horizons come from NASA open data (SPICE
DE440, LOLA), and the app shows its own comparison with NASA references.

NASA Space Apps Challenge 2026, challenge
[Lunar Landing Site Navigator](https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/).

- **Live site:** https://tilion.nedovost.org (static page; needs WebGL)
- **Demo video (29.9 s, English subtitles):** https://tilion.nedovost.org/hd/demo/tilion-demo.mp4

## 60-second walkthrough

Open the live site, select a polar site on the globe or the map (for example
*Shackleton–de Gerlache ridge*), then drag the time strip (arrow keys step it, T opens the date picker). The planner gets four answers:

1. **Is the Sun above the terrain?** *Horizon panorama* and *View from site* (3D) draw the
   LOLA terrain horizon, the Sun disc and the Earth. The site card shows "Sun above terrain": the
   Sun elevation over the local terrain horizon, not over a flat horizon.
   The "Main blocker" row names the terrain sector that costs the most sunlight: azimuth range, peak
   mask elevation, ridge distance and height, and lost hours.
2. **How long until sunset?** The site panel shows the time to the next sunset and Earthset.
   Sunset means the whole Sun disc is below the terrain mask.
3. **When can we talk to Earth?** *Windows* is a dated calendar: Sun, Earth in view, or both,
   per day. It gives an OK / MARGINAL / FAIL verdict for the mission limits.
4. **If the date slips, where and when instead?** *Mission* takes a plan (site, date, slip
   range, search radius, waypoints) and ranks site × date alternatives by a 0–100 score with a
   per-term breakdown. The rover traverse follows the LOLA elevation profile. The plan is a
   shareable link.

*Compare* puts sites side by side. *NASA check* shows how our numbers compare with NASA references.

## How we validate

**In the app.** The *NASA check* screen compares our numbers with independent references:
Sun and Earth azimuth/elevation from [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/), the
Sun at the Apollo landings
([ALSJ](https://www.apollojournals.org/alsj/alsj-EarthSun_AltAz.html) and Mission Reports),
18.6-year illumination and Earth visibility from
[PGDA product 69](https://pgda.gsfc.nasa.gov/products/69) (Mazarico et al. 2011), and ridge
illumination from [Barker et al. 2021](https://doi.org/10.1016/j.pss.2020.105119) on the same
LOLA DEM, and lunar eclipse contact times from the
[NASA GSFC eclipse catalogue](https://eclipse.gsfc.nasa.gov/LEcat5/LE2001-2100.html). Each card shows our value, the reference, the difference, the tolerance and
PASS or FAIL. Failed checks stay on the screen with the reason.

**By command.** `make eval` runs every scenario in `eval/cases.json` and compares the system with a baseline
(a bare sphere, horizon 0°). Output on commit `19a13076`, 2026-11-15:

```
RESULT: 12/16 сценариев (критических 10/11; автоматизировано 16); PGDA 69, Солнце: площадок в допуске 5 п.п., % (из 18): система 88.9 против baseline 38.9
```

In English: 12 of 16 scenarios pass (10 of 11 critical). The PGDA 69 Sun illumination is within
5 percentage points at 88.9 % of 18 sites; the bare-sphere baseline (Sun lit when any limb is above 0°) gets 38.9 %. Per scenario:

| Scenario | Result | `make eval` note |
|---|---|---|
| S1 Sun and Earth position vs JPL Horizons | pass | max 1e-06° at tolerance 0.002°; the wrong frame MOON_PA gives 0.028994° |
| S2 Sun elevation and azimuth at Apollo landings | pass | 8/8 within 0.3°, max 0.096° |
| S3 Earth visibility, 18.6 y, vs PGDA 69 | pass | 18/18 within 5 pp, max 3.674 pp |
| S4 Sun illumination, 18.6 y, vs PGDA 69 | pass | 8/8 within 5 pp, max 1.076 pp; sites on the 240 m map. On the 60 m map the Sun is scored on the map's own 60 m grid (S4_same_dem_60, D-023) |
| S4_patch Sun paired 7×7-pixel median absolute difference | pass | 8/8 within 5 pp, max 0.765 pp; sites on the 240 m map |
| S4_same_dem Sun illumination on the map's own DEM (LDEM_75S_120M) vs the 120 m PGDA 69 map, sites at 75–90°S | pass | 15/15 within 5 pp, max 3.367 pp; threshold committed before the run |
| S4_same_dem_60 Sun illumination on the 60 m grid (LDEM_75S_60M V2.0) vs the 60 m PGDA 69 map, sites south of 85°S | **FAIL** | 9/10 within 5 pp, max 29.643 pp: one pixel on the connecting ridge (see *Honest limits*); threshold committed before the run |
| S4_same_dem_60_patch Sun paired 7×7-pixel median on the 60 m grid | pass | 10/10 within 5 pp, max 3.588 pp |
| S4_random Sun illumination, 18.6 y, at 150 random points 85–90°S vs the 60 m PGDA 69 map | pass | seed 20261115: RMSE 1.43 pp at threshold 5 pp, bias +0.06 pp, 99 % of points within 5 pp, max 11.99 pp |
| S5 Terrain moves sunset vs a bare sphere | pass | 18 sites: median sphere error 39.625 h |
| S6 Ridge illumination in the Barker 2021 B..C corridor | pass | 7/7 points |
| S7 Earth eclipses the Sun: contacts of 2025-03-14, 2027-02-20, 2027-08-17 vs NASA GSFC | pass | 18/18 within 30 s, max 6.1 s; Blue Ghost M1 site inside the catalogue windows |
| S8 Model shadows vs 3 LROC NAC images (Shackleton ridge, Malapert, Nobile), image shadow by Otsu | **FAIL** | shadow IoU 0.51 / 0.55 / 0.04 at threshold 0.7, fixed before the run (see *Honest limits*) |
| S9 Model shadows vs 3 new LROC NAC images, image shadow by Lommel–Seeliger photometry on the LOLA slope | **FAIL** | 2 of 3 pass: agreement 98.5 / 98.5 / 99.3 %, shadow IoU 0.65 / 0.94 / 0.83 at threshold 0.7 (Malapert W, Nobile S, Nobile NE) |
| S10 Regolith surface temperature (Hayne 2017 1D model) vs Diviner at the equator and the Apollo 15/17 heat flow probes | pass | 5/5 within 5 K, max 2.8 K |
| S11 Polar site temperature vs Diviner Polar Resource Product: annual maximum and 2 cm annual mean | **FAIL** | 27/30 within 10 K, max 56.3 K: annual maximum 14/15, 2 cm mean 13/15 (see *Honest limits*) |

**Hindcast (beta, on the NASA check screen).** We computed sunset and sunrise at two real
landers with the same pipeline (`web/public/data/beta/hindcast.json`). The results are
*consistent with* news reports of operator statements, not telemetry:

- IM-1 Odysseus: our sunset is on 2024-02-29, the day Intuitive Machines announced the end of
  the mission at lunar night ([Universe Today](https://www.universetoday.com/articles/lunar-night-permanently-ends-the-odysseus-mission)).
- Chandrayaan-3 Vikram: ISRO put the lander to sleep 5.2 h before our sunset, with the Sun still up
  ([Deccan Herald / PTI](https://www.deccanherald.com/amp/story/science%2Fspace%2Fchandrayaan-3-after-rover-lander-set-into-sleep-mode-hoping-for-their-awakening-by-sep-22-says-isro-2672110));
  our sunrise is about 2 days before the 22 Sep wake-up target
  ([The National](https://www.thenationalnews.com/world/asia/2023/09/05/indias-chandrayaan-3-mission-lander-and-rover-in-sleep-mode-for-lunar-night)).

**DSN complexes (beta, in Next windows).** Each Earth-in-view window says which complex sees the
Moon above 10° (Goldstone, Madrid, Canberra; `web/public/data/beta/dsn_stations.json`) and how many
hours no complex does. `dsnVisible` is stricter per station: the same station must clear the
site's lunar horizon (test). Moon elevation at the three stations matches JPL Horizons within 0.001° at three moments
0.2–1° from the limit. Over the data period at least one complex sees the Moon 98.1 % of hours,
exactly one 72.6 % (Moon above 10° at a station, without the site mask).

## Data and sources

All data is open. Raw files (~10 GB) stay outside git; `scripts/fetch-data.sh` downloads them
and checks `scripts/data.sha256`. The page reads only precomputed static files in `web/public/data`.

| Data | Use | Source |
|---|---|---|
| NAIF SPICE: DE440 (`de440s.bsp`), Moon frame `MOON_ME` (`moon_de440_250416.tf`, `moon_pa_de440_200625.bpc`), `naif0012.tls`, `pck00011.tpc`, Earth orientation `earth_2026_*` | Sun and Earth vectors, light time + stellar aberration (LT+S), TDB time; DSN station geometry | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ |
| LOLA polar DEMs 80 m (80–90°S) and 240 m (60–90°S), PGDA product 90; their height error layers `*_ADJ_ERR` (read over HTTP) | horizon masks, custom points, map; DEM error range (beta) | https://pgda.gsfc.nasa.gov/products/90 |
| LOLA DEMs 20 m (80–90°S) and 10 m (83–90°S), PGDA product 90 | horizon within 5 km of a polar site (20 m); map relief tiles | https://pgda.gsfc.nasa.gov/data/LOLA_20mpp/ |
| LOLA 5 m site DEMs, PGDA product 78 | high-resolution map relief | https://pgda.gsfc.nasa.gov/products/78 |
| Polar illumination and Earth visibility maps, 18.6 y, PGDA product 69 | validation reference; cold-trap candidates (beta) | https://pgda.gsfc.nasa.gov/products/69 |
| LROC WAC south polar mosaic, 100 m | photo layer of the map | https://wms.lroc.asu.edu/lroc/view_rdr_product/WAC_GLOBAL_P900S0000_100M |
| NASA SVS CGI Moon Kit (LROC color, LOLA global DEM); NASA Blue Marble (Earth) | 3D globe textures | https://svs.gsfc.nasa.gov/4720 |
| IAU Gazetteer of Planetary Nomenclature | feature names on the map | https://planetarynames.wr.usgs.gov/ |
| Landing site coordinates | curated site list (24 sites) | LROC landing-site images, Artemis III candidate sites (Wueller 2026, https://zenodo.org/records/17084058), NASA NTRS; per-site link in `web/public/data/sites.json` |

Method in one line: horizon mask from LOLA terrain for an observer 2 m above the surface,
hourly Sun and Earth positions from SPICE, Sun as a limb-darkened 0.53° disc.
Longitude is 0–360° east in the IAU mean-Earth frame (MOON_ME).

## Honest limits

- **One Sun pixel fails on the 60 m map** (S4_same_dem_60, 5 pp tolerance fixed before the run):
  the connecting ridge gives 74.0 % against 44.3 %. The map's own 3×3 neighbourhood spans
  44.3–75.5 %, and the 7×7 patch median is 2.66 pp, within 5 pp. On the 120 m map the same
  ridge gives 78.3 % against 78.3 % (S4_same_dem), and it passes against Barker 2021 (S6).
  The 60 m map label names LDEM_85S_060M; PDS no longer serves it, so we use LDEM_75S_60M V2.0
  (the same 60 m grid, 2017). On our own 80 m DEM the Sun rows of the 60 m map are a reference
  only (D-023): they measure the DEM difference. Example: the Shackleton rim gives 65.9 % on our
  80 m DEM and 86.1 % on the 60 m grid, against 85.5 % on the map. On crests the DEM grid decides
  the result.
- **S8 fails on all 3 LROC NAC images** (rule fixed before the first result). The Otsu
  threshold also puts dim sunlit slopes at a grazing Sun into the image's dark class. Of the cells
  our model puts in shadow, 99.8–100 % are dark in the image (a diagnostic, not the pass rule).
  It is not a position error: on these 3 images the best shift of the model shadow against the
  S9 image shadow is 0, 0 and 1 cell of 20 m (#338).
- **S9 fails on 1 of 3 new LROC NAC images.** S9 divides the image brightness by the
  Lommel–Seeliger term cos i / (cos i + cos e) of the LOLA slope, so dim sunlit slopes stay lit.
  We tuned it on the 3 S8 images, then committed the rule and the list of new images before we
  downloaded them. On the new images cell agreement is 98.5–99.3 % and shadow IoU is 0.94 and 0.83;
  Malapert W gets IoU 0.65 (threshold 0.7). Its shadows are small, and about half of its mismatched
  cells touch the shadow edge (one 20 m cell). 6–12 % of cells are not scored: the Sun grazes the slope.
- **Cold traps are candidates, not ice.** A cold-trap candidate is a PGDA 69 pixel with no
  sunlight in 18.6 years: permanent shadow. We do not claim water ice.
- **The route score is a model with assumptions.** Score weights per mode (Energy / Comms /
  Balanced) are our choice. The 48 h sunset margin (checkout and first charge) is a mission
  assumption, not a published constant. The 50 h night limit is the VIPER survival value
  ([NTRS 20220008301](https://ntrs.nasa.gov/citations/20220008301)).
- **Rover speed is 36 m/h:** the VIPER planning mean of about 1 cm/s with stops
  ([VIPER lunar operations](https://science.nasa.gov/mission/viper/lunar-operations)).
- **Earth + DSN is geometry only.** Goldstone, Madrid or Canberra is above the site's terrain
  horizon, and the same station sees the Moon above 10°. 10° is the DSN uplink limit (10.1°); receive starts
  near 6° ([DSN 810-005, module 301P](https://deepspace.jpl.nasa.gov/dsndocs/810-005/301/301P.pdf),
  §2.2.4). Station positions are the 70 m antennas DSS-14, DSS-63 and DSS-43. They do not
  work in the 26 GHz lunar K-band. The 34 m antennas within 10 km of them do
  ([module 104Q](https://deepspace.jpl.nasa.gov/dsndocs/810-005/104/104Q.pdf)); the geometry is the same.
  No antenna schedules: the DSN is oversubscribed, with demand at times 40 % above capacity
  ([NASA OIG IG-23-016](https://oig.nasa.gov/docs/IG-23-016.pdf)). The educational link-budget
  calculator on the horizon screen uses only values the user enters; it does not confirm a contact.
- **Relays are not modelled.** No Western relay serves the south pole yet. NASA LCRNS estimates
  that one relay raises south-pole availability from 17–43 % (direct to Earth) to 80–86 %
  ([NTRS 20250003321](https://ntrs.nasa.gov/citations/20250003321)).
- **Terrain covers 60–90°S only.** North of 60°S the Moon is a bare sphere, marked
  "no terrain". Outside the precomputed time range, or without a precomputed file, the app
  shows synthetic values marked "mock".
- **Time:** precomputed hourly from 2026-12-01 to 2028-01-01; hourly steps give ±1 h.
- **Earth eclipses** dim the Sun by the covered share of the disc. The Earth disc is 1.01 × its
  radius (Danjon rule, as the NASA GSFC catalogue); light refracted into the shadow is ignored.
  Terrain and Earth are taken as independent (the product of the two shares). In our window the
  2027-08-17 eclipse hides up to 48 % of the Sun at the polar sites for about 3 h; the
  2027-02-20 eclipse does not reach the south pole.
- **Lander energy is a simple model.** Each hour: panel W × visible Sun × cos(angle on a vertical
  panel that turns to the Sun) − load; the battery stays between 0 and its capacity. Defaults are
  VIPER-class: 320 W panel and 5,420 Wh battery
  ([NTRS 20240013903](https://ntrs.nasa.gov/citations/20240013903)), 174 W standby load
  ([NTRS 20220013310](https://ntrs.nasa.gov/citations/20220013310), Table 5.1), 108 W night load
  = 5,420 Wh / 50 h survival (our derivation). No temperature, dust, ageing or depth-of-discharge
  limit. The user can edit every input. The panel can also be a flat deck or tilted at any angle:
  cos = sin(tilt) × cos(Sun el) × cos(Δaz) + cos(tilt) × sin(Sun el). At Haworth a flat deck gets
  3.6 % of the energy of the vertical tracking panel (unit test, checked by a separate recomputation).
- **Smallest battery (beta)** runs the same energy model with the user's panel and loads. It
  finds by bisection the smallest capacity whose charge stays at or above a 20 % reserve (our
  assumption, a margin for ageing, cold and faults) over the shown period, and shows the longest
  spell without panel output and its load energy. Tests: the found size survives and 1 % less
  fails; it equals the largest drop from full / 0.8 to 1e-5; the Apollo 11 night is 349–355 h
  (half a synodic month is 354.4 h).
- **Ground temperature is a model forecast at the sites.** The *NASA check* screen (group
  "Regolith surface temperature") runs the 1D regolith heat model of
  [Hayne et al. 2017](https://doi.org/10.1002/2017JE005387) (Appendix A, Table A1 parameters).
  Against the paper's Table A2 references it is within 5 K: Diviner equator 385.3 / 100.0 / 93.6 K
  at noon / midnight / before sunrise (references 385 / 101 / 95 K) and Apollo 17 / 15 diurnal
  means 213.2 / 210.8 K (216 / 211 K). For Apollo we use mare albedo 0.06 as the author's reference
  code [heat1d](https://github.com/phayne/heat1d) (MIT); we chose it after the first run, and with
  the highland 0.12 the means are 205.7 / 203.0 K, 10.3 / 8.0 K below the references, and S10
  fails. At each polar site the model takes our
  hourly Sun behind the terrain horizon on the ground slope from the DEM and gives the 2027 minimum
  and maximum surface temperature. There the albedo is 0.12 at every incidence angle, as in the
  polar terrain model of [Hayne et al. 2021](https://arxiv.org/abs/2005.05369) (Methods); we take only
  its albedo and, in a simple form, its light and infrared from sunlit slopes (below). We chose
  this after the first S11 run: the low-latitude law of the 2017 paper gives albedo 0.7–0.8 for a Sun
  1–2° high. With that law S11 had 4 of 30 rows within 10 K on the 20 m DEM slope at the site and
  0 of 30 on the product's triangle slope, ours 20–71 K colder. Check S11 compares with the Diviner South Polar
  Resource Product ([Paige et al. 2010](https://doi.org/10.1126/science.1187726)) at the product's
  scale: the slope of its own ~0.5 km triangle and the horizon of LOLA 240 m, the LOLA grid closest
  to that mesh; the 10 K threshold was committed before the download. We chose the 240 m horizon
  after a run on our 20 m site terrain (2 cm mean then 7 of 15): a 20 m crest hides the Sun at some
  sites, e.g. de Gerlache rim GR1 sees the Sun 25 % of hours on 20 m and 54 % on 240 m, and a
  0.5 km mesh cannot resolve it (#339). Both models add light and infrared from sunlit slopes. In
  ours each azimuth of the horizon is a slope facing the site, view factor sin² of its horizon
  angle; a sunlit slope returns 0.12 of the Sun as light and the rest as infrared. At these sites it
  adds 0–2.2 W/m² on average: up to 3.1 K in the 2 cm mean, up to 1.1 K in the maximum. In this
  simple form it does not explain the misses. It treats the site as level (a tilted triangle also
  sees ground below its plane), and the slopes return the infrared at once, with no night heat. The annual maximum is within 10 K at 14 of 15 sites, but ours is
  6.3–10.8 K warmer at 14 of them: the constant albedo may overheat under a low Sun. The 2 cm annual
  mean is within 10 K at 13 of 15. Misses: Shackleton rim 2 cm mean 56.3 K colder (the 240 m grid
  flattens its crest: Sun 50 % of hours against 80 % on 20 m), de Gerlache rim GR1 2 cm mean
  10.6 K colder, IM-1 Odysseus maximum 10.8 K warmer. S11 **fails**. Since we chose the albedo and
  the horizon grid after seeing S11, S11 is now a development check, not a blind test.
  It is the regolith surface, not the lander: equipment temperature depends on the lander design,
  and we do not compute it.
- **Hindcast** compares with news reports, so we say "consistent with", never "matches".
- The highest map zoom levels (z17–18) are served only by the live site, not by `make demo`.

## Performance

Measured 2026-11-15 on `main` before PR #199 (issue #151): RTX 4080, headless Chromium
(Playwright), window 1440×900, `make demo` and the live site, frame timing in the page,
10 s per scenario.

| Measure | local (`make demo`) | live site | software GL (SwiftShader) |
|---|---|---|---|
| Globe ready (first frame with the Moon) | 0.59–0.75 s | 1.73–1.83 s (with network) | 1.15 s |
| Globe → map | 0.19–0.31 s | 0.18–0.23 s | 0.23 s |
| "View from site" 3D ready | 0.83–0.84 s | 0.84 s | 1.56 s |
| Globe rotation: fps / p95 frame | 60 / 16.7 ms | 60 / 16.7 ms | 11.5 / 100 ms |
| Timeline scrub: fps / p95 frame | 60 / 16.7 ms | 60 / 16.7 ms | 12.8 / 100 ms |

60 fps is the vsync limit. `make e2e JOBS=4` after PR #199: 39 of 39 tests passed in 3 of 3 runs,
1.3 min each. Rerun 2026-11-15 on the code of `1bb8429c`: `make e2e JOBS=4` — 55 passed in 1.5 min.

## How to run

Needs `git`, `make`, `uv`, Node.js 22+.

```bash
make setup                   # Python and web dependencies, .env from .env.example
bash scripts/fetch-data.sh   # optional: raw NASA data (~10 GB), only to recompute web/public/data
make demo                    # build the page and serve it at http://localhost:8000
make check                   # lint, type check, build, unit tests, one test per data trap
make e2e                     # end-to-end user scenario in headless Chromium
make eval                    # the validation scenarios against the baseline
```

`make demo` and `make eval` use the precomputed files in git. `make precompute` rebuilds them
from `data/`.

## Where AI helped

Tilion was built with AI coding agents under human direction. Team members chose the
challenge, the user (a mission planner after a date slip), the data sources, the validation
references and tolerances. AI agents proposed design options and task plans. Team members
chose among them and approved the task plan and every change to a formula or method.

- **Code, tests and data pipeline:** written mostly by Claude Code agents (Anthropic), one
  GitHub issue at a time. Each change passed `make check`. Method changes were checked with
  `make eval`. Team members reviewed the results and tested the app by hand.
- **Research:** ChatGPT Deep Research and Claude Research drafted background notes. We used
  them as pointers only. Facts in the app come from the primary sources linked above.
- **No image, video or audio generation models.** The demo video is a scripted screen
  recording of the live app (`scripts/demo_video.cjs`). The wordmark is vector geometry from a
  script (`scripts/wordmark.py`). Agents wrote both scripts, as with the rest of the code.

## Team

GitHub: [M1hairu](https://github.com/M1hairu), [IR630](https://github.com/IR630),
[GG-crypto34](https://github.com/GG-crypto34), [fafakaj](https://github.com/fafakaj).
The full team is on our Space Apps team page.

## Licenses and credits

- Data: NASA PGDA (LOLA, illumination maps), NASA/JPL NAIF SPICE kernels, NASA LRO LROC
  (Arizona State University), NASA SVS CGI Moon Kit and Blue Marble (public domain), IAU/USGS
  Gazetteer of Planetary Nomenclature. Site coordinates and reports: the sources linked in
  `web/public/data/sites.json` and above.
- Libraries: three.js (MIT), MapLibre GL JS (BSD-3-Clause), React (MIT), GSAP, spiceypy,
  rasterio, NumPy, FastAPI. Fonts: IBM Plex Sans and JetBrains Mono (SIL OFL 1.1).
- Adapted code under MIT: the tilted-panel formula of the energy model. Source, commit and
  license text are in `THIRD_PARTY_NOTICES.md`.
- Tilion is an independent project. It is not endorsed by NASA, and it uses no NASA logos.
