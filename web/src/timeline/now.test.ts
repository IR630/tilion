import { describe, expect, it } from "vitest";
import { momentLine, openMoment } from "./now";
import { T0, T1 } from "./time";

describe("opening moment (#377)", () => {
  it("before the data: held at the data start", () => {
    expect(openMoment(T0 - 16 * 86_400_000)).toEqual({ utc: "2026-12-01T00:00:00Z", kind: "before" });
    expect(openMoment(T0 - 1)).toEqual({ utc: "2026-12-01T00:00:00Z", kind: "before" });
  });
  it("inside the data: the current UTC hour, rounded down", () => {
    expect(openMoment(Date.parse("2027-05-02T08:59:59Z"))).toEqual({ utc: "2027-05-02T08:00:00Z", kind: "now" });
    expect(openMoment(T0)).toEqual({ utc: "2026-12-01T00:00:00Z", kind: "now" });
    expect(openMoment(T1)).toEqual({ utc: "2027-12-31T23:00:00Z", kind: "now" });
  });
  it("after the data: held at the last hour", () => {
    expect(openMoment(T1 + 3_600_000).kind).toBe("after");
    expect(openMoment(Date.parse("2030-01-01T00:00:00Z"))).toEqual({ utc: "2027-12-31T23:00:00Z", kind: "after" });
  });
  it("the readout says which moment it uses", () => {
    const before = Date.parse("2026-11-15T18:30:00Z");
    expect(momentLine("2026-12-01T00:00:00Z", before)).toBe("Data starts 2026-12-01 00:00 UTC; now is earlier.");
    const inside = Date.parse("2027-05-02T08:10:00Z");
    expect(momentLine("2027-05-02T08:00:00Z", inside)).toBe("Now, 2027-05-02 08:00 UTC.");
    expect(momentLine("2027-05-03T00:00:00Z", inside)).toBe("At 2027-05-03 00:00 UTC.");
    expect(momentLine("2027-12-31T23:00:00Z", Date.parse("2029-01-01T00:00:00Z"))).toBe("Data ends 2027-12-31 23:00 UTC; now is later.");
  });
});
