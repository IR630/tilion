# Tilion: глубокое исследование аналогов, реальной практики и приоритетов продукта

## Короткий вывод

**Три наиболее сильных направления для Tilion сейчас:**

1. **Автоматический поиск ближайшего устойчивого окна посадки после сдвига даты.** В Tilion уже есть ручной date slip и календарь с Sun/Earth overlap, поэтому сильная новая функция — не ещё один график, а ответ на практический вопрос: «Если посадка сдвинулась на 3/7/10 суток, какое ближайшее окно сохраняет заданную продолжительность освещения и геометрической видимости Земли, а почему остальные даты отпали?» Это напрямую соответствует реальной логике NASA, где доступность площадки зависит от сочетания даты запуска, траектории, освещения, связи и других ограничений. citeturn709859view0turn709859view1turn889861view5

2. **Объяснимость и устойчивость результата: “почему соседние точки отличаются?” + чувствительность к рельефу, высоте и координате.** Это особенно важно для Tilion, потому что в приложенном коде уже вычисляются варианты для высоты наблюдателя 0/2/10 м и разных LOLA DEM, но собственный `validation.json` содержит **47 проверок, из которых 40 pass и 7 fail**, причём провалы освещённости связаны с сильной чувствительностью к выбору пикселя/окрестности. NASA прямо предупреждает, что в районе южного полюса режим света может существенно меняться на очень коротких расстояниях. citeturn709859view0turn889861view3

3. **Evidence-first UX: качество данных и ограничения как часть результата, а не спрятанный disclaimer.** Для каждого ответа Tilion стоит показывать: использован ли настоящий LOLA или сферическая модель; разрешение DEM; высоту наблюдателя; временной диапазон расчёта; является ли результат real или mock; статус независимой проверки; и чётко отделять «Earth geometrically visible» от «связь обеспечена», а «Sun visible» — от «вырабатывается достаточная мощность». NASA/LOLA отдельно отмечает, что даже их карта Earth visibility несколько оптимистична для радиолинии, а официальная задача Space Apps формулирует эти величины как оценку потенциальной генерации и DTE-возможностей, не как гарантированную энергетику или канал связи. citeturn889861view3turn335952search0

**Приоритет продукта:** объяснять выбор площадки, устойчивость результата и пределы достоверности расчёта.

**Главный риск:** интерфейс может выглядеть убедительнее, чем позволяет текущая валидация. В архиве Tilion эпhemeris-проверки выглядят сильными, но семь illumination checks не проходят собственные критерии, и часть расхождений очень чувствительна к пикселю. До презентации нельзя превращать такие данные в категоричное «эта площадка лучше» без визуализации неопределённости и происхождения результата.

## Что реально удалось проверить

Архив **`/mnt/data/nasa_hack-main.zip` действительно был доступен и изучен напрямую**. Я не ограничивался скриншотом README. Были просмотрены frontend, backend/precompute pipeline, JSON-данные и validation output.

По коду Tilion уже имеет значительно больше возможностей, чем можно понять из одного README:

| Что уже есть | Что найдено в коде | Вывод для выбора фич |
|---|---|---|
| Основные представления | `App.tsx`: Globe, Compare, Horizon, Polar map, 3D terrain, Calendar, NASA check | Не стоит делать ещё один отдельный «экран с картой» ради самого экрана |
| Реальные данные | LOLA 80/240 м, SPICE DE440; временной ряд примерно с 2026-12-01 до 2028-01-01, шаг около часа | Автопоиск окон можно сделать поверх готовых временных рядов |
| Sun/Earth overlap | `Calendar.tsx` уже показывает Sun, Earth, both и **longest Sun+Earth window** | «Пересечение солнца и Земли» и «самое длинное непрерывное окно» **не новые функции** |
| Перенос даты | `Compare.tsx` уже позволяет date slip от −14 до +30 суток и показывает delta относительно базовой даты | Нужен не slider, а **автоматический recovery finder** |
| Неопределённость | `summary.ts` вычисляет диапазон `lo–hi`; варианты высоты 0/2/10 м и DEM 80/240 м | Sensitivity уже частично рассчитана; надо сделать её понятной пользователю |
| Горизонт | `Horizon.tsx`, backend ray marching, шаг по азимуту около 0,5°, дальность до 300 км | Можно объяснить конкретный terrain blocker; но сейчас нужно дополнительно сохранить расстояние/координату blocking point |
| Произвольная точка | `PolarMap.tsx` позволяет выбрать custom point | Вне предвычисленных данных часть результата может перейти в synthetic/mock — это должно быть явно видно |
| Эфемериды | `ephem.py`: SPICE, Moon-fixed frame, light-time correction | Хорошая основа для независимой проверки через Horizons |
| Освещённость | доля солнечного диска над terrain horizon | Это **геометрическая доступность света**, не мощность панели |
| Земля | центр Земли над terrain horizon | Это **геометрическая LOS-возможность**, не гарантированный DTE link |
| Валидация | `validation.py` и `web/public/data/validation.json` | Сильная сторона проекта, но результаты нужно показывать честно |
| Текущее состояние validation | 47 checks: 40 pass, 7 fail; отдельно 19 informational entries | Самый важный технический риск перед демо |

