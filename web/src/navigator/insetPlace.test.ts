import { describe, expect, it } from "vitest";
import type { Pt } from "../inset/insetGeometry";
import { INSET_H, INSET_W, insetShown, placeInset } from "./insetPlace";

const view = { w: 1400, h: 800 };
// Left column and rail on the left, place card on the right: the free area between them.
const free = { left: 508, top: 96, right: 1016, bottom: 724 };
const square = (cx: number, cy: number, side: number): Pt[] => [
  { x: cx - side / 2, y: cy - side / 2 },
  { x: cx + side / 2, y: cy - side / 2 },
  { x: cx + side / 2, y: cy + side / 2 },
  { x: cx - side / 2, y: cy + side / 2 },
];

describe("placeInset (#129)", () => {
  it("a small outline in the middle: tile at the bottom left of the free area, two leaders", () => {
    const p = placeInset(square(760, 400, 20), view, free);
    expect(p?.corner).toBe("bl");
    expect(p?.tile).toEqual({ x: 508, y: 724 - INSET_H, w: INSET_W, h: INSET_H });
    expect(p?.leaders).toHaveLength(2);
    expect(p?.frame.h).toBe(INSET_W);
  });

  it("keeps the previous corner while it is clear", () => {
    expect(placeInset(square(760, 400, 20), view, free, [], "tr")?.corner).toBe("tr");
  });

  it("a panel on the preferred corner: the tile takes the next clear corner", () => {
    const panel = { x: 500, y: 300, w: 200, h: 450 }; // left column over the bottom left
    const p = placeInset(square(760, 160, 20), view, free, [panel]);
    expect(p?.corner).toBe("br");
  });

  it("the outline reaches the tile: the tile goes to the farthest clear corner, leaders stay", () => {
    // The outline sits in the bottom left; the farthest clear corner is the top right.
    const p = placeInset(square(620, 600, 200), view, free);
    expect(p?.corner).toBe("tr");
    expect(p?.leaders).toHaveLength(2);
  });

  it("the outline is larger than 60 % of the viewport: no inset", () => {
    expect(placeInset(square(700, 400, 0.6 * view.h + 1), view, free)).toBeNull();
  });

  it("every corner touches the outline: no inset", () => {
    expect(placeInset(square(760, 410, 440), view, free)).toBeNull();
  });

  it("the outline is off the screen: no inset", () => {
    expect(placeInset(square(-300, 400, 20), view, free)).toBeNull();
  });

  it("the free area is narrower than the tile: no inset", () => {
    expect(placeInset(square(300, 400, 20), view, { ...free, right: free.left + INSET_W - 1 })).toBeNull();
  });

  it("only 20 m and 80 m tiles are shown; a 240 m tile or no tile is not", () => {
    expect(insetShown({ resolutionM: 20 })).toBe(true);
    expect(insetShown({ resolutionM: 80 })).toBe(true);
    expect(insetShown({ resolutionM: 240 })).toBe(false);
    expect(insetShown(null)).toBe(false);
  });
});
