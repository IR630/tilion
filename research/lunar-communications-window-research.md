# Tilion: связь Луна—Земля и поиск оптимальных окон связи

[Скачать полный Markdown-отчёт](sandbox:/mnt/data/tilion_lunar_communications_research.md)

## Главный вывод и состояние Tilion

Для Tilion критически важно перестать трактовать **Earth visibility как синоним связи**. В реальной миссии существуют как минимум три разных уровня доступности:

**Геометрическое окно** означает, что направление на Землю или на конкретную наземную станцию не перекрыто Луной и локальным рельефом. **RF-feasible window** дополнительно означает, что при заданных частоте, мощности передатчика, антеннах, ориентации, скорости передачи и потерях link budget закрывается с требуемым запасом. **Operational contact** дополнительно требует реально выделенной наземной станции, совместимого оборудования и расписания сети. NASA/JPL прямо описывает DSN scheduling как отдельный процесс переговоров между миссиями; публичный DSN Now показывает текущие соединения и **не является расписанием будущих сеансов**. citeturn731324search0turn731324search3turn731324search9

Это особенно важно именно на южном полюсе. NASA описывает Землю там как объект, находящийся постоянно низко над горизонтом и геометрически доступный примерно половину каждого сидерического месяца; локальная топография дополнительно ухудшает связь. NASA также активно исследует отражения радиосигнала от лунной поверхности и вызванный ими multipath/fading — это не теоретическая мелочь, а отдельная программа Lunar Surface Propagation. citeturn298897search10turn298897search12turn211208search0turn211208search1

В уже выполненном аудите архива Tilion были обнаружены SPICE/DE440, LOLA 80/240 м, terrain horizon ray marching, временные ряды Earth/Sun, варианты высоты наблюдателя 0/2/10 м, Calendar с Sun/Earth overlap и расчёт Земли относительно локального горизонта. В текущей реализации Earth-условие фактически соответствует **центру Земли над terrain horizon**, то есть это хороший геометрический фундамент, но ещё не модель реального DTE-сеанса. fileciteturn1file0

Отдельно важно понять роль уже загруженных `AVGVISIB_*_EARTH.TIF`. NASA PGDA строит эти карты как **среднюю Earth visibility по часовым отсчётам на протяжении 18,6-летнего цикла**. Земля считается видимой, если над terrain horizon появляется хотя бы часть её диска. Авторы прямо предупреждают, что такой критерий немного оптимистичен для radio-link studies, например с DSN. Следовательно, raster очень полезен для **быстрого screening площадок**, но не должен использоваться как динамический прогноз сеанса на конкретные дату и время. citeturn298897search0

Самая сильная новая коммуникационная функция для Tilion поэтому выглядит так:

> **Explainable Contact Window Finder:** пользователь выбирает площадку, дату, высоту антенны и коммуникационный профиль; Tilion находит точные ingress/egress DTE-окон, показывает направление Земли, рельефный blocker, минимальный clearance, устойчивость к DEM/координате/высоте, кандидатов DSN/ESTRACK и отдельно помечает, является ли результат только геометрическим, RF-feasible или реально schedule-confirmed.

Это существенно сильнее простого процента Earth visibility.

## Физика и геометрия связи на южном полюсе

### От центра Земли к реальной линии связи

Пусть положение площадки в Moon-fixed frame равно \(\mathbf r_s\), а положение выбранной цели связи — центра Земли, наземной станции или relay — \(\mathbf r_t(t)\). Вектор линии связи:

\[
\mathbf d(t)=\mathbf r_t(t)-\mathbf r_s
\]

и единичный вектор

\[
\hat{\mathbf d}(t)=\frac{\mathbf d(t)}{\|\mathbf d(t)\|}.
\]

Для локальной системы East-North-Up:

\[
E=\hat{\mathbf d}\cdot \hat{\mathbf e},
\qquad
N=\hat{\mathbf d}\cdot \hat{\mathbf n},
\qquad
U=\hat{\mathbf d}\cdot \hat{\mathbf u}.
\]

Тогда

\[
Az=\operatorname{atan2}(E,N),
\qquad
El=\arcsin(U).
\]

SPICE уже имеет специальные routines для topocentric azimuth/elevation observers на поверхности тел; NAIF определяет локальный frame с +Z по наружной нормали поверхности и документирует вычисление az/el для landmarks без отдельного SPK самого объекта. citeturn413687search6

Для Луны желательно использовать высокоточную ориентацию через binary lunar PCK и `MOON_ME`/`MOON_PA`, а не автоматически полагаться на `IAU_MOON`. NAIF прямо показывает, что `MOON_ME` — mean Earth/polar-axis frame, а `MOON_PA` — principal-axis frame; tutorial NAIF отдельно называет `IAU_MOON` обычно плохим выбором для высокоточной лунной геометрии. Ваш набор `moon_pa_de440_200625.bpc` + `moon_de440_250416.tf` подходит для этой архитектуры. citeturn413687search0turn413687search9turn413687search8

### Почему Земля движется в лунном небе

