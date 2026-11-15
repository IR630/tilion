# Решения

Строка — что выбрали, до 200 символов. Почему — в коммите. Режим «финал» — только
решения о модели, формате, контракте.

- D-001 (черновик) Контракт данных UI: статика web/public/data/{sites.json, mask/<id>.json, timeline/<id>.json}, MOON_ME, 0–360°E, UTC; типы — web/src/contracts.ts.
- D-002 Имя продукта — Tilion (майар-рулевой Луны у Толкина); подзаголовок «Lunar landing site navigator — Sun, Earth & terrain».
- D-003 UI-прототипы #27 удалены в #36: главный экран — навигатор (D-005), остальные экраны — вкладки с ленивой загрузкой.
- D-004 Маршрут миссии = варианты (площадка × дата посадки) от плана при переносе; режимы Энергия/Связь/Баланс задают веса скора 0–100 (#160); порядок: допуски → скор → |сдвиг| → расстояние.
- D-005 Карта-навигатор: MapLibre, координаты карты = метры полярной стереографии (stereoXY) / 1e6 как lng/lat; подложка basemap/meta.json: layers[{id,kind,file,bounds:[xmin,ymin,xmax,ymax] м}].
- D-006 hours.json: {startUtc, stepMin, n, sites:{id:"0123…"}}; символ на час: 0 ничего, 1 Солнце (sunVisible>0), 2 Земля (earthVisible>0), 3 оба.
- D-007 План миссии: файл JSON "format":"tilion-mission/1" (поля MissionPlan, radiusKm null = любое расстояние, waypoints необязательны) и ссылка ?site=&t=&days=&slip=a..b&radius=&mode=&name=&wp=.
- D-008 Рельеф полярных площадок — по схеме Barker 2021: LOLA 20 м до 5 км (окно по HTTP), 80 м, 240 м дальше. Модель сверяем с Barker 2021 табл. 2; PGDA 69 — справочно, на сетке карты.
- D-009 Своя точка считается в браузере (Web Worker) по data/custom/: ephem.bin — float32 векторы Солнца и Земли (MOON_ME, LT+S, час); dem240-<k>.bin — LOLA 240 м ±304 км, int16 0,5 м, gzip.
- D-010 sunVisible = поток диска Солнца (0,3 + 0,93μ − 0,23μ², Allen 2000) над маской и вне диска Земли (радиус × 1,01, Danjon). Светло = > 0.
- D-011 dsnVisible: почасовые 0/1; станция DSN над маской площадки И та же станция видит центр Луны выше 10° (DSN 301P). ITRF93 → MOON_ME, LT+S; без расписания. earthVisible — центр Земли.
- D-012 Врезки площадок: data/inset/<id>.webp (5×5 км, 512 px, отмывка без Солнца) + <id>.json (bounds в метрах стереографии, source «LOLA 20/80/240 M» по самой грубой DEM в плитке); тип SiteInset.
- D-013 Своя точка: LOLA 240 м на весь квадрат ±931 км (60–90°S), тайлы custom/dem240/<ряд>-<столбец>.bin по 388 px, int16 0,5 м, gzip; браузер берёт тайлы в 300 км. Заменяет dem240-<k> из D-009.
- D-014 Точки маршрута JSON (#160): [{"name","lat","lon"}], lon 0–360°E, lat −60…−90, до 20 точек; файл tilion-route.json; траверс площадка → WP1 → … при 36 м/ч.
- D-015 Подложка карты (#149): пирамида XYZ WebP 256 px; meta.json "tiles" {tileSize, sets[{id,layer relief|photo,url,minzoom,maxzoom,bounds м,resolutionM,source}]}; git z7–16, /hd/basemap/manifest.json — z17–18.
- D-016 blocker/<id>.json: siteId, azStepDeg, distM/riseM — целые метры дуги до максимума горизонта и высоты над площадкой; сетка как mask, лучи LOLA 20/80/240 м, наблюдатель 2 м.
- D-017 Сверка с LROC (#217): data/lroc/index.json {ids, rule, rule9} + <id>.json (split dev|test, S8-поля, s9{agreementPct, shadowIou, excludedPct, pass}) + <id>.webp, _mask, _mask9; тип LrocResult.
- D-018 beta/dsn_stations.json (#259): {startUtc, stepMin, n, thresholdDeg 10, complexes[G,M,C], codes} — символ на час, битовая маска 0–7; earthVisible И codes≠0 = dsnVisible.
- D-019 Для S4 AVGVISIB считаем долю отсчётов с любой видимой частью Солнца (метка PGDA 69), не средний поток диска; высота 0 м, центр пикселя. Допуск 5 п.п. сохраняем.
- D-020 S4_same_dem (#270): та же модель на DEM карты LDEM_75S_120M против AVGVISIB_75S_120M, 75–90°S, 5 п.п.; файлы — исходные IMG/LBL PDS, GDAL по метке.
- D-021 Вердикт PGDA 69 в списке и на карточке — строка Same DEM (метод на DEM карты). Один пиксель карты на нашем DEM — справка: на гребне сдвиг на пиксель меняет долю на десятки п.п. (#311).
- D-022 Группа thermal (#277): Hayne 2017 1D; у полюса альбедо 0,12 и свет/ИК склонов горизонта (Hayne 2021); S10 Table A2 ±5 K; S11 Diviner PRP на склоне его треугольника ±10 K; вне значка площадки.
- D-023 Карта PGDA 69 60 м: Солнце в счёте — на её сетке 60 м (LDEM_75S_60M, порог до расчёта). Строки Солнца на DEM 80 м — справка. Земля в счёте: другой карты нет (#321).
- D-024 beta/dsn_links.json (#383): сетка и порядок G/M/C как dsn_stations; moonElevationDeg[3][n], sites[id] — биты связи по станции. OR битов совпадает с timeline.dsnVisible после #329.
- D-025 skyline/<id>.json (#334, необязательный): горизонт по рельефу в пределах 3 км, 30 км и полный (= mask) на сетке mask, наблюдатель 2 м; near ≤ mid ≤ full. Нет файла — панорама как раньше.
