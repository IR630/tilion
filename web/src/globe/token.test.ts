import { afterEach, describe, expect, it } from "vitest";
import { cssToken } from "./token";

describe("cssToken", () => {
  afterEach(() => document.documentElement.removeAttribute("style"));

  it("reads a token from :root, with or without the leading dashes", () => {
    document.documentElement.style.setProperty("--red", " #ff5a1f ");
    expect(cssToken("--red", "#000000")).toBe("#ff5a1f");
    expect(cssToken("red", "#000000")).toBe("#ff5a1f");
  });

  it("falls back when the token is missing or unresolved", () => {
    expect(cssToken("--nope", "#4a90e2")).toBe("#4a90e2");
    document.documentElement.style.setProperty("--sun", "var(--red)");
    expect(cssToken("--sun", "#ff5a1f")).toBe("#ff5a1f");
    expect(cssToken("--sun", "#ff5a1f", null)).toBe("#ff5a1f");
  });
});
