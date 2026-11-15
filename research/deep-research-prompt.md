Ты — исследователь для команды хакатона NASA Space Apps Challenge 2026. Цель — максимум баллов жюри за 25 часов (заморозка кода 15 ноября 2026, 23:00 МСК; сдача до 23:59 МСК) силами 6 человек с coding-агентами (Claude Code, Codex). Пиши по-русски. Отвечай только фактами с источниками; оценки и догадки помечай явно.

## Условия (дословно)
Челлендж «Lunar Landing Site Navigator»: https://www.spaceappschallenge.org/2026/challenges/lunar-landing-site-navigator/

## Summary

Missions to the Moon’s south pole face extreme lighting and communication constraints, and planning them takes careful coordination between science and engineering teams. Tools for determining Sun and Earth positions at candidate landing sites exist, but their complicated interfaces make it difficult to evaluate critical information with efficiency. Your challenge is to create an intuitive tool or application that lets mission planners, educators, and the public compare landing sites and dates quickly, visualizing Sun and Earth positions relative to the horizon to assess power generation potential and direct-to-Earth communication windows.

## Background

NASA’s Commercial Lunar Payload Services (CLPS) program and other lunar missions depend on careful selection of landing sites and dates that balance the needs of both science and engineering teams. One of the most significant challenges in this process is understanding the local lighting and communication environment at a potential landing site. The position of the Sun determines power availability for solar arrays and thermal conditions for equipment, while the position of Earth determines whether direct communication is possible without relay satellites.

This challenge is particularly acute at the Moon's south pole, where many future missions are planned due to the presence of water ice and other scientifically valuable resources. The south pole's geometry creates extreme variations in solar illumination and Earth visibility across different lunar days and seasons. Small changes in landing location or date can dramatically affect both power generation potential and communication windows, making rapid site evaluation critical.

In practice, mission development rarely proceeds on a fixed timeline. Hardware development challenges, launch delays, or other factors often force mission planners to reconsider their original landing date and location. When this happens, engineers need to quickly evaluate alternative sites in the same region, or alternative dates at the same site, to understand how these changes impact mission feasibility. A tool that enables rapid, intuitive comparison of multiple scenarios would accelerate this decision-making process and help teams identify viable alternatives when constraints shift.

Tools that provide this information — such as NASA's Quickmap, Moon Trek, and the JPL Horizons System — are built for detailed analysis and are often difficult for non-specialists to use effectively for rapid scenario comparison. Evaluating each site-data combination means navigating multiple interfaces and interpreting raw data. This leaves a gap between the technical data available and the accessible tools needed to support agile mission planning. An intuitive interface that translates complex ephemeris and topographic data into clear, comparable visualizations could help bridge that gap.

## Objectives

Your challenge is to create a tool or application that enables rapid evaluation of lunar landing site options. Your solution may include:

- Interactive site selection and comparison: You may consider allowing users to choose from a curated list of notable landing sites – such as past Apollo missions, future CLPS mission targets, targets of other commercial lunar missions, or landing sites from other countries' lunar programs – as well as the ability to input custom lunar coordinates. You may also consider enabling side-by-side or sequential comparison of multiple sites to help users quickly assess trade-offs.

- Date and time flexibility: You may consider allowing users to select landing dates and times, and providing tools to explore how conditions change across different lunar days or seasons. This enables users to understand how mission schedule adjustments affect feasibility.

- Sun and Earth position visualization: Display the positions of the Sun and Earth relative to the horizon at a selected landing site on a chosen date. You may consider showing how much time remains before sunset or Earthset, as this directly impacts mission operations and power generation windows.

- Power and communication assessment: You may consider highlighting key metrics such as solar elevation angle (which affects power generation efficiency), duration of sunlight, and Earth visibility windows. These metrics help mission planners quickly assess whether a site-date combination is viable.

- Multiple visualization approaches: You may explore 2D maps, 3D surface visualizations, or other creative representations that help users understand the spatial relationships between the landing site, Sun, and Earth.

- Temporal dynamics: You may consider creating animations or timeline views that show how Sun and Earth positions change over a lunar day or across multiple days, helping users understand the duration and timing of operational windows.