Луна находится в синхронном вращении, но направление на Землю для фиксированной лунной точки не постоянно. Из-за орбитальной эксцентриситетности, наклона орбиты, ориентации оси и физических/оптических либраций sub-Earth longitude и latitude меняются. На полюсе это превращается в медленное движение Земли вдоль низкого горизонта. Поэтому статическое утверждение «площадка обращена к Земле» недостаточно: необходимо вычислять \(Az_E(t)\) и \(El_E(t)\) для каждого времени. JPL Horizons способен выдавать apparent azimuth/elevation для arbitrary topocentric site на Луне и использует высокоточную lunar mean-Earth модель, поэтому это отличный независимый validation source для Tilion. citeturn435542search0turn435542search7

### Локальный горизонт и кривизна Луны

Геометрическая видимость определяется не нулевым elevation, а сравнением с **terrain skyline**:

\[
C(t)=El_E(t)-H(Az_E(t)),
\]

где \(H(Az)\) — максимальный elevation рельефа в данном азимуте.

Если \(C>0\), центр Земли выше локального terrain horizon; если \(C<0\), центр перекрыт. Для южного полюса именно эта поправка является решающей. JPL ещё в ранней работе по полярной связи строил horizon masks из DEM и сравнивал их с движением Земли; современные исследования показывают, что учёт terrain существенно меняет Earth visibility по сравнению со сферической Луной. citeturn298897search3turn298897search5

В Tilion предыдущий аудит обнаружил horizon ray marching до примерно 300 км. Это физически оправдано: Земля и Солнце находятся низко, поэтому дальний ridge может определять skyline. Но качество результата зависит от DEM resolution, NoData и корректного учёта lunar curvature. fileciteturn1file1

### Земля — не точка

Средний радиус Земли около 6371 км, а расстояние Земля—Луна порядка 384 400 км. Угловой радиус Земли с Луны приблизительно

\[
\alpha_E \approx \arcsin\left(\frac{6371}{384400}\right)\approx0.95^\circ ,
\]

то есть полный диск около \(1.9^\circ\).

Поэтому полезно различать:

\[
C>\alpha_E \Rightarrow \text{весь диск открыт},
\]

\[
C<-\alpha_E \Rightarrow \text{весь диск скрыт},
\]

а между ними — **частичная видимость диска**.

Именно так логически устроен PGDA Earth-visibility product: «видимой» считается Земля, если доступна хотя бы часть диска, что NASA и называет немного оптимистичным для реальной radio link. citeturn298897search0

Но для настоящего DTE правильнее вообще не использовать Earth limb как конечный критерий: передатчику нужна линия на **конкретную ground antenna**, например DSS-43, а не произвольная видимая часть планеты.

### Параллакс и движение наземных станций

Разница между Earth center и конкретной точкой на поверхности Земли с расстояния Луны составляет углы порядка земного angular radius — почти градус. У south-pole site, где clearance часто измеряется единицами градусов или долями градуса, это принципиально. JPL Horizons в августе 2026 специально показывал пример, где одна и та же точка на Луне геоцентрически считалась видимой, но из конкретной земной станции могла оказаться на lunar far side; документация прямо подчёркивает роль observer parallax. citeturn435542search2

Поэтому для версии Tilion с DSN нужно рассчитывать:

\[
\mathbf r_{\text{station}}(t)
\]

из геодезических координат станции, Earth rotation/ITRF и преобразования в инерциальный frame, а затем строить line-of-sight **site → station**, а не site → Earth center.

### Высота антенны

Высота антенны меняет локальную точку наблюдения и horizon. Это особенно важно около ridge/crater rim. У вас уже есть варианты 0/2/10 м, что стоит превратить из внутренней sensitivity-проверки в пользовательскую функцию. Предыдущий terrain-аудит также отметил, что современные NASA DEM uncertainty studies специально рассматривают влияние высоты наблюдателя на полярные visibility predictions. fileciteturn1file1

### Световое время

При 384 400 км:

\[
t_{1way}=\frac{384400000}{299792458}\approx1.282\text{ s},
\]

то есть round-trip приблизительно \(2.56\) с.

SPICE routines позволяют учитывать one-way light-time и stellar aberration (`LT`, `LT+S`, `CN`, `CN+S`). Для received signal логика отличается от transmitted signal: в одном случае нужно положение цели в момент излучения, в другом — положение в момент прибытия команды. NAIF это различает явно. citeturn413687search2turn413687search4

Для Tilion разумный default для apparent reception geometry — converged light-time + stellar aberration, а в metadata результата обязательно показывать выбранный aberration mode.

### Земная атмосфера и рефракция

На Луне практически нет атмосферы, поэтому **лунной atmospheric refraction для DTE не существует**. Но земная станция наблюдает Луну через земную тропосферу. На малых elevation действуют refractive bending, gaseous attenuation и, особенно в Ka, погода/вода/дождь. Horizons даже позволяет применять приблизительную terrestrial atmospheric refraction к Earth-based apparent elevation; для lunar-surface observer она не применяется. citeturn435542search0

