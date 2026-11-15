// Date picker popover (Google Flights style): two months, every day coloured by the quality of a
// mission window that lands that day at the plan site (metricsAt from the route engine).
// With a plan a click moves the landing (inside the slip range); without one it sets the moment.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Hours } from "../route/hours";
import { metricsAt } from "../route/route";
import { ExactInput } from "./ExactInput";
import { openMoment } from "./now";
import { atTimeOfDay, DAY, fmtMonth, fmtSlip, monthGrid, T0, T_END, windowQuality, type Quality } from "./time";
import { Info } from "../ui/Info";

export type PickerPlan = {
  landingUtc: string;
  originalUtc: string;
  durationDays: number;
  bounds: [number, number]; // allowed slip, whole days from the original landing
};

type Props = {
  hours: Hours | null;
  siteId: string | null;
  siteName: string;
  atUtc: string;
  plan: PickerPlan | null; // null: pick the moment, 14-day windows from it
  onPick: (utc: string) => void;
  onAtUtc: (utc: string) => void;
  onClose: () => void;
};

const WEEK = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const QUALITY_LABEL: Record<Quality, string> = {
  both: "Sun + Earth most of the window",
  sun: "Mostly Sun only",
  earth: "Mostly Earth only",
  poor: "Poor: little Sun and Earth",
};

const nowTitle = { before: "Now is before the data: goes to the data start", after: "Now is after the data: goes to the last data hour" };

