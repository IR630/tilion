// Sun-lit and Earth-in-view shares by observer height, from the precomputed variants (same DEM as the reference).
import { expandFlips } from "../../api";
import type { Timeline, VisibilityVariants } from "../../contracts";

export type Mast = { m10: number; m2: number };

/** Share (0..1) of the shown period with the Sun lit at 10 m and 2 m; null when the data lacks either or does not fit. */
export function mastShares(v: VisibilityVariants | null, tl: Timeline): Mast | null {
  if (!v || tl.stub || !tl.sunVisible.length) return null;
  const n = tl.sunVisible.length;
  const offset = (Date.parse(tl.startUtc) - Date.parse(v.startUtc)) / (v.stepMin * 60000);
  if (v.stepMin !== tl.stepMin || !Number.isInteger(offset) || offset < 0 || offset + n > v.n) return null;
  const share = (h: number) => {
    const x = v.variants.find((y) => y.heightM === h && y.dem === v.ref.dem);
    if (!x || !Array.isArray(x.sun)) return null;
    return expandFlips(x.sun, offset, n).reduce((a, b) => a + b, 0) / n;
  };
  const m10 = share(10);
  const m2 = share(2);
  return m10 === null || m2 === null ? null : { m10, m2 };
}

export type MastEarth = { m0: number; m2: number; m10: number };

/** Share (0..1) of the whole data window with the Earth centre in view at 0, 2 and 10 m; null without all three. */
export function mastEarth(v: VisibilityVariants | null): MastEarth | null {
  if (!v || !v.n) return null;
  const share = (h: number) => {
    const x = v.variants.find((y) => y.heightM === h && y.dem === v.ref.dem);
    if (!x || !Array.isArray(x.earth)) return null;
    return expandFlips(x.earth, 0, v.n).reduce((a, b) => a + b, 0) / v.n;
  };
  const [m0, m2, m10] = [share(0), share(2), share(10)];
  return m0 === null || m2 === null || m10 === null ? null : { m0, m2, m10 };
}

export const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