Для MVP Tilion достаточно station elevation mask, например конфигурируемого 6–10°, а полноценную troposphere/weather model оставить P1/P2. Старые DSN operational docs указывают, что nominal beginning-of-track uplink может ограничиваться transmitter elevation около 10°, но точная station/antenna constraint должна браться из актуальных DSN station documentation и mission interface. citeturn731324search8turn487504search5

### Солнце, радио-шум и multipath

Геометрически открытая Земля может находиться близко по направлению к Солнцу. DSN Handbook имеет отдельные модули по solar corona/solar wind и atmospheric/environmental effects, потому что солнечная геометрия может ухудшать radio performance. citeturn890037search3

Для южного полюса есть ещё специфический эффект: прямой и отражённый от поверхности сигнал могут приходить в receiver с разными фазами. NASA Lunar Surface Propagation прямо исследует terrain reflections, destructive interference и data loss; JPL analysis 2019 показывает, что low-Elevation south-pole DTE может вести себя как slow-fading channel для десятков/сотен kbps. citeturn211208search0turn211208search1

Это означает, что **clearance = +0.1° не должен автоматически считаться «хорошим» окном**. Чем выше запас над terrain horizon, тем обычно более устойчивым следует считать геометрическое окно.

## От геометрического окна к реальной радиосвязи

### DTE, relay и настоящий contact session

Для Direct-to-Earth одновременно нужны:

1. LOS от лунной антенны к конкретной земной станции;
2. station elevation к лунной площадке выше station mask;
3. совместимые frequency/telemetry/command modes;
4. правильное pointing обеих антенн;
5. положительный link margin;
6. достаточная onboard power;
7. допустимые thermal/attitude constraints;
8. выделенный ресурс наземной сети.

NASA/LunaNet формально различает Direct-With-Earth и relay communications; LNIS v5 описывает LunaNet как network-of-networks с Earth ground providers, lunar-orbiting platforms и lunar surface assets. Текущая версия LNIS — Version 5, датирована 29 января 2025 и опубликована NASA 7 февраля 2025. citeturn890037search0turn890037search8

Физическое окно therefore:

\[
W_{\text{geom}}
\]

шире, чем RF-feasible:

\[
W_{\text{RF}}\subseteq W_{\text{geom}},
\]

а реально забронированный сеанс:

\[
W_{\text{ops}}\subseteq W_{\text{RF}}.
\]

Именно эти три состояния я бы сделал в Tilion разными цветами/labels.

### Ground networks

DSN состоит из комплексов Goldstone, Madrid и Canberra, примерно разнесённых на 120° по долготе, что позволяет передавать обслуживание между площадками при вращении Земли. Но сеть обслуживает множество миссий и её ресурсы планируются заранее; NASA описывает переговоры о critical events за месяцы до исполнения. citeturn154367search14turn731324search3turn731324search9

Публичный **DSN Now** показывает текущий state, обновляемый раз в несколько секунд, но NASA прямо говорит: он **не читает planned schedule**. Существующие scheduling systems JPL требуют mission/JPL access. Следовательно, Tilion без специальной интеграции не может честно написать «DSN свободна в 12:00». citeturn731324search0turn731324search1

ESA Estrack сегодня включает 35-м deep-space dishes New Norcia, Cebreros и Malargüe; 1 апреля 2026 в nominal operations вошла новая 35-м DSA-4 в New Norcia. Для разных антенн доступны X/Ka и другие bands. ESA использует эти станции и extended-network partners для лунных миссий. citeturn487504search6turn487504search7turn487504search9

### Почему relay почти неизбежен

NASA LCRNS прямо создан для районов вроде south pole/far side, где DTE ограничен или отсутствует. В опубликованном NASA reference analysis DTE-only для двух south-pole example sites давал порядка 17–43% coverage; комбинация DTE + relay — около 86%, а два relay в reference analysis давали 100% line-of-sight coverage. Это **не универсальная гарантия будущего сервиса**, а результат конкретной reference simulation, но очень ясно показывает архитектурный эффект relay. citeturn463301search1turn463301search8turn463301search2

ESA Moonlight строится как lunar communication/navigation service; ESA сейчас описывает пятиспутниковую архитектуру — один communications satellite и четыре navigation satellites, ориентированную в том числе на south pole. citeturn890037search5turn463301search6

При этом важно обновить устаревшую информацию: более ранние ESA материалы говорили о Lunar Pathfinder в 2026, но **актуальная страница ESA от 12 октября 2026 указывает запуск в 2027** вместе с Blue Ghost Mission 2. Именно свежую дату стоит использовать в презентации. citeturn890037search6turn463301search5

Gateway в будущем тоже предусматривает Lunar Link — ESA telecommunications system на HALO для связи с multiple lunar assets, но Tilion не должен считать Gateway relay уже доступной operational service без конкретного mission epoch и ephemeris. citeturn463301search3

### Частоты, антенны и link budget

В глубоком космосе традиционно используются S/X/Ka. DSN handbook содержит текущие station interfaces и frequency assignments; CCSDS 401.0-B-32 задаёт общие recommendations по RF/modulation, а CCSDS в 2026 обновил coding standards, включая TM Synchronization and Channel Coding Issue 6 в апреле 2026 и corrigenda к другим standards. citeturn890037search1turn487504search13turn890037search4

