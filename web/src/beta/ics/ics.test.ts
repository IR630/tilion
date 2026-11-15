import { describe, expect, it } from "vitest";
import type { Site, Timeline } from "../../contracts";
import { buildIcs, foldLine, timelineWindows } from "./ics";

const site = { id: "s1", name: "Site, with; odd name " + "x".repeat(90) } as Site;
const tl = {
  siteId: "s1",
  startUtc: "2027-01-01T00:00:00.000Z",
  stepMin: 60,
  sunVisible: [1, 1, 0, 0, 1, 0],
  earthVisible: [0, 1, 1, 0, 1, 1],
  dsnVisible: [0, 0, 1, 0, 1, 0],
} as Timeline;

describe("ics export", () => {
  it("derives runs of Sun, Earth and Earth+DSN", () => {
    const w = timelineWindows(tl).map((x) => `${x.kind}@${new Date(x.startMs).getUTCHours()}-${new Date(x.endMs).getUTCHours()}`);
    expect(w).toEqual(["Sun lit@0-2", "Earth in view@1-3", "Earth + DSN@2-3", "Earth + DSN@4-5", "Earth in view@4-6", "Sun lit@4-5"]);
  });
  it("omits DSN events when dsnVisible is absent", () => {
    const { dsnVisible: _d, ...rest } = tl;
    expect(timelineWindows(rest as Timeline).some((x) => x.kind === "Earth + DSN")).toBe(false);
  });
  it("is a valid VCALENDAR with CRLF, UTC times and folded lines", () => {
    const ics = buildIcs(site, tl, Date.parse("2026-11-15T12:00:00Z"));
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    const lines = ics.split("\r\n").slice(0, -1);
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-1)).toBe("END:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(6);
    expect(lines.filter((l) => l === "END:VEVENT")).toHaveLength(6);
    for (const l of lines) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    const unfolded = ics.replace(/\r\n /g, "").split("\r\n");
    const uids = unfolded.filter((l) => l.startsWith("UID:"));
    expect(new Set(uids).size).toBe(6);
    expect(unfolded.filter((l) => l.startsWith("DTSTAMP:")).every((l) => l === "DTSTAMP:20261115T120000Z")).toBe(true);
    expect(unfolded.filter((l) => /^DT(START|END):/.test(l)).every((l) => /:\d{8}T\d{6}Z$/.test(l))).toBe(true);
    expect(unfolded).toContain("DTSTART:20270101T000000Z");
    expect(unfolded).toContain("DTEND:20270101T020000Z");
    expect(unfolded.find((l) => l.startsWith("SUMMARY:Sun lit"))).toContain("Site\\, with\; odd name");
  });
  it("folds on character boundaries within 75 octets", () => {
    const f = foldLine("X:" + "é".repeat(100));
    for (const l of f.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(f.split("\r\n").slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(f.replace(/\r\n /g, "")).toBe("X:" + "é".repeat(100));
  });
});
