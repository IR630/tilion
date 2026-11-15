import { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hindcast, type HindcastFile } from "./Hindcast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shipped = JSON.parse(readFileSync("public/data/beta/hindcast.json", "utf8")) as HindcastFile;

async function render(node: React.ReactNode) {
  const el = document.createElement("div");
  await act(async () => createRoot(el).render(node));
  return el;
}

afterEach(() => vi.unstubAllGlobals());

describe("Hindcast (beta)", () => {
  it("shows a BETA tag and one table row per mission event from the shipped data", async () => {
    const el = await render(<Hindcast file={shipped} />);
    expect(el.querySelector(".beta-tag")?.textContent).toMatch(/^BETA (dev|v\d+) snapshot$/);
    const heads = [...el.querySelectorAll("th")].map((h) => h.textContent);
    expect(heads).toEqual(["Mission", "Site", "Event", "Our time", "Reported event", "Δ ours − reported", "Source"]);
    const rows = el.querySelectorAll("tbody tr");
    expect(rows.length).toBe(shipped.rows.length);
    expect(rows.length).toBe(3);
    const t = el.textContent ?? "";
    expect(t).toContain("IM-1 Odysseus");
    expect(t).toContain("Chandrayaan-3 Vikram");
    expect(t).toContain("80.1300°S 1.4400°E");
    expect(t).toContain("2024-02-29 11:13 UTC");
    expect(t).toContain("same day");
    expect(t).toContain("+5.2 h");
    expect(t).toContain("(date only)");
    expect([...el.querySelectorAll("tbody a")].every((a) => a.getAttribute("href")?.startsWith("https://"))).toBe(true);
  });

  it("says 'consistent with', never claims a match, and names the missing DSN coverage", async () => {
    const el = await render(<Hindcast file={shipped} />);
    const t = el.textContent ?? "";
    expect(t).toContain("consistent with");
    expect(t).not.toMatch(/\bmatches\b(?! it)/);
    expect(t).toContain("not telemetry");
    expect(t).toContain("No DSN figures");
    expect(t).toContain("2026-2126");
  });

  it("loads data/beta/hindcast.json and renders nothing when it is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => shipped })));
    const ok = await render(<Hindcast />);
    expect(ok.querySelectorAll("tbody tr").length).toBe(3);
    expect(vi.mocked(fetch).mock.calls[0][0]).toMatch(/data\/beta\/hindcast\.json$/);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404 })));
    const missing = await render(<Hindcast />);
    expect(missing.innerHTML).toBe("");
  });
});