Free-space loss:

\[
L_{FS}=20\log_{10}\left(\frac{4\pi R}{\lambda}\right)
\]

или при \(R\) в km, \(f\) в GHz:

\[
L_{FS}[dB]=92.45+20\log_{10}R_{km}+20\log_{10}f_{GHz}.
\]

Для среднего расстояния 384 400 км:

- 2.3 GHz: примерно **211.4 dB**;
- 8.4 GHz: примерно **222.6 dB**;
- 32 GHz: примерно **234.2 dB**.

Это только vacuum path loss; никакой вывод «S лучше Ka» из этого делать нельзя. На более высоких частотах доступны более высокие antenna gains при той же aperture и более широкая bandwidth, поэтому итог определяется полным budget.

EIRP:

\[
EIRP=P_{TX}[dBW]+G_{TX}[dBi]-L_{TX}[dB].
\]

Ground receiver обычно описывается через:

\[
G/T = G_R[dBi]-10\log_{10}T_{sys}[K].
\]

Тогда

\[
C/N_0[dBHz]
=
EIRP+G/T-L_{FS}-L_{other}+228.6.
\]

А

\[
E_b/N_0=C/N_0-10\log_{10}R_b.
\]

Link margin:

\[
M=(E_b/N_0)_{available}-(E_b/N_0)_{required}.
\]

Required value зависит от modulation/coding и target BER/FER.

**Иллюстративный пример, не характеристики какой-либо миссии.** Пусть X-band, \(EIRP=15\) dBW, \(G/T=45\) dB/K, \(L_{FS}=222.6\) dB и дополнительные потери 3 dB. Тогда:

\[
C/N_0\approx15+45-222.6-3+228.6=63.0\ dBHz.
\]

При \(R_b=100\,000\) bit/s:

\[
10\log_{10}R_b=50\,dB
\]

и

\[
E_b/N_0\approx13\,dB.
\]

Это **не означает**, что реальный lander сможет передавать 100 kbps. Нужны actual antenna pattern, transmit power, polarization loss, pointing loss, station G/T, coding, required BER, atmospheric loss и implementation margin. DSN 810-005 именно поэтому содержит целый набор link-interface, environmental и ground-station modules. citeturn890037search1turn487504search1

Ka-band особенно чувствителен к atmospheric attenuation и precipitation на земном конце; X обычно легче эксплуатировать, но обладает меньшим потенциальным throughput. Tilion должен не выбирать band за пользователя, а рассчитывать сценарий.

### Pointing, beamwidth и Doppler

Для parabolic dish приблизительно:

\[
G\approx\eta\left(\frac{\pi D}{\lambda}\right)^2,
\]

а beamwidth уменьшается примерно пропорционально \(\lambda/D\). Поэтому high-gain antenna требует более точного pointing.

LCROSS даёт хороший operational пример: mission team писала, что для высокого 1 Mbps режима требовались medium-gain antennas, направленные на Землю, тогда как low-rate режимы могли использовать omni antennas с большим attitude tolerance. citeturn316736search4

Doppler:

\[
f_D\approx-\frac{v_r}{c}f_c,
\]

где \(v_r\) — radial range-rate. Для accurate TT&C Tilion может вычислять range/range-rate из SPICE, но уже для MVP достаточно экспортировать Doppler estimate.

## Реальные миссии, операции и существующие инструменты

| Миссия / система | Реальная коммуникационная архитектура | Урок для Tilion |
|---|---|---|
| **Apollo** | Unified S-Band объединял tracking, ranging, telemetry, command, voice и TV; VHF использовался для локальных links | Связь — набор режимов, а не один LOS boolean |
| **Surveyor** | Direct Earth operations через ground network, передача тысяч TV images | Contact sessions и энергетический режим надо моделировать отдельно |
| **LRO** | S-band для TT&C, Ka-band high-rate science downlink | Один аппарат может иметь разные link classes |
| **LCROSS** | DSN sessions, разные downlink rates по link margin, реальные конфликты schedule с LRO | Видимость DSN ≠ выделенный DSN resource |
| **Chang'e-4** | Far-side lander через Queqiao в Earth-Moon L2 halo orbit | Relay полностью меняет доступность площадок |
| **Chang'e-6** | Queqiao-2 обеспечивал relay support для far-side sample-return lander | Relay — operational reality, не только концепт |
| **Chandrayaan-3** | Lander ↔ IDSN и rover; rover только ↔ lander; Chandrayaan-2 orbiter planned as contingency | Нужно моделировать network graph / multi-hop |
| **SLIM** | Direct ground communications; после landing communication established, power was limiting; lander пережил несколько ночей | Geometry не гарантирует operability без power |
| **IM-1 Odysseus** | Commercial Lunar Data Network + NASA experiments; LN-1 signal был принят DSN | Commercial/agency networks могут coexist |
| **IM-2 Athena** | Южнополярная миссия Mons Mouton; limited Earth communication geometry отмечалась оператором | Для Tilion это почти прямой operational analogue |
| **Blue Ghost Mission 1** | Near-side operations, передано 119 GB | Window scoring должен учитывать объём данных |
| **CAPSTONE** | DSN; потеря связи из-за ошибочной команды задержала maneuver | Operational robustness важнее идеальной геометрии |
| **Artemis I** | Near Space Network + DSN с handover между комплексами | Real network planning — несколько providers/resources |