Особенно показателен validation output. Например, для ряда полярных точек расчёт средней освещённости Tilion расходится с PGDA69, а значения в соседних пикселях самой карты NASA могут сильно различаться. Это не доказывает автоматически ошибку алгоритма Tilion: PGDA69 — долгосрочный 18,6-летний продукт, а результат чувствителен к точному местоположению, высоте и grid registration. Но именно поэтому продукту нужна не зелёная печать «validated», а честное объяснение диапазона и причин расхождения. NASA PGDA сама подчёркивает необходимость учитывать более короткие интервалы, более высокое разрешение и высоту над поверхностью; при просмотре COG overview-пиксели также могут быть усреднены и непригодны для количественного сравнения. citeturn889861view3

### Проверка стартовых URL

| Источник | Доступность 14.11.2026 | Что фактически открыто | Соответствие описанию |
|---|---|---|---|
| **Lunar Planner** — https://www.its.ohio.edu/foundations/lunar/docs.html | Доступен | Полная документация и сама веб-страница planner | **Подтверждено.** Документация обновлена 12 ноября 2026; есть 3D globe, terrain profiles, Fresnel/LOS, relay view, real-Sun lighting, cast shadows, sunlight report, ground view. Для relay visibility документация прямо предупреждает, что terrain blocking пока не учитывается. citeturn138741view2turn709859view6 |
| **NASA Lunar Site Selection white paper** | Доступен | PDF прочитан; страницы с terrain/lighting и Earth visibility дополнительно просмотрены как изображения | **Полностью соответствует.** Это NASA white paper по выбору площадок Human Lunar Return, условиям рельефа, ~6–6,5 суток освещения, Earth visibility и mission availability. citeturn709859view0turn709859view1 |
| **Wueller et al., JGR Planets, DOI 10.1029/2025JE009434** | Доступен | Полный HTML статьи | **Подтверждено.** Опубликована 27 февраля 2026; исследует 130 candidate landing sites, освещение 2025–2032, PSR в пределах 2 км, slopes и изменчивость доступности площадок по годам. citeturn709859view2turn709859view3 |
| **JPL Horizons** — https://ssd.jpl.nasa.gov/horizons/ | Доступен | Официальный сервис и документация | **Подтверждено.** Подходит как независимый источник эфемерид/azimuth/elevation; разумнее использовать для валидации, а не делать сетевую доступность Horizons обязательной для Tilion |
| **NASA Moon Trek** — https://trek.nasa.gov/moon/ | Доступен | Публичный Moon Trek и NASA-описание mission-planning функций | **Подтверждено.** Это профессионально-образовательный GIS-инструмент; часть продвинутых функций mission planning предназначена для зарегистрированных пользователей |
| **LROC QuickMap** — https://quickmap.lroc.asu.edu/ | Доступен | URL открылся и перенаправился на актуальный QuickMap; страница сообщает, что для приложения нужен JavaScript | **Подтверждено существование приложения**, но интерактивные GIS-функции в этом исследовательском браузере полноценно прокликать не удалось. Официальная LROC документация также указывает QuickMap как инструмент поиска и визуализации LROC-данных. citeturn138741view3 |

Официальная формулировка текущего challenge — **Lunar Landing Site Navigator**: быстро сравнивать площадки и даты, показывать Солнце и Землю относительно местного горизонта для оценки потенциальной солнечной энергетики и DTE communication windows. citeturn335952search0

## Как планирование устроено в реальности

Реальная площадка не выбирается одной метрикой «процент света». NASA описывает процесс как интегрированный отбор: геометрия запуска и перелёта, возможность посадки, terrain safety, освещение, связь и научная ценность должны одновременно образовать пригодное окно. В обновлении Artemis III NASA отдельно пишет, что исходные 13 candidate regions были сокращены до девяти, но каждый регион всё ещё содержит несколько потенциальных landing sites; окончательная пригодность зависит от даты и конкретной конфигурации миссии. citeturn889861view5turn889861view4

