# Space Apps 2026 project page — text for the submission form

Copy each block into the field with the same name. English only. Numbers come from
`make eval` (commit `a4dc6972`, 2026-11-15) and from the README. Do not add new numbers here.

## Project Name

Tilion — lunar landing site navigator

## One-sentence pitch

Tilion shows a lunar mission planner, in one minute, whether the Sun and the Earth are above
the real terrain horizon at a south-pole landing site, and which site or date to choose when
the landing slips.

## High-Level Project Summary (≤ 150 words)

Tilion is a web app for planners of CLPS-style landings at the lunar south pole. When a
landing date slips, the team must find another site or date fast. Today this takes manual
queries in JPL Horizons, QuickMap and Moon Trek. Tilion answers four questions on one screen:
is the Sun above the terrain, how long until sunset, when is Earth in view, and which
site × date alternative scores best. It draws the Sun and the Earth over a horizon computed
from LOLA terrain, with SPICE DE440 ephemerides. The app also shows its own evidence: a
NASA check screen compares our numbers with JPL Horizons, Apollo landing records and the
PGDA 69 illumination maps, and shows the checks that fail. This matters because near the
pole a bare-sphere model moves sunset by hours to days; real terrain decides power and
communication.

## Link to Project Demo

https://tilion.nedovost.org/hd/demo/tilion-demo.mp4 (29.9 s video, English subtitles)

## Link to Final Project

https://tilion.nedovost.org

<!-- Add the public code repository link here after scripts/export_public.sh output is published. -->

## Detailed Project Description

**What it does.** Tilion is a static web app with a 3D globe and a polar map of the Moon. The
user selects one of 24 curated sites (Artemis III candidate regions, CLPS landers, other
national missions, Apollo) or a custom point (terrain from 60°S to 90°S), and a date. For that
site × date the app shows:

- the horizon panorama and a 3D view from the site, with the LOLA terrain horizon, the Sun
  disc and the Earth;
- Sun elevation above the terrain, and time to the next sunset and Earthset;
- a dated calendar of Sun and Earth windows, with an OK / MARGINAL / FAIL verdict for the
  mission limits;
- side-by-side comparison of sites;
- a mission plan: landing date, slip range, search radius and rover waypoints. The app
  ranks site × date alternatives by a 0–100 score (power, night survival, comms, longest
  blackout, sunset margin) and shows each term. A rover traverse follows the LOLA elevation
  profile. The plan is a shareable link.

**How it works.** A Python pipeline precomputes everything. It builds a horizon mask for each
site from LOLA terrain (20 m within 5 km of a polar site, then 80 m and 240 m) for an
observer 2 m above the surface. It computes hourly Sun and Earth positions with NASA NAIF
SPICE (DE440, frame MOON_ME, light time and aberration, TDB time). The Sun is a
limb-darkened 0.53° disc, not a point. The browser reads static files; a custom point is
computed in the browser on the LOLA 240 m map. DSN visibility (Goldstone, Madrid, Canberra)
is geometric.

**How we validate.** The NASA check screen and `make eval` compare our numbers with
independent references. Result of `make eval`: 11 of 15 scenarios pass. Sun and Earth
positions differ from JPL Horizons by at most 1e-06° at a 0.002° tolerance. The Sun at 8 of 8 Apollo
landings is within 0.3°. Earth visibility matches PGDA 69 at 18 of 18 sites within 5
percentage points. The 60 m and 120 m PGDA 69 maps are also compared on their own DEM grids, with the
5 pp tolerance fixed before the run: the 120 m map at 15 of 15 sites, the 60 m map at 9 of 10 sites, its 7×7 patches at
10 of 10. The one miss is a single 60 m pixel on the Shackleton–de Gerlache ridge (74.0 % against
44.3 %); the map's own neighbouring pixels reach 75.5 %, and the 120 m map gives 78.3 % against our
78.3 %. On crests the DEM grid decides the result. On the same ridge, our illumination is inside the
NASA corridor of Barker et
al. 2021 at 7 of 7 points. We show the failures in the app. A beta hindcast is consistent
with news reports of the IM-1 Odysseus and Chandrayaan-3 sunsets.

**Benefits.** One screen replaces several expert tools for a fast "what if the date slips"
decision. Every validated number shows its reference and tolerance. Teachers and the public see why
a small change of site or date can change power and contact at the lunar pole.

