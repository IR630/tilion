// #282: place card table "if the landing slips" — Sun, Earth and the longest dark run over the next 14 d
// at −3…+3 days. The column with the most Sun is marked; a click moves the moment there.
import { useMemo } from "react";
import type { Timeline } from "../contracts";
import { fmtDuration, fmtShare } from "../format";
import { slipRows } from "./slip";

const DAYS = 14;

export function SlipTable({ tl, atUtc, onPick }: { tl: Timeline; atUtc: string; onPick: (t: string) => void }) {
  const rows = useMemo(() => slipRows(tl, atUtc, DAYS), [tl, atUtc]);
  const live = rows.filter((r) => r !== null);
  if (live.length < 2) return null;
  const best = live.reduce((a, b) => (b.sun > a.sun || (b.sun === a.sun && Math.abs(b.slipD) < Math.abs(a.slipD)) ? b : a));
  const cell = (f: (r: NonNullable<(typeof rows)[number]>) => string) =>
    rows.map((r, k) => <td key={k} className={r === best ? "best" : undefined}>{r ? f(r) : "—"}</td>);
  return (
    <section className="slip" aria-label="If the landing slips">
      <p className="slip-k">If the landing slips: the next {DAYS}&nbsp;d from each date</p>
      <table>
        <thead>
          <tr>
            <th />
            {rows.map((r, k) => (
              <th key={k} className={r === best ? "best" : undefined}>
                {r ? (
                  <button type="button" onClick={() => onPick(r.atUtc)} title={`Go to ${r.atUtc.slice(0, 16).replace("T", " ")} UTC`}>
                    {r.slipD === 0 ? "now" : `${r.slipD > 0 ? "+" : "−"}${Math.abs(r.slipD)} d`}
                  </button>
                ) : "—"}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr><th>Sun-lit</th>{cell((r) => fmtShare(r.sun))}</tr>
          <tr><th>Earth</th>{cell((r) => fmtShare(r.earth))}</tr>
          <tr><th>Longest dark</th>{cell((r) => (r.longestDarkH ? fmtDuration(r.longestDarkH) : "0"))}</tr>
        </tbody>
      </table>
    </section>
  );
}
