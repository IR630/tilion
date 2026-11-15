# Полный ресерч: как реально выбирали места посадки на Луну, что происходило при посадках и что из этого нужно Tilion

## Главный вывод

История лунных посадок показывает, что **выбор площадки никогда не сводился к поиску самой ровной точки**. В разные эпохи приоритеты менялись: сначала требовалось доказать, что поверхность вообще выдержит аппарат; затем — научиться попадать в безопасную область; затем — приблизиться к конкретной геологической цели; сейчас, особенно у южного полюса, задача стала многомерной: рельеф, локальные уклоны, посадочная дисперсия, освещение, связь с Землёй, доступ к permanently shadowed regions, температура, энергетика, автономная навигация и научная ценность должны быть приемлемы **одновременно и в конкретное время миссии**. NASA сегодня прямо использует именно такой интегральный подход. citeturn431402search0turn391684search0turn391684search1

Самый важный практический урок для Tilion: **site selection уменьшает часть рисков, но не устраняет отказы посадочной системы**. Luna‑25 разбилась из-за ошибки работы бортового управления и слишком длинного импульса двигателя; Peregrine вообще не дошёл до посадки из-за отказа клапана в propulsion system; Chandrayaan‑2 потерял Vikram из-за динамики descent, вышедшей за расчётные пределы; Beresheet — из-за цепочки отказов во время снижения. Улучшенный DEM сам по себе не исправил бы эти аварии. citeturn351988search4turn351988search5turn692024search7turn477668search47

Но есть и обратные примеры, где **рельеф, site choice и navigation действительно имели прямое значение**. Apollo 11 оказался направлен в район West Crater с валунным полем, и Армстронг вручную перелетел опасную область. Apollo 12 продемонстрировал точную посадку возле Surveyor 3 благодаря гораздо более зрелой навигации. HAKUTO‑R Mission 1 потерпел аварию после того, как изменение места посадки привело аппарат над рельефом, неадекватно покрытым verification-сценариями: прыжок измеренной высоты над краем кратера был отвергнут программой как неисправный sensor reading. IM‑2 в 2025 году показал современную полярную версию той же проблемы: низкое Солнце, длинные тени, crater recognition и altimetry одновременно осложнили финальное снижение. citeturn431402search2turn431402search4turn692024search2turn351988search7

Для Tilion это даёт очень чёткую продуктовую нишу:

> **не “найти лучшую точку”, а показать множество допустимых площадок, ограничения каждой, устойчивость результата к ошибкам данных и реальные mission trade-offs.**

Предыдущий аудит вашего архива показал, что Tilion уже имеет LOLA 80/240 м, SPICE/DE440, terrain horizon, Sun/Earth timelines, несколько высот наблюдателя, Calendar, Compare, Polar Map и 3D Terrain; поэтому имеет смысл строить следующий слой поверх существующей физики, а не добавлять ещё одну карту. fileciteturn1file0 fileciteturn1file1

## Как менялся выбор мест посадки

### От вопроса «можно ли вообще сесть?» к научным площадкам

Первые мягкие посадки решали прежде всего инженерную задачу. Luna 9 3 февраля 1966 года стала первой survivable soft landing на Луне. Surveyor 1 2 июня 1966 года подтвердил, что американская автоматическая система может выполнить radar/rocket-controlled soft landing, а фотографии и следы опор помогли исследовать свойства поверхности. Серия Surveyor затем дала изображения, soil mechanics и химические измерения в нескольких районах, непосредственно поддерживая подготовку Apollo. citeturn483727search7turn483727search1turn483727search0

До Surveyor существовали опасения, сможет ли рыхлый реголит удержать посадочный аппарат. Практические посадки показали, что поверхность выдерживает аппараты, а снимки позволили оценивать распределения кратеров, обломков и свойства реголита. Surveyor 3 и 7 даже имели механический scoop; Surveyor 5, 6 и 7 выполняли химические измерения. Surveyor 6 после посадки кратковременно поднялся и переставился примерно на 2,5 м, что позволило получить стереоскопические наблюдения поверхности. citeturn483727search2turn483727search47

NASA затем использовало Lunar Orbiter как систематическую разведку. Пять аппаратов 1966–1967 годов фотографировали потенциальные площадки Apollo; первые три Orbiter позволили сформировать набор предварительных зон, а Lunar Orbiter 5 дополнительно изучал районы будущих Apollo 15, Apollo 17 и Surveyor 7. citeturn483727search9turn483727search28turn483727search34

Для раннего Apollo критерии были жёстко ориентированы на безопасность: низкие широты и долготы на видимой стороне, достаточно ровная поверхность, отсутствие крупных препятствий на подходе, подходящее освещение и возможность повторных запусков. NASA рассматривало около 30 площадок и в 1968 году объявило пять кандидатов для первой высадки. На фотографиях искали hills, escarpments, craters, boulders и steep slopes; вокруг целевой точки рисовались эллипсы, отражавшие навигационную дисперсию. citeturn431402search0turn431402search1turn483727search35

### Apollo изменил вопрос: «куда безопасно?» → «куда научно полезно?»