**What we hope to achieve.** A planner can test a slipped date or a nearby site on one screen and trust the numbers because the app shows how they compare with NASA references.

**Honest limits.** Terrain covers 60–90°S only. Cold-trap areas are permanent-shadow
candidates, not detected ice. Score weights and the 48 h sunset margin are our assumptions;
the rover speed is the VIPER planning mean of 36 m/h. Earth + DSN is geometry only, with no
antenna schedules; the educational link-budget calculator uses values the user enters.

**Tools and languages.** TypeScript, React, Vite, three.js, MapLibre GL JS, GSAP; Python,
spiceypy (NAIF SPICE), rasterio, NumPy, FastAPI (local demo server only); Vitest, pytest,
Playwright; GitHub Actions; Caddy static hosting.

## Use of Super Intelligence (SI)

Yes. Team members chose the challenge, the user, the data sources, the validation references
and the tolerances. AI agents proposed design options and task plans; team members chose
among them and approved every change to a formula or method. Claude Code agents (Anthropic)
wrote most of the code, tests and the data pipeline under human direction, one GitHub issue
at a time; each change passed the automated tests and the NASA comparisons. ChatGPT Deep
Research and Claude Research drafted background notes; we took facts only from primary
sources. No image, video or audio generation models were used: the demo video is a
scripted screen recording of the live app, and the wordmark is vector geometry from a script
(agents wrote both scripts, as with the rest of the code). The README states this too.

## NASA Data

- NASA/JPL NAIF SPICE kernels: DE440 planetary ephemeris, Moon frame (MOON_ME) and
  orientation, leap seconds, Earth orientation — https://naif.jpl.nasa.gov/pub/naif/generic_kernels/
- LRO LOLA polar DEMs 240 m, 80 m, 20 m and 10 m, NASA GSFC PGDA product 90 —
  https://pgda.gsfc.nasa.gov/products/90
- LRO LOLA 5 m site DEMs, PGDA product 78 — https://pgda.gsfc.nasa.gov/products/78
- Polar illumination and Earth visibility maps over 18.6 years (Mazarico et al. 2011), PGDA
  product 69 — https://pgda.gsfc.nasa.gov/products/69
- LRO LROC WAC south polar mosaic, 100 m —
  https://wms.lroc.asu.edu/lroc/view_rdr_product/WAC_GLOBAL_P900S0000_100M
- NASA SVS CGI Moon Kit (globe textures) — https://svs.gsfc.nasa.gov/4720; NASA Blue Marble
  (Earth texture)
- JPL Horizons (validation reference) — https://ssd.jpl.nasa.gov/horizons/
- Apollo Lunar Surface Journal and Apollo Mission Reports (validation reference) —
  https://www.apollojournals.org/alsj/alsj-EarthSun_AltAz.html
- VIPER operations planning values: NASA NTRS 20220008301 —
  https://ntrs.nasa.gov/citations/20220008301, and
  https://science.nasa.gov/mission/viper/lunar-operations

## Space Agency Partner Data and Other References

- ISRO Chandrayaan-3 landing (site in the curated list; hindcast from news reports of ISRO
  statements: Deccan Herald / PTI, The National).
- Barker, Mazarico et al. 2021, Planetary and Space Science, ridge illumination reference —
  https://doi.org/10.1016/j.pss.2020.105119
- Artemis III candidate landing sites dataset (Wueller 2026) — https://zenodo.org/records/17084058
- IAU Gazetteer of Planetary Nomenclature (USGS) — https://planetarynames.wr.usgs.gov/
- IM-1 Odysseus end of mission report — https://www.universetoday.com/articles/lunar-night-permanently-ends-the-odysseus-mission
- Lunar Window by adqm0001 (Space Apps 2026 team), https://github.com/adqm0001/lunar-window, commit
  13d45a98: its LOLA horizon field around the pole (field_pole, 250 m, cropped by us to ±32 km) and its field decoder,
  used for the "Shadows now" map layer. Used with credit; the Sun direction is ours.
- Open-source libraries: three.js (MIT), MapLibre GL JS (BSD-3-Clause), React (MIT), GSAP,
  spiceypy, rasterio, NumPy, FastAPI; fonts IBM Plex Sans and JetBrains Mono (SIL OFL 1.1).
- Tilion is not endorsed by NASA and uses no NASA logos.
