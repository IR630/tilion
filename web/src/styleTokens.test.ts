import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

describe("style tokens (#361)", () => {
  it("defines lime, text on lime and the serif family", () => {
    expect(css).toMatch(/--lime:#D8FA5C/i);
    expect(css).toMatch(/--on-lime:#101419/i);
    expect(css).toMatch(/--font-serif:"Chakra Petch"/);
  });
  it("keeps --accent white: it is body text colour in ~40 places", () => {
    expect(css).toMatch(/--accent:#ffffff/i);
  });
});