У Apollo 11 научная привлекательность была вторична безопасности первой высадки. После успешной демонстрации возможности посадки критерии постепенно стали агрессивнее. Apollo 12 целился рядом с уже стоявшим Surveyor 3, чтобы доказать precision landing. Apollo 15 выбрал Hadley-Apennine — существенно более сложный рельеф рядом с Hadley Rille и горами, но дававший доступ одновременно к mare и highland material. Apollo 17 выбрал Taurus-Littrow специально для доступа к древним highlands и сравнительно молодым вулканическим материалам. citeturn431402search4turn483727search10turn431402search7

Apollo 16 иллюстрирует другой важный урок: геологическая интерпретация до посадки может оказаться неверной. Район Descartes выбирался ради высокогорных геологических единиц, которые предполагались вулканическими; образцы показали, что значительная часть материала была impact-related breccia. Это один из ключевых исторических примеров того, почему карта научной ценности должна показывать **гипотезу и uncertainty**, а не выдавать геологическую интерпретацию за факт. NASA фиксирует основную цель Apollo 16 как исследование и sampling Descartes; последующие выводы программы изменили понимание высокогорной коры. citeturn483727search21turn483727search10

iturn789307image1

На снимке LRO видны фактическая точка Apollo 11, Little West и крупный West Crater. До посадки West Crater и связанное с ним валунное поле стали тем самым локальным hazard, который пришлось обходить вручную. citeturn431402search3turn431402search2

### Современная эпоха: ресурс, дата и системная доступность

После Apollo дистанционные миссии радикально расширили набор критериев. Lunar Prospector обнаружил усиленную концентрацию водорода у полюсов; LCROSS намеренно ударил по Cabeus в 2009 году и подтвердил наличие water-bearing volatiles в постоянно затенённой области; LRO/LOLA/LROC дали глобальную топографию, детальные изображения, illumination и polar datasets. citeturn477668search0turn477668search4turn477668search10

Поэтому современный south-pole site selection — это уже не поиск одного «лучшего места». NASA в 2024 году выделяло девять candidate regions: Peak near Cabeus B, Haworth, Malapert Massif, Mons Mouton Plateau, Mons Mouton, Nobile Rim 1/2, de Gerlache Rim 2 и Slater Plain. Они оценивались по science value, terrain, lighting, Earth communications и совместимости с полной архитектурой миссии. citeturn391684search0turn675607search1

Есть важное обновление на **14 ноября 2026 года**: первоначальная концепция Artemis III как лунной посадки устарела. NASA 23 октября 2026 года объявило, что Artemis III в 2027 году будет демонстрационной миссией в низкой околоземной орбите, а первую новую пилотируемую посадку NASA сейчас планирует на **Artemis IV в 2028 году**. Поэтому прежние «Artemis III candidate landing regions» остаются важными результатами site-selection исследований, но их нельзя сегодня без оговорки называть окончательными площадками Artemis III. citeturn675607search2turn675607search5turn675607search6

## Что реально определяет пригодность посадочной площадки

У site selection есть три разных уровня, которые Tilionу полезно разделять.

**Первый — физическая площадка.** Здесь важны высота, slope на нескольких spatial baselines, roughness, crater/boulder abundance, размер contiguous safe patch, наличие NoData и uncertainty DEM. Южнополярные продукты NASA уже содержат не только DEM, но и slope maps, высотные uncertainty, slope uncertainty, count maps и 100 statistical clones; современные shape-from-shading продукты дают 5 м/пиксель для отдельных candidate regions и добавляют terrain detail там, где обычный LOLA сильно интерполирован между tracks. citeturn391684search2turn391684search3

**Второй — доступность посадки.** Даже идеальная ровная площадка бесполезна, если landing ellipse, navigation errors или траектория приводят аппарат через опасный рельеф. Это фундаментальный урок и Apollo, и HAKUTO-R Mission 1. NASA ещё в Apollo строило вероятностные landing ellipses вокруг target point; ispace в 2023 году обнаружила, что после изменения landing site программа проверки недостаточно моделировала фактический terrain по маршруту снижения. citeturn431402search0turn692024search2

**Третий — эксплуатация после посадки.** Нужно учитывать солнечное питание, thermal conditions, DTE/relay communications, возможности EVA/rover traverse, proximity к science targets и operational schedule. NASA HLS ConOps отдельно указывает разумные slopes, EVA traverse slopes, solar lighting и RF line-of-sight; для sustained-phase документ приводит, например, пожелание выравнивания lander приблизительно в пределах 8° от горизонтали, предпочтительно около 5°, и EVA traverse менее 20°. Это **конкретные HLS operational considerations**, а не универсальные законы для любого лендера. citeturn391684search9

То же относится к числам из других миссий. Например, Blue Ghost Mission 1 выбирал район около Mons Latreille с заявленными критериями low slope менее 2° на 4-метровой базе и низкой rock abundance. Это характеристика конкретного lander/site analysis, а не универсальный безопасный предел для всех аппаратов. citeturn557115search10

