import { describe, expect, it } from "vitest";
import { BUILD_LABEL, buildTag, formatBuild } from "./buildInfo";

describe("build info", () => {
  it("formats number, sha and UTC date", () => {
    expect(formatBuild("412", "9d7c0ab", "2026-11-15")).toBe("v412 (9d7c0ab), 2026-11-15");
    expect(buildTag("412")).toBe("v412");
  });

  it("falls back to dev without git", () => {
    expect(formatBuild("dev", "dev", "dev")).toBe("dev");
    expect(buildTag("dev")).toBe("dev");
  });

  it("gets the injected values in tests", () => {
    expect(BUILD_LABEL).toMatch(/^(dev|v\d+ \([0-9a-f]+\), \d{4}-\d{2}-\d{2})$/);
  });
});
