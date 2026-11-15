/** Static, reproducible example from precompute.ellipse (#115). Numbers are copied from its output. */
export function EllipseExample() {
  return <details className="hud-notes">
    <summary>Landing ellipse slope example: Shackleton ridge (C1)</summary>
    <p>Example ellipse: centre 89.4398° S, 222.83° E; semi-axes 1000 m × 500 m, major axis along local north. This example is fixed and does not follow the selected site.</p>
    <p>Share of area with slope ≤ 5°: 38.16 %; ≤ 10°: 85.35 %; ≤ 15°: 97.67 %. No data: 0.00 %; unknown (outside DEM coverage): 0.00 %.</p>
    <p>Share of area meeting the chosen slope criterion — not a probability of success or a safety certification. Boulders, guidance and landing dynamics are not assessed.</p>
    <p>Method: DEM 5 m (PGDA 78, Site01), slope by central difference over a 10 m baseline. It matches the published PGDA 78 slope map on the same grid: median difference 0.0000°, RMS 0.0002°. No-data pixels are never counted as flat.</p>
    <p><a href="https://pgda.gsfc.nasa.gov/products/78">LOLA 5 m site DEMs and slope maps, PGDA 78</a></p>
  </details>;
}