Apollo Unified S-Band и историческая network architecture подтверждены NASA. citeturn949812search0turn949812search11turn949812search12

LRO использовал S-band TT&C и Ka-band high-rate downlink; ранняя operations concept предусматривала несколько Ka passes в день и S-band contacts почти каждый orbit. citeturn316736search0turn316736search11

LCROSS особенно полезен как пример для вашего продукта: NASA mission blog прямо описывает scheduled DSN contacts, начальную low-rate acquisition, переключение на 64 kbps при наличии margin и отдельные конфликты DSN schedule с LRO. citeturn316736search3turn316736search4

Chang'e-4 смогла работать на far side благодаря Queqiao в halo orbit около Earth-Moon L2, где relay видел и Землю, и far side. Queqiao-2 в 2024 прошёл communication tests с Chang'e-4 и Chang'e-6, после чего обеспечивал relay support Chang'e-6. citeturn949812search6turn949812search7turn949812search8turn949812search9

ISRO для Chandrayaan-3 официально указывает: propulsion module communicates with IDSN; lander communicates with IDSN and rover; rover communicates only with lander; Chandrayaan-2 orbiter предусматривался для contingency link. citeturn450887search0

Для SLIM JAXA подтверждает, что связь была установлена после landing, но solar array сначала не генерировал power; аппарат позже пережил несколько lunar nights. Это хороший пример того, почему **communication geometry и power availability нельзя смешивать**. citeturn450887search8turn450887search7

IM-1 вернул более 500 MB NASA/spacecraft data, а Lunar Node-1 получил DSN tracking/telemetry support через Goldstone/Madrid. citeturn450887search9turn450887search10

IM-2 действительно достиг района Mons Mouton около south pole, но завершился досрочно после landing; Intuitive Machines отдельно отмечала harsh illumination и limited direct Earth communication conditions этого района. citeturn154367search1turn154367search7

Blue Ghost Mission 1 передал 119 GB за примерно один lunar day и несколько часов ночи, показывая, что для mission planning важен не только `% contact`, но и **интегральный data return**. citeturn450887search11

CAPSTONE потерял communication после некорректной команды к radio и вынужден был перенести trajectory correction, хотя геометрически spacecraft находился там, где ожидалось. Это хороший пример distinction между geometric availability и operational availability. citeturn154367search9turn154367search10turn154367search11

### Что уже существует как software

**SPICE** — лучший базовый engine для Tilion. NAIF Toolkit вычисляет positions, frames, light-time corrections, surface geometry и events. Данные и software доступны через NAIF; для вашего Python pipeline это наиболее естественная основа. citeturn492931search7turn492931search8

**JPL Horizons** — лучший независимый reference для validation topocentric Earth az/el. На август 2026 текущая документация Horizons — v4.98e, и она прямо поддерживает arbitrary sites на Moon, apparent az/el и surface coordinates. citeturn435542search0turn435542search4

**NASA GMAT** в 2026 имеет текущую NASA Software Catalog release и открыт под Apache-2.0; он подходит для trajectory/contact/reference analyses, но интегрировать весь GMAT в web-app ради DTE windows не требуется. citeturn492931search0turn492931search2

**Orekit** — Apache-2.0 Java library с event detectors, включая elevation/event machinery. Полезен, если команде нужен reusable astrodynamics backend, но при уже существующем SPICE/Python pipeline переход даст мало пользы. citeturn492931search35turn492931search39

**Ansys STK** умеет access, multi-hop links и full link-budget analysis, включая communication constraints, но это commercial licensed product. Это скорее benchmark того, что должен уметь зрелый Tilion, чем dependency для хакатона. citeturn492931search33turn492931search37turn492931search46

**NASA Moon Trek / LROC QuickMap** полезны для GIS cross-check и terrain context, но не решают вашу задачу объяснимого mission-window optimization. Tilionу выгоднее оставаться decision-support layer, а не пытаться стать универсальным lunar GIS.

## Практический алгоритм для Tilion

### Геометрический pipeline

Для каждой площадки нужно заранее вычислить horizon profile:

```text
azimuth: 0 ... 359.5 deg
horizon_elevation: H(az)
blocking_distance
blocking_lat
blocking_lon
DEM_resolution
coverage_confidence
```

У Tilion уже есть terrain horizon; я бы расширил stored data координатой и distance до blocking point. Тогда UI сможет отвечать:

> Earth blocked at azimuth 173.5° by ridge 41.8 km away.

Это очень сильная explainability feature. Предыдущий аудит кода уже показал, что текущий backend вычисляет skyline, но blocker identity стоит сохранить дополнительно. fileciteturn1file0

### Динамический Earth calculation

Вместо `AVGVISIB` для конкретного mission date:

```python
for t in timeline:
    earth = spice_apparent_vector(
        target="EARTH",
        observer=site,
        frame="MOON_ME",
        abcorr="CN+S",
        et=t
    )

    az, el = local_az_el(earth)
    h = horizon.interpolate(az)

    clearance = el - h
```

