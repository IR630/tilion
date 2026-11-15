import { describe, expect, it, vi } from "vitest";
import { editPlan, moveLanding, planFrom } from "../mission/plan";
import { DEFAULT_PLAN, type MissionPlan, type MissionState } from "../mission/types";
import {
  addMission,
  deserialise,
  EMPTY_SCHEDULE,
  loadSchedule,
  otherMissionPins,
  removeMission,
  saveSchedule,
  serialise,
  setActive,
  STORAGE_KEY,
  syncFromApp,
  updateMission,
} from "./store";

const plan = (name: string, siteId: string, landingUtc: string, p: Partial<MissionPlan> = {}): MissionPlan => ({
  ...DEFAULT_PLAN, name, siteId, landingUtc, ...p,
});
const A = plan("Rover", "a_haworth", "2027-01-20T00:00:00Z", { radiusKm: Infinity }); // explicit any: JSON null must survive
const B = plan("Relay", "cr1_connecting_ridge", "2027-03-01T12:00:00Z", { radiusKm: 50, durationDays: 20 });
const onMap = (p: MissionPlan): MissionState => ({ plan: p, original: p, selected: null });

const two = () => {
  const a = addMission(EMPTY_SCHEDULE, A, "a");
  return addMission(a.state, B, "b").state;
};

describe("store transitions", () => {
  it("adds, updates, removes", () => {
    let s = two();
    expect(s.missions.map((m) => m.id)).toEqual(["a", "b"]);
    expect(s.missions[0].baseLandingUtc).toBe(A.landingUtc);
    s = updateMission(s, "a", { ...A, landingUtc: "2027-01-23T00:00:00Z" });
    expect(s.missions[0].plan.landingUtc).toBe("2027-01-23T00:00:00Z");
    expect(s.missions[0].baseLandingUtc).toBe(A.landingUtc); // the slip counts from the base
    expect(updateMission(s, "a", s.missions[0].plan)).toBe(s); // no change, same object
    s = setActive(s, "a");
    s = removeMission(s, "a");
    expect(s.missions.map((m) => m.id)).toEqual(["b"]);
    expect(s.activeId).toBeNull();
  });
  it("setActive ignores an unknown id", () => {
    const s = two();
    expect(setActive(s, "zzz")).toBe(s);
    expect(setActive(s, "b").activeId).toBe("b");
  });
});

