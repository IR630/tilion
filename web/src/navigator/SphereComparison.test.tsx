import { readFileSync } from "node:fs";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { Timeline, ValidationFile } from "../contracts";
import { SphereComparison } from "./SphereComparison";

const timeline = JSON.parse(readFileSync("public/data/timeline/im2_athena.json", "utf8")) as Timeline;
const validation = JSON.parse(readFileSync("public/data/validation.json", "utf8")) as ValidationFile;
vi.mock("../api", () => ({ loadValidation: () => Promise.resolve(validation) }));

afterEach(() => { document.body.innerHTML = ""; });

it("compares IM-2 bands and shows its own validation result", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement("div");
  document.body.append(el);
  const root = createRoot(el);
  act(() => root.render(<SphereComparison tl={timeline} siteId="im2_athena" atUtc="2027-01-15T00:00:00Z" />));
  expect(el.querySelectorAll("svg")).toHaveLength(0);
  await act(async () => { el.querySelector("button")!.click(); });
  const bands = [...el.querySelectorAll("svg")];
  expect(bands).toHaveLength(4);
  expect(bands[0].innerHTML).not.toEqual(bands[1].innerHTML);
  expect(el.textContent).toContain("Sphere sunset error here: 7 h median in 2027");
  act(() => root.unmount());
});