| Вопрос | Что прямо подтверждают источники | Что разумно упростить для Tilion | Что нельзя честно утверждать без новых данных |
|---|---|---|---|
| **Как выбирают площадку и дату** | NASA ищет относительно плоский рельеф с допустимыми препятствиями; ранние Artemis sites должны поддерживать примерно 6–6,5 суток освещённой поверхности. Доступность площадки зависит от launch opportunity, trajectory, rendezvous, communications, landing performance, illumination и terrain. citeturn709859view0turn889861view5 | Tilion может считать **surface-availability window** по своим данным: Sun + Earth + пользовательская длительность | Нельзя называть это полноценным **launch window** или «mission feasible»: Tilion не моделирует ракету, trans-lunar injection, HLS rendezvous, aborts и operational rules |
| **Освещённость, тень, ночь** | У полюса режим сильно зависит от высоты и топографии, может резко меняться на коротком расстоянии; непрерывно освещённой точки на южном полюсе не известно. PGDA рекомендует учитывать конкретный период, разрешение и height above surface. citeturn709859view0turn889861view3 | Показывать долю/окна видимого солнечного диска, longest darkness, sensitivity to mast height | Нельзя автоматически переводить это в Wh/kWh: нужны ориентация/площадь панели, КПД, температурная модель, батарея, degradation/dust и power profile |
| **Видимость Земли** | Для раннего Human Lunar Return DTE требует Землю в лунном небе; около полюса она может скрываться рельефом. PGDA прямо предупреждает, что «видна любая часть диска» несколько оптимистично для реального radio link. citeturn709859view1turn889861view3 | Называть метрику **geometric Earth visibility / DTE opportunity** и позволять задать minimum elevation mask | Нельзя писать «связь есть». Для этого нужны хотя бы ground-station geometry, antenna pattern/gain, link budget, frequency, pointing, margin, relay availability и operational schedules |
| **Рельеф, уклоны, препятствия** | NASA требует данных достаточного разрешения; разные lander design имеют разные tolerances. Исследование Wueller использовало 20 м DEM, slope limit 0–8°, 100 м buffer от более крутых склонов в рамках рассматриваемых HLS assumptions. citeturn709859view0turn709859view3 | Можно показывать local slope/roughness как **screening metric**, если вычислить её из подходящего DEM и подписать разрешение | Нельзя объявлять «safe to land»: нет полной hazard inventory, boulders/craters на нужном масштабе, navigation dispersion и сертифицированных tolerances конкретного аппарата |
| **Научные цели и PSR** | Wueller et al. отобрали 130 sites, сочетая flat terrain, illumination и доступ к PSR в пределах 2 км; PSR интересны как потенциальные cold traps, но глубина/количество volatile остаются неопределёнными. citeturn709859view2 | Можно добавить «distance to nearest mapped PSR» и показать научный trade-off | Без PSR dataset и traverse/slope model нельзя обещать «доступность льда», а тем более количество воды |
| **Если дата сдвинулась** | NASA подчёркивает сильную temporal variability; исследование 2026 показывает, что в разные годы пригодны разные sites. Официальная site-selection логика держит несколько landing options именно потому, что доступность окна меняется с датой. citeturn709859view2turn889861view5 | Здесь Tilion особенно силён: автоматически искать ближайшую альтернативную дату в доступном precomputed range | Нельзя утверждать, что новая дата действительно достижима запуском с Земли без trajectory/launch constraints |
| **Что решают заранее, что после посадки** | До посадки фиксируются candidate region/site, vehicle constraints, trajectory, illumination/communications assumptions и surface plan; после посадки тактическая деятельность адаптируется к фактической позиции, состоянию системы и наблюдаемой среде | Tilion может разделить **strategic planning** и **post-landing situational view**: например, «если фактическая точка ±100 м от target» | Нельзя моделировать фактическое решение экипажа, энергетику или EVA safety без telemetry, flight rules и более детальной operational model |
| **Почему соседние точки дают разные ответы** | NASA прямо говорит, что отношение sunlight/darkness может сильно меняться на коротких расстояниях; исследовательские DEM-модели показывают аналогичную чувствительность. citeturn709859view0turn709859view3 | Для двух соседних points показать horizon profiles и sector/azimuth, который блокирует Sun/Earth | Чтобы назвать конкретный ridge/crater причиной, Tilion нужно сохранять координату/range terrain sample, давшего максимум горизонта, а не только угол |
| **Неопределённость** | Реальные studies используют конкретное DEM resolution, time step, observer height и buffering assumptions; NASA подчёркивает ограниченность высокого разрешения в полярной зоне. citeturn709859view0turn709859view3 | Показать range между DEM/height variants и небольшую координатную perturbation map | Нельзя превращать spread двух raster resolutions в статистический confidence interval — это sensitivity range, не вероятностная ошибка |

Исследование Wueller et al. особенно полезно Tilion как пример **правильного сочетания критериев**. Авторы не ранжируют site по одному среднему проценту света: они сначала фильтруют по slope и buffer, затем моделируют временное освещение для конкретных периодов, учитывают PSR и подчёркивают, что доступность меняется по годам. Статья опубликована **27 февраля 2026 года** и является рецензируемой JGR: Planets работой. citeturn709859view2turn709859view3

