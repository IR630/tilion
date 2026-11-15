import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Site } from "../contracts";
import { moveLanding } from "../mission/plan";
import { DEFAULT_PLAN, type MissionPlan, type MissionState } from "../mission/types";
import { SchedulePanel } from "./SchedulePanel";
import { addMission, EMPTY_SCHEDULE, otherMissionPins, saveSchedule, STORAGE_KEY, useSchedule } from "./store";

const site = (id: string, name: string, status: string, p: Partial<Site> = {}): Site => ({
  id, name, group: "clps", status, kind: "point", lat: -85, lonE: 10, elevM: null,
  source: "", confidence: "high", terrain: "polar80", note: "", ...p,
});
const SITES: Site[] = [
  site("a_haworth", "Haworth (HW02)", "candidate"),
  site("cr1_connecting_ridge", "Ridge C1", "reference"),
  site("viper_nobile_west", "VIPER target (W Nobile)", "planned 2027", {
    kind: "region", lat: null, lonE: null, source: "https://www.nasa.gov/", terrain: "none", note: "No published point; region only",
  }),
  site("change7_target", "Chang'e-7 target (Shackleton SE)", "planned 2027", {
    source: "secondary", confidence: "hypothesis", note: "HYPOTHESIS: secondary source",
  }),
  site("im2_athena", "IM-2 Athena", "landed 2025-03-06"),
  site("apollo11", "Apollo 11 LM", "landed 1969-07-20T20:17:40Z", { group: "historic" }),
];

vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), loadSites: async () => SITES }));
vi.mock("../route/hours", async (orig) => {
  const m = await orig<typeof import("./../route/hours")>();
  const n = 396 * 24;
  // Haworth: Sun and Earth all the time; the ridge: Sun only.
  const hours = m.decodeHours({ startUtc: "2026-12-01T00:00:00Z", stepMin: 60, n, sites: { a_haworth: "3".repeat(n), cr1_connecting_ridge: "1".repeat(n) } });
  return { ...m, hoursLoader: async () => hours };
});

const plan = (name: string, siteId: string, landingUtc: string): MissionPlan => ({ ...DEFAULT_PLAN, name, siteId, landingUtc });
const ROVER = plan("Rover", "a_haworth", "2027-01-20T00:00:00Z");
const RELAY = plan("Relay", "cr1_connecting_ridge", "2027-01-28T00:00:00Z");
const AT = "2027-01-15T00:00:00Z";

let el: HTMLDivElement;
let root: Root;
let seen: MissionState[];
let setApp: (m: MissionState) => void;

