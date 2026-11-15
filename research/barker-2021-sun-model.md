# Barker 2021: модель Солнца в расчёте освещённости NASA

Факт: NASA считает Солнце протяжённым диском с потемнением к краю на 550 нм.

- Источник: Barker et al., «Improved LOLA Elevation Maps for South Pole Landing Sites: Error
  Estimates and Their Impact on Illumination Conditions», Planetary and Space Science 203 (2021),
  105119, https://doi.org/10.1016/j.pss.2020.105119.
- Полный текст (авторская рукопись, NTRS 20205009660):
  https://ntrs.nasa.gov/citations/20205009660. Раздел 5 «Illumination conditions», страница
  рукописи 13 (после сноски «12»).
- Цитата: «The Sun is treated as a 2-dimensional extended source with limb darkening at 550 nm».
- Там же: доля видимого диска — это деление диска горизонтально по высоте горизонта в азимуте
  центра диска. Мы режем диск на 15 вертикальных полос, у каждой свой горизонт (`geo.visible_fraction`).
  Разница по Barker RoI 1–7 — в допуске `make eval` (S6).
- Коэффициенты закона у нас: Allen, Astrophysical Quantities (Cox 2000); в статье их нет.
  Слово «limb» встречается в статье один раз, коэффициентов нет. Наши: `SUN_LIMB` в `backend/src/precompute/geo.py` (D-010).
