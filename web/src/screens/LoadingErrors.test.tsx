import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { loadFullTimeline, loadTimeline } from "../api";
import { customSite } from "./PolarMap";
import { mockTimeline } from "../mock";
import { Calendar } from "./Calendar";
import { Compare } from "./Compare";

// The real constants (DATA_START_UTC …) stay: the calendar's Next windows (#207) reads them.
vi.mock("../api", async (orig) => ({ ...(await orig<typeof import("../api")>()), loadFullTimeline: vi.fn(), loadTimeline: vi.fn(), loadValidation: async () => null }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
const atUtc = "2027-01-01T00:00:00Z";

it.each(["summary", "effect", "calendar"])("shows the %s load error instead of loading or missing data", async (kind) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const site = { ...customSite(-89, 10), id: kind };
  vi.mocked(loadFullTimeline).mockResolvedValue(null);
  vi.mocked(loadTimeline).mockResolvedValue(mockTimeline(site, atUtc));
  if (kind === "summary") vi.mocked(loadTimeline).mockRejectedValue(new Error("timeline offline"));
  else vi.mocked(loadFullTimeline).mockRejectedValue(new Error("timeline offline"));
  const el = document.createElement("div");
  const root = createRoot(el);
  try {
    await act(async () => root.render(kind === "calendar"
      ? <Calendar sites={[site]} atUtc={atUtc} onPick={() => {}} />
      : <Compare sites={[site]} atUtc={atUtc} />));
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("timeline offline");
    expect(el.textContent).not.toContain("No precomputed timeline");
  } finally { await act(async () => root.unmount()); }
});