Отсюда следует важная терминология для Tilion: на экране лучше писать **“Sun visibility opportunity”** и **“geometric Earth line-of-sight opportunity”**, а не «Power» и «Communication» как бинарные гарантии. Это не перестраховка, а научно корректная граница модели. PGDA NASA буквально предупреждает, что даже их Earth-visibility product может быть слегка оптимистичным для DSN radio link. citeturn889861view3

## Идеи функций

Ниже — идеи после сверки с реальным кодом. Я специально не представляю уже существующие `Sun+Earth overlap`, `longest overlap`, ручной `date slip`, 0/2/10 m variants, DEM-resolution variants, horizon panorama, 3D terrain или NASA validation screen как новые функции.

| Идея | Пользователь и ситуация | Как выглядит UX | Что использует / чего не хватает | Статус относительно Tilion | Реальная практика, отличие, сложность и риск |
|---|---|---|---|---|---|
| **Recovery Window Finder** | Planner: «Посадка сорвалась на пять суток — какой следующий вариант?» | Пользователь задаёт требуемую surface stay, min Sun visibility и min Earth-LOS; Tilion показывает ближайшие 3–5 дат и почему предыдущие не подходят | Уже есть hourly timelines, calendar, Sun/Earth overlap, slip. Нужен search/filter algorithm и failure explanation | **Новая надстройка** над существующим slip | NASA реально оценивает integrated mission availability и держит multiple landing options. Tilion должен называть результат **surface window**, не launch window. Реализация ~4–8 ч, проверка ~2–4 ч. Риск: создать ложное ощущение общей mission feasibility. citeturn889861view5turn709859view2 |
| **Slip Robustness Band** | Planner хочет знать не только точную дату, но и запас | Рядом с датой: «условия сохраняются при сдвиге от −2 до +4 суток», с причинами границ | Всё необходимое почти уже рассчитано | **Улучшение** date-slip | Очень наглядна за 30 секунд. ~2–4 ч / 1–2 ч. |
| **Why These Sites Differ** | Инженер сравнивает две точки в 500 м друг от друга | Split view двух horizon profiles; подсвечивается azimuth, где ridge отрезает Sun/Earth, и временной эффект | Есть horizon angle; не хватает сохранённого `argmax distance/terrain coordinate` вдоль луча | **Новая explanatory feature** | Сильно связана с реальной полярной геометрией, где условия меняются на коротких расстояниях. ~6–10 ч + recompute; проверка ~3–6 ч. Риск — неверно назвать blocker при coarse DEM. citeturn709859view0 |
| **Terrain On / Smooth Moon** | Преподаватель или жюри хочет понять, зачем вообще LOLA | Toggle: «с реальным рельефом / гладкая сфера»; timeline и horizon меняются, рядом delta | В pipeline уже есть sphere-vs-terrain validation и terrain mask | **Улучшение существующего расчёта** | Отличный объяснительный эксперимент: показывает, почему обычной астрономической высоты Sun/Earth недостаточно. ~3–5 ч / ~2 ч. Риск минимальный, если подписать модель |
| **Sensitivity Lens** | Планировщик спрашивает: «а если мачта 10 м вместо 2 м? а DEM другой?» | На каждой метрике маленький диапазон и “What changes this?”; раскрытие 0/2/10 м × 80/240 м | **Уже есть variants и lo-hi** | **UI-улучшение**, не новый расчёт | Очень сильная и быстрая фича. NASA/PGDA прямо отмечает зависимость от height/resolution. ~2–4 ч / 1–2 ч. Не называть диапазон statistical confidence. citeturn889861view3 |
| **Coordinate Robustness Patch** | Реальная посадка может оказаться не точно в номинальной точке | Вокруг site строится 3×3/5×5 grid ±80–100 м; показывается best/worst window и карта нестабильности | Нужна пакетная генерация horizons для соседних coordinate offsets | **Новая** | Особенно оправдана собственными validation failures Tilion и статьёй, где учитывается 100 м landing dispersion/buffer. ~6–12 ч / 4–8 ч. Риск — вычислительная стоимость и неверная интерпретация grid as probability. citeturn709859view3 |
| **Data Quality Passport** | Любой пользователь хочет понять, можно ли доверять конкретной карточке | Badge: `LOLA 80 m / 2 m observer / DE440 / hourly / real`; предупреждение `sphere`, `mock`, `outside validated range`; ссылка на validation row | Все provenance данные в проекте в основном уже существуют | **Новая presentation layer** | Один из наиболее дешёвых способов усилить Validity/Presentation. ~2–4 ч / 1–2 ч. Риск — перегрузить UI; решается progressive disclosure |
| **Validation Failure Explorer** | Жюри/технический пользователь спрашивает «что именно не совпало с NASA?» | Вместо pass/fail — scatter/neighbourhood: Tilion point, PGDA pixel, 3×3 range, причина потенциального расхождения | Уже есть validation JSON; возможно понадобится сохранить больше соседних values | **Улучшение NASA check** | Редкий и сильный ход: показывать несовпадения вместо сокрытия. ~3–6 ч / 2–3 ч. Риск — на демо придётся объяснить, почему fail не обязательно означает баг |
| **Science Proximity / PSR Layer** | Scientist: «где можно иметь свет и при этом работать рядом с PSR?» | Ползунок max distance to PSR + overlay; shortlist площадок | Нужны новые PSR polygons/raster, distance computation; для настоящей доступности — slope/traverse | **Новая** | Реально соответствует Artemis science trade-off; Wueller et al. рассматривают PSR в пределах 2 км. Но без dataset нельзя делать сейчас “на глаз”. ~8–16+ ч; верификация сложная. citeturn709859view2 |
| **Slope Screening Layer** | Landing engineer: «какие точки слишком крутые?» | Heatmap slope + threshold; отдельная надпись “screening only, not certified safe” | Нужно вычислить slope из DEM; для HLS-quality лучше более высокое разрешение, например 20 м/5 м products | **Новая** | Научная работа использует 20 м LDEM и 100 м buffer. ~4–8 ч с текущим DEM, но качество ограничено. Риск — пользователь примет это за complete hazard detection. citeturn709859view3 |
| **Mission Brief / Explain My Choice** | Жюри, преподаватель, public: нужно понять результат за минуту | Автоматический one-page summary: site/date, «почему выбран», strongest constraint, sensitivity, caveats, provenance | Все основные показатели уже есть | **Новая presentation feature** | Простая, полезная для Presentation/Impact; не уникальна по концепции, но отлично связывает Tilion в историю. ~3–5 ч / ~1–2 ч |
| **Teacher Mode: Smooth Moon → Real Moon** | Преподаватель объясняет роль рельефа и низкого Солнца | Три шага: геометрический горизонт → LOLA horizon → date slip; каждый шаг задаёт вопрос и показывает ответ | Существующие screens + небольшой guided workflow | **Новая UX-обвязка** | Соответствует официальной аудитории challenge — educators/public. ~3–6 ч. citeturn335952search0 |
| **Darkness Survival Check — только как user-input constraint** | Lander designer: «максимальная ночь должна быть ≤ X часов» | Пользователь вводит допустимую longest darkness; finder отбрасывает окна | Longest darkness уже есть; энергетической модели нет | **Новая constraint layer** | Полезна, если не притворяться battery simulation. ~2–3 ч / ~1 ч. Нельзя переводить darkness в SOC без battery/power model |
| **Communication Elevation Mask** | RF planner: «мне недостаточно Earth едва над горизонтом» | Пользователь задаёт 0°, 2°, 5°, 10° minimum Earth elevation; окна пересчитываются | Earth az/el и terrain уже есть | **Новая небольшая настройка** | Научно честнее бинарного centre-above-horizon и ближе к практике link margin. Но всё равно не link budget. ~2–4 ч / ~2 ч. Lunar Planner использует собственный elevation cutoff для relay visibility и честно оговаривает ограничения. citeturn709859view6 |

