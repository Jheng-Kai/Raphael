import { expect, test } from "vitest";
import { EDGE, EDGE_TOP, GROUP_GAP, SPOT_GAP, placeGroup, type Box, type PlaceInput } from "./place";

const view = { width: 1120, height: 900 };
const bubble = { width: 260, height: 110 };
const base: Omit<PlaceInput, "spot" | "prefer"> = { view, bubble, slime: 56 };
const right = (box: Box): number => box.left + box.width;
const bottom = (box: Box): number => box.top + box.height;
const apart = (a: Box, b: Box): boolean => right(a) <= b.left || right(b) <= a.left || bottom(a) <= b.top || bottom(b) <= a.top;

test("a group stands on the first side that fits, Raphael over the middle of what it points at and its words beside it", () => {
  const composer: Box = { left: 385, top: 774, width: 700, height: 112 };
  const found = placeGroup({ ...base, spot: composer, prefer: ["above"] });
  expect(found.side).toBe("above");
  expect(bottom(found.bubble)).toBe(composer.top - SPOT_GAP);
  expect(bottom(found.slime)).toBe(bottom(found.bubble));
  // Over the middle of the composer; the words follow to its right.
  expect(found.slime.left + 28).toBe(composer.left + composer.width / 2);
  expect(found.bubble.left).toBe(found.slime.left + 56 + GROUP_GAP);
});

test("beside the sidebar the group stands to its right, level with it", () => {
  const list: Box = { left: 0, top: 32, width: 348, height: 868 };
  const found = placeGroup({ ...base, spot: list, prefer: ["right"] });
  expect(found.side).toBe("right");
  expect(found.slime.left).toBe(right(list) + SPOT_GAP);
  expect(found.bubble.left).toBe(found.slime.left + 56 + GROUP_GAP);
  expect(found.bubble.top).toBeGreaterThanOrEqual(EDGE_TOP);
});

test("at the right edge the words go to Raphael's left and the group stays in the window", () => {
  const model: Box = { left: 930, top: 826, width: 120, height: 32 };
  const found = placeGroup({ ...base, spot: model, prefer: ["above"] });
  expect(found.side).toBe("above");
  expect(right(found.bubble)).toBeLessThanOrEqual(view.width - EDGE);
  expect(found.bubble.left).toBeLessThan(found.slime.left);
  expect(right(found.slime)).toBeLessThanOrEqual(view.width - EDGE);
});

test("a side with no room gives way to the next: a target at the top has nothing above it", () => {
  const top: Box = { left: 400, top: 40, width: 200, height: 40 };
  const found = placeGroup({ ...base, spot: top, prefer: ["above", "right"] });
  expect(found.side).toBe("right");
  expect(apart(found.bubble, top) && apart(found.slime, top)).toBe(true);
});

test("a target that fills the window holds the group inside, in its lower right", () => {
  const dialog: Box = { left: 60, top: 32, width: 1000, height: 813 };
  const found = placeGroup({ ...base, spot: dialog, prefer: ["inside"] });
  expect(found.side).toBe("inside");
  expect(right(found.bubble)).toBe(right(dialog) - 24);
  expect(bottom(found.bubble)).toBe(bottom(dialog) - 24);
  expect(found.slime.left + 56 + GROUP_GAP).toBe(found.bubble.left);
});

test("pointing at nothing puts the group in the middle of the window", () => {
  const found = placeGroup({ ...base, spot: null, prefer: ["inside"] });
  const width = 56 + GROUP_GAP + bubble.width;
  expect(found.slime.left).toBe(Math.round((view.width - width) / 2));
  expect(found.bubble.top).toBe(Math.round((view.height - bubble.height) / 2));
});

test("the offer stands over the account button at its left edge", () => {
  const face: Box = { left: 16, top: 856, width: 44, height: 44 };
  const found = placeGroup({ ...base, spot: face, prefer: ["above"], align: "start" });
  expect(found.side).toBe("above");
  expect(found.slime.left).toBe(face.left);
  expect(bottom(found.bubble)).toBe(face.top - SPOT_GAP);
});
