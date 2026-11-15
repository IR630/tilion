import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Timeline } from "../../contracts";
import { complexesAt, decodeDsn, viaComplexes, viaText, type DsnFile } from "./dsn";
import { DsnVia } from "./DsnVia";

const H = 3_600_000;
const complexes = [
  { id: "G", name: "Goldstone", dss: "DSS-14", dss34: "DSS-24, DSS-26" },
  { id: "M", name: "Madrid", dss: "DSS-63", dss34: "DSS-53, DSS-56" },
  { id: "C", name: "Canberra", dss: "DSS-43", dss34: "DSS-34, DSS-36" },
];
// Hours 0..7: Madrid, Madrid+Goldstone... bit 0 G, bit 1 M, bit 2 C.
const file: DsnFile = { startUtc: "2027-01-01T00:00:00Z", stepMin: 60, n: 8, thresholdDeg: 10, complexes, codes: "22310044" };
const d = decodeDsn(file);
const t0 = Date.parse(file.startUtc);

describe("BETA DSN stations", () => {
  it("decodes the bit mask per hour", () => {
    expect(complexesAt(d, t0 + 2.5 * H).map((c) => c.id)).toEqual(["G", "M"]);
    expect(complexesAt(d, t0 + 4 * H)).toEqual([]);
    expect(complexesAt(d, t0 - H)).toEqual([]);
  });
  it("rejects a damaged file instead of showing no complex", () => {
    expect(() => decodeDsn({ ...file, codes: "2231004" })).toThrow();
    expect(() => decodeDsn({ ...file, codes: "2231004x" })).toThrow();
  });
  it("lists complexes of a window in order of first view and counts hours without DSN", () => {
    const v = viaComplexes(d, t0, t0 + 8 * H)!;
    expect(v.order.map((c) => c.id)).toEqual(["M", "G", "C"]);
    expect(v.gapH).toBe(2);
    expect(viaText(v)).toBe("via Madrid, Goldstone, Canberra, 2\u00a0h without DSN");
    expect(viaText(viaComplexes(d, t0, t0 + 2 * H)!)).toBe("via Madrid");
    expect(viaText(viaComplexes(d, t0 + 4 * H, t0 + 6 * H)!)).toBe("no DSN complex sees the Moon");
  });
  it("renders the via line with the BETA tag", () => {
    const html = renderToString(<DsnVia startMs={t0} endMs={t0 + 3 * H} dsn={d} />);
    expect(html).toContain("via Madrid, Goldstone");
    expect(html).toContain("BETA");
    expect(renderToString(<DsnVia startMs={t0} endMs={t0 + 3 * H} dsn={null} />)).toBe("");
    const inline = renderToString(<DsnVia startMs={t0} endMs={t0 + 6 * H} dsn={d} compact />);
    expect(inline).toContain('aria-label="via Madrid, Goldstone, 2\u00a0h without DSN"');
    expect(inline).toContain("BETA: via Madrid");
  });
  it("real file: the timeline's dsnVisible needs a complex in view (#329: per-station lunar mask)", () => {
    const dir = join(process.cwd(), "public", "data");
    const real = decodeDsn(JSON.parse(readFileSync(join(dir, "beta", "dsn_stations.json"), "utf8")) as DsnFile);
    const tl = JSON.parse(readFileSync(join(dir, "timeline", "a_malapert_massif.json"), "utf8")) as Timeline;
    expect(Date.parse(tl.startUtc)).toBe(real.startMs);
    const dsn = tl.dsnVisible!;
    expect(dsn).toHaveLength(real.codes.length);
    // A link needs the same station above its own 10° limit; the lunar mask can only remove hours.
    expect(dsn.filter((v, i) => v > 0 && real.codes[i] === 0)).toHaveLength(0);
    expect(dsn.some((v, i) => v === 0 && real.codes[i] > 0)).toBe(true);
  });
});
