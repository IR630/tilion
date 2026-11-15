import type { Terrain, Timeline } from "../contracts";
import { nextVisibilityEvent, sunsetDirection, sunsetTone } from "./countdownTime";
import { fmtUntil, lowSunNote } from "../format";
import { liveState } from "./geo";
import { Info } from "../ui/Info";
import "./countdown.css";

export function Countdown({ tl, atUtc, body, terrain, onChange }: {
  tl: Timeline; atUtc: string; body: "sun" | "earth"; terrain: Terrain; onChange: (t: string) => void;
}) {
  const st = liveState(tl, atUtc);
  const event = nextVisibilityEvent(tl, atUtc, body);
  if (!st || !event) return null;
  const up = body === "sun" ? st.sunUp : st.earthUp;
  const name = body === "sun" ? (up ? "Sunset" : "Sunrise") : (up ? "Earthset" : "Earthrise");
  const tone = body === "sun" && up ? sunsetTone(event.hours) : "neutral";
  // #196: a low Sun that sets weeks later reads as a contradiction; one line explains it.
  const note = body === "sun" && up ? lowSunNote(st.sunElDeg, event.hours ?? event.leftH, event.hours === null) : null;
  return (
    <>
    <button
      type="button"
      className={`countdown ${tone}`}
      disabled={event.utc === null}
      onClick={() => event.utc && onChange(event.utc)}
    >
      {name} in {fmtUntil(event.hours ?? event.leftH, event.hours === null)}
      {body === "sun" && up && event.index !== null && <span>sets {sunsetDirection(tl, event.index, terrain)}</span>}
    </button>
    {note && <Info label="Why the Sun is low">{note}</Info>}
    </>
  );
}
