// #296: the owner reads the middle dot "·" as filler. No UI string in web/src has it; comments and
// tests may. e2e/text-layout.spec.ts checks the rendered text of the main screens.
import { describe, expect, it } from "vitest";

const files = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.{ts,tsx}"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
// The typing animation keeps punctuation still; "·" in its character class is not shown text.
const ALLOWED = new Set(["./motion/text.ts"]);

describe("no middle dot in UI strings (#296)", () => {
  it("finds no '·' outside comments", () => {
    expect(Object.keys(files).length).toBeGreaterThan(50);
    const hits: string[] = [];
    for (const [path, src] of Object.entries(files)) {
      if (ALLOWED.has(path)) continue;
      src.split("\n").forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (code.replace(/\/\/.*$/, "").includes("·")) hits.push(`${path}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
