/** Static, reproducible example from precompute.earth_windows (#105). */
export function EarthWindowExample() {
  return <details className="hud-notes">
    <summary>Refined Earth visibility example: Shackleton ridge</summary>
    <p>Example location: 89.45° S, 222.69° E; 2 m observer height. This example is fixed and does not follow the selected site.</p>
    <p>Period: 2026-12-01 00:00 to 2026-12-31 00:00 UTC. Earth centre above the modelled terrain: 2026-12-14 04:33:26 to 2026-12-27 11:38:57 UTC; continuous window: 319 h 5 min 31 s. Total visibility in the period: 319 h 5 min 31 s.</p>
    <p>Method: DE440, MOON_ME, LT+S; LOLA 240 m DEM, horizon sampled every 1° to 300 km. SPICE is sampled every 15 min; sign changes are bisected to 1 s. A separate 1 min sampling gave boundaries within 1 s. Shorter gaps can be missed; no gaps are merged.</p>
    <p>The 1 s numerical tolerance is not physical accuracy: DEM resolution, mask spacing, sampling and model errors affect the true boundary. Visibility is geometric only; radio link and station schedule are not checked. Incomplete DEM coverage produces an unknown result.</p>
    <p>Sources: <a href="https://pgda.gsfc.nasa.gov/products/90">LOLA polar DEM, PGDA 90</a> and <a href="https://ssd.jpl.nasa.gov/horizons/">JPL Horizons</a></p>
  </details>;
}