На южном полюсе освещение особенно сложно. NASA отмечает, что Солнце в relevant regions остаётся очень низко над горизонтом; небольшие изменения рельефа и даты могут резко менять видимость. Анализы Artemis также показывают, что illumination и DTE opportunities связаны с libration и calendar geometry, поэтому площадка, хорошая в один месяц, может быть неудобна в другой. citeturn391684search6turn391684search7turn675607search1

Предыдущий communication-аудит Tilion важен именно здесь: у вас уже вычисляется Earth relative to terrain horizon, но это означает **геометрическую Earth LOS**, а не гарантированный radio contact. Настоящее окно должно в идеале пройти три уровня: geometric LOS → RF-feasible link → operationally scheduled contact. fileciteturn1file2

## Реальные посадки: что планировали и что произошло

### Сравнительная матрица успешных и частично успешных операций

| Миссия | Что выбирали / зачем | Что произошло | Практический урок |
|---|---|---|---|
| **Luna 9**, 03.02.1966 | Oceanus Procellarum; инженерная демонстрация survivable soft landing | Первая успешная мягкая посадка; доказала практическую реализуемость surface operations. citeturn483727search7turn483727search24 | На раннем этапе engineering feasibility важнее science optimization. |
| **Surveyor 1**, 02.06.1966 | Apollo-compatible region; проверка terminal descent, radar и surface bearing | Успешно сел, передал >10 тыс. изображений; вокруг были метровые валуны. citeturn483727search1turn483727search8 | Даже safe-looking mare содержит hazards; ground truth нужен для calibration orbital interpretation. |
| **Surveyor 3**, 20.04.1967 | Oceanus Procellarum | Позже стал целью Apollo 12; аппарат оказался внутри небольшого кратера. citeturn431402search6 | Координата ≠ эксплуатационный контекст; локальная геометрия важна. |
| **Surveyor 5/6/7**, 1967–68 | Разные геологические районы, включая Tycho | Подтвердили surface mechanics и химический состав; Surveyor 6 сделал короткий повторный hop. citeturn483727search0turn483727search47 | Несколько sites нужны для проверки переносимости выводов. |
| **Apollo 11**, 20.07.1969 | Mare Tranquillitatis; максимально безопасная первая human landing zone | Автоматика вела LM к West Crater/boulder field; Armstrong перешёл к ручному управлению и выбрал более гладкий участок; blowing dust ухудшал оценку lateral velocity. citeturn431402search1turn431402search2 | Safe target ellipse не гарантирует safe touchdown point; onboard/manual hazard avoidance критичен. |
| **Apollo 12**, 19.11.1969 | Точная посадка рядом с Surveyor 3 | После ground navigation correction сел примерно в 535 ft от Surveyor 3. citeturn431402search4turn431402search5 | Хорошая navigation + real-time correction превращает site selection в достижимую точную задачу. |
| **Apollo 15**, 30.07.1971 | Hadley-Apennine ради geological diversity и доступа к rille/highlands | Успешная более сложная J-mission, rover расширил область исследования. citeturn483727search10 | После снижения landing risk можно сознательно обменивать простоту terrain на science value. |
| **Apollo 16**, 21.04.1972 UTC | Descartes highlands | Успешно, примерно 276 м от planned point; научная интерпретация terrain изменилась после samples. citeturn483727search25turn483727search21 | Геологические карты должны иметь confidence, а не categorical labels. |
| **Apollo 17**, 11.12.1972 | Taurus‑Littrow ради древнего highland material + молодых dark deposits | Успешная посадка и расширенная rover geology. citeturn431402search7turn431402search8 | Science proximity становится сильным фактором после зрелости landing system. |
| **Luna 16**, 20.09.1970 | Mare Fecunditatis, sample return | Успешная первая роботизированная lunar sample return. citeturn483727search13turn483727search22 | Site selection может быть оптимизирован под конкретную science operation, а не длительную surface mobility. |
| **Luna 20**, 1972; **Luna 24**, 1976 | Highland/sample-return targets | Обе успешно вернули образцы; Luna 24 села около 12.714°N, 62.213°E. citeturn483727search22turn483727search26 | Разные sites нужны для comparative geology. |
| **Chang’e‑3**, 14.12.2013 | Near-side Mare Imbrium region | Успешная lander+rover operation; ESA отслеживала descent signals. citeturn483727search30turn483727search38 | Ground-station geometry — часть landing operations, не только surface comms. |
| **Chang’e‑4**, 03.01.2019 | Von Kármán crater, far side | Первая мягкая посадка на far side; связь требовала relay architecture. citeturn483727search23turn483727search29 | Для far side DTE невозможна; relay availability становится hard constraint. |
| **Chang’e‑6**, 01.06.2024 | Apollo Basin, lunar far side | Успешно взяла и вернула far-side samples; использовалась relay infrastructure, LRO определил landing location ~42°S, 206°E. citeturn483727search15turn483727search31turn483727search32 | Site science value, relay geometry и sample-return trajectory должны рассматриваться совместно. |
| **Chandrayaan‑3**, 23.08.2023 | Южнополярный high-latitude highland region | Успешный soft landing после redesign Chandrayaan‑2; lander имел hazard detection camera, laser/RF altimetry и velocity sensing. citeturn557115search0turn557115search1 | Robustness к dispersion и sensor variation важнее оптимальной target point. |
| **SLIM**, 20.01.2024 JST | Восточнее Shioli crater; technology demo pinpoint landing | Достиг ~55–60 м от target; thruster anomaly привела к неправильной ориентации и отсутствию первоначальной solar generation. citeturn557115search4turn557115search6 | Высокая positional accuracy не гарантирует operational success после touchdown. |
| **IM‑1 Odysseus**, 22.02.2024 | South-pole region | Soft landed, но lander оказался наклонён/на боку; тем не менее передал scientific/technology data около недели. citeturn557115search8 | Landing success нужно оценивать не бинарно: touchdown, attitude, power и science return — разные метрики. |
| **Blue Ghost Mission 1**, 02.03.2025 | Mons Latreille, Mare Crisium | Успешная upright landing; site выбирался по low slope и low rock abundance. citeturn557115search9turn557115search10 | Mission-specific site constraints можно формализовать в Tilion как profile. |
| **IM‑2 Athena**, 06.03.2025 | Mons Mouton near south pole | Села внутри crater, более чем 250–400 м от target по разным operator/NASA formulations, оказалась на боку и быстро потеряла энергетическую возможность. citeturn351988search2turn351988search3 | Южнополярные shadows, altimetry и crater recognition должны тестироваться вместе. |

