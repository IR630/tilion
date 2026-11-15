# Площадки: районы Artemis III и освещённые гребни южного полюса

Дата обращения ко всем источникам: 2026-11-14. Широта отрицательная (юг), долгота 0–360°E.
Пересчёт из ±180°: если долгота отрицательная, прибавляем 360 (например, −137,411 → 222,589).

## Что сейчас со списком районов

- Список из девяти районов не менялся с 28.10.2024: Peak near Cabeus B, Haworth, Malapert Massif,
  Mons Mouton Plateau, Mons Mouton, Nobile Rim 1, Nobile Rim 2, de Gerlache Rim 2, Slater Plain.
  Подтверждение: тезисы NASA к LPSC 2026 (George, Rubio, Lawrence, Curell, «Artemis III site selection
  update: downselection from thirteen to nine candidate regions»,
  https://ntrs.nasa.gov/citations/20250011660). Там же сказано, что каждый район содержит несколько
  площадок, а сужения до одного района не будет: для доступности по датам пуска нужно держать несколько.
  Сообщения 2026 года о «трёх приоритетных районах» нашлись только на сомнительных сайтах, первоисточника нет.
- Большая перемена 2026 года касается не районов, а миссий. В феврале–марте 2026 NASA переделала Artemis III
  в испытательный полёт на низкой околоземной орбите (2027, стыковка Orion с посадочными модулями), а первая
  высадка перешла на Artemis IV (на странице NASA указано «Early 2028», обновлена 16.03.2026:
  https://www.nasa.gov/mission/artemis-iv/). Там же: «nine candidate landing regions near the lunar South Pole».
  16.03.2026 на LPSC A. Kshatriya сказал, что от южного полюса не отказываются, но требования к первым
  посадкам пересматривают (https://spacepolicyonline.com/news/kshatriya-hints-nasa-may-reconsider-south-pole-for-initial-artemis-landings/).
  Для питча правильнее писать «кандидатные районы Artemis (объявлены для Artemis III, сейчас относятся к первой высадке, Artemis IV)».
- Район примерно 15×15 км, площадка внутри района — круг радиусом около 100 м (пресс-релиз NASA 2022,
  https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/).

## Координаты центров районов NASA не публикует

Ни пресс-релиз, ни тезисы LPSC 2026 не дают ни центров, ни контуров. Контуры есть в выпуске USGS
«Down Selected Artemis III Candidate Landing Site Navigational Grids» (McClernan 2024, https://doi.org/10.5066/P1MEQ6UK):
сетки LGRS 1 км / 100 м / 10 м для всех девяти районов, взяты из LROC QuickMap, датум DE421 Mean Earth.
Скачать не удалось: ScienceBase закрыт проверкой Cloudflare. Это лучший будущий источник центров (центроид сетки 1 км).

Поэтому в таблице для каждого района две строки:

1. **region** — центр мозаики LROC NAC, которую ASU сняла под этот район (страница продукта на data.lroc.im-ldi.com,
   поля Center Lat / Center Lon, точность 0,1°). Мозаика покрывает район, но её центр не обязан совпадать с центром района NASA;
   у Mons Mouton Plateau мозаика тянется от −85,76 до −82,85, так что это лишь грубый ориентир.
   Где отдельной мозаики нет, взят центроид площадок Wueller et al. (посчитан мной в полярной стереографии) — это `HYPOTHESIS`.
2. **point** — конкретная площадка из рецензируемой работы Wueller et al. 2026, JGR Planets 131(3), e2025JE009434,
   https://doi.org/10.1029/2025JE009434. Данные: https://doi.org/10.5281/zenodo.17084058, файл `Landing_Sites.zip → LandingSites.shp`
   (атрибуты Latitude/Longitude, совпадают с геометрией до 1e-5°, я проверил). Для каждого района выбрана площадка,
   ближайшая к центроиду всех площадок этого района в работе. Площадки отобраны по уклону < 8° для HLS и по освещённости.
   Проекция файла: `Moon2000_spole`, сфера 1737,4 км. Явно система ME в файле не названа, но исходные данные LOLA даны в ME,
   поэтому frame = «ME (de facto)».

## Гребни и кромки у Шеклтона

- **Важная поправка к ТЗ.** Точка Mazarico et al. 2011 (Icarus 211, 1066–1081) с наибольшей освещённостью у южного полюса —
  это −89,45°, 222,69°E. Gläser et al. 2018 (Planet. Space Sci., препринт NASA: https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf,
  Table 1) относят её к **Connecting Ridge C1**, то есть к гребню Шеклтон — де Жерлаш, а не к кромке Шеклтона.
  Кромка Шеклтона у Mazarico 2011 — отдельная точка −89,78°, 204,27°E.
- Цифра из ТЗ «222,56°E, −89,475°» ближе всего к центру области CR1 у De Rosa et al. 2012 (Planet. Space Sci. 74, 224–246,
  https://arxiv.org/abs/1208.5587, Table 2): −89,4679°, −137,411° = 222,589°E. Таблица прямо заявлена в Mean Earth/Polar Axis (DE421).
  Это центр области интереса, а не пиксель максимума.
- C1 у Mazarico 2011 и CR1 у De Rosa разнесены примерно на 550 м. По 00b-probe сдвиг в 60 м на гребне меняет освещённость с 0 до 86 %,
  так что для «точки» брать максимум освещённости по карте (Gläser 2018), а для «области» — центр De Rosa.
- Точности: Mazarico 2011 — ЦМР 240 м/пиксель, координаты с двумя знаками (0,01° по широте ≈ 300 м).
  Gläser 2018 — ЦМР LOLA 20 м/пиксель, четыре знака; освещённые полосы там шириной 20–40 м.

## Таблица

| id (snake_case) | name | lat | lon_E | elev_m | point/region | source URL | frame | confidence | note |
|---|---|---|---|---|---|---|---|---|---|
| peak_near_cabeus_b | Peak near Cabeus B | −83.6 | 291.2 | UNKNOWN | region (LROC mosaic centre) | https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_CABEUSPKLO2 | not stated (LROC, LOLA-controlled → ME) | medium | мозаика −84.06…−83.21, −72.47…−64.80 (=287.53…295.20°E) |
| peak_near_cabeus_b_pcb03 | Peak near Cabeus B, site PCB03 | −83.5630 | 291.7991 | UNKNOWN | point | https://doi.org/10.5281/zenodo.17084058 | Moon2000 sphere, ME de facto | high | Wueller 2026; ближайшая к центроиду 5 площадок |
| haworth | Haworth | −86.7 | 336.3 | UNKNOWN | region (LROC mosaic centre) | https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_HAWORTH_LO1 | not stated → ME | medium | мозаика −87.39…−86.11, 325.02…347.64°E |
| haworth_hw02 | Haworth, site HW02 | −86.8076 | 338.2806 | UNKNOWN | point | https://doi.org/10.5281/zenodo.17084058 | Moon2000 sphere, ME de facto | high | Wueller 2026; 11 площадок в районе |
| malapert_massif | Malapert Massif | −86.0 | 0.3 | UNKNOWN | region (LROC mosaic centre) | https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_MALAPERTLO1 | not stated → ME | medium | мозаика −86.33…−85.63, 354.34…5.15°E |
| malapert_massif_mma01 | Malapert Massif, site MMA01 | −85.9425 | 359.0564 | UNKNOWN | point | https://doi.org/10.5281/zenodo.17084058 | Moon2000 sphere, ME de facto | high | Wueller 2026; у De Rosa 2012 MP1 = −85.9756, 357.8876 (ME) |
| mons_mouton_plateau | Mons Mouton Plateau | −84.3 | 30.6 | UNKNOWN | region (LROC mosaic centre) | https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_MOUTNPLTLO1 | not stated → ME | low | мозаика огромная (−85.76…−82.85, 15.49…46.61°E), центр района лишь приблизительно |
| mons_mouton_plateau_mmp06 | Mons Mouton Plateau, site MMP06 | −84.5961 | 30.4525 | UNKNOWN | point | https://doi.org/10.5281/zenodo.17084058 | Moon2000 sphere, ME de facto | high | Wueller 2026; 11 площадок |
| mons_mouton | Mons Mouton | −85.4 | 35.3 | UNKNOWN | region (LROC mosaic centre) | https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_MTMOUTONLO1 | not stated → ME | HYPOTHESIS | одна мозаика на два района: «Nobile Rim 1 and Mons Mouton (Leibnitz Beta Plateau)», −86.07…−84.82, 27.29…43.23°E |
| mons_mouton_mmo01 | Mons Mouton, site MMO01 | −85.4160 | 31.8506 | UNKNOWN | point | https://doi.org/10.5281/zenodo.17084058 | Moon2000 sphere, ME de facto | high | Wueller 2026; рядом De Rosa LP1 (Leibnitz β) = −85.4596, 31.7805 (ME) |
| nobile_rim_1 | Nobile Rim 1 | −85.1876 | 37.24 | UNKNOWN | region (centroid of 9 Wueller sites) | https://doi.org/10.5281/zenodo.17084058 | ME de facto | HYPOTHESIS | своей мозаики LROC нет; центроид посчитан мной |
| nobile_rim_1_nr107 | Nobile Rim 1, site NR107 | −85.1978 | 37.1774 | UNKNOWN | point | https://doi.org/10.5281/zenodo.17084058 | Moon2000 sphere, ME de facto | high | Wueller 2026; рядом De Rosa LP2 = −85.2934, 37.0304 (ME) |
| nobile_rim_2 | Nobile Rim 2 | −83.9 | 58.7 | UNKNOWN | region (LROC mosaic centre) | https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_NOBILE02LO1 | not stated → ME | medium | мозаика −84.40…−83.50, 54.46…63.02°E; точность мозаики 5–20 м |
| nobile_rim_2_nr208 | Nobile Rim 2, site NR208 | −83.9064 | 57.8114 | UNKNOWN | point | https://doi.org/10.5281/zenodo.17084058 | Moon2000 sphere, ME de facto | high | Wueller 2026 |
| de_gerlache_rim_2 | de Gerlache Rim 2 | −88.1737 | 291.213 | UNKNOWN | region (centroid of 7 Wueller dGR2 sites) | https://doi.org/10.5281/zenodo.17084058 | ME de facto | HYPOTHESIS | отдельной мозаики Rim 2 нет; общая мозаика «de Gerlache Rim» см. ниже |
| de_gerlache_rim_2_dgr203 | de Gerlache Rim 2, site dGR203 | −88.1408 | 288.3045 | UNKNOWN | point | https://doi.org/10.5281/zenodo.17084058 | Moon2000 sphere, ME de facto | high | Wueller 2026 |
| slater_plain | Slater Plain | −87.207 | 126.606 | UNKNOWN | region (centroid of 11 Wueller sites) | https://doi.org/10.5281/zenodo.17084058 | ME de facto | HYPOTHESIS | мозаики LROC под район не нашёл (есть только PSR кратера Slater) |
| slater_plain_sp07 | Slater Plain, site SP07 | −87.1306 | 127.857 | UNKNOWN | point | https://doi.org/10.5281/zenodo.17084058 | Moon2000 sphere, ME de facto | high | Wueller 2026 |
| connecting_ridge_c1_mazarico2011 | Shackleton–de Gerlache connecting ridge, C1 (Mazarico 2011 max) | −89.45 | 222.69 | UNKNOWN | point (illumination max, 240 m DEM) | https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf | LOLA → ME | high (value), low (precision ±300 m) | это «точка Mazarico» из ТЗ; 89.0 % ср. освещённость, 92.7 % видимость Солнца по Mazarico 2011; цитата по Gläser 2018 Table 1 |
| connecting_ridge_c1_glaser2018 | Connecting Ridge C1 (Gläser 2018, surface) | −89.4505 | 222.84 | UNKNOWN | point (max avg illumination at surface, 20 m DEM) | https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf | LOLA → ME (не указано явно) | high | 76.0 % ср. освещённость за 2017–2037 у поверхности |
| connecting_ridge_c1_glaser2018_2m | Connecting Ridge C1 (Gläser 2018, 2 m above ground) | −89.4398 | 222.83 | UNKNOWN | point (max at 2 m) | https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf | LOLA → ME | high | 88.0 % ср., 92.1 % видимость Солнца; лучшая точка южного полюса на высоте 2 м |
| connecting_ridge_cr1_derosa | Connecting Ridge CR1 (ESA Lunar Lander RoI) | −89.4679 | 222.589 | UNKNOWN | region (RoI centre) | https://arxiv.org/abs/1208.5587 | ME/PA, DE421 (явно) | high | Table 2; совпадает с «222.56, −89.475» из ТЗ; ≈550 м от C1 Mazarico |
| connecting_ridge_c2_glaser2018 | Connecting Ridge C2 | −89.3157 | 245.94 | UNKNOWN | point (max avg illumination at surface) | https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf | LOLA → ME | high | 75.6 %; на 2 м: −89.3130, 245.98 (78.1 %) |
| shackleton_rim_mazarico2011 | Shackleton rim (Mazarico 2011) | −89.78 | 204.27 | UNKNOWN | point (illumination max, 240 m DEM) | https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf | LOLA → ME | high (value), low (precision) | 86.7 % / 90.5 % по Mazarico 2011 |
| shackleton_rim_s_glaser2018 | Shackleton rim S (Gläser 2018) | −89.7849 | 203.97 | UNKNOWN | point (max at surface) | https://ntrs.nasa.gov/api/citations/20170007365/downloads/20170007365.pdf | LOLA → ME | high | 81.0 %; на 2 м две точки: −89.6866, 197.19 и −89.7815, 204.70 |
| shackleton_rim_sr1_derosa | Shackleton Rim SR1 | −89.7755 | 203.552 | UNKNOWN | region (RoI centre) | https://arxiv.org/abs/1208.5587 | ME/PA, DE421 | high | ещё SR2 = −89.689, 197.649; SR3 = −89.812, 52.125 |
| de_gerlache_rim | de Gerlache Rim (LROC) | −88.5 | 293.3 | UNKNOWN | region (LROC mosaic centre) | https://data.lroc.im-ldi.com/lroc/view_rdr/NAC_ROI_DEGERRIMLO1 | not stated → ME | medium | мозаика −89.02…−87.79, 276.82…318.69°E; покрывает и Rim 1, и Rim 2 |
| de_gerlache_rim_gr1_derosa | de Gerlache Rim GR1 | −88.6952 | 291.7154 | UNKNOWN | region (RoI centre) | https://arxiv.org/abs/1208.5587 | ME/PA, DE421 | high | у Wueller эта же точка как площадка «011» = −88.6744, 291.772 (район dGR1, исключён в 2024) |
| de_gerlache_rim_gr2_derosa | de Gerlache Rim GR2 | −89.0073 | 265.2364 | UNKNOWN | region (RoI centre) | https://arxiv.org/abs/1208.5587 | ME/PA, DE421 | high | имя GR2 у ESA не равно «de Gerlache Rim 2» у NASA (у NASA Rim 2 около −88.17, 291°E) |

Высоты нигде не опубликованы рядом с координатами. Их надо снять самим с LOLA LDEM 20 м (PGDA, «LOLA_80S_20M»)
в нашем пайплайне, раз ЦМР всё равно загружается.

## Что не вошло, но может пригодиться

- Районы, исключённые в 2024 (были среди 13 в 2022): Faustini Rim A, Peak Near Shackleton, Connecting Ridge,
  Connecting Ridge Extension, de Gerlache Rim 1, de Gerlache–Kocher Massif, Amundsen Rim (Leibnitz Beta Plateau
  переименован в Mons Mouton). Площадки по всем 16 районам есть в том же Zenodo-файле Wueller (коды FRA, PNS, CR, CRE, dGR1, dGKM, AR).
- Центры мозаик LROC для исключённых: Peak near Shackleton −88.8, 124.7; Faustini Rim A −87.8, 90.0;
  de Gerlache–Kocher −85.8, 243.6; Amundsen Rim −84.2, 69.3.
- В Zenodo-файле есть точки с суффиксом `_K2023` (например, dGR2_K2023 = −88.4500, 292.1409; HW_K2023 = −86.9895, 335.7455).
  Видимо, это площадки из более ранней работы (Kring?, 2023), источник не проверен.

## Открытые вопросы

1. Официальные центры и контуры девяти районов. Проверка: скачать шейп-файлы USGS (doi 10.5066/P1MEQ6UK) вручную в браузере
   (ScienceBase за Cloudflare) и посчитать центроиды сетки 1 км; либо слой «Artemis III regions» в LROC QuickMap.
   Пока `region` для Mons Mouton, Nobile Rim 1, de Gerlache Rim 2 и Slater Plain — `HYPOTHESIS`.
2. Система Wueller и LROC явно не названа (у Wueller только сфера Moon2000). Почти наверняка ME, потому что всё построено на LOLA.
   Проверка: наложить точки на LOLA 20 м и сравнить с картой освещённости PGDA (тест 00b-probe уже ловит PA-сдвиг ~0,03°).
3. Для гребня C1 три разные «точки» в радиусе ~550 м (Mazarico 2011, Gläser 2018, De Rosa 2012). Решить, что показываем:
   максимум по нашей карте AVGVISIB (как в тесте 00b-probe: 222,6°E, −89,47°) или опубликованную точку с подписью источника.
4. Высоты UNKNOWN: снять с LDEM в пайплайне.
5. Привязка районов к миссии: сейчас это кандидатные районы первой высадки (Artemis IV, 2028), отдельного списка для Artemis IV
   NASA не публиковала. Следить за LEAG и LPSC 2027.
