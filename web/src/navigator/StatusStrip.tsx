import type { Site } from "../contracts";
import { statusCard } from "./countdownTime";
import { useTimeline } from "./Navigator";
import "./countdown.css";

const CARDS = [["sun", "Sun"], ["earth", "Earth"], ["dsn", "DSN link"]] as const;

/** #371: Sun / Earth / DSN state with a countdown for the selected site at the dock moment. */
export function StatusStrip({ site, atUtc }: { site: Site; atUtc: string }) {
  const tl = useTimeline(site);
  if (!tl || tl instanceof Error) return null;
  return (
    <div className="status-strip" role="status" aria-label="Sun, Earth and DSN now">
      {CARDS.map(([body, label]) => {
        const c = statusCard(tl, atUtc, body);
        return (
          <div key={body} className={`status-card ${body}${c.up ? " on" : ""}`}>
            <span className="status-k">{label}</span>
            {c.state && <b>{c.state}</b>}
            <span className="status-when">{c.when}</span>
          </div>
        );
      })}
    </div>
  );
}
