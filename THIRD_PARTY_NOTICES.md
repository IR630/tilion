# Third-party notices

Tilion adapts code under the licenses below. Each adapted file names its source in a header comment.

## Smart1po/lunex

- Source: commit `e14ab5a2bd6732466a757fe9e94aa43075e06a38`, `src/lib/power.ts` (`panelCos`, case `fixed`).
- Used in: `web/src/energy/energy.ts` (`panelCos`, panel tilt, #332).
- License: MIT.

```
MIT License

Copyright (c) 2026 Team French Fries (Mariam Madouh, Shouq Yousef), LUNEX

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

NASA data used by this software (LRO LOLA, JPL Horizons) is in the public
domain. This is not an official NASA product.
```

## dan-od/lunar-landing

- Source: commit `7f3dee6968989e9272606242cb6a16b3fc7b483a`, `core/src/report.ts` (change report: a mark is a symbol and a word; the copied text equals the screen).
- Used in: `web/src/screens/slipReport.ts` (date-slip report, #335). The "winner = count of improved metrics" rule is not ported.
- License: MIT.

```
MIT License

Copyright (c) 2026 Moon Status

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## phayne/heat1d

- Source: https://github.com/phayne/heat1d (Hayne et al. 2017 lunar thermal model, reference code `validation.py`).
- Used in: `backend/src/precompute/validation.py` (`MARE_A0`, thermal check): the mare albedo value 0.06 and the scaling of the incidence terms by A0 / 0.12, as in the author's validation. Values only, no lines copied.
- License: MIT.

## Fonts

- Instrument Serif (`@fontsource/instrument-serif`, headings, #361): SIL Open Font License 1.1, https://openfontlicense.org.
- IBM Plex Sans and JetBrains Mono: SIL Open Font License 1.1.