Средний raster остаётся первым уровнем:

```text
Stage 1: long-term site screening
Stage 2: dynamic SPICE forecast
Stage 3: station-specific DTE
Stage 4: RF and schedule
```

Это очень хорошая архитектурная история для жюри.

### Earth disc

```python
alpha = asin(earth_radius_km / range_km)

if clearance > alpha:
    state = "FULL_EARTH"
elif clearance < -alpha:
    state = "BLOCKED"
else:
    state = "PARTIAL_EARTH"
```

Но в UI следует подписать:

> Full Earth disk geometrically visible — not yet a verified radio link.

### Наземные станции

Следующий уровень:

```python
for station in stations:
    station_pos = earth_station_state(station, t)

    los = station_pos - site_pos

    lunar_clearance = lunar_terrain_clearance(site, los)

    station_moon_el = elevation_from_station(
        station,
        lunar_site,
        t
    )

    physical = (
        lunar_clearance >= min_lunar_clearance
        and station_moon_el >= station.min_elevation
    )
```

Тут проявляется важная разница: одна DSN station может быть ниже Earth horizon, другая выше, даже когда Earth center геометрически видим.

Минимальный набор станций для prototype:

```text
DSS-14 / Goldstone
DSS-43 / Canberra
DSS-63 / Madrid
```

Но не следует говорить, что именно эти dishes будут выделены конкретной будущей mission: они нужны как **representative geometry model**.

### Точный поиск ingress/egress

Часовой шаг, который разумен для среднего raster, слишком груб для точного window finder.

Сначала coarse scan:

```text
Δt = 5–10 min
```

Определяем функцию:

\[
g(t)=C(t)-C_{min}
\]

и ищем интервалы, где

\[
g(t_i)g(t_{i+1})<0.
\]

После этого уточняем crossing через bisection или Brent:

```python
t_cross = brentq(g, t_i, t_i1)
```

до, например, 1–10 секунд.

Так Tilion получит реальные:

```text
AOS 04:13:22 UTC
LOS 10:46:05 UTC
duration 06:32:43
```

вместо «между 04:00 и 11:00».

### Непрерывность и короткие разрывы

Нужно отдельно решить policy для кратких interruptions. Например:

```text
merge_gap <= 30 s?
merge_gap <= 5 min?
never merge?
```

Нельзя молча объединять два окна.

Лучше показывать:

```text
continuous window: 2 h 14 m
total availability within 6 h: 5 h 48 m
```

Это разные operational metrics.

### UTC, ET/TDB и timestamps

User input/output должен быть UTC.

SPICE calculations внутри — ET/TDB.

Pipeline:

```text
UTC input
→ str2et
→ SPICE geometry
→ window root solve in ET
→ et2utc
→ ISO-8601 Z
```

Не нужно использовать локальный timezone пользователя для physics calculation.

### NoData и uncertainty

Если часть skyline построена по NoData, окно нельзя считать definitely open.

Вместо:

```text
earth_visible = true
```

возвращать:

```json
{
  "geometry": "VISIBLE",
  "terrain_confidence": "LOW",
  "reason": "4.3% of horizon ray lacks DEM coverage"
}
```

Для uncertainty стоит повторять расчёт:

- DEM 80/240 м;
- observer 0/2/10 м;
- ±1–2 pixels coordinate perturbation;
- альтернативный DEM;
- minimum-clearance threshold.

Это даст **robust window**:

\[
W_{robust}=\bigcap_i W_i,
\]

то есть часть окна, сохраняющаяся при всех разумных сценариях.

### Независимая валидация

Для выбранной площадки:

1. Horizons Earth az/el без terrain.
2. Tilion SPICE Earth az/el без terrain.
3. Сравнить до arcminute/выбранного tolerance.
4. Добавить terrain horizon.
5. Сравнить average availability с PGDA69 только как statistical sanity check.
6. Не ожидать совпадения конкретного года с 18.6-year average raster.

Horizons manual прямо поддерживает topocentric lunar observer sites и apparent AZ/EL, поэтому такой validation воспроизводим. citeturn435542search0

## Что такое «идеальное» окно

Плохая идея:

```text
best_window = max(Earth_visible_percent)
```

Процент видимости ничего не говорит о:

- продолжительности непрерывного сеанса;
- близости к terrain horizon;
- доступных ground stations;
- RF margin;
- achievable data rate;
- объёме данных;
- требуемой энергии;
- чувствительности к pointing;
- устойчивости к DEM error;
- наличии relay fallback.

### Метрики окна

Для каждого contact interval Tilion должен рассчитывать:

| Метрика | Почему важна |
|---|---|
| Duration | Сколько реально длится непрерывный контакт |
| Min terrain clearance | Худший момент окна |
| Mean terrain clearance | Типичное качество геометрии |
| Full/partial Earth | Насколько Earth limb открыт |
| Station count | Есть ли redundancy |
| Ground elevation | Атмосферные потери и station feasibility |
| Range | FSPL |
| Range-rate | Doppler |
| Link margin | RF feasibility |
| Expected throughput | Реальный data return |
| Power cost | Может ли lander поддерживать TX |
| Sun overlap | Только как power constraint, не как связь |
| Robust duration | Насколько окно устойчиво к uncertainty |
| Relay fallback | Есть ли резервный маршрут |
| Data volume | Может ли окно передать required bits |

