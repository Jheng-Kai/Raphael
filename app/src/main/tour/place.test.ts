import { expect, test } from "vitest";
import { EDGE, EDGE_TOP, GROUP_GAP, SPOT_GAP, groundBox, placeAroundLayer, placeGroup, placeInside, type Box, type PlaceInput } from "./place";

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

test("placement tries beside a layer before the free part of its header", () => {
  const layer = { left: 60, top: 80, width: 740, height: 740 };
  const header = { left: 80, top: 100, width: 680, height: 134 };
  const close = { left: 680, top: 105, width: 48, height: 45 };
  const search = { left: 110, top: 245, width: 440, height: 40 };
  const input: PlaceInput = { ...base, spot: search, prefer: ["right"], controls: [close], slimeInset: 16 };
  expect(placeAroundLayer(input, { ...layer, width: 620 }, header)?.side).toBe("right");
  const found = placeAroundLayer(input, layer, header)!;
  expect(found.side).toBe("inside");
  for (const part of [groundBox(found.slime, 16), found.bubble]) {
    expect(part.top).toBeGreaterThanOrEqual(header.top);
    expect(bottom(part)).toBeLessThanOrEqual(bottom(header));
    expect(apart(part, close) && apart(part, search)).toBe(true);
  }
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

test("a nearly full dialog needs a clear dim strip when the header is too short", () => {
  const dialog = { left: 90, top: 54, width: 900, height: 560 };
  const search = { left: 124, top: 140, width: 700, height: 32 };
  const input: PlaceInput = { ...base, view: { width: 1080, height: 640 }, spot: search,
    slime: 64, slimeInset: 16, prefer: ["right"], controls: [search] };
  expect(placeAroundLayer(input, dialog, { left: 110, top: 80, width: 840, height: 42 })).toBeNull();
  const shifted = { ...dialog, top: 174, height: 440 };
  const movedSearch = { ...search, top: 260 };
  const found = placeAroundLayer({ ...input, spot: movedSearch, controls: [movedSearch] }, shifted)!;
  expect(found.side).toBe("above");
  for (const part of [groundBox(found.slime, 16), found.bubble]) {
    expect(part.top).toBeGreaterThanOrEqual(EDGE_TOP);
    expect(bottom(part)).toBeLessThanOrEqual(shifted.top - SPOT_GAP);
  }
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

test("a dialog that fills the window is stood on at its lower right, clear of its title, and never moved", () => {
  const dialog: Box = { left: 90, top: 40, width: 900, height: 560 };
  const title: Box = { left: 122, top: 64, width: 130, height: 28 };
  const small = { width: 1080, height: 640 };
  expect(placeAroundLayer({ ...base, view: small, spot: dialog, prefer: ["right"], controls: [dialog, title] }, dialog)).toBeNull();
  const found = placeInside({ ...base, view: small, spot: dialog, prefer: ["right"], controls: [dialog, title] }, dialog);
  expect(found.side).toBe("inside");
  for (const part of [found.bubble, found.slime]) {
    expect(part.left).toBeGreaterThanOrEqual(dialog.left);
    expect(right(part)).toBeLessThanOrEqual(right(dialog));
    expect(bottom(part)).toBeLessThanOrEqual(bottom(dialog));
    expect(apart(part, title)).toBe(true);
  }
  // At its lower right: the dialog's own corner, not the window's middle.
  expect(right(found.bubble)).toBe(right(dialog) - 24);
  expect(bottom(found.bubble)).toBe(bottom(dialog) - 24);
});

test("a page looked at from a narrow window keeps its composer clear", () => {
  const page: Box = { left: 85, top: 0, width: 635, height: 900 };
  const composer: Box = { left: 120, top: 780, width: 568, height: 92 };
  const found = placeInside({ ...base, view: { width: 720, height: 900 }, spot: page, prefer: ["right"], controls: [page, composer] }, page);
  expect(apart(found.bubble, composer) && apart(found.slime, composer)).toBe(true);
  expect(bottom(found.bubble)).toBeLessThanOrEqual(composer.top);
});