export function DatePicker(p: Props) {
  const now = openMoment();
  const ref = useRef<HTMLDivElement>(null);
  const focusMs = Date.parse(p.plan?.landingUtc ?? p.atUtc);
  const [month, setMonth] = useState(() => monthIndex(focusMs));
  const first = monthIndex(T0);
  const last = monthIndex(T_END - 1) - 1; // the left month of the last pair

  // Close on Escape and on a click outside the popover (the opener toggles it itself).
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    const down = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest("[data-picker-opener]")) p.onClose();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", down);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", down);
    };
  }, [p]);

  const tod = p.plan?.landingUtc ?? p.atUtc;
  // #484: the UTC hour a picked day lands at. Arrows, the wheel or typing change it; a day click
  // keeps it; Enter in the field applies it to the current day.
  const todHour = new Date(Date.parse(tod)).getUTCHours();
  const [hour, setHour] = useState(todHour);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setHour(todHour), [todHour]);
  const hourRef = new Date(hour * HOUR + (((Date.parse(tod) % HOUR) + HOUR) % HOUR)).toISOString();
  const stepHour = (d: number) => {
    setDraft(null);
    setHour((h) => (((h + d) % 24) + 24) % 24);
  };
  const hourBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const box = hourBox.current;
    if (!box) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY) stepHour(e.deltaY < 0 ? 1 : -1);
    };
    box.addEventListener("wheel", wheel, { passive: false });
    return () => box.removeEventListener("wheel", wheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const dur = p.plan?.durationDays ?? 14;
  const origDay = p.plan ? dayStart(Date.parse(p.plan.originalUtc)) : null;
  const landDay = p.plan ? dayStart(Date.parse(p.plan.landingUtc)) : null;
  const slip0 = p.plan && origDay !== null ? origDay + p.plan.bounds[0] * DAY : null;
  const slip1 = p.plan && origDay !== null ? origDay + p.plan.bounds[1] * DAY : null;
  const atDay = dayStart(Date.parse(p.atUtc));

  const months = [month, month + 1].map((m) => {
    const y = Math.floor(m / 12);
    const mo = m % 12;
    return { key: m, label: fmtMonth(Date.UTC(y, mo, 1)), cells: monthGrid(y, mo) };
  });

  // Window quality per visible day: about 61 engine calls, cached per site, time of day and length.
  const cache = useMemo(() => new Map<number, ReturnType<typeof metricsAt>>(), [p.hours, p.siteId, tod.slice(11), dur]); // eslint-disable-line react-hooks/exhaustive-deps
  const metrics = (day: number) => {
    if (!p.hours || !p.siteId) return null;
    if (!cache.has(day)) cache.set(day, metricsAt(p.hours, p.siteId, atTimeOfDay(day, tod), dur));
    return cache.get(day) ?? null;
  };

  const enabled = (day: number) =>
    day >= T0 && day < T_END && (slip0 === null || (day >= slip0 && day <= slip1!));
  const pick = (day: number) => {
    const utc = atTimeOfDay(day, hourRef);
    if (p.plan) p.onPick(utc);
    p.onAtUtc(utc);
  };

  return (
    <div className="dp" ref={ref} role="dialog" aria-label="Date picker">
      <header className="dp-head">
        <div>
          <p className="dp-eyebrow">
            {p.plan ? "Landing date" : "Date"}
            <Info label="What each day shows">
              {p.plan
                ? `Each day: a ${dur}-day window landing at ${tod.slice(11, 16)} UTC. Slip ${fmtSlip(p.plan.bounds[0])} … ${fmtSlip(p.plan.bounds[1])}.`
                : `Each day: the next ${dur} days from ${tod.slice(11, 16)} UTC.`}
            </Info>
          </p>
          <p className="dp-site">{p.siteName}</p>
        </div>
        <div className="dp-nav">
          <button type="button" aria-label="Previous month" disabled={month <= first} onClick={() => setMonth((m) => m - 1)}>
            <Chevron dir={-1} />
          </button>
          <button type="button" aria-label="Next month" disabled={month >= last} onClick={() => setMonth((m) => m + 1)}>
            <Chevron dir={1} />
          </button>
        </div>
      </header>

      {/* #196: typing is the fast way to a moment; the field opens focused with its text selected. */}
      <div className="dp-type">
        <label>
          <span>Date and time</span>
          <ExactInput label="Date (UTC)" valueUtc={p.atUtc} onUtc={p.onAtUtc} autoFocus onEnter={p.onClose} />
          <span>UTC</span>
        </label>
        <div className="dp-hour" onWheel={(e) => e.stopPropagation()}>
          <span>Hour</span>
          <button type="button" aria-label="Hour earlier" onClick={() => stepHour(-1)}>
            <Chevron dir={-1} />
          </button>
          <input
            ref={hourBox}
            className="dp-hour-input"
            role="spinbutton"
            aria-label="Hour (UTC)"
            aria-valuemin={0}
            aria-valuemax={23}
            aria-valuenow={hour}
            inputMode="numeric"
            maxLength={2}
            value={draft ?? String(hour).padStart(2, "0")}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={() => setDraft(null)}
            onChange={(e) => {
              const v = e.currentTarget.value.replace(/\D/g, "").slice(-2);
              setDraft(v);
              if (v !== "" && Number(v) <= 23) setHour(Number(v));
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                stepHour(e.key === "ArrowUp" ? 1 : -1);
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(landDay ?? atDay);
                p.onClose();
              }
            }}
          />
          <button type="button" aria-label="Hour later" onClick={() => stepHour(1)}>
            <Chevron dir={1} />
          </button>
          <span>UTC</span>
        </div>
        <span className="dp-type-hint">Type e.g. 2027-01-15 12:00 and press Enter, or pick a day</span>
      </div>

      <div className="dp-months">
        {months.map((m) => (
          <div key={m.key} className="dp-month">
            <p className="dp-month-name">{m.label}</p>
            <div className="dp-grid" role="grid" aria-label={m.label}>
              {WEEK.map((w) => (
                <span key={w} className="dp-wd" aria-hidden="true">
                  {w}
                </span>
              ))}
              {m.cells.map((day, k) => {
                if (day === null) return <span key={`b${k}`} aria-hidden="true" />;
                const mt = day >= T0 && day < T_END ? metrics(day) : null;
                const q = mt ? windowQuality(mt) : null;
                const on = enabled(day);
                const iso = new Date(day).toISOString().slice(0, 10);
                const cls = [
                  "dp-day",
                  q ? `q-${q.kind}` : "q-none",
                  !on && "is-off",
                  day === landDay && "is-landing",
                  p.plan && day === origDay && day !== landDay && "is-original",
                  slip0 !== null && day >= slip0 && day <= slip1! && "in-slip",
                  day === atDay && "is-moment",
                ]
                  .filter(Boolean)
                  .join(" ");
                const name = q
                  ? `${iso}: Sun + Earth ${Math.round(q.bothShare * 100)} % of the window, ${QUALITY_LABEL[q.kind].toLowerCase()}`
                  : `${iso}: no data`;
                return (
                  <button
                    key={day}
                    type="button"
                    role="gridcell"
                    className={cls}
                    aria-label={name}
                    aria-selected={day === (landDay ?? atDay)}
                    disabled={!on}
                    style={q ? ({ "--share": q.bothShare.toFixed(2) } as React.CSSProperties) : undefined}
                    onClick={() => pick(day)}
                  >
                    <span className="dp-num">{new Date(day).getUTCDate()}</span>
                    {q && <span className="dp-val">{Math.round(q.bothShare * 100)}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <footer className="dp-foot">
        <ul className="dp-legend" aria-label="Day colours">
          <li>
            <i className="q-both" /> Sun + Earth
          </li>
          <li>
            <i className="q-sun" /> Sun only
          </li>
          <li>
            <i className="q-earth" /> Earth only
          </li>
          <li>
            <i className="q-poor" /> Poor
          </li>
          <li className="dp-legend-num">Number = % of window hours with Sun + Earth</li>
        </ul>
        <div className="dp-exact">
          <button type="button" title={now.kind === "now" ? undefined : nowTitle[now.kind]} onClick={() => p.onAtUtc(now.utc)}>
            {now.kind === "now" ? "Now" : now.kind === "before" ? "Data start" : "Data end"}
          </button>
          <button type="button" className="dp-done" onClick={p.onClose}>
            Done
          </button>
        </div>
      </footer>
    </div>
  );
}

const monthIndex = (ms: number) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};
const HOUR = 3_600_000;
const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;

export function Chevron({ dir, double = false }: { dir: 1 | -1; double?: boolean }) {
  const d = dir > 0 ? "M5 3l4 4-4 4" : "M9 3 5 7l4 4";
  return (
    <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      {double && (
        <path
          d={dir > 0 ? "M1 3l4 4-4 4" : "M13 3 9 7l4 4"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity=".55"
        />
      )}
    </svg>
  );
}
