import { describe, expect, it } from "vitest";
import { earthWindow, heroVerdict } from "./horizonHero";

describe("heroVerdict", () => {
  it("says the Sun is up with its elevation and time to sunset", () => {
    expect(heroVerdict(3.24, 0.8, { none: false, when: "in 41 h" })).toBe("Sun up, 3.2° above level. Sets in 41 h.");
  });
  it("#450 names the angle above terrain like the Sun card", () => {
    expect(heroVerdict(3.1, 1, { none: false, when: "in 6.0 d" }, 4.2)).toBe("Sun up, 4.2° above terrain (3.1° above level). Sets in 6.0 d.");
  });
  it("says Sun hidden when the disc is under the mask, even above 0°", () => {
    expect(heroVerdict(1.5, 0, { none: false, when: "in 5 h" })).toBe("Sun hidden behind terrain. Rises in 5 h.");
    expect(heroVerdict(-4, 0, { none: false, when: "in 5 h" })).toBe("Sun hidden. Rises in 5 h.");
  });
  it("names the open end when there is no sunset or sunrise in the data", () => {
    expect(heroVerdict(2, 1, { none: true, when: "> 30 d" })).toBe("Sun up, 2.0° above level. No sunset in the data (> 30 d).");
    expect(heroVerdict(-2, 0, { none: true, when: "> 30 d" })).toBe("Sun hidden. No sunrise in the data (> 30 d).");
  });
  it("has no middle dot", () => {
    expect(heroVerdict(3, 1, { none: false, when: "in 2 h" })).not.toContain("·");
  });
});

describe("earthWindow", () => {
  const flags = [0, 0, 1, 1, 1, 0, 0, 1];
  it("gives the start and the length of the next window", () => {
    expect(earthWindow(flags, 0, 60)).toEqual({ open: false, value: "in 2 h", foot: "lasts 3 h" });
  });
  it("gives the time to the close when the window is open", () => {
    expect(earthWindow(flags, 3, 60)).toEqual({ open: true, value: "open now", foot: "closes in 2 h" });
  });
  it("marks a window that runs to the data end and a missing window", () => {
    expect(earthWindow(flags, 5, 60).foot).toBe("open to the data end");
    expect(earthWindow([0, 0, 0], 0, 60).value).toBe("none");
    expect(earthWindow([1, 1, 1], 0, 60).foot).toContain("no close in the data");
  });
});
