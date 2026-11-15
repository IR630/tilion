import { describe, expect, it, vi } from "vitest";
import { decodeStationLinks, loadStationLinks, stationSnapshot, type StationLinksFile } from "./stationLinks";

const start = "2027-01-01T00:00:00Z";
const H = 3600000;
const t = Date.parse(start);
const fixture = (): StationLinksFile => ({
  startUtc: start, stepMin: 60, n: 4, thresholdDeg: 10,
  complexes: ["Goldstone", "Madrid", "Canberra"].map((name, i) => ({ id: String(i), name, dss: "", dss34: "" })),
  moonElevationDeg: [[11, 11, 11, 11], [9, 9, 9, 9], [20, 20, 20, 20]],
  sites: { ridge: "0413", floor: "0000" },
});

describe("site-specific DSN station data", () => {
  it("uses the bits for the selected site and station, not a centre-Earth or rounded-elevation fallback", () => {
    const d = decodeStationLinks(fixture());
    const snap = stationSnapshot(d, "ridge", t + H)!;
    expect(snap.rows.map((r) => r.elevationDeg)).toEqual([11, 9, 20]);
    expect(snap.rows.map((r) => r.link)).toEqual([false, false, true]);
    expect(snap.next).toEqual({ kind: "available", station: "Goldstone", hours: 1 });
    expect(stationSnapshot(d, "floor", t + H)!.rows.map((r) => r.link)).toEqual([false, false, false]);
  });

  it("uses the hour holding the selected time and finds the next opening", () => {
    const d = decodeStationLinks(fixture());
    expect(stationSnapshot(d, "ridge", t + H - 1)!.rows[2].link).toBe(false);
    expect(stationSnapshot(d, "ridge", t + H - 1)!.next).toEqual({ kind: "available", station: "Canberra", hours: 0.1 });
    expect(stationSnapshot(d, "ridge", t + H)!.rows[2].link).toBe(true);
    expect(stationSnapshot(d, "ridge", t + 2 * H + H / 2)!.next).toEqual({ kind: "available", station: "Madrid", hours: 0.5 });
    expect(stationSnapshot(d, "ridge", t + 3 * H)!.next).toEqual({ kind: "none" });
  });

  it("returns unavailable for an unknown site, invalid date or a moment outside the file", () => {
    const d = decodeStationLinks(fixture());
    for (const ms of [t - 1, t + 4 * H, NaN]) expect(stationSnapshot(d, "ridge", ms)).toBeNull();
    expect(stationSnapshot(d, "missing", t)).toBeNull();
  });

  it("rejects malformed arrays and station bit strings", () => {
    const f = fixture();
    expect(() => decodeStationLinks({ ...f, moonElevationDeg: [[1]] })).toThrow();
    expect(() => decodeStationLinks({ ...f, sites: { ridge: "0890" } })).toThrow();
    expect(() => decodeStationLinks({ ...f, sites: { ridge: "01" } })).toThrow();
  });

  it("reports a failed load and retries on the next request", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: async () => fixture() });
    vi.stubGlobal("fetch", fetcher);
    try {
      expect(await loadStationLinks()).toBeNull();
      expect(await loadStationLinks()).not.toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); error.mockRestore(); }
  });
});