/** The panel inside a tiny app: it owns the mission and the shared moment like App.tsx does. */
function Host({ initial }: { initial: MissionState }) {
  const [mission, setMission] = useState(initial);
  const [at, setAt] = useState(AT);
  setApp = setMission;
  const onMission = (m: MissionState) => {
    seen.push(m);
    setMission(m);
  };
  const schedule = useSchedule(mission, onMission); // lifted, as in App.tsx
  return (
    <>
      <SchedulePanel atUtc={at} onAtUtc={setAt} mission={mission} onMission={onMission} schedule={schedule} />
      <output data-pins>{JSON.stringify(otherMissionPins(schedule.state, mission))}</output>
    </>
  );
}

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});
async function mount(initial: MissionState = { plan: null, original: null, selected: null }) {
  act(() => root.render(<Host initial={initial} />));
  await flush();
}
const button = (name: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === name || b.getAttribute("aria-label") === name) as HTMLButtonElement;
const slider = (name: string) => el.querySelector(`[role="slider"][aria-label="${name}"]`) as SVGGElement;
const seed = (...plans: MissionPlan[]) => {
  let s = EMPTY_SCHEDULE;
  plans.forEach((p, i) => (s = addMission(s, p, `m${i}`).state));
  saveSchedule(s);
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  seen = [];
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

describe("SchedulePanel", () => {
  it("starts empty: no fake missions, public missions say the date is not published", async () => {
    await mount();
    expect(el.querySelector('[aria-label="Mission schedule"]')).not.toBeNull();
    expect(el.textContent).toContain("No missions in the schedule yet.");
    expect(el.querySelectorAll(".sch-row")).toHaveLength(0);
    const pub = [...el.querySelectorAll(".sch-public")];
    expect(pub.map((g) => g.getAttribute("data-site"))).toEqual(["viper_nobile_west", "change7_target"]);
    expect(pub.every((g) => g.textContent === "Planned 2027 — date not published")).toBe(true);
    expect(el.textContent).toContain("HYPOTHESIS: secondary source");
    expect(el.querySelector('a[href="https://www.nasa.gov/"]')).not.toBeNull();
    expect(el.textContent).toContain("2 past landings (1969\u2060–\u20602025) are before the data range");
    expect(button("Add current plan").disabled).toBe(true); // nothing on the map
  });

  it("public missions fold away", async () => {
    await mount();
    const toggle = el.querySelector(".sch-group-toggle") as HTMLButtonElement;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(el.querySelectorAll(".sch-public")).toHaveLength(0);
    act(() => toggle.click());
    expect(el.querySelectorAll(".sch-public")).toHaveLength(2);
  });

  it("Add current plan stores the map plan and makes it active", async () => {
    await mount({ plan: ROVER, original: ROVER, selected: null });
    act(() => button("Add current plan").click());
    await flush();
    expect(el.querySelectorAll(".sch-row")).toHaveLength(1);
    expect(el.querySelector(".sch-row")!.classList.contains("is-active")).toBe(true);
    expect(seen.at(-1)?.plan).toEqual(ROVER);
    expect(button("Add current plan").disabled).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toContain('"Rover"');
    // The bar is coloured from the day strip: Haworth is Sun + Earth all day.
    expect(el.querySelector('.sch-bar rect.k-both')).not.toBeNull();
  });

  it("lifted state: scheduled missions other than the active one are pins for the time strip (#113)", async () => {
    seed(ROVER, RELAY);
    await mount({ plan: ROVER, original: ROVER, selected: null });
    const pins = () => JSON.parse(el.querySelector("[data-pins]")!.textContent!) as { utc: string; label: string }[];
    expect(pins().map((p) => [p.label, p.utc])).toEqual([["Relay", RELAY.landingUtc]]); // Rover is on the map
    act(() => (el.querySelectorAll("button.sch-label")[1] as HTMLButtonElement).click()); // Relay becomes active
    await flush();
    expect(pins().map((p) => p.label)).toEqual(["Rover"]);
  });

  it("two missions on the timeline; a click makes one active and puts it on the map", async () => {
    seed(ROVER, RELAY);
    await mount();
    expect(el.querySelectorAll(".sch-row")).toHaveLength(2);
    // Upcoming: by landing date, relative to the shared moment.
    const items = [...el.querySelectorAll(".sch-upcoming li")];
    expect(items.map((li) => li.querySelector(".sch-up-name")!.textContent)).toEqual(["Rover", "Relay"]);
    expect(items[0].textContent).toContain("in 5 d");
    expect(items[1].textContent).toContain("in 13 d");
    // The windows overlap (20 Jan + 14 d vs 28 Jan): one marker.
    expect(el.querySelectorAll(".sch-overlap")).toHaveLength(1);

    act(() => (el.querySelectorAll("button.sch-label")[1] as HTMLButtonElement).click());
    await flush();
    expect(seen.at(-1)).toEqual({ plan: RELAY, original: RELAY, selected: null });
    const rows = el.querySelectorAll(".sch-row");
    expect(rows[1].classList.contains("is-active")).toBe(true);
    expect(rows[0].classList.contains("is-active")).toBe(false);
    expect(button("Make Relay active").disabled).toBe(true);
    expect(el.querySelector(".sch-upcoming li.is-active")!.textContent).toContain("Active");
  });

  it("slipping the active mission's pin moves the map plan and shows the chip", async () => {
    seed(ROVER);
    await mount();
    act(() => button("Make Rover active").click());
    await flush();
    const pin = slider("Landing of Rover");
    act(() => {
      pin.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await flush();
    act(() => {
      slider("Landing of Rover").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await flush();
    expect(seen.at(-1)?.plan?.landingUtc).toBe("2027-01-22T00:00:00Z");
    expect(seen.at(-1)?.original).toEqual(ROVER); // moveLanding keeps the original
    expect(el.querySelector(".sch-chip")!.textContent).toBe("+2 d");
    expect(el.querySelector(".sch-orig")).not.toBeNull(); // ghost of the planned landing
    expect(el.querySelector(".sch-upcoming li")!.textContent).toContain("slipped +2 d");
  });

  it("dragging the pin snaps to whole days inside the slip window", async () => {
    seed(ROVER);
    await mount();
    const pin = slider("Landing of Rover");
    const ev = (type: string, clientX: number) =>
      act(() => {
        pin.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }) as PointerEvent);
      });
    // Months zoom = 7 px/day: +40 px = +6 d (5.7 rounded); an inactive mission changes only in the store.
    ev("pointerdown", 100);
    ev("pointermove", 140);
    ev("pointerup", 140);
    await flush();
    expect(slider("Landing of Rover").getAttribute("aria-valuenow")).toBe("6");
    expect(seen).toHaveLength(0);
    // Far past the window end: clamped to slipMaxDays (+30).
    ev("pointerdown", 0);
    ev("pointermove", 5000);
    ev("pointerup", 5000);
    await flush();
    expect(slider("Landing of Rover").getAttribute("aria-valuenow")).toBe("30");
  });

  it("follows the app: a slip made on the HUD strip updates the stored mission", async () => {
    seed(ROVER);
    await mount();
    act(() => button("Make Rover active").click());
    await flush();
    act(() => setApp(moveLanding({ plan: ROVER, original: ROVER, selected: null }, "2027-01-24T00:00:00Z")));
    await flush();
    expect(el.querySelector(".sch-upcoming li")!.textContent).toContain("2027-01-24 00:00 UTC");
    expect(el.querySelector(".sch-chip")!.textContent).toBe("+4 d");
    expect(localStorage.getItem(STORAGE_KEY)).toContain("2027-01-24T00:00:00Z");
  });

  it("New mission creates a mission at a site with light data", async () => {
    await mount();
    act(() => button("New mission").click());
    const form = el.querySelector('form[aria-label="New mission"]')!;
    act(() => form.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Site"]')!.click());
    const options = [...document.querySelectorAll('[role="listbox"][aria-label="Site"] [role="option"]')].map((o) => o.textContent);
    expect(options).toEqual(["Haworth (HW02)", "Ridge C1"]); // no VIPER (no point), no hours elsewhere
    act(() => form.querySelector<HTMLButtonElement>('[role="combobox"][aria-label="Site"]')!.click());
    act(() => (form.querySelector('button[type="submit"]') as HTMLButtonElement).click());
    await flush();
    expect(el.querySelectorAll(".sch-row")).toHaveLength(1);
    expect(seen.at(-1)?.plan).toMatchObject({ siteId: "a_haworth", landingUtc: AT, name: DEFAULT_PLAN.name });
  });

  it("Delete removes a mission; opening files adds valid ones and lists errors", async () => {
    seed(ROVER);
    await mount();
    act(() => button("Delete Rover").click());
    await flush();
    expect(el.querySelectorAll(".sch-row")).toHaveLength(0);

    const input = el.querySelector('input[type="file"]') as HTMLInputElement;
    const good = new File([JSON.stringify({ format: "tilion-mission/1", ...RELAY, radiusKm: null })], "relay.json");
    const bad = new File(["{nope"], "bad.json");
    Object.defineProperty(input, "files", { value: [good, bad], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(el.querySelectorAll(".sch-row")).toHaveLength(1);
    expect(el.querySelector('[role="status"]')!.textContent).toContain("Opened 1 mission file.");
    expect(el.querySelector('[role="status"]')!.textContent).toContain("bad.json: The file is not valid JSON.");
  });

  it("the now line follows the shared moment and scrubs it from the keyboard", async () => {
    await mount();
    const now = slider("Shared moment");
    expect(now.getAttribute("aria-valuetext")).toBe("2027-01-15 00:00 UTC");
    act(() => now.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(slider("Shared moment").getAttribute("aria-valuetext")).toBe("2027-01-16 00:00 UTC");
    act(() => slider("Shared moment").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", shiftKey: true, bubbles: true })));
    expect(slider("Shared moment").getAttribute("aria-valuetext")).toBe("2027-01-15 23:00 UTC");
  });
});