Из этих идей две особенно важно **не делать в ложной форме**.

Первая — полноценный **Power Predictor**. По текущим данным Tilion можно показывать солнечную видимость и длительность тени; нельзя достоверно обещать электрическую мощность без конфигурации панели, её ориентации/трекера, площади, КПД, температурной зависимости, батареи и load profile. Официальный challenge также говорит именно о визуализации для оценки *potential* power generation. citeturn335952search0

Вторая — кнопка **“Communication guaranteed”**. Геометрическая видимость центра Земли — только один prerequisite. Даже NASA PGDA подчёркивает, что более либеральное условие «видна любая часть диска Земли» оптимистично для DSN. Если Tilion не добавляет станции, RF link budget, antenna pattern, pointing и schedule, корректное название — *DTE geometry opportunity*. citeturn889861view3

## Приоритеты и отбор

| Идея | Проблема | Польза жюри / пользователю | Готовые данные | Чего не хватает | Оценка реализации | Оценка проверки | Риск | Приоритет |
|---|---|---|---|---|---:|---:|---|---|
| **Recovery Window Finder + Slip Robustness** | Сдвиг даты превращает статический план в вопрос «что делать дальше?» | Демонстрирует реальный decision workflow, а не визуализацию | Готовые hourly Sun/Earth timelines, calendar, existing slip | Search/ranking, constraint form, failure explanation | ~4–8 ч | ~2–4 ч | Назвать surface feasibility полной mission feasibility | **Очень высокий** |
| **Sensitivity Lens + Data Quality Passport** | Пользователь не понимает устойчивость числа | Сильно повышает Validity и доверие; почти всё уже рассчитано | 0/2/10 м, 80/240 м, validation, provenance | UI aggregation | ~2–4 ч | ~1–2 ч | Перегрузка интерфейса | **Очень высокий** |
| **Terrain vs Smooth Moon** | Непонятно, зачем сложный terrain model | Мгновенно объясняет научную ценность продукта | Terrain horizon, sphere comparisons | UI toggle / paired summary | ~3–5 ч | ~2 ч | Низкий | **Высокий** |
| **Why These Sites Differ** | Две соседние точки дают разные ответы без понятной причины | Создаёт сильный «aha moment» и объяснимость | Horizon profiles | Blocker range/coordinate provenance | ~6–10 ч | ~3–6 ч | Coarse DEM может неверно локализовать ridge | **Высокий, если хватит времени** |
| **Coordinate Robustness Patch** | Номинальная координата не отражает локальную вариабельность | Очень сильная связь с реальным landing dispersion и собственной validation problem | DEM/SPICE engine | Precompute offsets, aggregation | ~6–12 ч | ~4–8 ч | Производительность, ложная вероятностная интерпретация | **Средне-высокий** |

