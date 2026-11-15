# Вопросы жюри

Заполняет `/hackathon-kickoff` из отчёта планировщика («What a jury will ask»). Ответ —
с цифрой и командой; цифры обновляет `scribe` по выводу `make eval`.

- [ИЗ ПЛАНИРОВЩИКА]

**Q: How do we know you did not tune thresholds to your results?**

**A:** No pass threshold was ever loosened. The planning note
[930e40e4](https://github.com/M1hairu/nasa_hack/commit/930e40e4) (2026-11-14 18:24 MSK) named
Horizons ≤ 0.05° and Apollo ≤ 0.5° beside its probe results; both are far looser than those
results. The first full validation run
([f2fb60e1](https://github.com/M1hairu/nasa_hack/commit/f2fb60e1), 22:29 MSK) used 0.05° (S1),
0.3° (S2) and 5 pp (S3, S4). After it we tightened S1 to 0.002°
([6e40f361](https://github.com/M1hairu/nasa_hack/commit/6e40f361)) so that the wrong frame
MOON_PA (0.029°) fails, and S6 to B ≤ ours ≤ C
([e777f6dd](https://github.com/M1hairu/nasa_hack/commit/e777f6dd)). S5 (terrain moves sunset by
≥ 1 h vs a bare sphere) was formalised after its errors were saved
([3e6301be](https://github.com/M1hairu/nasa_hack/commit/3e6301be)). Four method changes came
after results, with thresholds unchanged: PGDA 69 is compared on LOLA 80 + 240 m, the grid
closest to the maps ([f7a861ff](https://github.com/M1hairu/nasa_hack/commit/f7a861ff)), and the
bare-sphere baseline counts the Sun as visible by any limb, the same rule as the UI
([4cd74b13](https://github.com/M1hairu/nasa_hack/commit/4cd74b13): baseline 55.6 → 38.9 %, our
system 72.2 % unchanged), and PGDA 69 Sun illumination counts the time any part of the disc is
up, as the product label defines it ([d57f4b7c](https://github.com/M1hairu/nasa_hack/commit/d57f4b7c):
system 72.2 → 88.9 %), and for the 60 m PGDA 69 map the Sun is scored on that map's own 60 m grid,
LDEM_75S_60M V2.0, while the rows on our 80 m DEM became a reference for all 10 sites of that map
(D-023, [98687951](https://github.com/M1hairu/nasa_hack/commit/98687951)). The replacement checks
S4_same_dem_60 and S4_same_dem_60_patch (5 pp) were committed before any computation
([35099ba8](https://github.com/M1hairu/nasa_hack/commit/35099ba8)); the patch check passes 10 of 10,
the pixel check fails at 1 of 10 (the connecting ridge, 74.0 % against 44.3 %). S4 now covers the
8 sites of the 240 m map and passes 8 of 8; we kept its 5 pp threshold. The patch
threshold S4_patch (5 pp) was committed before its first run
([e80dd2b8](https://github.com/M1hairu/nasa_hack/commit/e80dd2b8)); it passes 8 of 8 on the 240 m map. The like-for-like
threshold S4_same_dem (5 pp per site, the map's own DEM LDEM_75S_120M) was committed before any computation
([fd6ab622](https://github.com/M1hairu/nasa_hack/commit/fd6ab622)); it passes 15 of 15. A sealed hidden
test set is opened once by `make eval-final` on the frozen commit. Audit:
`git log -p -- eval/cases.json backend/src/api/checks.py backend/src/precompute/validation.py`.

**Q: Why do 4 of 142 checks against NASA stay red?**

**A:** We did not change their tolerances, delete them or mark them `info` (#394). Each row note
states the reason. (1) PGDA 69, connecting ridge C1, same 60 m DEM: ours 74.0 %, map 44.3 %,
tolerance 5 pp. On this crest one pixel decides: the map's own 3×3 neighbourhood spans
44.3–75.5 %, and the 7×7 patch check passes. (2–4) Diviner Polar Resource Product, ±10 K:
Shackleton rim 2 cm annual mean 73.9 K against 130.2 K, de Gerlache rim GR1 105.3 K against
115.9 K, IM-1 Odysseus annual maximum 282.6 K against 271.8 K. At these rims the Sun time depends
on the horizon scale (Shackleton rim: Sun 50 % of hours on LOLA 240 m, 80 % on 20 m). The product
uses the Diviner team's own ~0.5 km mesh horizon; we use LOLA 240 m. A horizon from that mesh
is a method change, so we kept the frozen method.
