// Mission schedule (#73): the operator's missions on a timeline (Gantt), the "Upcoming" list and
// public missions from sites.json. Opened from the left icon rail (#72).
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { loadSites } from "../api";
import type { Site } from "../contracts";
import { fileName, planFromJson, planToJson, wholeHourUtc } from "../mission/plan";
import { DEFAULT_PLAN, type MissionPlan, type MissionState } from "../mission/types";
import { hoursLoader, type Hours } from "../route/hours";
import { Gantt } from "./Gantt";
import { fmtUtc, history, KIND_COLOR, publicMissions, relativeLabel, slipDays, slipLabel, ZOOMS, type Zoom } from "./layout";
import { samePlan, type Schedule, type ScheduledMission } from "./store";
import { ExactInput } from "../timeline/ExactInput";
import { Select } from "../ui/Select";
import { SlideMark } from "../ui/Slide";
import "./schedule.css";

export type ScheduleProps = {
  atUtc: string;
  onAtUtc: (utc: string) => void;
  mission: MissionState;
  onMission: (m: MissionState) => void;
  schedule: Schedule; // lifted to App, so the time strip sees the other missions (#113)
  onClose?: () => void;
};

export function SchedulePanel({ atUtc, onAtUtc, mission, onMission, schedule, onClose }: ScheduleProps) {
  const { state, activate, add, update, remove } = schedule;
  const [sites, setSites] = useState<Site[]>([]);
  const [hours, setHours] = useState<Hours | null>(null);
  const [zoom, setZoom] = useState<Zoom>("months");
  const [form, setForm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    loadSites().then(
      (s) => live && setSites(s),
      (e) => live && setNotice(`Sites did not load: ${e}`),
    );
    hoursLoader().then(
      (h) => live && setHours(h),
      (e) => live && setNotice(`Light data did not load: ${e}`),
    );
    return () => {
      live = false;
    };
  }, []);

  const siteMap = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const publicList = useMemo(() => publicMissions(sites), [sites]);
  const historyNote = useMemo(() => {
    const h = history(sites);
    // #405: word joiners keep the year range on one line when the note wraps.
    return h ? `${h.count} past landings (${h.from}\u2060–\u2060${h.to}) are before the data range` : null;
  }, [sites]);
  const upcoming = useMemo(
    () => [...state.missions].sort((a, b) => Date.parse(a.plan.landingUtc) - Date.parse(b.plan.landingUtc)),
    [state.missions],
  );
  const scheduled = !!mission.plan && state.missions.some((m) => samePlan(m.plan, mission.plan));

  const addCurrent = () => {
    if (mission.plan && !scheduled) add(mission.plan, true);
  };

  const exportPlan = (m: ScheduledMission) => {
    const url = URL.createObjectURL(new Blob([planToJson(m.plan)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName(m.plan);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const errs: string[] = [];
    let n = 0;
    for (const f of [...files]) {
      const r = planFromJson(await f.text());
      if ("error" in r) errs.push(`${f.name}: ${r.error}`);
      else (add(r.plan, false), n++);
    }
    setNotice([n ? `Opened ${n} mission file${n > 1 ? "s" : ""}.` : "", ...errs].filter(Boolean).join(" "));
    if (fileInput.current) fileInput.current.value = "";
  };

  return (
    <section className="schedule" aria-label="Mission schedule">
      <header className="sch-top">
        <div className="sch-title">
          <p className="sch-eyebrow">Operations</p>
          <h2>Mission schedule</h2>
        </div>
        <div className="sch-zoom" role="group" aria-label="Zoom">
          {ZOOMS.map(([z, label]) => (
            <button key={z} type="button" aria-pressed={zoom === z} onClick={() => setZoom(z)}>
              {label}
            </button>
          ))}
          <SlideMark />
        </div>
        <div className="sch-actions">
          <button type="button" onClick={addCurrent} disabled={!mission.plan || scheduled} title={scheduled ? "The current plan is in the schedule" : undefined}>
            Add current plan
          </button>
          <button type="button" onClick={() => setForm((v) => !v)} aria-expanded={form}>
            New mission
          </button>
          <button type="button" onClick={() => fileInput.current?.click()}>
            Open mission file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            multiple
            hidden
            aria-label="Mission files"
            onChange={(e) => importFiles(e.currentTarget.files)}
          />
          {onClose && (
            <button type="button" className="sch-close" aria-label="Close schedule" onClick={onClose}>
              ×
            </button>
          )}
        </div>
      </header>

      {form && (
        <NewMission
          sites={sites}
          hours={hours}
          atUtc={atUtc}
          onCreate={(p) => {
            add(p, true);
            setForm(false);
          }}
          onCancel={() => setForm(false)}
        />
      )}
      {notice && (
        <p className="sch-notice" role="status">
          {notice}
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ×
          </button>
        </p>
      )}

      <div className="sch-body">
        <div className="sch-main">
          <Gantt
            missions={state.missions}
            activeId={state.activeId}
            sites={siteMap}
            hours={hours}
            atUtc={atUtc}
            onAtUtc={onAtUtc}
            zoom={zoom}
            publicList={publicList}
            historyNote={historyNote}
            onActivate={activate}
            onSlip={(m, utc) => update(m.id, { ...m.plan, landingUtc: utc })}
          />
          {state.missions.length === 0 && (
            <div className="sch-empty">
              <p>No missions in the schedule yet.</p>
              <div>
                <button type="button" className="primary" onClick={addCurrent} disabled={!mission.plan}>
                  Add current plan
                </button>
                <button type="button" onClick={() => setForm(true)}>
                  New mission
                </button>
              </div>
            </div>
          )}
          <ul className="sch-legend" aria-label="Legend">
            <li><i style={{ background: KIND_COLOR.both }} /> Sun + Earth</li>
            <li><i style={{ background: KIND_COLOR.sun }} /> Sun only</li>
            <li><i style={{ background: KIND_COLOR.earth }} /> Earth only</li>
            <li><i style={{ background: KIND_COLOR.none }} /> Neither</li>
            <li><i className="lg-ghost" /> Allowed slip</li>
            <li><i className="lg-hatch" /> Date not published</li>
          </ul>
        </div>

        <aside className="sch-upcoming" aria-label="Upcoming">
          <h3>
            Upcoming <span className="sch-count">{fmtUtc(atUtc)}</span>
          </h3>
          {upcoming.length === 0 && <p className="sch-muted">Missions you add appear here by landing date.</p>}
          <ol>
            {upcoming.map((m) => {
              const slip = slipDays(m.baseLandingUtc, m.plan.landingUtc);
              const active = m.id === state.activeId;
              const rel = relativeLabel(m.plan.landingUtc, m.plan.durationDays, atUtc);
              return (
                <li key={m.id} className={active ? "is-active" : undefined} data-mission={m.id}>
                  <div className="sch-up-head">
                    <span className="sch-up-name">{m.plan.name}</span>
                    <span className={`sch-up-rel${rel.startsWith("in") ? " future" : ""}`}>{rel}</span>
                  </div>
                  <div className="sch-up-sub">
                    {siteMap.get(m.plan.siteId)?.name ?? m.plan.siteId}, {fmtUtc(m.plan.landingUtc)}
                  </div>
                  <div className="sch-up-chips">
                    {active && <span className="sch-tag active">Active</span>}
                    <span className={`sch-tag${slip ? " slipped" : ""}`}>{slip ? `slipped ${slipLabel(slip)}` : "on plan"}</span>
                    <span className="sch-tag">{m.plan.durationDays} d</span>
                  </div>
                  <div className="sch-up-actions">
                    <button type="button" onClick={() => activate(m)} disabled={active} aria-label={`Make ${m.plan.name} active`}>
                      {active ? "On the map" : "Make active"}
                    </button>
                    <button type="button" onClick={() => exportPlan(m)} aria-label={`Export ${m.plan.name}`}>
                      Export JSON
                    </button>
                    <button type="button" className="danger" onClick={() => remove(m.id)} aria-label={`Delete ${m.plan.name}`}>
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>
    </section>
  );
}

function NewMission({
  sites,
  hours,
  atUtc,
  onCreate,
  onCancel,
}: {
  sites: Site[];
  hours: Hours | null;
  atUtc: string;
  onCreate: (p: MissionPlan) => void;
  onCancel: () => void;
}) {
  // Only sites with light data: the schedule shows Sun/Earth hours for every mission.
  const usable = sites.filter((s) => s.kind === "point" && s.lat !== null && (hours ? hours.sites.has(s.id) : s.terrain !== "none"));
  const [name, setName] = useState("");
  const [siteId, setSiteId] = useState("");
  const [when, setWhen] = useState(atUtc.slice(0, 16));
  const [days, setDays] = useState(DEFAULT_PLAN.durationDays);
  const site = siteId || usable[0]?.id || "";
  const landingUtc = wholeHourUtc(`${when}:00Z`);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!site || !landingUtc) return;
    onCreate({ ...DEFAULT_PLAN, name: name.trim() || DEFAULT_PLAN.name, siteId: site, landingUtc, durationDays: days });
  };
  return (
    <form className="sch-form" onSubmit={submit} aria-label="New mission">
      <label>
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={DEFAULT_PLAN.name} maxLength={80} />
      </label>
      <label>
        <span>Site</span>
        <Select label="Site" value={site} options={usable.map((s) => ({ value: s.id, label: s.name }))} onChange={setSiteId} />
      </label>
      <label>
        <span>Landing (UTC)</span>
        <ExactInput label="Landing (UTC)" valueUtc={`${when}:00Z`} onUtc={(utc) => setWhen(utc.slice(0, 16))} />
      </label>
      <label className="narrow">
        <span>Days</span>
        <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
      </label>
      <div className="sch-form-actions">
        <button type="submit" className="primary" disabled={!site || !landingUtc}>
          Create
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