- Accessibility across skill levels: Your tool could serve mission planners seeking detailed technical information for rapid decision-making, as well as educators and the general public curious about why the Moon presents such distinct engineering challenges.

You are encouraged to be creative in how you present this information. Your solution might be a web application, a mobile app, an interactive visualization, an educational game, or another format entirely — as long as it makes rapid site evaluation clear and efficient.

## Potential Considerations

You may (but are not required to) consider the following:

Technical approach:

- Ephemeris data – the positions and motions of celestial bodies – can be calculated using tools like the JPL Horizons System, or you may consider using pre-computed datasets.

- Lunar topography data from sources like the Lunar Orbiter Laser Altimeter (LOLA) can help create realistic surface visualizations and accurate horizon calculations.

- Consider how to handle the Moon's lack of atmosphere when calculating horizon positions. Without atmospheric refraction, the horizon is determined by local terrain and the edge of the lunar sphere as seen from the landing site.

- Solar elevation angle is a key metric for power generation, and you may consider calculating and displaying this prominently.

User experience:

- Your interface could prioritize rapid scenario comparison, allowing mission planners to evaluate multiple site-date combinations efficiently.

- Consider how to clearly communicate time remaining before sunset or Earthset, as this is critical operational information.

- Think about how to make the extreme differences between lunar and terrestrial conditions apparent—they can be compelling when visualized effectively.

- You may consider features that help users understand why small location or date changes have large impacts on mission feasibility.

Data and accuracy:

- Consider accounting for the Moon's actual topography, as terrain elevation can significantly affect horizon positions and visibility windows.

- Consider whether your tool will account for factors like Earth's libration (wobble) or the Moon's orbital variations.

- South pole terrain is particularly complex, and you may consider how to represent steep slopes and deep craters that create extreme shadow conditions.

Engagement and impact:

- Your solution could support mission planners in coordinating between science and engineering teams during mission development.

- It could help teams respond quickly when schedule changes or hardware development challenges require landing date or location adjustments.

- It could also serve as an educational tool to help students and the public understand lunar exploration challenges and why mission planning is so complex.

For data and resources related to this challenge, refer to the Resources tab at the top of the page. More resources may be added before the hackathon begins.

NASA does not endorse any non-U.S. Government entity and is not responsible for information contained on non-U.S. Government websites. For non-U.S. Government websites, participants must comply with any data use parameters of that specific website.

## NASA Data & Resources