### Link-integrated throughput

Вместо фиксированной data rate полезно считать:

\[
D=\int_{t_0}^{t_1}R_b(t)\,dt
\]

где rate выбирается по link margin/modcod.

Тогда два окна:

```text
Window A: 8 h, low elevation, 50 kbps
Window B: 4 h, high margin, 1 Mbps
```

дают радикально разный data return.

Это делает Tilion гораздо ближе к реальному mission planning.

### Score и Pareto

Я бы не выдавал одну «NASA score».

Лучше сначала hard constraints:

```text
duration >= 2 h
min_clearance >= 1 deg
RF margin >= 3 dB
expected_data >= 2 Gbit
```

затем Pareto ranking.

Для UX можно дать optional weighted score:

\[
S =
0.20 S_{duration}
+0.20 S_{clearance}
+0.25 S_{margin}
+0.15 S_{throughput}
+0.10 S_{redundancy}
+0.10 S_{robustness}.
\]

Но веса должен задавать mission profile.

Пример результата:

```json
{
  "site": {
    "lat_deg": -89.4,
    "lon_deg": 28.2,
    "antenna_height_m": 2
  },
  "window": {
    "start_utc": "2027-01-14T04:13:22Z",
    "end_utc": "2027-01-14T10:46:05Z",
    "duration_s": 23563
  },
  "geometry": {
    "earth_center_visible": true,
    "earth_disc": "FULL",
    "min_clearance_deg": 2.1,
    "mean_clearance_deg": 4.7
  },
  "ground_network": {
    "candidate_stations": ["DSS-43", "DSS-63"],
    "schedule_verified": false
  },
  "rf": {
    "profile": null,
    "link_margin_db": null
  },
  "robustness": {
    "observer_heights_m": [0, 2, 10],
    "dem_resolutions_m": [80, 240],
    "stable": true
  },
  "classification": "GEOMETRIC_DTE_OPPORTUNITY"
}
```

Такая структура очень полезна, потому что не позволяет frontend случайно превратить `visible=true` в «Guaranteed communications».

## Roadmap, UX, данные и ограничения

### MVP за 1–3 дня

**P0. Dynamic DTE windows.** Использовать существующие SPICE + horizon, но перейти от average/часового representation к точным windows.

**P0. Contact timeline.**

```text
Earth center ━━━━━━━━╸
Full Earth   ━━━━━╸
Robust DTE      ━━━━
Sun overlap       ━━━
```

**P0. Terrain horizon chart.**

```text
Elevation
 8°        /\          ridge
 6°   ____/  \____
 4°                 ● Earth
 2°
 0°────────────────────────
      azimuth
```

Показать:

```text
Earth elevation      4.8°
Terrain horizon      2.6°
Clearance            2.2°
Blocker              41.8 km
```

**P0. Antenna-height what-if.**

```text
0 m   robust contact  4h 12m
2 m                   5h 01m
10 m                  6h 43m
```

Не обещать улучшение заранее — показать фактический результат.

**P0. Правильный label.**

Не:

> Communication available

а:

> Candidate DTE geometric window

### За 1–2 недели

**P1. DSN/ESTRACK geometry.** Добавить representative station catalogue и вращение Земли.

**P1. Skyplot.** Earth track относительно local terrain:

```text
Az / El polar chart
terrain skyline
Earth trajectory
window start/end
```

**P1. Ground-station handover.**

```text
04:10–06:30  Canberra candidate
06:22–09:05  Canberra + Madrid overlap
08:58–10:45  Madrid candidate
```

Это всё ещё **geometric**, пока нет schedule.

**P1. RF profile.**

User config:

```text
Band: X
TX power: 20 W
TX antenna: 18 dBi
RX G/T: ...
Data rate: 100 kbps
Coding: ...
Required Eb/N0: ...
Pointing loss: ...
Other loss: ...
```

После этого можно честно показывать margin.

**P1. Uncertainty.** Показывать:

```text
Nominal window   6h32m
Robust window    5h47m
Uncertainty      ±23m
```

**P1. Site comparison.**

```text
Site A   longer contact
Site B   higher margin
Site C   more robust to DEM
```

### Долгосрочно

**P2. LCRNS/Moonlight relay.** NASA публикует reference constellation states для LCRNS analysis, хотя NASA подчёркивает, что reference constellation не является финальным design подрядчика. Это хороший источник для research/demo relay modeling. citeturn463301search2

**P2. Multi-hop path selection.**

```text
surface → relay A → Earth
surface → relay B → Earth
surface → DTE
```

и выбирать маршрут по latency/data rate/availability.

**P2. DTN.** LunaNet прямо делает ставку на Delay/Disruption Tolerant Networking для intermittent links. Для Tilion это будущая функция «сколько данных успеет уйти до next contact, если storage N GB». citeturn463301search0

