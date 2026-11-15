// iCalendar (RFC 5545) export of the Sun / Earth / Earth+DSN windows of a timeline.
// Windows come from the same 0/1 series the Horizon screen shows; runs are found with sharedWindows.
import type { Site, Timeline } from "../../contracts";
import { sharedWindows } from "../../screens/EarthWindows";

export type IcsWindow = { kind: "Sun lit" | "Earth in view" | "Earth + DSN"; startMs: number; endMs: number };

export function timelineWindows(tl: Timeline): IcsWindow[] {
  const n = tl.sunVisible.length;
  const t0 = Date.parse(tl.startUtc);
  const step = tl.stepMin * 60000;
  const series: [IcsWindow["kind"], number[]][] = [
    ["Sun lit", tl.sunVisible.map((v) => (v > 0 ? 1 : 0))],
    ["Earth in view", tl.earthVisible.map((v) => (v > 0 ? 1 : 0))],
  ];
  if (tl.dsnVisible) series.push(["Earth + DSN", tl.earthVisible.map((v, i) => (v > 0 && tl.dsnVisible![i] > 0 ? 1 : 0))]);
  const out: IcsWindow[] = [];
  for (const [kind, s] of series)
    for (const [a, b] of sharedWindows([0, n], [s])) out.push({ kind, startMs: t0 + a * step, endMs: t0 + b * step });
  return out.sort((x, y) => x.startMs - y.startMs || x.kind.localeCompare(y.kind));
}

const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]|\.\d{3}/g, "");

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold a content line at 75 octets (UTF-8); continuation lines start with one space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = "";
  let len = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (len + b > limit) {
      parts.push(cur);
      cur = " ";
      len = 1;
      limit = 75;
    }
    cur += ch;
    len += b;
  }
  parts.push(cur);
  return parts.join("\r\n");
}

export function buildIcs(site: Site, tl: Timeline, nowMs: number = Date.now()): string {
  const stamp = utc(nowMs);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tilion//Windows BETA//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(`Tilion windows: ${site.name}`)}`];
  for (const w of timelineWindows(tl)) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${site.id}-${w.kind.toLowerCase().replace(/[^a-z]+/g, "-")}-${utc(w.startMs)}@tilion`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utc(w.startMs)}`,
      `DTEND:${utc(w.endMs)}`,
      `SUMMARY:${esc(`${w.kind}: ${site.name}`)}`,
      `DESCRIPTION:${esc("Geometric windows from the hourly Tilion timeline. Earth in view = Earth centre above the terrain mask. No link budget or antenna schedule checked.")}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