### Apollo 11 — самый важный operational case для Tilion

Apollo 11 — отличный пример того, почему landing site нельзя представлять как точку. NASA предварительно выбрало гладкую область, основываясь на Lunar Orbiter и Surveyor. Но во время descent фактическая траектория выводила Eagle к West Crater и ejecta boulder field. Armstrong описал, что перешёл в manual control, перелетел crater/boulders и выбрал более ровный участок между кратерами. При снижении ниже примерно 100 ft engine plume начал поднимать dust, который ухудшал визуальную оценку lateral velocity. citeturn431402search1turn431402search2

Для Tilion это прямо переводится в четыре функции: **landing ellipse**, **hazard density внутри ellipse**, **approach corridor**, **worst-case safe patch вместо target point**.

### Apollo 12 — точность не появляется из DEM

Apollo 12 целился рядом с Surveyor 3. Во время descent Houston заметил trajectory discrepancy; новый ground processor позволил рассчитать correction, данные были переданы экипажу голосом, после чего LM приземлился примерно в 535 ft от Surveyor. citeturn431402search4turn431402search5

Урок: Tilion может оценить site geometry, но **navigation performance и correction authority должны быть отдельными input parameters**. Нельзя считать landing ellipse фиксированным свойством площадки.

### SLIM — точное попадание и плохая ориентация одновременно

SLIM специально создавался для демонстрации landing within ~100 m-class target area. JAXA оценила попадание примерно в 55 м от цели и очень малую positional error до начала obstacle-avoidance maneuver. Но потеря части thruster capability в финальной фазе привела к abnormal attitude; солнечные панели первоначально не генерировали энергию. citeturn557115search4turn557115search6turn557115search5

Это очень важный урок для scoring: **точность touchdown и качество post-landing orientation — отдельные цели**.

## Неудачи и частичные неудачи: что на самом деле было причиной

