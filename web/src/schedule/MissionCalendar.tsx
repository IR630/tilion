// Mission calendar (#159): a Google-Calendar-style month grid in the left column of the navigator.
// Bars = missions of the schedule (and the app's plan); a thin band under each day = the dominant light
// of that day at the selected site (hours.json, D-006). A click on a day sets the shared moment (same
// hour); a click on a bar selects the mission and its site.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Site } from "../contracts";
import { hoursLoader, type Hours } from "../route/hours";
import { dayStrip, type DayStat } from "../route/route";
import { Icon } from "../ui/icons";
import {
  addMonths,
  type CalItem,
  dayStart,
  layoutWeek,
  monthName,
  monthStart,
  rangeMonths,
  rangeTitle,
  utcOnDay,
  weekStarts,
} from "./calendarLayout";
import { DAY_MS, dayKind, fmtDay, KIND_COLOR, type Kind, RANGE_END_MS, RANGE_START_MS } from "./layout";
import "./missionCalendar.css";

type Props = {
  atUtc: string;
  onAtUtc: (utc: string) => void;
  items: CalItem[];
  /** The site whose Sun/Earth days shade the grid; null = no shading. */
  site: Site | null;
  onOpenMission: (item: CalItem) => void;
};

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const LANES = 2;
const OPEN_KEY = "tilion.calendar.open";
const KIND_LABEL: Record<Kind, string> = { both: "Sun + Earth", sun: "Sun", earth: "Earth", none: "None" };

function initialOpen(): boolean {
  try {
    const v = window.localStorage.getItem(OPEN_KEY);
    if (v === "1" || v === "0") return v === "1";
  } catch {
    /* storage blocked: fall through */
  }
  // Open by default only where it leaves room for the map: a short or narrow screen starts with the icon.
  return window.matchMedia?.("(min-width: 761px) and (min-height: 820px)").matches ?? true;
}

