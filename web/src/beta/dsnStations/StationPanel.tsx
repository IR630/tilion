import { fmtElevation } from "../../format";
import "./stationPanel.css";

/** Display-ready values; the data adapter supplies site-specific link states. */
export type StationRow = { name: string; elevationDeg: number | null; link: boolean | null };
export type NextStation = { kind: "available"; station: string; hours: number } | { kind: "none" } | { kind: "unknown" };

export function StationPanel({ rows, next }: { rows: StationRow[]; next: NextStation }) {
  const available = rows.filter((row) => row.link).map((row) => row.name);
  return <section className="station-panel" aria-label="DSN station links">
    <h3>DSN stations</h3>
    <p>Moon elevation above each station's horizon. A geometric link requires the Moon above 10° and the station above lunar terrain.</p>
    <table>
      <thead><tr><th>Station</th><th>Moon elevation</th><th>Link</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.name}>
        <th scope="row">{row.name}</th>
        <td>{row.elevationDeg === null ? "Unavailable" : fmtElevation(row.elevationDeg)}</td>
        <td>{row.link === null ? "Unavailable" : row.link ? "Link available" : "No link"}</td>
      </tr>)}</tbody>
    </table>
    {available.length > 0 && <p>Link available now via {available.join(", ")}.</p>}
    <p>{next.kind === "available" ? `Next link via ${next.station} in ${next.hours} h` : next.kind === "none" ? "No next link in the available data" : "Next link unavailable"}.</p>
    <p>No station schedule or link budget.</p>
  </section>;
}