describe("persistence", () => {
  it("round-trips through JSON, Infinity radius included", () => {
    const s = setActive(updateMission(two(), "a", { ...A, landingUtc: "2027-01-22T00:00:00Z" }), "b");
    const back = deserialise(serialise(s));
    expect(back.dropped).toBe(0);
    expect(back.state).toEqual(s);
    expect(back.state.missions[0].plan.radiusKm).toBe(Infinity);
    expect(back.state.missions[0].baseLandingUtc).toBe(A.landingUtc);
  });
  it("drops a damaged mission and keeps the rest", () => {
    const saved = JSON.parse(serialise(setActive(two(), "a")));
    saved.missions[0].plan.durationDays = -3;
    const back = deserialise(JSON.stringify(saved));
    expect(back.dropped).toBe(1);
    expect(back.state.missions.map((m) => m.id)).toEqual(["b"]);
    expect(back.state.activeId).toBeNull();
  });
  it("bad JSON or no entry = empty schedule", () => {
    expect(deserialise("{oops").state).toEqual(EMPTY_SCHEDULE);
    expect(deserialise(null).state).toEqual(EMPTY_SCHEDULE);
    expect(deserialise('{"v":2}').state).toEqual(EMPTY_SCHEDULE);
  });
  it("uses localStorage and works without it", () => {
    localStorage.clear();
    const s = two();
    expect(saveSchedule(s)).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toContain('"Relay"');
    expect(loadSchedule()).toEqual(s);
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(loadSchedule(broken)).toEqual(EMPTY_SCHEDULE);
    expect(saveSchedule(s, broken)).toBe(false);
    expect(saveSchedule(s, null)).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("sync with the app mission", () => {
  it("the active mission follows edits that come from its anchor (route panel, HUD slip)", () => {
    const s = setActive(two(), "a");
    const app = moveLanding(onMap(A), "2027-01-25T00:00:00Z"); // original stays A
    const next = syncFromApp(s, app, A);
    expect(next.activeId).toBe("a");
    expect(next.missions[0].plan.landingUtc).toBe("2027-01-25T00:00:00Z");
    // A second edit keeps following: the original is still the anchor.
    const later = syncFromApp(next, editPlan(app, { siteId: "a_mons_mouton" }), A);
    expect(later.missions[0].plan.siteId).toBe("a_mons_mouton");
    expect(later.missions[1].plan).toEqual(B);
  });
  it("matches by name and site when the plan comes from a link or a file", () => {
    const s = two();
    const moved = { ...B, landingUtc: "2027-03-04T12:00:00Z" };
    const next = syncFromApp(s, onMap(moved), null);
    expect(next.activeId).toBe("b");
    expect(next.missions[1].plan.landingUtc).toBe("2027-03-04T12:00:00Z");
  });
  it("two missions with one name and site: the landing date picks the right one", () => {
    const early = plan("Untitled mission", "a_haworth", "2027-02-01T00:00:00Z");
    const late = plan("Untitled mission", "a_haworth", "2027-08-01T00:00:00Z");
    const s = addMission(addMission(EMPTY_SCHEDULE, early, "e").state, late, "l").state;
    const next = syncFromApp(s, onMap(late), null);
    expect(next.activeId).toBe("l");
    expect(next.missions.find((m) => m.id === "e")!.plan).toEqual(early); // not overwritten
    // A slipped copy of the late one (+3 d, inside its slip window) still finds it.
    const slipped = syncFromApp(s, onMap({ ...late, landingUtc: "2027-08-04T00:00:00Z" }), null);
    expect(slipped.activeId).toBe("l");
    expect(slipped.missions.find((m) => m.id === "e")!.plan).toEqual(early);
    // Outside both slip windows: no stored mission is touched.
    const far = syncFromApp(s, onMap({ ...late, landingUtc: "2027-05-01T00:00:00Z" }), null);
    expect(far.activeId).toBeNull();
    expect(far.missions.map((m) => m.plan)).toEqual([early, late]);
  });
  it("a new plan elsewhere on the map does not overwrite the active mission", () => {
    const s = setActive(two(), "a");
    const fresh = planFrom(onMap(A), "a_slater_plain", "2027-06-01T00:00:00Z");
    const next = syncFromApp(s, fresh, A);
    expect(next.activeId).toBeNull();
    expect(next.missions[0].plan).toEqual(A);
  });
  it("no app plan = no change", () => {
    const s = setActive(two(), "a");
    expect(syncFromApp(s, { plan: null, original: null, selected: null }, A)).toBe(s);
  });
});

describe("pins of the other missions (#113)", () => {
  const group = (id: string) => (id === "a_haworth" ? "clps" : undefined);

  it("an edit of an inactive mission shows at once; the active one is not a pin", () => {
    const s = setActive(two(), "a");
    expect(otherMissionPins(s, onMap(A), group)).toEqual([
      { utc: "2027-03-01T12:00:00Z", label: "Relay", color: "var(--fg)" },
    ]);
    const edited = updateMission(s, "b", moveLanding(onMap(B), "2027-03-05T00:00:00Z").plan!);
    expect(otherMissionPins(edited, onMap(A), group).map((p) => p.utc)).toEqual(["2027-03-05T00:00:00Z"]);
  });

  it("colours a pin by the group of its site and skips the plan now on the map", () => {
    expect(otherMissionPins(two(), onMap(B), group)).toEqual([
      { utc: "2027-01-20T00:00:00Z", label: "Rover", color: "var(--g-clps)" },
    ]);
    expect(otherMissionPins(EMPTY_SCHEDULE, onMap(A), group)).toEqual([]);
  });
});
