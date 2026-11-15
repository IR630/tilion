// "Waypoints" section of the mission panel (#148): add by a map click, rename, reorder, remove;
// distance and initial azimuth from the landing site; long-term PGDA 69 means at the point.
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { Icon } from "../ui/icons";
import { type Grid, loadIllumGrids, sample, type Sample } from "./illumGrid";
import type { MissionState, Waypoint } from "./types";
import { azimuthDeg, distanceKm, MAX_WAYPOINTS, moveWaypoint, removeWaypoint, renameWaypoint } from "./waypoints";
import "./waypoints.css";
import { Info } from "../ui/Info";

type Props = {
  waypoints: Waypoint[];
  /** Landing site [lat, lonE]; null when the site has no position. */
  from: [number, number] | null;
  onMission: Dispatch<SetStateAction<MissionState>>;
  addMode: boolean;
  onAddMode: (on: boolean) => void;
  highlight?: number | null;
};

function useGrids(want: boolean): Grid[] | Error | null {
  const [g, setG] = useState<Grid[] | Error | null>(null);
  useEffect(() => {
    if (!want || g) return;
    let live = true;
    loadIllumGrids().then((x) => live && setG(x), (e) => live && setG(new Error(String(e))));
    return () => {
      live = false;
    };
  }, [want, g]);
  return g;
}

const fmtCell = (s: Sample) => (s.cellM < 500 ? `${Math.round(s.cellM)} m` : `${(s.cellM / 1000).toFixed(2).replace(/0$/, "")} km`);

function Mean({ grids, kind, w }: { grids: Grid[] | Error | null; kind: "sun" | "earth"; w: Waypoint }) {
  if (!grids) return <span className="wp-val">…</span>;
  if (grids instanceof Error) return <span className="wp-val" title={grids.message}>failed to load</span>;
  const s = sample(grids, kind, w.lat, w.lonE);
  if (!s) return <span className="wp-val wp-nodata">no data</span>;
  return (
    <span className="wp-val" title={`PGDA 69 mean, 18.6 y; mean of a ${fmtCell(s)} cell`}>
      {s.pct}
      <span className="hud-unit">%</span>
    </span>
  );
}

export function WaypointList({ waypoints, from, onMission, addMode, onAddMode, highlight = null }: Props) {
  const grids = useGrids(waypoints.length > 0);
  const full = waypoints.length >= MAX_WAYPOINTS;
  return (
    <section className="wp-section" aria-label="Waypoints">
      <h3>
        <span>
          Waypoints
          <Info label="About waypoint numbers">
            Distance and azimuth from the landing site, great circle on R = 1737.4 km. Sun and Earth: PGDA 69 mean, 18.6 y (Mazarico et al.
            2011): the share of time any part of the solar disc is in view and the share of time any part of the Earth disc is in view, as the
            mean of a 240 m cell (960 m north of 85°S); “no data” north of 65°S. Hourly Sun and Earth windows exist only for the 23 precomputed
            sites.
          </Info>
        </span>
        <span className="rp-count">{waypoints.length}</span>
      </h3>
      <div className="wp-add">
        <button
          type="button"
          className={`rp-btn${addMode ? " is-on" : ""}`}
          aria-pressed={addMode}
          disabled={full && !addMode}
          onClick={() => onAddMode(!addMode)}
        >
          <Icon name={addMode ? "close" : "plus"} size={15} />
          {addMode ? "Done adding" : "Add waypoint"}
        </button>
        {addMode && <span className="wp-hint">Each map click adds the next waypoint. Esc or Done to finish.</span>}
        {full && <span className="wp-hint">{MAX_WAYPOINTS} waypoints at most.</span>}
      </div>
      {waypoints.length === 0 && !addMode && (
        <p className="rp-muted">No waypoints yet. Use “Add waypoint”, or “Add as waypoint” on a crater or site card.</p>
      )}
      {waypoints.length > 0 && (
        <ol className="wp-list" aria-label="Waypoint list">
          {waypoints.map((w, i) => {
            const d = from ? distanceKm(from[0], from[1], w.lat, w.lonE) : null;
            const az = from ? Math.round(azimuthDeg(from[0], from[1], w.lat, w.lonE)) % 360 : null;
            return (
              <li key={`${i}-${w.name}-${w.lat}-${w.lonE}`} className={`wp-item${highlight === i ? " is-hl" : ""}`} data-testid="waypoint-item">
                <span className="wp-num hud-label">WP{i + 1}</span>
                <input
                  className="wp-name"
                  aria-label={`Waypoint ${i + 1} name`}
                  defaultValue={w.name}
                  maxLength={60}
                  onBlur={(e) => onMission((m) => renameWaypoint(m, i, e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") {
                      (e.target as HTMLInputElement).value = w.name;
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                />
                <span className="wp-tools">
                  <button type="button" aria-label={`Move waypoint ${i + 1} up`} disabled={i === 0} onClick={() => onMission((m) => moveWaypoint(m, i, -1))}>
                    <Icon name="chevron" size={14} className="wp-up" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move waypoint ${i + 1} down`}
                    disabled={i === waypoints.length - 1}
                    onClick={() => onMission((m) => moveWaypoint(m, i, 1))}
                  >
                    <Icon name="chevron" size={14} className="wp-down" />
                  </button>
                  <button type="button" aria-label={`Remove waypoint ${i + 1}`} onClick={() => onMission((m) => removeWaypoint(m, i))}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
                <dl className="wp-facts">
                  <div>
                    <dt className="hud-label">Distance</dt>
                    <dd className="wp-val" data-testid="waypoint-distance">
                      {d === null ? "—" : d < 100 ? d.toFixed(1) : Math.round(d)}
                      <span className="hud-unit">km</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="hud-label">Azimuth</dt>
                    <dd className="wp-val">{az === null ? "—" : `${az}°`}</dd>
                  </div>
                  <div>
                    <dt className="hud-label">Sun, 18.6-y mean</dt>
                    <dd>
                      <Mean grids={grids} kind="sun" w={w} />
                    </dd>
                  </div>
                  <div>
                    <dt className="hud-label">Earth, 18.6-y mean</dt>
                    <dd>
                      <Mean grids={grids} kind="earth" w={w} />
                    </dd>
                  </div>
                </dl>
                <span className="wp-coords">
                  {Math.abs(w.lat).toFixed(3)}°S {w.lonE.toFixed(3)}°E
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {waypoints.length > 0 && grids instanceof Error && (
        <p className="wp-note" role="alert">
          PGDA 69 grids failed to load: {grids.message}.
        </p>
      )}
    </section>
  );
}
