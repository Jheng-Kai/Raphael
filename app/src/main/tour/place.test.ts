import { expect, test } from "vitest";
import { EDGE, EDGE_TOP, GROUP_GAP, SPOT_GAP, groundBox, placeGroup, type Box, type PlaceInput } from "./place";

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

test("the model group stands above the composer with the slime left of the bubble", () => {
  const composer: Box = { left: 385, top: 780, width: 696, height: 100 };
  const model: Box = { left: 905, top: 828, width: 120, height: 42 };
  const found = placeGroup({ ...base, bubble: { width: 300, height: 88 }, slime: 64, slimeInset: 18,
    spot: model, clear: [composer], prefer: ["above"], slimeFirst: true });
  expect(found.side).toBe("above");
  expect(right(found.slime)).toBeLessThan(found.bubble.left);
  expect(bottom(found.bubble)).toBe(composer.top - SPOT_GAP);
  expect(apart(groundBox(found.slime, 18), composer)).toBe(true);
});

test("the portrait and its light stay clear of the standalone Connect apps dialog at 720 px", () => {
  const dialog = { left: 16, top: 86, width: 688, height: 760 };
  const composer = { left: 120, top: 782, width: 568, height: 90 };
  const found = placeGroup({ ...base, view: { width: 720, height: 900 }, bubble: { width: 300, height: 88 },
    spot: dialog, clear: [composer], slime: 64, slimeInset: 18, prefer: ["right", "above"] });
  expect(found.side).toBe("inside");
  expect(found.hideSlime).toBeUndefined();
  expect(bottom(groundBox(found.slime, 18))).toBe(dialog.top);
  expect(apart(groundBox(found.slime, 18), composer)).toBe(true);
  expect(found.bubble.top).toBeGreaterThan(dialog.top);
});

test("the whole account group stands above the sidebar foot, clear of its controls and the composer", () => {
  const foot = { left: 12, top: 810, width: 324, height: 82 };
  const account = { left: 12, top: 856, width: 36, height: 36 };
  const apps = { left: 52, top: 856, width: 284, height: 36 };
  const composer = { left: 391, top: 780, width: 686, height: 100 };
  const found = placeGroup({ ...base, slime: 64, slimeInset: 16, spot: foot, clear: [account], controls: [foot, composer],
    prefer: ["above"], align: "start" });
  expect(found.side).toBe("above");
  for (const part of [groundBox(found.slime, 16), found.bubble]) {
    expect(bottom(part)).toBe(foot.top - SPOT_GAP);
    for (const control of [account, apps, composer]) expect(apart(part, control)).toBe(true);
  }
});

test("the bubble still avoids the composer when it has to stand inside a large dialog", () => {
  const dialog = { left: 16, top: 86, width: 688, height: 760 };
  const composer = { left: 104, top: 159, width: 584, height: 88 };
  const foot = { left: 12, top: 812, width: 64, height: 80 };
  const found = placeGroup({ ...base, view: { width: 720, height: 900 }, bubble: { width: 300, height: 88 },
    spot: dialog, controls: [foot, composer], slime: 64, slimeInset: 16, prefer: ["right", "above"] });
  expect(found.side).toBe("inside");
  expect(found.hideSlime).toBeUndefined();
  expect(apart(found.bubble, composer)).toBe(true);
  expect(apart(found.bubble, foot)).toBe(true);
});

test("pointing at nothing puts the group in the middle of the window", () => {
  const found = placeGroup({ ...base, spot: null, prefer: ["inside"] });
  const width = 56 + GROUP_GAP + bubble.width;
  expect(found.slime.left).toBe(Math.round((view.width - width) / 2));
  expect(found.bubble.top).toBe(Math.round((view.height - bubble.height) / 2));
});

test("one short line of words leaves Raphael standing taller than its bubble, clear of the target and in the window", () => {
  const face: Box = { left: 8, top: 854, width: 40, height: 40 };
  const found = placeGroup({ ...base, bubble: { width: 230, height: 47 }, spot: face, prefer: ["above"], align: "start" });
  expect(found.side).toBe("above");
  expect(apart(found.slime, face) && apart(found.bubble, face)).toBe(true);
  expect(bottom(found.slime)).toBe(bottom(found.bubble));
  expect(found.slime.left).toBeGreaterThanOrEqual(EDGE);
  // A target too small to hold the group inside still gives a group that is in the window.
  const tiny = placeGroup({ ...base, bubble: { width: 230, height: 47 }, spot: { left: 4, top: 880, width: 10, height: 10 }, prefer: ["inside"] });
  expect(tiny.slime.left).toBeGreaterThanOrEqual(EDGE);
});

test("the offer stands over the account button at its left edge", () => {
  const face: Box = { left: 16, top: 856, width: 44, height: 44 };
  const found = placeGroup({ ...base, spot: face, prefer: ["above"], align: "start" });
  expect(found.side).toBe("above");
  expect(found.slime.left).toBe(face.left);
  expect(bottom(found.bubble)).toBe(face.top - SPOT_GAP);
});