Это именно **оценки**, а не измеренные сроки. Они предполагают, что существующий pipeline и web-приложение собираются без серьёзных regressions.

На критерии Space Apps эти функции могут влиять без необходимости придумывать «баллы». Recovery Finder усиливает **Relevance** и **Impact**, потому что превращает challenge statement в конкретное решение пользователя. Sensitivity/Data Quality усиливает **Validity** и **Presentation**, потому что показывает, что команда понимает границы NASA datasets. Terrain-vs-sphere усиливает **Creativity + Presentation**, поскольку физическая причина различий становится мгновенно видна. Такие критерии перечислены и во внутренних материалах приложенного репозитория; официальная задача при этом подчёркивает именно быстрое сравнение sites/dates для planners, educators и public. citeturn335952search0

**Самая сильная идея для 30-секундного показа:**  
пользователь выбирает site и дату → нажимает **“Landing slipped +5 days”** → текущая дата становится красной из-за разрыва нужного Sun+Earth window → Tilion автоматически предлагает ближайшее подходящее окно → кнопка **“Why?”** показывает, что предыдущие два дня отсеяны terrain shadow, а следующая дата имеет достаточный непрерывный overlap → рядом badge сообщает, насколько результат меняется при observer height 0–10 м и DEM resolution. Это одновременно показывает планирование, объяснение и научную честность.

**Быстрая доработка существующего интерфейса:**  
**Data Quality Passport + Sensitivity Lens.** Практически все данные уже есть; нужно перестать прятать `lo/hi`, variant metadata и mock/real status. Это даёт больше пользы, чем новый декоративный экран.

**Смелая идея при наличии времени:**  
**Coordinate Robustness Patch** вокруг площадки. Именно она превращает «point solution» в ответ на более реалистичный вопрос: что происходит в окрестности nominal landing point. Она особенно оправдана тем, что собственные PGDA comparisons Tilion уже обнаружили pixel-scale sensitivity.

**От чего лучше отказаться сейчас:**  
полноценная **power/battery simulation** или **guaranteed communication link model**. Обе выглядели бы эффектно, но сейчас требуют слишком много новых engineering inputs. Быстро собранная модель создаст больше риска для Validity, чем пользы. Такие модели требуют достаточных исходных данных.

**Минимальный совместимый пакет, который реально довести до рабочего и проверенного демо:**  
**Recovery Window Finder + Sensitivity/Data Quality + Terrain-vs-Sphere.** Они используют почти один и тот же уже готовый набор данных, не требуют PSR/Diviner/relay datasets и образуют единую историю: *«найди альтернативу → пойми, почему она работает → увидь, насколько ответ устойчив»*. Это существенно лучше набора из трёх несвязанных новых экранов.

## Как проверить три лучшие идеи

### Recovery Window Finder

**Сценарий.** Пользователь выбирает одну из поддерживаемых Artemis-area точек, базовую дату и, например, surface stay 6,5 суток. Он задаёт минимальное условие: всё пребывание должно иметь определённый режим Sun visibility, а заданная доля времени — geometric Earth LOS. Затем сдвигает посадку на несколько суток и просит Tilion найти ближайшую альтернативу.

**Исходные данные.** Уже существующие hourly Sun/Earth states из SPICE + LOLA terrain horizon; выбранная observer height/DEM variant; границы precomputed interval.

**Критерий успеха.** Finder должен возвращать те же интервалы, которые можно независимо получить прямым сканированием исходного timeline. Если пользователю показано «не подходит из-за 11-часового interruption», этот разрыв должен быть виден в raw hourly sequence и Calendar.

**Независимая проверка.** Для нескольких дат Sun/Earth az/el можно сверить с JPL Horizons; terrain crossing — повторно вычислить backend reference implementation. Для самого window search независимая проверка проста: написать маленький reference scan, не использующий frontend ranking code. Внешний NASA источник не выдаст готовый список «правильных окон» для произвольных Tilion points, поэтому end-to-end независимая сертификация невозможна; проверяется каждая составная часть.

