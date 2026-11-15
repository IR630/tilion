import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Metrics } from "../route/route";
import { PlanCard } from "./RoutePanel";

afterEach(() => vi.unstubAllGlobals());

const m: Metrics = {
  windowH: 336, windowClipped: false, sunH: 300, earthH: 250, bothH: 240, longestDarkH: 20, longestNoCommsH: 122,
  hoursToSunset: 100, hoursToEarthset: 50, sunsetBeyondData: false, earthsetBeyondData: false,
  sunUpAtLanding: true, earthUpAtLanding: true,
};

// #230: "87 score" stood next to "FAIL comm gap 122 h > 120 h". The verdict is read first.
it("renders the verdict before the score", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() =>
    root.render(
      <PlanCard m={m} mode="balanced" days={14} smooth={false}>
        <div data-testid="verdict">FAIL comm gap 122 h &gt; 120 h</div>
      </PlanCard>,
    ),
  );
  const verdict = host.querySelector('[data-testid="verdict"]')!;
  const score = host.querySelector(".sc-plan")!;
  expect(verdict).toBeTruthy();
  expect(score).toBeTruthy();
  expect(verdict.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  act(() => root.unmount());
});
