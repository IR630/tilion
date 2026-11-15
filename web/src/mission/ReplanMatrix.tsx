// #328, #365: the replan matrix in the Mission panel. On top: one verdict line and the smallest change that
// passes. Then sites × days around the slipped landing, each cell the Windows verdict (OK / MARGINAL / FAIL,
// the plan card rule) with the body behind the failure (Sun / Earth). A click on a cell sets that date and
// opens step 02 Sky at that site. Limits are the mission limits of the Windows panel. Logic: replan.ts.
import { useEffect, useMemo, useState } from "react";
import { loadVariants } from "../api";
import type { Site, VisibilityVariants } from "../contracts";
import { type Conditions, type Verdict, verdictRule } from "../landing";
import type { Hours } from "../route/hours";
import { BETA } from "../beta/flags";
import { Info } from "../ui/Info";
import {
  type Cause,
  type Cell,
  buildMatrix,
  headline,
  lowestHeight,
  moveSameDate,
  nearestStart,
  passDaysText,
  passes,
  pickRows,
  TO_DAY,
  waitAtSite,
} from "./replan";
import type { MissionPlan } from "./types";
import "./replan.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (iso: string) => {
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:00 UTC`;
};
const slip = (d: number) => (d === 0 ? "slipped date" : `${d > 0 ? "+" : "−"}${Math.abs(d)} d`);
const n = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const km = (x: number) => (x < 10 ? x.toFixed(1) : String(Math.round(x)));

const CAUSE: Record<Cause, { mark: string; label: string }> = {
  sun: { mark: "S", label: "Sun" },
  earth: { mark: "E", label: "Earth" },
};

const cls = (v: Verdict | null) => (v ? v.level.toLowerCase() : "none");

function cellTitle(name: string, x: Cell, c: Conditions): string {
  const head = `${name}, ${when(x.landingUtc)} (${slip(x.day)})`;
  if (!x.verdict) return `${head}: no data, the ${n(c.days)} d mission does not fit the data`;
  const cause = x.cause ? ` (${CAUSE[x.cause].label})` : "";
  return `${head}: ${x.verdict.level}${cause}. ${verdictRule(x.verdict, c)}. Click to see the sky at this site and date.`;
}

type Props = {
  hours: Hours;
  sites: Site[];
  plan: MissionPlan;
  limits: Conditions;
  nameOf: (id: string) => string;
  /** A cell click: set the app time to that landing and open the Sky view of that site. */
  onPick?: (siteId: string, utc: string) => void;
};

export function ReplanMatrix({ hours, sites, plan, limits, nameOf, onPick }: Props) {
  // Same rivals as the route search (useRoutes): LOLA terrain sites, and the plan site whatever its terrain.
  const rivals = useMemo(() => sites.filter((s) => s.terrain !== "none" || s.id === plan.siteId), [sites, plan.siteId]);
  const rows = useMemo(
    () => buildMatrix(hours, pickRows(rivals, plan.siteId, plan.radiusKm), plan.landingUtc, limits),
    [hours, rivals, plan.siteId, plan.radiusKm, plan.landingUtc, limits],
  );
  const planCell = rows[0]?.cells.find((x) => x.day === 0) ?? null;
  const needB = !!planCell && !passes(planCell.verdict);
  const wait = useMemo(() => (needB ? waitAtSite(rows) : null), [needB, rows]);
  const move = useMemo(() => (needB ? moveSameDate(rows) : null), [needB, rows]);
  const start = useMemo(
    () => (needB ? nearestStart(hours, plan.siteId, plan.landingUtc, limits) : null),
    [needB, hours, plan.siteId, plan.landingUtc, limits],
  );

  const planSite = sites.find((s) => s.id === plan.siteId);
  const [variants, setVariants] = useState<VisibilityVariants | null | undefined>(undefined);
  useEffect(() => {
    if (!BETA.mast || !needB || !planSite) return; // the height row follows the mast beta flag
    let live = true;
    setVariants(undefined);
    loadVariants(planSite).then(
      (v) => live && setVariants(v),
      () => live && setVariants(null),
    );
    return () => {
      live = false;
    };
  }, [needB, planSite]);
  const height = useMemo(() => (variants ? lowestHeight(variants, plan.landingUtc, limits) : null), [variants, plan.landingUtc, limits]);

  if (!rows.length) return null;
  const days = rows[0].cells.map((x) => x.day);
  const planName = nameOf(plan.siteId);
  const radius = Number.isFinite(plan.radiusKm) ? `within ${plan.radiusKm} km` : "at any distance";
  const unknownAhead = rows[0].cells.filter((x) => x.day >= 0 && !x.verdict).length;
  const heights = height ? height.tried.map((t) => n(t.heightM)).join(", ") + " m" : "";
  const head = headline(rows);
  const verdictLine =
    head.level === "pass"
      ? `${planName} holds on ${when(plan.landingUtc)}: all mission limits pass.`
      : head.level === "unknown" || !planCell?.verdict
        ? `No data for a ${n(limits.days)} d mission from ${when(plan.landingUtc)} at ${planName}.`
        : `${planName} fails on ${when(plan.landingUtc)}: ${verdictRule(planCell.verdict, limits)}.`;
  const smallest = !needB
    ? null
    : start
      ? `Land ${start.hours} h later (${n(Math.round((start.hours / 24) * 10) / 10)} d) at ${planName}: ${when(start.landingUtc)}, ${start.verdict.level}.`
      : move
        ? `Move ${km(move.row.distanceKm)} km to ${nameOf(move.row.siteId)}, same date: ${move.cell.verdict?.level}.`
        : `No hourly start at ${planName} passes in the next ${TO_DAY} d, and no nearby site passes on the slipped date.`;

  return (
    <section className="rpl" aria-label="Replan matrix">
      <h3 className="rpl-title">
        <span>
          Replan: sites × slip days
          <Info label="How the replan matrix is judged">
            Each cell is the plan card verdict for a landing on that day at the same hour: a {n(limits.days)} d mission, Sun and Earth up at
            landing, night ≤ {n(limits.maxNightH)} h, comm gap ≤ {n(limits.maxGapH)} h. MARGINAL = a limit is more than 75 % used. The letter is
            the first failed limit. Rows: the plan site and the nearest LOLA sites {radius}. No data is shown as no data, never as a pass. Mission
            limits are editable planning assumptions, not NASA mission requirements.
          </Info>
        </span>
      </h3>
      <p className={`rpl-verdict is-${head.level}`} role="status">
        {verdictLine}
        {head.level !== "unknown" && (
          <small>
            {passDaysText(head.passDays, head.total, planName, plan.landingUtc)}
          </small>
        )}
      </p>
      {smallest && (
        <div className="rpl-fix" aria-label="Smallest change that passes">
          <h4>Smallest change that passes</h4>
          <p>{smallest}</p>
        </div>
      )}
      <p className="rpl-sub">
        Day 0 = {when(plan.landingUtc)}. Rows: {planName} and the nearest sites {radius}. Limits (Windows panel): {n(limits.days)} d mission,
        night ≤ {n(limits.maxNightH)} h, comm gap ≤ {n(limits.maxGapH)} h. Click a cell to see the sky there.
      </p>
      <div className="rpl-scroll">
        <table className="rpl-grid">
          <thead>
            <tr>
              <th scope="col" className="rpl-site">
                Site
              </th>
              {days.map((d) => (
                <th key={d} scope="col" className={d === 0 ? "is-zero" : undefined} title={when(rows[0].cells[d - days[0]].landingUtc)}>
                  {d % 7 === 0 ? (d > 0 ? `+${d}` : d < 0 ? `−${-d}` : "0") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const name = nameOf(r.siteId);
              return (
                <tr key={r.siteId}>
                  <th scope="row" className="rpl-site" title={name}>
                    <div>
                      <span>{name}</span>
                      <small>{r.distanceKm === 0 ? "plan" : `${km(r.distanceKm)} km`}</small>
                    </div>
                  </th>
                  {r.cells.map((x) => (
                    <td key={x.day} className={`rpl-c is-${cls(x.verdict)}${x.day === 0 ? " is-zero" : ""}`}>
                      <button
                        type="button"
                        title={cellTitle(name, x, limits)}
                        aria-label={cellTitle(name, x, limits)}
                        disabled={!onPick}
                        onClick={() => onPick?.(r.siteId, x.landingUtc)}
                      >
                        {x.verdict ? (x.cause ? CAUSE[x.cause].mark : "") : "?"}
                      </button>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="rpl-key">
        <span className="rpl-k is-ok" /> OK <span className="rpl-k is-marginal" /> marginal <span className="rpl-k is-fail" /> fail{" "}
        <span className="rpl-k is-none">?</span> no data. Why it fails: <b>S</b> Sun (down at landing, or night over the limit; terrain and Earth
        eclipses included), <b>E</b> Earth (hidden at landing, or comm gap over the limit).
      </p>

      {needB && (
        <>
          <div className="rpl-cards" aria-label="Plan B">
            <article className="rpl-card">
              <h4>Plan B: wait at {planName}</h4>
              {wait ? (
                <>
                  <p className="rpl-big">until {when(wait.landingUtc)}</p>
                  <p className="rpl-note">
                    {slip(wait.day)}. {wait.verdict && `${wait.verdict.level}: ${verdictRule(wait.verdict, limits)}`}
                  </p>
                </>
              ) : (
                <p className="rpl-note">
                  No passing day here in the next {TO_DAY} d{unknownAhead ? ` (${unknownAhead} d without data)` : ""}.
                </p>
              )}
            </article>
            <article className="rpl-card">
              <h4>Plan B: move, same date</h4>
              {move ? (
                <>
                  <p className="rpl-big">to {nameOf(move.row.siteId)}</p>
                  <p className="rpl-note">
                    {km(move.row.distanceKm)} km from the plan site. {move.cell.verdict && `${move.cell.verdict.level}: ${verdictRule(move.cell.verdict, limits)}`}
                  </p>
                </>
              ) : (
                <p className="rpl-note">No site in the matrix passes on the slipped date.</p>
              )}
            </article>
          </div>
          {BETA.mast && (
            <div className="rpl-small" aria-label="Observer height">
              <p>
                <b>Observer height:</b>{" "}
              {variants === undefined
                ? "loading height variants…"
                : !height || !height.tried.length
                  ? "no height variants for this site"
                  : height.lowest !== null
                    ? `${n(height.lowest)} m, smallest among available variants (${heights})`
                    : `none of the available variants (${heights}) passes${height.tried.some((t) => !t.verdict) ? "; some have no data" : ""}`}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