**Если данных недостаточно.** Вне precomputed interval приложение должно писать **“No validated timeline available for this date”**, а не переключаться незаметно в synthetic/mock.

**Тихие ошибки.** Off-by-one в UTC/date boundaries; интерполяция вокруг sunrise/set; путаница partial-disc/centre visibility; часовой шаг, который может скрыть короткий outage; неправильное объединение интервалов между samples. Вывод следует подписывать как hourly-resolution estimate.

### Sensitivity Lens + Data Quality Passport

**Сценарий.** Пользователь видит «78% Sun visibility» и спрашивает: «насколько это число устойчиво?» Нажатие на badge показывает результаты для 0/2/10 м, 80/240 м DEM, происхождение данных и validation status.

**Исходные данные.** Уже существующие variants, `summary.ts`, site metadata, `validation.json`, real/mock flags, data-range metadata.

**Критерий успеха.** Все значения в UI должны воспроизводиться прямым чтением соответствующего variant output. `lo` и `hi` должны быть минимумом/максимумом именно тех вариантов, которые перечислены пользователю.

**Независимая проверка.** Высотную чувствительность можно проверить повторным backend horizon computation для 0, 2 и 10 м. DEM sensitivity — повторным запуском на обоих raster products. Ссылку с PGDA69 нужно трактовать осторожно: продукт NASA усреднён по 18,6-летнему циклу, имеет собственное разрешение и scaling, поэтому это cross-check, а не ground truth для любого краткого interval. NASA сама предупреждает о resolution/height dependence и COG overview averaging. citeturn889861view3

**Если данных недостаточно.** Показывать `Sensitivity unavailable` и причину: «только один DEM», «custom point not precomputed», «date outside validation range». Не заменять отсутствующий variant нулём.

**Тихие ошибки.** Самая опасная — назвать min–max «95% confidence interval». Это не статистическое доверительное распределение, а **model/data sensitivity range**. Вторая — смешать variation from observer height и variation from raster resolution в одно число без объяснения.

### Terrain vs Smooth Moon

**Сценарий.** Преподаватель выбирает полярную площадку и показывает студенту, что астрономическая высота Солнца положительна, но реальный ridge всё равно закрывает диск. Один toggle убирает LOLA terrain; окно света появляется. Возврат terrain — исчезает.

**Исходные данные.** SPICE Sun/Earth geometry, существующий LOLA horizon и smooth/spherical horizon reference.

**Критерий успеха.** В режиме smooth Moon результат должен совпадать с чистой локальной геометрией без terrain obstruction; в terrain mode — с текущим horizon intersection. Delta должна воспроизводиться backend calculation.

**Независимая проверка.** Smooth case можно проверить через JPL Horizons для az/el; terrain case — отдельно через reference ray marcher и визуальное сопоставление с LOLA/QuickMap. Полностью независимую «истину» для terrain horizon получить сложнее, поскольку инструменты могут использовать разные DEM/resolution; это следует прямо сказать. NASA white paper подтверждает сам принцип: короткие пространственные перемещения и высота существенно меняют полярное освещение. citeturn709859view0

**Если данных недостаточно.** Для site без terrain tile показывать только smooth model с заметным badge **“terrain not modeled”**. Нельзя рисовать точный terrain shadow поверх сферического расчёта.

**Тихие ошибки.** Разные reference radii/coordinate frames, incorrect longitude convention, sampling gaps, nodata interpreted as low terrain, и неправильная обработка рельефа за пределами 300 км. Особенно стоит проверить текущее поведение `geo.py` при missing terrain: присваивание низкого горизонта может искусственно увеличить visibility.

## Источники и вопросы команде

### Основные источники