Quickmap [https://quickmap.lroc.asu.edu/]: An interactive mapping tool developed by Arizona State University that provides access to high-resolution lunar imagery, topographic data, and other datasets from NASA's Lunar Reconnaissance Orbiter. You can use Quickmap to explore landing sites, visualize terrain, and understand the lunar surface in detail - particularly useful for understanding the complex topography of south pole regions.

Moon Trek [https://trek.nasa.gov/moon/]: NASA's interactive 3D visualization tool for lunar exploration. Moon Trek allows you to explore the lunar surface, view topographic data, and understand the terrain at potential landing sites. It provides an intuitive interface for spatial understanding of lunar locations and can help you visualize how terrain affects horizon positions.

Horizons System [https://ssd.jpl.nasa.gov/horizons/]: A powerful ephemeris computation tool developed by NASA's Jet Propulsion Laboratory that calculates the positions and velocities of celestial bodies, including the Sun and Earth as seen from any location on the Moon. You can use Horizons to obtain the precise angular positions of the Sun and Earth at specific times and locations, which form the foundation for your visualizations and power/communication assessments.


### Критерии жюри (равные веса, каждый 1–5)
- Impact — масштаб проблемы и охват; 5 = significant problem, extensive reach, could change the world.
- Creativity — оригинальность; 5 = groundbreaking approach never attempted before.
- Validity — научная обоснованность и техническая реализуемость, полнота, удобство; 5 = scientifically sound, fully developed, highly usable.
- Relevance — прямо отвечает челленджу, NASA-данные — ядро решения, а не украшение; 5 = NASA data integral to success.
- Presentation — демо и вся страница проекта; 5 = compelling structured storytelling.

### Ограничения и формат сдачи
- Демо: до 7 слайдов (включая титул) ИЛИ видео до 30 с. Выбрали 7 слайдов. Всё на английском.
- Ссылки на сайт/репозиторий — публичные, без логина. Жюри может открыть их через недели после сдачи. Сервера нет — решение статическое (GitHub Pages), считаем заранее или в браузере.
- Все внешние ресурсы — в поле References. Нельзя: bilateral activity с Китаем / китайскими организациями (NASA China funding restriction) — учитывай при выборе датасетов и библиотек.
- Команда 6 человек, Universal Event.

### Что уже сделано и измерено (не повторять, а опираться)
- Данные скачаны: SPICE generic kernels (DE440, moon_pa_de440, pck00011), LOLA DEM южного полюса 80 м (80–90°S) и 240 м (60–90°S, PGDA 90), карты средней освещённости и видимости Земли Mazarico (PGDA 69).
- SPICE (MOON_ME, LT+S) совпадает с JPL Horizons до 0,0000°. Маска горизонта по DEM до 300 км даёт освещённость гребня Shackleton 85,4 % против 88,4 % у Mazarico 2011.
- Сфера без рельефа ошибается во времени заката на 10–300 ч у полярных площадок; сдвиг точки на 60 м у гребня меняет освещённость 0 % → 86 %; +2 м высоты мачты — +8 п.п.
- Решения команды: ставка на Validity + Relevance (измеренная точность и сверка с NASA видны в интерфейсе); экраны — таблица «площадки × даты», панорама горизонта с ходом Солнца/Земли, 2D-карта полюса, 3D-рельеф; ~20 площадок (Artemis III, CLPS, другие страны, Apollo); допуск каждого времени — измеренный разброс по высоте 0/2/10 м и DEM 80/240 м; свет — виден любой край Солнца, связь — центр Земли выше маски.

## Правила ответа
- Каждый факт — со ссылкой на первичный источник: документация, статья, код, официальная страница организатора, датасет. Блоги и форумы — только как слабый сигнал, с пометкой.
- Не знаешь — пиши `UNKNOWN` и что бы это проверило. Предположение — `HYPOTHESIS:` и как его проверить за ≤ 30 минут.
- Цифры (метрики, время, цена) — с условиями измерения. Нет условий — не пиши цифру.
- Не предлагай то, что нарушает ограничения условий.

## Что нужно
1. **Топ-5 решений по баллам на оставшийся срок.** Таблица: решение | какие критерии (вес) закрывает | ожидаемый балл по каждому | часы на сборку | главный риск | источник (похожий проект, статья, готовый инструмент). Отсортируй по «баллы / час». Отдельно — самый простой baseline и его ожидаемая метрика.
2. **Что не делать.** 5–10 ловушек: что съест время и не даст баллов; что жюри считает слабым местом; известные подвохи в данных такого типа (системы координат ME/PA, проекции, масштаб растров, UTC/TDB, либрация).
3. **Таблица источников.** | источник | тип (первичный / вторичный) | что из него берём | дата | надёжность. Минимум 10, первичные — сначала. Готовые модели, датасеты, API, JS-библиотеки для эфемерид и рельефа в браузере — с лицензией и ограничениями. Особо: есть ли готовые предрасчитанные маски горизонта / таймлайны освещённости для площадок Artemis III (статьи, PGDA, LROC), DEM 5–20 м у площадок.
4. **Предметная область.** Глоссарий и 5–10 фактов, без которых решение будет наивным (как реально оценивают площадки CLPS/Artemis по свету и DTE-связи; пороги высоты Солнца для панелей; требования DSN к углу места Земли; терморежим).
5. **Вопросы жюри.** 8–10 вопросов, которые задаст эксперт по этим критериям, и какой ответ даёт баллы.
6. **Вопросы организаторам.** Что в условиях неоднозначно и меняет решение. Для каждого — почему это важно и наш вариант по умолчанию.
7. **Победители похожих челленджей.** Space Apps прошлых лет (лунные/планетные визуализации), похожие инструменты (Quickmap, Moon Trek, LunaServ, ESA/NASA планировщики освещённости): что сделали, что сработало, ссылка на код или разбор.

Формат: заголовки как выше, таблицы markdown, без вступления и заключения.