**P2. Weather/Ka.** Подключать terrestrial weather только когда появится реальный station/band scenario.

**P2. Multipath/fading.** Использовать NASA Lunar Surface Propagation work как основание для terrain-aware fading risk layer, но не пытаться придумывать точный fading margin без измерений. NASA/JPL сами подчёркивают ограниченность measurement data для south-pole propagation. citeturn211208search0turn211208search1

### Что скачать или добавить

Для геометрического MVP дополнительных orbital datasets почти не нужно: ваши DE440/SPICE kernels и DEM уже достаточны.

Полезно добавить:

- station catalogue DSN/ESTRACK: latitude, longitude, altitude, frequency capabilities;
- актуальные DSN 810-005 modules;
- LunaNet LNIS v5;
- LCRNS reference constellation states для relay prototype;
- более качественный south-pole DEM/uncertainty products;
- optionally Horizons validation fixtures.

Для RF P1 нужны mission-defined parameters, а не ещё один NASA raster:

```text
TX power
TX gain pattern
RX gain/G/T
frequency
bandwidth
coding
modulation
data rate
pointing error
polarization
implementation losses
required BER/FER
```

### Что нельзя утверждать

Без link budget:

- «связь гарантирована»;
- «будет X Mbps»;
- «Ka лучше X»;
- «окно подходит для video».

Без schedule:

- «DSN свободна»;
- «сеанс доступен»;
- «связь 24/7».

Без relay service contract/ephemeris:

- «LunaNet будет доступна в это время»;
- «Gateway обеспечит fallback».

Без power model:

- «можем передавать всё окно».

Без propagation model:

- «terrain clearance 0.1° означает надёжный канал».

Самые правильные статусы:

```text
EARTH_VISIBLE_GEOMETRICALLY
DTE_GEOMETRIC_CANDIDATE
RF_FEASIBLE_UNDER_ASSUMPTIONS
GROUND_STATION_GEOMETRICALLY_VISIBLE
NETWORK_SCHEDULE_NOT_VERIFIED
RELAY_CANDIDATE
```

## Источники, достоверность и рекомендации команде

Наиболее надёжные первоисточники для Tilion:

**NASA PGDA Lunar Polar Illumination / Earth Visibility** — первичный научный dataset и описание того, как Earth visibility действительно вычислялась; особенно важно предупреждение о partial Earth disk и optimistic radio interpretation. citeturn298897search0

**JPL/NASA Lunar Pole Illumination and Communications Maps** — фундаментальная работа по DEM horizon masks и Earth visibility. citeturn298897search3turn298897search4

**NASA Lunar Surface Propagation** и JPL fading paper — лучший источник именно по специфике low-elevation RF south pole, multipath и fading. citeturn211208search0turn211208search1

**NASA Lunar Communications and Navigation Architecture** — официальное объяснение проблемы south-pole DTE и необходимости relay. citeturn298897search10

**LunaNet Interoperability Specification v5** — текущий стандартный framework NASA/ESA/JAXA для DWE, relay, networking и PNT. citeturn890037search0turn890037search8

**NASA LCRNS Reference Constellation / coverage studies** — наиболее полезны для будущего relay mode в Tilion. citeturn463301search2turn463301search8

**JPL DSN 810-005** — основной технический reference для ground-station interfaces/link planning; release notices показывают обновления вплоть до июля 2026. citeturn487504search1turn487504search4

**CCSDS Space Link Services** — стандарты RF, telemetry coding, modulation и data-link protocols; текущие публикации включают обновления 2026 года. citeturn890037search4

**JPL Horizons v4.98e** — лучший независимый validator для lunar topocentric Earth az/el. citeturn435542search0

**NAIF SPICE** — основной computation engine для high-precision frames, ephemerides и aberration corrections. citeturn413687search2turn492931search7

**ESA Moonlight / Lunar Pathfinder** — актуальный European relay-service roadmap; на 14 ноября 2026 Lunar Pathfinder планируется в 2027. citeturn463301search5turn463301search6

### Чёткая рекомендация Tilion

Если времени мало, я бы не строил сейчас полный telecom simulator. Наиболее сильный пакет на хакатон:

1. **Точные динамические DTE windows** из SPICE + terrain skyline, а не average raster.
2. **Explainability**: Earth az/el, terrain horizon, clearance, конкретный blocking ridge и antenna-height sensitivity.
3. **Robustness**: nominal vs robust window при DEM/height/coordinate variation.
4. **DSN/ESTRACK candidate geometry** с честным статусом `schedule not verified`.
5. Если останется время — **simple configurable link budget**.

Ваш самый сильный narrative:

> Tilion не говорит «Земля видна — значит связь есть». Он последовательно проверяет геометрию, рельеф, конкретную ground station, radio assumptions и устойчивость результата, а всё, чего он не знает — например расписание DSN — явно помечает как неизвестное.

Это одновременно технически корректно, хорошо демонстрируется за 30–60 секунд и напрямую решает слабое место большинства упрощённых lunar landing-site planners: смешивание **Earth visibility**, **radio feasibility** и **реальной network availability** в один boolean.