| Миссия | Тип результата | Подтверждённая причина / состояние | Насколько виноват site selection |
|---|---|---|---|
| **Luna 15**, 1969 | crash during descent | Исторический hard impact; подробный modern official anomaly report недоступен в найденных первичных источниках. NASA каталог фиксирует crash site, но не даёт достаточной причинной детализации. citeturn477668search18 | **Не установлено.** Нельзя приписывать terrain без evidence. |
| **Luna 23**, 1974 | landed but sample-return failed | Посадка повредила/нарушила работоспособность аппарата; полной первичной telemetry reconstruction в найденном наборе источников нет. | **Неясно.** Не стоит делать сильный вывод. |
| **Luna‑25**, 19.08.2023 | crash before landing | Двигатель отработал 127 с вместо 84 с; наиболее вероятная причина — fault onboard control/accelerometer data handling, после чего аппарат ушёл на незамкнутую траекторию и столкнулся с Луной. citeturn351988search4 | **Практически нет.** Улучшенный DEM не спас бы миссию. |
| **Chandrayaan‑2 Vikram**, 07.09.2019 | hard landing | Первый descent phase нормальный; затем velocity reduction отличалась от design, fine-braking начался вне допустимых initial conditions; hard landing произошёл в пределах ~500 м от designated site. citeturn692024search7 | **Site selection не первопричина.** |
| **Beresheet**, 11.04.2019 | hard impact | NASA фиксирует потерю во время landing; NASA safety-study summarization указывает reboot/software/engine-shutdown chain. citeturn477668search1turn477668search47 | **Не terrain-driven.** |
| **HAKUTO‑R M1**, 26.04.2023 JST | crash after fuel depletion | Lander прошёл над ~3 км terrain feature; sensor altitude резко изменился, software отверг measurement как abnormal. Изменение landing site после CDR повлияло на verification plan; terrain по маршруту был недостаточно смоделирован. citeturn692024search2 | **Да, косвенно и существенно.** Не unsafe touchdown site, а interaction terrain + software/V&V. |
| **Peregrine Mission One**, январь 2024 | failure to reach landing | Most likely root cause — loss of seal in helium pressure control valve, overpressure/oxidizer leak. citeturn351988search5turn351988search6 | **Нет.** Site model не имеет отношения к отказу. |
| **IM‑1 Odysseus**, 22.02.2024 | soft landing, tipped | Аппарат передал data и проработал запланированную примерно недельную surface interval, но оказался наклонён. citeturn557115search8 | **Частично возможно**, но доступные NASA summary не дают основания свести исход только к site selection. |
| **SLIM**, 20.01.2024 | success with anomaly | Thruster trouble непосредственно перед landing; неправильная orientation → солнечная генерация первоначально отсутствовала. citeturn557115search4turn557115search6 | **Нет как primary cause.** |
| **IM‑2 Athena**, 06.03.2025 | soft/hard operationally degraded landing, tipped | Intuitive Machines после полёта указала laser-altimeter interference, lighting/terrain effects и crater-recognition tuning как три ключевых findings; long shadows и low-angle Sun осложнили optical navigation. citeturn351988search7 | **Да, terrain/lighting были частью causal chain**, но не единственным фактором. |
| **HAKUTO‑R M2**, 06.06.2025 | hard landing | Laser rangefinder поздно начал давать valid measurements; lander не успел достаточно замедлиться. Июньский technical analysis связал hard landing с LRF anomaly; независимый review 2026 расширил анализ на system-level causes. citeturn692024search9turn692024search4turn692024search5 | **Не доказано как site-selection failure.** |

### HAKUTO‑R Mission 1 — кейс, который Tilion должен обязательно показывать

Это один из самых ценных современных уроков. При descent lander прошёл над rim/crater relief примерно на 3 км выше окружающей поверхности. Altimeter увидел изменение, но prediction model ожидал другое; filter решил, что sensor выдаёт abnormal reading, и перестал использовать данные высоты. Аппарат считал себя у поверхности, фактически находясь примерно в 5 км над ней, затем продолжал снижаться до исчерпания топлива и упал. ispace прямо указала, что смена landing site после critical design review повлияла на verification/validation и что simulations недостаточно воспроизводили lunar environment по новой trajectory. citeturn692024search2turn692024search3

Для Tilion это не просто «нужен лучший DEM». Нужна функция:

> **Approach Terrain Consistency Check** — показать профиль рельефа вдоль финальной траектории, ожидаемый altitude-vs-range и потенциальные резкие изменения range measurement.

Это очень сильная demo feature, потому что напрямую основана на реальном accident report.

### IM‑2 — почему южный полюс сложнее Apollo

После IM‑2 оператор выделил три связанные проблемы: шум/искажение laser altimeter на финальном descent; low-angle solar illumination и terrain shadows; crater-recognition database/tuning, основанную на orbital imagery, которая не полностью отражала вид crater shapes с низкой высоты и при полярном освещении. citeturn351988search7

Это означает, что «у нас есть LRO image» недостаточно. Для landing navigation важно, **как terrain выглядит из перспективы камеры аппарата при конкретном Sun geometry**.

## Южный полюс, наука и реальные trade-offs

Южный полюс привлекателен не потому, что там существует одна «идеальная площадка». Lunar Prospector обнаружил polar hydrogen enhancement; LCROSS затем целенаправленно ударил по постоянно затенённому Cabeus и подтвердил volatile-bearing material. LRO и последующие исследования показали, что PSR и ice indications распределены неоднородно. citeturn477668search0turn477668search4turn477668search14

Отсюда возникает фундаментальный конфликт:

**научно интересные участки** часто находятся рядом с холодными, теневыми, геометрически сложными зонами;

**энергетически удобные участки** стремятся к возвышенностям с хорошим solar exposure;

**communication-friendly участки** требуют хорошего Earth line-of-sight;

**посадочно безопасные участки** требуют низких slopes, достаточного safe footprint и понятного terrain;

**роверу** нужен проход между science target и lander с приемлемым terrain.

NASA в Artemis site-selection анализирует эти ограничения вместе, а не последовательно. При DTE architecture предпочтительнее regions с лучшей Earth visibility; illumination должна быть устойчивой на surface-stay interval; launch date и trajectory способны изменить доступность региона. citeturn391684search0turn675607search1

iturn789307image0

Это особенно важно для Tilion: **один общий score скрывает trade-off**. Две площадки могут быть одинаковыми по итоговым 82/100, но одна может быть отлична по science и плоха по comms, другая наоборот. Поэтому я бы показывал не только weighted score, но и **Pareto frontier**.

На практике scoring должен разделяться минимум на:

| Категория | Возможные physical metrics |
|---|---|
| Terrain | max/mean slope [deg], roughness [m], safe-patch area [m²], boulder/crater density |
| Landing robustness | fraction of landing ellipse meeting hard constraints, approach-corridor hazards |
| Illumination | continuous Sun window [h], fractional Sun visibility, minimum Sun clearance [deg] |
| Communications | continuous geometric Earth LOS [h], minimum terrain clearance [deg], RF link margin [dB] — если рассчитан |
| Thermal | predicted surface/environment temperature range, если есть validated model |
| Science | distance to PSR/geologic unit/sample target [m or km], science-category flags |
| Mobility | traversable fraction/path slope, route length |
| Data confidence | DEM resolution, effective resolution, height uncertainty, missing data fraction |

Для Apollo удобная площадка была в основном close-to-equatorial nearside mare. Для Artemis-like polar operations почти каждый критерий становится time-dependent. NASA даже отмечает, что usable illumination geometry у south pole сезонно смещается примерно на недели от года к году. citeturn675607search1

## Что это означает для Tilion

### Что уже есть и чего не нужно повторять

Аудит вашего архива показал, что Tilion уже содержит Globe, Compare, Horizon, Polar Map, Terrain 3D, Calendar и validation view; backend использует SPICE, LOLA и terrain ray-marching. Calendar уже вычисляет Sun/Earth overlap и longest overlap, Compare имеет date-slip, а sensitivity частично считается для observer heights 0/2/10 м и разных DEM. fileciteturn1file0

Поэтому следующие функции не стоит продавать как новую уникальность:

- «мы показываем рельеф»;
- «мы показываем Earth visibility»;
- «мы показываем sunlight»;
- «у нас 3D Moon»;
- «у нас есть longest Sun+Earth window».

Они уже либо существуют в Tilion, либо встречаются в Moon Trek, QuickMap и других planners. fileciteturn1file0

### Системная модель выбора sites

Я бы разделил pipeline на четыре стадии.

**Hard constraints** отбрасывают физически недопустимые места. Например:

```text
slope_max > mission_limit            -> reject
safe_patch < required_footprint      -> reject
Earth_LOS_continuous < required      -> reject
Sun_window < required                -> reject
DEM_coverage insufficient            -> unknown / reject by policy
```

Порог должен принадлежать **mission profile**, а не быть вшит в Tilion как универсальный.

Затем **risk aggregation по footprint/ellipse**. Не оценивать только central pixel:

\[
P_{\mathrm{safe}}
=
\int_{\mathrm{landing\ ellipse}}
I_{\mathrm{terrain\ admissible}}(x,y)
\,p(x,y)\,dx\,dy
\]

Даже если вы не имеете настоящую probability distribution navigation error, MVP может честно использовать uniform ellipse coverage и называть это **ellipse safe-area fraction**, а не probability of landing success.

Далее — **multi-objective scoring**:

\[
S=w_TT+w_CC+w_PP+w_SS+w_MM
\]

где terrain, communications, power/illumination, science и mobility нормируются отдельно. Но UI должен показывать все components и weights, иначе score становится непроверяемой магией.

Наконец — **uncertainty**. Для каждой площадки полезно рассчитывать:

```text
nominal score
score range under:
    ± coordinate shift
    DEM 80m vs 20m/5m
    observer height
    landing-date shift
    terrain uncertainty clones
```

Предыдущий terrain audit уже показал, что NASA предоставляет effective-resolution и uncertainty layers, а ваш текущий 80/240 м DEM заметно грубее доступных polar products. fileciteturn1file1 citeturn391684search2turn391684search3

### Самые сильные новые фичи из реальных аварий

| Реальный урок | Фича Tilion |
|---|---|
| Apollo 11 — target ellipse содержал локальный boulder/crater hazard | **Landing Ellipse Risk Map** |
| Apollo 12 — real-time navigation correction позволила точную посадку | **Landing dispersion slider / navigation profile** |
| Apollo 16 — pre-landing geologic interpretation оказалась неполной | **Science confidence / hypothesis layer** |
| HAKUTO-R M1 — terrain profile конфликтовал с onboard altitude expectation | **Approach Terrain Profile + altimeter expectation** |
| Chandrayaan-2 — descent state вышел за design envelope | **Не пытаться выдавать terrain score за landing-success probability** |
| SLIM — точное попадание, но abnormal attitude и solar problem | **Separate touchdown accuracy / post-landing operability scores** |
| IM-2 — low Sun and crater appearance ухудшили optical navigation | **Landing-lighting preview / shadow severity** |
| Luna‑25 — propulsion/control failure | **Explicit “not covered by site-selection” failure category** |
| Peregrine — valve failure до посадки | **Mission-system disclaimer / failure mode taxonomy** |
| Artemis south pole — несколько constraints совпадают только в узких датах | **Integrated mission-window finder** |

### Концепт интерфейса

Для выбранной точки я бы показывал не «Score 87».

Лучше:

```text
MALAPERT CANDIDATE 04

Landing terrain             PASS
Slope 50 m baseline         3.1°
Slope 250 m baseline        1.7°
Safe ellipse coverage       86%
Terrain confidence          MEDIUM
DEM effective resolution    18–65 m

Sun
Continuous window           91 h
Minimum clearance           +1.4°

Earth
Geometric DTE               76 h
Minimum terrain clearance   +0.6°
RF link                     NOT MODELLED

Science
PSR distance                1.8 km
Geologic confidence         MEDIUM

ROBUSTNESS
+500 m location shift       score: 81–89
+3 day schedule slip        FAILS illumination constraint

WHY NOT SITE B?
Better science access,
but 37% of its landing ellipse exceeds the current slope profile.
```

Числа выше — **макет интерфейса, не реальные данные конкретного Malapert site**.

## Roadmap и практические уроки

### P0 — то, что реально усилит хакатон за один–три дня

**Landing Ellipse Risk.** Пользователь задаёт размер ellipse или выбирает profile аппарата. Tilion показывает, какая часть ellipse удовлетворяет slope/terrain constraints. Это прямой урок Apollo.

**Terrain blocker explanation.** У вас уже считается horizon; сохраняйте distance и coordinates блокирующей возвышенности и объясняйте «Earth blocked by ridge 23 km away». Это естественное продолжение текущего pipeline. fileciteturn1file2

**Automatic Mission Window Finder.** Не только longest Sun+Earth overlap, который уже есть, а поиск ближайшей даты после schedule slip, когда одновременно выполняются terrain-independent operational constraints.

**Mission-specific thresholds.** Profiles: `Apollo-like demo`, `small robotic lander`, `polar science lander`, `custom`. Все числа должны быть labeled как requirements/profile values, а не «NASA universal limits».

**Failure mode disclaimer.** Рядом с suitability показать:

> Terrain/site analysis does not model propulsion, software, sensor, structural or guidance failures.

Это научно и инженерно очень сильный элемент — и он напрямую подтверждается Luna‑25, Peregrine, Chandrayaan‑2 и Beresheet. citeturn351988search4turn351988search5turn692024search7turn477668search47

### P1 — одна–две недели

Добавить LOLA 20/10 м для south pole и 5 м products для выбранных regions. NASA PGDA предоставляет DEM, slopes, count/effective-resolution и uncertainty products. citeturn391684search2turn391684search3

Добавить **multiscale slope** — например 20, 50, 100, 250 м. Нельзя сводить terrain к одному slope number.

Добавить **approach corridor** и рельеф под trajectory. HAKUTO-R M1 — идеальный validation story.

Добавить **shadow/lighting navigation severity**: не просто Sun visible, а low-angle Sun, contrast/shadow environment. IM‑2 делает этот пункт особенно обоснованным. citeturn351988search7

Добавить **Pareto view**:

```text
Science ↑
         site A ●
               \
                ● site C   ← Pareto frontier
             ● B
                  ● D
                         Safety →
```

Пользователь может видеть, что «лучшего вообще» site не существует.

### P2 — более долгий горизонт

High-resolution LROC NAC / SfS regional terrain.

Boulder/crater catalogue из image analysis.

Surface thermal model.

RF link budget и конкретные ground stations.

TRN simulation — synthetic descent camera frames при реальном Sun geometry.

Rover route planning.

Monte Carlo landing dispersion.

Physics-based plume/regolith interaction — но это уже существенно выходит за разумный scope Space Apps.

### Протокол валидации

Первый validation site — **Apollo 11**. Ввести approximate approach corridor и проверить, что West Crater/boulder terrain выделяется как hazard relative to touchdown area. Не нужно симулировать весь LM.

Второй — **Apollo 12**. Проверить географию Surveyor 3 и реальной LM позиции; продемонстрировать маленькую посадочную ошибку без утверждения, что Tilion воспроизводит Apollo navigation.

Третий — **SLIM**. Проверить target vs actual landing coordinates и показать, что excellent positional accuracy не означает good orientation/power state. citeturn557115search4turn557115search6

Четвёртый — **HAKUTO-R M1**. Воспроизвести большой terrain change на descent corridor. Не пытаться повторить proprietary flight software; показать только environmental geometry, которая входила в causal chain. citeturn692024search2

Пятый — **IM‑2**. Использовать как southern-polar case: crater, low Sun, terrain shadows, actual offset. citeturn351988search2turn351988search7

## Главные практические уроки для Tilion

