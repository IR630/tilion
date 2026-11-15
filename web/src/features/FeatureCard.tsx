// Compact card of an IAU feature (#147): name, type, diameter, coordinates, the gazetteer record,
// "Add as waypoint" (#148). A feature is not a landing site: no "Plan mission from here".
import { fmtLatLon } from "../format";
import { Icon } from "../ui/icons";
import { type Feature, fmtDiameter, typeLabel } from "./features";

type Props = {
  feature: Feature;
  /** null = no mission plan: the button explains it. */
  onAddWaypoint: (() => void) | null;
  added: boolean;
  onClose: () => void;
};

export function FeatureCard({ feature: f, onAddWaypoint, added, onClose }: Props) {
  return (
    <article className="place-card feature-card" aria-label="Feature card">
      <header>
        <p className="place-eyebrow">
          IAU feature: {typeLabel(f.type)}
        </p>
        <h2>{f.name}</h2>
        <p className="place-coords">{fmtLatLon(f.lat, f.lonE)}</p>
        <button type="button" className="place-close" aria-label="Close feature card" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>
      <dl className="feature-facts">
        <div>
          <dt className="hud-label">Diameter</dt>
          <dd>{fmtDiameter(f.diameterKm)}</dd>
        </div>
      </dl>
      <div className="place-actions">
        <button
          type="button"
          className="primary"
          disabled={!onAddWaypoint || added}
          title={onAddWaypoint ? "Add this feature to the mission waypoints" : "Plan a mission first"}
          onClick={() => onAddWaypoint?.()}
        >
          <Icon name="flag" size={16} />
          {added ? "Added as waypoint" : "Add as waypoint"}
        </button>
        {!onAddWaypoint && <p className="place-muted small">Plan a mission first: waypoints belong to a mission plan.</p>}
      </div>
      <p className="place-muted small">
        Official name:{" "}
        <a href={f.url} target="_blank" rel="noreferrer">
          IAU Gazetteer of Planetary Nomenclature
        </a>{" "}
        (USGS). Centre point and diameter as published.
      </p>
    </article>
  );
}
