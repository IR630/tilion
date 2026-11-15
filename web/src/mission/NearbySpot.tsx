import { useEffect, useMemo, useState } from "react";
import type { Site } from "../contracts";
import { coveringPoint, type Grid, loadIllumGrids } from "./illumGrid";
import { brighterNearby, type Nearby, type NearbySpot } from "./nearby";
import "./nearby.css";

export function useNearby(site: Site | null) {
  const lat = site?.lat ?? null;
  const lonE = site?.lonE ?? null;
  const want = lat !== null && lonE !== null;
  const at = `${lat},${lonE}`;
  // #372: only the grids under this point; the state keeps the point it was loaded for.
  const [loaded, setLoaded] = useState<{ at: string; g: Grid[] | Error } | null>(null);
  useEffect(() => {
    if (lat === null || lonE === null) return;
    let live = true;
    loadIllumGrids(coveringPoint(lat, lonE)).then(
      (g) => live && setLoaded({ at, g }), (e) => live && setLoaded({ at, g: new Error(String(e)) }),
    );
    return () => { live = false; };
  }, [lat, lonE, at]);
  const grids = loaded?.at === at ? loaded.g : null;
  return useMemo(() => !want ? null : grids instanceof Error ? grids : grids
    ? brighterNearby(grids, lat!, lonE!) : undefined, [grids, want, lat, lonE]);
}

export function NearbyRow({ result, onOpen }: { result: Nearby | Error | null | undefined; onOpen: (spot: NearbySpot) => void }) {
  if (result instanceof Error) return <p className="nearby-row" role="alert">Brighter spot nearby: PGDA 69 failed to load.</p>;
  if (!result) return <p className="nearby-row">Brighter spot nearby: {result === undefined ? "loading…" : "no data"}</p>;
  const { spot, cellM, radiusKm } = result;
  return (
    <div className="nearby-row" title={`PGDA 69 mean visibility, ${cellM} m cells; open the point for the LOLA horizon at 2 m`}>
      <span>{spot
        ? `Brighter spot nearby: +${spot.gainPp} pp Sun, ${spot.distanceKm.toFixed(2)} km ${spot.compass}, Earth ${spot.earthPct === null ? "no data" : `${spot.earthPct}\u00a0%`}`
        : `Site is the brightest cell within ${radiusKm} km`}</span>
      {spot && <button type="button" onClick={() => onOpen(spot)}>Open as custom point</button>}
    </div>
  );
}