export function MissionCalendar({ atUtc, onAtUtc, items, site, onOpenMission }: Props) {
  const atMs = Date.parse(atUtc);
  const [open, setOpen] = useState(initialOpen);
  const [fromMs, setFromMs] = useState(() => monthStart(atMs));
  const [dir, setDir] = useState<0 | 1 | -1>(0);
  const [hours, setHours] = useState<Hours | null>(null);
  const [hoursErr, setHoursErr] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const months = rangeMonths(fromMs, atMs, items);
  const toMs = addMonths(fromMs, months);
  const minFrom = monthStart(Math.min(Date.now(), RANGE_START_MS));
  const maxFrom = monthStart(RANGE_END_MS - 1);

  // The shared moment moved out of the shown months (time strip, another panel): follow it.
  // Only a change of the moment moves the view; the month arrows may leave the moment behind.
  const lastAt = useRef(atMs);
  useEffect(() => {
    if (atMs === lastAt.current) return;
    lastAt.current = atMs;
    if (Number.isFinite(atMs) && (atMs < fromMs || atMs >= toMs)) {
      setDir(atMs < fromMs ? -1 : 1);
      setFromMs(monthStart(atMs));
    }
  }, [atMs, fromMs, toMs]);

  useEffect(() => {
    let live = true;
    hoursLoader().then(
      (h) => live && setHours(h),
      () => live && setHoursErr(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const weeks = useMemo(() => weekStarts(fromMs, months), [fromMs, months]);
  const rows = useMemo(() => weeks.map((w) => ({ w, ...layoutWeek(w, items, LANES) })), [weeks, items]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const lit = site && hours?.sites.has(site.id) ? site : null;
  const light = useMemo<DayStat[] | null>(
    () => (lit && hours ? dayStrip(hours, lit.id, new Date(weeks[0]).toISOString(), weeks.length * 7) : null),
    [lit, hours, weeks],
  );

  // Keep the day of the shared moment in view inside the scrolling grid.
  const atDay = dayStart(atMs);
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const keep = () => {
      const el = box.querySelector<HTMLElement>(".mcal-day.is-at");
      if (!el) return;
      const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
      if (top < box.scrollTop || top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top - 4;
    };
    keep();
    // The column height changes with the window: keep the day in view then too.
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(keep) : null;
    ro?.observe(box);
    return () => ro?.disconnect();
  }, [atDay, open, fromMs]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* private mode: the choice lives for this page */
    }
  };
  const shift = (k: 1 | -1) => {
    setDir(k);
    setFromMs((f) => Math.min(maxFrom, Math.max(minFrom, addMonths(f, k))));
  };

  const today = dayStart(Date.now());
  const title = rangeTitle(fromMs, months);

  return (
    <section className={`mcal${open ? " is-open" : ""}`} aria-label="Mission calendar">
      <header className="mcal-head">
        <button
          type="button"
          className="mcal-toggle"
          aria-expanded={open}
          aria-label={open ? "Hide mission calendar" : "Show mission calendar"}
          title={open ? "Hide the calendar" : "Mission calendar"}
          onClick={toggle}
        >
          <Icon name="calendar" size={16} />
        </button>
        <h2 className="mcal-title" aria-live="polite">
          {title}
        </h2>
        {open && (
          <div className="mcal-nav">
            <button type="button" className="mcal-arrow is-prev" aria-label="Previous month" disabled={fromMs <= minFrom} onClick={() => shift(-1)}>
              <Icon name="chevron" size={16} />
            </button>
            <button type="button" className="mcal-arrow is-next" aria-label="Next month" disabled={fromMs >= maxFrom} onClick={() => shift(1)}>
              <Icon name="chevron" size={16} />
            </button>
          </div>
        )}
      </header>

      <div className="mcal-fold" aria-hidden={!open} inert={!open}>
        <div className="mcal-inner">
          <div className="mcal-dow" aria-hidden="true">
            {DOW.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div ref={scroller} className="mcal-scroll">
            <div key={fromMs} className={`mcal-weeks${dir > 0 ? " from-next" : dir < 0 ? " from-prev" : ""}`}>
              {rows.map(({ w, segs, more }, wi) => (
                <div key={w} className="mcal-week">
                  {DOW.map((_, c) => {
                    const ms = w + c * DAY_MS;
                    const d = new Date(ms);
                    const inMonths = ms >= fromMs && ms < toMs;
                    const inData = ms >= RANGE_START_MS && ms < RANGE_END_MS;
                    const stat = light?.[wi * 7 + c];
                    const kind: Kind | null = stat && stat.hours > 0 ? dayKind(stat) : null;
                    const names = items.filter((i) => i.startMs < ms + DAY_MS && i.endMs > ms).map((i) => i.name);
                    const tip = [
                      fmtDay(ms),
                      !inData ? "outside the data range" : null,
                      stat && kind ? `${lit!.name}: Sun ${Math.round(stat.sunH)} h, Earth ${Math.round(stat.earthH)} h, both ${Math.round(stat.bothH)} h` : null,
                      ...names,
                    ]
                      .filter(Boolean)
                      .join("\n");
                    const cls = [
                      "mcal-day",
                      inMonths ? "" : "is-out",
                      ms === today ? "is-today" : "",
                      ms === atDay ? "is-at" : "",
                      d.getUTCDate() === 1 ? "is-first" : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <button
                        key={ms}
                        type="button"
                        className={cls}
                        data-day={new Date(ms).toISOString().slice(0, 10)}
                        aria-pressed={ms === atDay}
                        aria-label={`${DOW[c]} ${fmtDay(ms)}${names.length ? `, ${names.length} mission${names.length > 1 ? "s" : ""}` : ""}`}
                        title={tip}
                        disabled={!inData}
                        onClick={() => onAtUtc(utcOnDay(ms, atUtc))}
                      >
                        <span className="mcal-num">{d.getUTCDate() === 1 ? `${monthName(ms)} 1` : d.getUTCDate()}</span>
                        {more[c] > 0 && <span className="mcal-more">+{more[c]}</span>}
                        {kind && <i className="mcal-light" style={{ background: KIND_COLOR[kind] }} />}
                      </button>
                    );
                  })}
                  <div className="mcal-bars">
                    {segs.map((s) => {
                      const it = byId.get(s.id)!;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          className={`mcal-bar${it.active ? " is-active" : ""}${s.head ? " is-head" : ""}${s.tail ? " is-tail" : ""}`}
                          style={{ gridColumn: `${s.col + 1} / span ${s.span}`, gridRow: s.lane + 1 }}
                          aria-label={`${it.name}: ${fmtDay(it.startMs)} – ${fmtDay(it.endMs - 1)}`}
                          title={`${it.name}: ${fmtDay(it.startMs)} – ${fmtDay(it.endMs - 1)}, ${it.plan.durationDays} d on the surface`}
                          onClick={() => onOpenMission(it)}
                        >
                          {it.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {items.length === 0 && <p className="mcal-empty">No missions yet. Plan one from a site card.</p>}
          <p className="mcal-legend" title="Band under a day: what stays above the terrain horizon for most of that day at the site (hourly data).">
            {lit ? (
              <>
                <span className="mcal-legend-site">{lit.name}</span>
                {(["both", "sun", "earth", "none"] as Kind[]).map((k) => (
                  <span key={k} className="mcal-key">
                    <i style={{ background: KIND_COLOR[k] }} />
                    {KIND_LABEL[k]}
                  </span>
                ))}
              </>
            ) : (
              <span>{hoursErr ? "Light data did not load." : site && !hours ? "Loading light data…" : site ? `No hourly light data for ${site.name}.` : "Pick a site to see its Sun and Earth days."}</span>
            )}
          </p>
        </div>
      </div>
    </section>
  );
}