| Источник | Категория | Ссылка | Для чего использован |
|---|---|---|---|
| NASA Space Apps 2026 — Lunar Landing Site Navigator | **Официальный первичный** | https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/ | Официальная формулировка задачи и аудитории. citeturn335952search0 |
| NASA Space Apps 2026 schedule | **Официальный первичный** | https://www.spaceappschallenge.org/2026/ | Даты 14–15 ноября и submission timeline. citeturn335952search1 |
| NASA Moon to Mars Architecture — Lunar Site Selection white paper | **Официальный первичный** | https://www.nasa.gov/wp-content/uploads/2024/02/15-2024-architecture-workshop-white-paper-lunar-site-selection.pdf | Terrain, lighting, ~6–6,5 суток, Earth visibility, интегрированный site selection. citeturn709859view0turn709859view1 |
| NASA Artemis III landing-region update | **Официальный первичный** | https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/ | Девять актуальных candidate regions и критерии отбора. citeturn889861view4 |
| NASA NTRS — Artemis III Site Selection Update | **Официальный первичный** | https://ntrs.nasa.gov/citations/20250011660 | End-to-end mission availability: launch/transit/comms/landing/illumination/terrain. citeturn889861view5 |
| NASA GSFC PGDA Product 69 | **Официальный первичный** | https://pgda.gsfc.nasa.gov/products/69 | Long-term illumination/Earth visibility, caveats, resolution, height sensitivity. citeturn889861view3 |
| NASA GSFC PGDA Product 90 | **Официальный первичный** | https://pgda.gsfc.nasa.gov/products/90 | LOLA polar DEM source |
| NASA/JPL Horizons | **Официальный первичный** | https://ssd.jpl.nasa.gov/horizons/ | Независимая проверка эфемерид |
| NASA NAIF Generic Kernels | **Официальный первичный** | https://naif.jpl.nasa.gov/pub/naif/generic_kernels/ | DE440/lunar orientation/SPICE kernels |
| NASA Moon Trek | **Официальный первичный / профессиональный инструмент** | https://trek.nasa.gov/moon/ | GIS, terrain/mission-planning reference |
| LROC QuickMap | **Профессиональный научный инструмент** | https://quickmap.lroc.asu.edu/ | Визуальный cross-check LROC imagery/coordinates. URL доступен, JS app не был полноценно интерактивно исследован. citeturn138741view3 |
| Wueller et al., JGR: Planets | **Научная рецензируемая статья** | https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2025JE009434 | 130 candidate sites, PSR access, slope, 2025–2032 illumination, temporal variability. citeturn709859view2turn709859view3 |
| Lunar Planner, Ohio University | **Исследовательский / образовательный инструмент** | https://www.its.ohio.edu/foundations/lunar/docs.html | Terrain LOS/Fresnel, relays, sunlight, ground view, ограничения моделей. citeturn138741view2turn709859view6 |
| ESA ELOPE | **Официальный первичный / открытый конкурс** | https://www.esa.int/Enabling_Support/Space_Engineering_Technology/ELOPE_with_ESA_s_moon_landing_guidance_competition | Близкое открытое соревнование по lunar descent/navigation. citeturn889861view6 |

### Вопросы команде перед окончательным выбором фич

Эти вопросы не мешают сделать предложенный минимальный пакет, но ответы заметно влияют на то, какую смелую функцию стоит брать дальше:

1. **Что сейчас считается canonical build для демо:** версия из архива, deployed site или отдельная ветка? Это важно, чтобы не реализовать поверх устаревшего UI.
2. **Можно ли сегодня перегенерировать precompute**, или новая функция должна работать только с уже закоммиченными JSON/timelines?
3. **Сколько времени занимает полный horizon precompute** для одной новой точки и для, например, 9–25 соседних coordinate offsets? Это определит реалистичность Coordinate Robustness.
4. **Есть ли у команды объяснение семи failed illumination checks**: pixel registration, координатная convention, observer height, отличающийся период усреднения, DEM resolution или реальная ошибка? До финала это важнее ещё одной декоративной фичи.
5. **Custom points должны быть научно полноценной функцией или только UI-demo?** Сейчас особенно важно не позволять synthetic fallback выглядеть как реальный NASA-derived calculation.
6. **Какой exact definition “sunlit” команда хочет защищать перед жюри:** any solar limb, centre, half-disc или fractional disc threshold? Определение должно совпадать с расчётом.
7. **Что означает Earth visible в UI Tilion сегодня:** centre above terrain, any-disc, или дополнительный elevation mask? Формулировка интерфейса должна совпадать с кодом.
8. **Есть ли возможность заменить/дополнить 80/240 м DEM более высоким разрешением** в нескольких demo sites? Статья 2026 использует 20 м LDEM для slope screening, а NASA имеет более детальные regional products; это особенно важно, если команда решит показывать safety/slope. citeturn709859view3
9. **Что важнее в финальной истории — planner или educator?** Если planner, приоритет Recovery + Robustness; если educator, Terrain-vs-Sphere + guided explanation может дать более цельный двухминутный narrative. Официальная задача допускает обе аудитории. citeturn335952search0
10. **Готова ли команда публично показывать failed validations?** Если да, это можно превратить из слабости в сильную feature: «Tilion не скрывает, где модель чувствительна». Если нет, сначала следует устранить или хорошо объяснить эти расхождения, а не просто убрать их со страницы.

Итоговый продуктовый выбор я бы сформулировал так: **Tilion уже достаточно богат визуально и математически; следующий прирост качества должен идти не в ширину, а в принятие решения и доверие к нему.** Самая убедительная версия проекта — та, которая не просто говорит «здесь Солнце и Земля видны», а отвечает: **«если миссия сдвинулась, вот ближайшая альтернатива; вот какая часть результата вызвана рельефом; вот насколько решение устойчиво; и вот граница того, что наши NASA-данные действительно позволяют утверждать».**
