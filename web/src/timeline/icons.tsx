// Small line icons of the strip: Sun / Earth rise and set (turn icons of the mission route).
import type { EventKind } from "./time";

export function EventIcon({ kind }: { kind: EventKind }) {
  const sun = kind === "sunrise" || kind === "sunset";
  const up = kind === "sunrise" || kind === "earthrise";
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {sun ? (
        <>
          <path d="M3.5 11a4.5 4.5 0 0 1 9 0" fill="currentColor" />
          <path d="M8 4.2v1.3M3.4 6.2l.9.9M12.6 6.2l-.9.9M1.8 11h1M13.2 11h1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </>
      ) : (
        <>
          <circle cx="8" cy="9.5" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5.2 8.3c1.2.2 1.6 1.3 2.7 1.1M8.7 6.3c.4 1 1.6 1.2 2.4 1.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </>
      )}
      <path d="M2 14.2h12" stroke="currentColor" strokeWidth="1.1" opacity=".55" />
      <path
        d={up ? "M8 2.6 6.4 4.2M8 2.6l1.6 1.6" : "M8 4.4 6.4 2.8M8 4.4l1.6-1.6"}
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        transform={sun ? undefined : "translate(0 -0.6)"}
      />
    </svg>
  );
}

export function PlayIcon({ playing }: { playing: boolean }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      {playing ? <path d="M2.5 1.5h2.5v9H2.5zM7 1.5h2.5v9H7z" fill="currentColor" /> : <path d="M3 1.4 10.5 6 3 10.6Z" fill="currentColor" />}
    </svg>
  );
}
