// BETA (#256): direct-to-Earth hours with an elevation margin, against the NASA LCRNS published coverage.
// Removable: delete web/src/beta/commsMargin/, its flag and its mount lines in screens/Horizon.tsx and screens/Validation.tsx.
// Data: earthEl and earthVisible of data/timeline/<id>.json. The core rule (earthVisible = Earth centre above
// the terrain mask) is not changed; this beta only adds a stricter view of the same hours.
import type { Timeline } from "../../contracts";

/** Our assumption, not a published threshold: below it a low Earth risks multipath and terrain loss. */
export const MARGIN_DEG = 5;

/** NASA states the multipath risk of a low Earth here (it gives no degree value). */
export const MULTIPATH_SRC = {
  label: "NTRS 20240013248",
  url: "https://ntrs.nasa.gov/api/citations/20240013248/downloads/Edwards%20Presentation_Ver%202.pdf",
};
export const LCRNS_SRC = {
  label: "NASA LCRNS, NTRS 20250003321, Fig. 7",
  url: "https://ntrs.nasa.gov/api/citations/20250003321/downloads/LCRNS_Esper_257.pdf",
};

export type Margin = {
  /** Earth centre above the terrain, share of hours 0..1 (the usual Earth share). */
  inView: number;
  /** In view and more than `deg` above the local level. */
  high: number;
  /** In view, at `deg` or lower: link geometry exists, margin is small. */
  low: number;
  n: number;
};

/** Shares over the whole timeline; null without Earth data. */
export function commsMargin(tl: Pick<Timeline, "earthEl" | "earthVisible" | "stub">, deg = MARGIN_DEG): Margin | null {
  const n = tl.earthVisible?.length ?? 0;
  if (tl.stub || !n || tl.earthEl?.length !== n) return null;
  let inView = 0;
  let high = 0;
  for (let i = 0; i < n; i++) {
    if (!tl.earthVisible[i]) continue;
    inView++;
    if (tl.earthEl[i] > deg) high++;
  }
  return { inView: inView / n, high: high / n, low: (inView - high) / n, n };
}

/** The two LCRNS cases. NASA gives names only; the IAU Gazetteer distances are ours (great circle, R = 1737.4 km). */
export const LCRNS_CASES = [
  {
    siteId: "a_malapert_massif",
    nasaName: "Mount Malapert Peak (best case)",
    reference: 43,
    match:
      "Our MMA01 point lies 1.9 km from the centre of Mons Malapert (IAU Gazetteer: 85.98° S, 358.33° E, 67 km wide). The match is reasonable.",
  },
  {
    siteId: "cr1_connecting_ridge",
    nasaName: "Spudis Ridge Peak (worst case)",
    reference: 17,
    match:
      "Match not confirmed. The paper gives no coordinates, and the IAU has no feature named Spudis Ridge. " +
      "Our C1 point is on the Shackleton–de Gerlache ridge, 14.2 km from the centre of Spudis crater " +
      "(IAU Gazetteer: 89.51° S, 275.39° E, 13 km wide). We assume NASA means a peak on this ridge.",
  },
] as const;

export const pct1 = (x: number) => `${(x * 100).toFixed(1)} %`;