1. **Landing site — область вероятности, а не точка.** Apollo site selection уже использовал ellipses. citeturn431402search0
2. **Предварительно безопасная зона может содержать опасный touchdown patch.** Apollo 11 — прямое доказательство. citeturn431402search2
3. **Точность посадки и безопасность посадки — разные параметры.**
4. **Точность посадки и эксплуатационная пригодность после touchdown — тоже разные параметры.** SLIM это показал особенно ясно. citeturn557115search6
5. **Высокое разрешение DEM не заменяет onboard hazard avoidance.**
6. **Подход к площадке нужно анализировать вместе с самой площадкой.** HAKUTO-R M1. citeturn692024search2
7. **Изменение site после design freeze требует повторной verification всей descent environment.**
8. **Low-angle polar sunlight — navigation hazard, а не только энергетический параметр.** IM‑2. citeturn351988search7
9. **Earth visibility ≠ гарантированная связь.** Для Tilion это уже было подробно разобрано в communication research. fileciteturn1file2
10. **Sun visibility ≠ доступная электрическая мощность.**
11. **Один slope number недостаточен:** slope зависит от spatial baseline.
12. **Размер DEM pixel ≠ фактическое resolution.** NASA поэтому публикует effective-resolution и uncertainty layers. citeturn391684search2turn391684search3
13. **Научная карта — это гипотеза, пока её не подтвердили ground truth/sample.** Apollo 16 — важный пример.
14. **Failure to land нельзя автоматически объяснять плохим site.** Luna‑25, Peregrine и Chandrayaan‑2 показывают противоположное. citeturn351988search4turn351988search5turn692024search7
15. **Реальный mission window — пересечение множества time-dependent constraints.** NASA применяет именно integrated availability analysis для полярных миссий. citeturn675607search1
16. **Лучшей площадки глобально не существует:** есть Pareto-optimal sites для разных mission goals.
17. **Неопределённость должна быть частью результата**, а не footer/disclaimer.
18. **Tilion должен говорить “research planning tool”, а не “safe landing certification”.**
19. **Реальные аварии — отличный validation dataset**, если не делать ложный causal claim.
20. **Самая сильная функция Tilion — объяснить “почему этот site и почему именно сейчас”.**

## Ключевые первоисточники

NASA Apollo landing-site history:  
https://www.nasa.gov/wp-content/uploads/static/history/SP-350/ch-5-5.html citeturn431402search0

Apollo 11 technical crew debriefing:  
https://www.nasa.gov/wp-content/uploads/static/history/alsj/a11/a11tcdb.html citeturn431402search2

Apollo 12 precision landing:  
https://www.nasa.gov/missions/apollo/apollo-12-the-pinpoint-mission/ citeturn431402search4

Apollo 17 mission/site:  
https://www.nasa.gov/missions/apollo/apollo-17-mission-details/ citeturn431402search7

NASA Surveyor history:  
https://science.nasa.gov/mission/lunar-rangers-and-surveyors/ citeturn483727search0

NASA Lunar Orbiter history:  
https://www.nasa.gov/history/60-years-ago-nasa-approves-the-lunar-orbiter-program/ citeturn483727search9

NASA PGDA high-resolution south-pole LOLA:  
https://pgda.gsfc.nasa.gov/data/LOLA_5mpp/ citeturn391684search2

NASA PGDA Enhanced Topography / Shape-from-Shading:  
https://pgda.gsfc.nasa.gov/products/104 citeturn391684search3

Artemis candidate-region update:  
https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/ citeturn391684search0

2026 Artemis program update — Artemis III now LEO test, first landing targeted for 2028:  
https://www.nasa.gov/missions/artemis/nasas-artemis-iii-mission-to-test-future-moon-lander-operations/ citeturn675607search2

ISRO Chandrayaan‑2 official parliamentary failure explanation:  
https://www.isro.gov.in/media_isro/pdf/docs/UsefulLinks/ParliamentQuestions/winter_session_2019.pdf citeturn692024search7

ISRO Chandrayaan‑3 systems and hazard avoidance:  
https://www.isro.gov.in/ISRO_EN/Chandrayaan3_Details.html citeturn557115search0

JAXA SLIM mission data:  
https://darts.isas.jaxa.jp/en/missions/slim citeturn557115search4

ispace HAKUTO‑R Mission 1 postmortem:  
https://www.ispace-inc.com/2023/05/26/ispace-announces-results-of-the-hakuto-r-mission-1-lunar-landing/ citeturn692024search2

ispace HAKUTO‑R Mission 2 technical analysis:  
https://2022.ispace-inc.com/news-en/?p=7671 citeturn692024search4

Astrobotic Peregrine post-mission report:  
https://www.astrobotic.com/wp-content/uploads/2024/08/PM1_Post-Mission-Report_2024-1.pdf citeturn351988search5

Roscosmos Luna‑25 investigation summary:  
https://www.roscosmos.ru/39790/ citeturn351988search4

NASA IM‑2 result:  
https://www.nasa.gov/news-release/nasa-receives-some-data-before-intuitive-machines-ends-lunar-mission/ citeturn351988search2

NASA LCROSS:  
https://science.nasa.gov/mission/lcross/ citeturn477668search4

NASA Lunar Prospector science:  
https://nssdc.gsfc.nasa.gov/planetary/lunar/lp_science.html citeturn477668search0

Самый разумный следующий шаг для Tilion после этого исследования — **не добавлять ещё одну “красивую” карту Луны**, а собрать один интегрированный экран `Landing Decision`, где пользователь видит landing ellipse, terrain risk, Sun/Earth windows, science proximity, uncertainty и конкретное объяснение того, почему соседняя площадка или другая дата стала хуже. История реальных миссий показывает, что именно сочетание этих факторов, а не один показатель, определяет практическую ценность site selection.