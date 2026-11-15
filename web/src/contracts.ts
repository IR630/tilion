// Data contract between the precompute pipeline (backend, Python + SPICE + LOLA) and the static UI.
// The pipeline writes JSON files to web/public/data/. The UI never calls a server (decision Q3/Q10).
// Change this file in the same PR as the pipeline (label: contract).
//
// Frame: MOON_ME. Longitude: 0–360° east. Time: UTC ISO 8601. Angles: degrees.

export type SiteGroup = "ridge" | "artemis" | "clps" | "international" | "historic";
export type Confidence = "high" | "medium" | "low" | "hypothesis" | "unknown";
/** Which terrain the horizon uses: LOLA 20 + 80 + 240 m (80–90°S, nested, D-008), LOLA 240 m (60–90°S), or bare sphere. */
export type Terrain = "polar80" | "polar240" | "none";

/** data/sites.json → SitesFile */
export type Site = {
  id: string;
  name: string;
  group: SiteGroup;
  status: string;
  kind: "point" | "region";
  lat: number | null; // null = no published point
  lonE: number | null;
  elevM: number | null;
  source: string;
  confidence: Confidence;
  terrain: Terrain;
  note: string;
};
export type SitesFile = { version: 1; frame: "MOON_ME"; lonConvention: "0-360E"; sites: Site[] };

/** A value with a measured spread (decision Q8: observer height 0/2/10 m × DEM 20+80+240 / 80+240 / 240 m). */
export type Interval = { value: number; lo: number; hi: number };

/** data/mask/<siteId>.json — terrain horizon elevation by azimuth. */
export type HorizonMask = {
  siteId: string;
  observerHeightM: number;
  terrain: Terrain;
  azStepDeg: number; // azimuth i = i * azStepDeg, from north to east
  elevDeg: number[];
};

/** data/timeline/<siteId>.json — Sun and Earth over a period. Arrays share one index. */
export type Timeline = {
  siteId: string;
  startUtc: string;
  stepMin: number;
  sunAz: number[];
  sunEl: number[];
  /** Visible share of the solar flux above the terrain mask, 0..1: the disc with limb darkening
   *  (D-010, issue #99). Q9: light = any limb, i.e. > 0. */
  sunVisible: number[];
  earthAz: number[];
  earthEl: number[];
  /** 1 when the Earth centre is above the mask + margin (Q9: comm = centre), else 0. */
  earthVisible: number[];
  /** A DSN station clears the lunar mask AND that station sees the Moon centre above 10°. Hourly 0/1.
   * Absent for synthetic or derived sphere timelines (DSN access not computed).
   */
  dsnVisible?: number[];
  stub?: boolean; // true = synthetic data, the UI must say so
  /** Q8 spread, filled by the loader from data/variants: one 0/1 series per variant, same index. */
  variantSunLit?: number[][];
  variantEarthVisible?: number[][];
};

/** One visibility variant (Q8): flip indexes of a 0/1 series that starts at 0 (off). */
export type VisibilityVariant = {
  heightM: number;
  // 20+80+240 = LOLA 20 m within 5 km, 80 m to its edge, 240 m beyond (nested grid, Barker et al. 2021);
  // 80+240 = 80 m near, 240 m beyond; 240 = 240 m only
  dem: "20+80+240" | "80+240" | "240" | "none";
  sun: number[]; // Sun lit (any limb above the mask)
  earth: number[]; // Earth centre above the mask
};
/** data/variants/<siteId>.json — hourly grid of the timeline; n = number of steps. */
export type VisibilityVariants = {
  siteId: string;
  startUtc: string;
  stepMin: number;
  n: number;
  ref: { heightM: number; dem: string };
  variants: VisibilityVariant[];
};

/** One row of the Compare table: site × date. */
export type SiteSummary = {
  siteId: string;
  atUtc: string;
  sunElDeg: number;
  hoursToSunset: Interval | null; // null = Sun not visible now
  hoursToEarthset: Interval | null;
  lightFraction: Interval; // over the next 29.53 days
  earthFraction: Interval;
  /** Geometric Earth + DSN share, next 30 days; absent when DSN data is unavailable. */
  dsnFraction?: number;
  /** Longest stretch with the Sun not lit, hours, over the whole data window (not the slip date). */
  longestNightH: Interval;
  /** Longest stretch without direct Earth contact, hours, over the whole data window. */
  longestCommGapH: Interval;
  stub?: boolean;
};

/** data/validation.json — written by backend precompute.validation (#23). */
export type ValidationRow = {
  check: string;
  site: string;
  siteId: string | null;
  source: string;
  url: string;
  ours: number | null;
  reference: number | null;
  diff: number | null;
  unit: string;
  tolerance: number | null;
  pass: boolean | null; // null = information row, not a check
  note: string;
};
export type ValidationGroup = { id: string; title: string; explanation: string; rows: ValidationRow[] };
export type ValidationFile = {
  generatedUtc: string;
  command: string;
  summary: { checks: number; pass: number; fail: number; info: number };
  groups: ValidationGroup[];
};

/** data/inset/<siteId>.json — meta of the close-up hillshade tile data/inset/<file> (#125, additive).
 *  Only sites with terrain have one. The image is a 5 × 5 km greyscale hillshade, no Sun, centred on the site.
 *  bounds are polar stereographic metres (D-005) [xmin, ymin, xmax, ymax]; image row 0 = ymax (0°E side),
 *  col 0 = xmin: the layout of the basemap layers. `source` is the coarsest DEM in the tile, shown as is. */
export type SiteInset = {
  siteId: string;
  file: string;
  bounds: [number, number, number, number];
  sizePx: number;
  sizeM: number;
  pixelM: number;
  resolutionM: 20 | 80 | 240;
  source: "LOLA 20 M" | "LOLA 80 M" | "LOLA 240 M";
  shading: string;
  layout: string;
};

/** data/skyline/<siteId>.json — optional (#334): the horizon from terrain within nearM, within midM
 *  and the full mask range, same azimuth grid and observer height as mask/<siteId>.json.
 *  Per azimuth nearDeg ≤ midDeg ≤ fullDeg; fullDeg equals the mask. Only sites with terrain have one. */
export type Skyline = {
  siteId: string;
  observerHeightM: number;
  azStepDeg: number;
  nearM: number;
  midM: number;
  nearDeg: number[];
  midDeg: number[];
  fullDeg: number[];
};
