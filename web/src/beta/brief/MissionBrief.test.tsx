import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Site, Timeline, ValidationFile } from "../../contracts";
import { DEFAULT_LIMITS } from "../../landing";
import type { MissionPlan, MissionState } from "../../mission/types";
import type { Metrics, RouteOption } from "../../route/route";

// One synthetic site: Sun always up, Earth up except a 122 h gap from hour 48. A 14 d mission from
// hour 0 fails the Robot preset (comm gap 122 h > 120 h), like cr1_connecting_ridge on 2027-01-15 (#210).
const H = 24 * 40;
const tl: Timeline = {
  siteId: "s1",
  startUtc: "2027-01-01T00:00:00Z",
  stepMin: 60,
  sunAz: Array(H).fill(90),
  sunEl: Array(H).fill(5),
  sunVisible: Array(H).fill(1),
  earthAz: Array(H).fill(0),
  earthEl: Array(H).fill(3),
  earthVisible: Array.from({ length: H }, (_, i) => (i >= 48 && i < 48 + 122 ? 0 : 1)),
};
const validation: ValidationFile = {
  generatedUtc: "2026-11-15T15:18:07Z",
  command: "x",
  summary: { checks: 105, pass: 102, fail: 3, info: 21 },
  groups: [{ id: "g", title: "g", explanation: "", rows: [{ siteId: "s1", pass: true } as never, { siteId: "s1", pass: false } as never] }],
};
vi.mock("../../api", async (orig) => ({
  ...(await orig<typeof import("../../api")>()),
  loadFullTimeline: (s: Site) => Promise.resolve(s.id === "s1" ? tl : null),
  loadValidation: () => Promise.resolve(validation),
}));
vi.mock("../uncertainty/uncertainty", async (orig) => ({
  ...(await orig<typeof import("../uncertainty/uncertainty")>()),
  loadUncertainty: () =>
    Promise.resolve({
      sites: [{ siteId: "s1", name: "S1", sigmaMedianM: 1.2, errMaxDeg: 0.1, sun: { value: 0.93, lo: 0.926, hi: 0.934 }, earth: { value: 0.5, lo: 0.5, hi: 0.5 } }],
    }),
}));

const { PlanCard } = await import("../../mission/RoutePanel");
const { PlanVerdict } = await import("../../mission/PlanVerdict");
const { BriefSheet, PrintBrief, briefAlternative } = await import("./MissionBrief");

const site = (id: string, terrain: Site["terrain"] = "polar80"): Site => ({
  id, name: id.toUpperCase(), group: "ridge", status: "", kind: "point", lat: -89.4398, lonE: 222.83, elevM: null, source: "", confidence: "high", terrain, note: "",
});
const m: Metrics = {
  windowH: 336, windowClipped: false, sunH: 336, earthH: 214, bothH: 214, longestDarkH: 0, longestNoCommsH: 122,
  hoursToSunset: 336, hoursToEarthset: 48, sunsetBeyondData: false, earthsetBeyondData: false, sunUpAtLanding: true, earthUpAtLanding: true,
};
const plan: MissionPlan = { name: "Test", siteId: "s1", landingUtc: "2027-01-01T00:00:00Z", durationDays: 14, slipMinDays: -14, slipMaxDays: 30, radiusKm: 150, mode: "balanced" };
const opt = (siteId: string, slipDays: number): RouteOption => ({ ...m, siteId, landingUtc: plan.landingUtc, slipDays, distanceKm: siteId === "s1" ? 0 : 12, tags: [] });
const limits = DEFAULT_LIMITS.cond;

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function render(node: React.ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  return host;
}

describe("printable mission brief (#326)", () => {
  it("prints the same verdict, energy, hours and score as the plan card", async () => {
    const byId = new Map([["s1", site("s1")]]);
    const mission: MissionState = { plan, original: null, selected: null };
    const panel = await render(
      <PlanCard m={m} mode="balanced" days={14} smooth={false}>
        <PlanVerdict site={byId.get("s1")!} landingUtc={plan.landingUtc} limits={limits} />
      </PlanCard>,
    );
    await render(<PrintBrief plan={plan} pm={m} options={[opt("s1", 0)]} mission={mission} byId={byId} limits={limits} />);
    const sheet = document.querySelector(".mb-sheet")!;
    expect(sheet).toBeTruthy();
    const text = (sel: string, el: Element = sheet) => el.querySelector(sel)?.textContent?.trim();

    // Verdict: the plan card's tag and rule, word for word.
    expect(text(".rp-verdict-tag", panel)).toBe("FAIL");
    expect(text(".mb-verdict-tag")).toBe("FAIL");
    expect(text('[data-testid="brief-rule"]')).toBe(text(".rp-verdict-line span", panel));
    expect(text('[data-testid="brief-rule"]')).toBe("Comm gap 122 h > 120 h limit");
    // Energy line.
    const energy = [...panel.querySelectorAll(".rp-verdict-note")].map((p) => p.textContent).find((t) => t?.startsWith("Energy"));
    expect(text('[data-testid="brief-battery"]')).toBe(energy);
    // Window hours: every cell of the plan card.
    const cells = [...panel.querySelectorAll(".rp-metrics div")];
    expect(cells).toHaveLength(5);
    for (const c of cells) {
      const k = c.querySelector("dt")!.textContent!;
      expect(text(`dd[data-k="${k}"]`)).toBe(c.querySelector("dd")!.textContent);
    }
    // Score and "sets in".
    expect(text('[data-testid="brief-score"]')).toMatch(new RegExp(`^${text(".sc-num b", panel)} / 100`));
    expect(text('[data-testid="brief-earth"]')).toContain(text(".rp-tile.earth span:last-child", panel)!);
    expect(text('[data-testid="brief-sun"]')).toContain(text(".rp-tile.sun span:last-child", panel)!);
    // Limits table uses the verdict's window.
    expect(text('[data-testid="brief-gap"]')).toBe("122 h");
    // Evidence from validation.json, uncertainty from uncertainty.json.
    expect(text('[data-testid="brief-checks"]')).toContain("102 of 105 checks pass, 3 fail");
    expect(sheet.textContent).toContain("Checks that name S1: 1 pass, 1 fail.");
    expect(text('[data-testid="brief-unc"]')).toContain("Sun 93.0 % [92.6–93.4 %]");
    expect(text('[data-testid="brief-pos"]')).toContain("89.4398°S 222.8300°E");
    expect(sheet.textContent).not.toContain("·");
  });

  it("shows the selected option, else the best option that is not the plan", () => {
    const opts = [opt("s1", 0), opt("s2", 3), opt("s3", 0)];
    expect(briefAlternative({ plan, original: null, selected: null }, opts)).toEqual({ o: opts[1], chosen: false });
    expect(briefAlternative({ plan, original: null, selected: opts[2] }, opts)).toEqual({ o: opts[2], chosen: true });
    expect(briefAlternative({ plan, original: null, selected: null }, [opts[0]])).toBeNull();
  });

  it("marks a site without terrain and prints no verdict without a timeline", async () => {
    await render(
      <BriefSheet plan={{ ...plan, siteId: "slim" }} site={site("slim", "none")} pm={m} facts={null} alt={null} original={null} validation={null} unc={null} url="http://x/?site=slim" generatedUtc="2027-01-01T00:00:00Z" />,
    );
    const t = document.querySelector(".mb-sheet")!.textContent!;
    expect(t).toContain("No terrain coverage: bare sphere with a flat horizon");
    expect(t).toContain("Smooth sphere, no terrain model.");
    expect(t).toContain("No verdict");
    expect(t).toContain("http://x/?site=slim");
  });
});
