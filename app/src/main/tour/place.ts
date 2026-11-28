// Where Raphael and its bubble stand beside what the tour points at. Pure geometry: the view measures, this decides.

export interface Box { left: number; top: number; width: number; height: number }
/** The side of the target the bubble stands on. It can move inside when a large dialog leaves no room beside it. */
export type Side = "right" | "left" | "above" | "below" | "inside";

export interface PlaceInput {
  /** What is pointed at, with the room it is given round it; null when nothing is (the group stands in the middle). */
  spot: Box | null;
  view: { width: number; height: number };
  bubble: { width: number; height: number };
  /** Raphael's slime is a square of this side. */
  slime: number;
  /** The light extends beyond both sides of the portrait. */
  slimeInset?: number;
  /** Other surfaces to keep clear, such as the control that opened a highlighted dialog. */
  clear?: readonly Box[];
  /** Controls that remain visible around the target or in its open layer. */
  controls?: readonly Box[];
  slimeFirst?: boolean;
  /** The sides to try first. */
  prefer: readonly Side[];
  /** Above or below the target Raphael stands over its middle (`center`) or at its left edge (`start`). */
  align?: "center" | "start";
}

export interface Placement { side: Side; slime: Box; bubble: Box }

/** The space between Raphael and its words, and between the group and the target. */
export const GROUP_GAP = 8;
export const SPOT_GAP = 12;
/** What the group keeps clear of the window's edges; the top also clears the caption strip. */
export const EDGE = 12;
export const EDGE_TOP = 44;

const ALL: readonly Side[] = ["right", "above", "left", "below", "inside"];

const within = (box: Box, view: PlaceInput["view"]): boolean =>
  box.left >= EDGE - 0.5 && box.top >= EDGE_TOP - 0.5 && box.left + box.width <= view.width - EDGE + 0.5 && box.top + box.height <= view.height - EDGE + 0.5;

export const touches = (a: Box, b: Box): boolean =>
  a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

export const groundBox = (slime: Box, inset: number): Box => ({ ...slime, left: slime.left - inset, width: slime.width + 2 * inset });

/** The two boxes of a group, from where its slime stands (`slimeLeft` to its left edge, with the words on the side `words` says). */
function group(input: PlaceInput, slimeLeft: number, bubbleTop: number, words: "after" | "before"): Placement & { all: Box } {
  const { slime, bubble, slimeInset = 0 } = input;
  slimeLeft = Math.round(slimeLeft);
  bubbleTop = Math.round(bubbleTop);
  const bubbleLeft = words === "after" ? slimeLeft + slime + GROUP_GAP : slimeLeft - GROUP_GAP - bubble.width;
  const bubbleBox: Box = { left: bubbleLeft, top: bubbleTop, width: bubble.width, height: bubble.height };
  // Raphael stands on the ground of the words: its feet at the bubble's foot (over the bubble's top when the words are one short line).
  const slimeBox: Box = { left: slimeLeft, top: bubbleTop + bubble.height - slime, width: slime, height: slime };
  const ground = groundBox(slimeBox, slimeInset);
  const left = Math.min(bubbleBox.left, ground.left), right = Math.max(bubbleBox.left + bubbleBox.width, ground.left + ground.width);
  const top = Math.min(bubbleBox.top, slimeBox.top), bottom = Math.max(bubbleBox.top + bubbleBox.height, slimeBox.top + slimeBox.height);
  return { side: "inside", slime: slimeBox, bubble: bubbleBox, all: { left, top, width: right - left, height: bottom - top } };
}

function candidate(side: Side, input: PlaceInput): Placement & { all: Box } {
  const { spot, view, bubble, slime, align = "center", slimeInset = 0 } = input;
  if (!spot) {
    const width = slime + GROUP_GAP + bubble.width;
    const left = Math.round((view.width - width) / 2), top = Math.round((view.height - bubble.height) / 2);
    return { ...group(input, left, top, "after"), side: "inside" };
  }
  const middleY = spot.top + spot.height / 2;
  const vertical = clamp(middleY - bubble.height / 2, EDGE_TOP, Math.max(EDGE_TOP, view.height - EDGE - bubble.height));
  if (side === "right") return { ...group(input, spot.left + spot.width + SPOT_GAP + slimeInset, vertical, "after"), side };
  if (side === "left") {
    const width = input.slimeFirst ? slime + GROUP_GAP + bubble.width : slime + slimeInset;
    return { ...group(input, spot.left - SPOT_GAP - width, vertical, input.slimeFirst ? "after" : "before"), side };
  }
  if (side === "above" || side === "below") {
    const top = side === "above" ? spot.top - SPOT_GAP - bubble.height : spot.top + spot.height + SPOT_GAP;
    const slimeLeft = align === "start" ? spot.left : spot.left + spot.width / 2 - slime / 2;
    // The words go to the right of Raphael; where the window has no room for them, to its left.
    const after = input.slimeFirst || slimeLeft + slime + GROUP_GAP + bubble.width <= view.width - EDGE;
    const placed = group(input, slimeLeft, top, after ? "after" : "before");
    // A group that sticks out sideways slides back in, Raphael still over (or under) the target.
    const minShift = Math.max(-placed.all.left, EDGE - placed.bubble.left, EDGE - placed.slime.left);
    const maxShift = Math.min(view.width - placed.all.left - placed.all.width,
      view.width - EDGE - placed.bubble.left - bubble.width, view.width - EDGE - placed.slime.left - slime);
    const shift = clamp(0, minShift, maxShift);
    return { ...group(input, slimeLeft + shift, top, after ? "after" : "before"), side };
  }
  // inside: the lower right of the target, kept in the window (a target too small to hold it still gives a group that is in view).
  const right = Math.min(spot.left + spot.width, view.width) - 24, bottom = Math.min(spot.top + spot.height, view.height) - 24;
  const top = Math.max(EDGE_TOP + Math.max(0, slime - bubble.height), bottom - bubble.height);
  return { ...group(input, Math.max(EDGE, right - bubble.width - GROUP_GAP - slime), top, "after"), side };
}

/** Move a box the shortest distance to a free position, within the given bounds. */
function nearestFree(box: Box, bounds: Box, obstacles: readonly Box[]): Box | undefined {
  const { width, height } = box;
  const right = bounds.left + bounds.width, bottom = bounds.top + bounds.height;
  const lefts = [box.left, bounds.left, right - width];
  const tops = [box.top, bounds.top, bottom - height];
  for (const obstacle of obstacles) {
    lefts.push(Math.floor(obstacle.left - width), Math.ceil(obstacle.left + obstacle.width));
    tops.push(Math.floor(obstacle.top - height), Math.ceil(obstacle.top + obstacle.height));
  }
  let best: Box | undefined;
  let distance = Infinity;
  for (const left of lefts) for (const y of tops) {
    if (left < bounds.left || left + width > right || y < bounds.top || y + height > bottom) continue;
    const next = { ...box, left, top: y };
    if (obstacles.some(obstacle => touches(next, obstacle))) continue;
    const offset = Math.abs(left - box.left) + Math.abs(y - box.top);
    if (offset < distance) { best = next; distance = offset; }
  }
  return best;
}

/** Try the sides of an open layer, its header, then the dim above or below it. */
export function placeAroundLayer(input: PlaceInput, layer: Box, header?: Box): Placement | null {
  const { view, spot } = input;
  const clampArea = (left: number, top: number, right: number, bottom: number): Box => {
    left = Math.ceil(Math.max(EDGE, left));
    top = Math.ceil(Math.max(EDGE_TOP, top));
    return { left, top, width: Math.floor(Math.min(view.width - EDGE, right)) - left,
      height: Math.floor(Math.min(view.height - EDGE, bottom)) - top };
  };
  const right = layer.left + layer.width, bottom = layer.top + layer.height;
  const sides = {
    right: clampArea(right + SPOT_GAP, 0, view.width, view.height),
    left: clampArea(0, 0, layer.left - SPOT_GAP, view.height),
  };
  const sideOrder = input.prefer[0] === "left" ? ["left", "right"] as const : ["right", "left"] as const;
  const areas: [Side, Box][] = [
    ...sideOrder.map(side => [side, sides[side]] as [Side, Box]),
    ...(header ? [["inside", clampArea(header.left, header.top, header.left + header.width, header.top + header.height)] as [Side, Box]] : []),
    ["above", clampArea(0, 0, view.width, layer.top - SPOT_GAP)],
    ["below", clampArea(0, bottom + SPOT_GAP, view.width, view.height)],
  ];
  const obstacles = [...(spot ? [spot] : []), ...(input.clear ?? []), ...(input.controls ?? [])];
  for (const [side, bounds] of areas) {
    const desired = candidate(side, { ...input, spot: layer });
    const free = nearestFree(desired.all, bounds, obstacles);
    if (free) {
      const dx = free.left - desired.all.left, dy = free.top - desired.all.top;
      const shift = (box: Box) => ({ ...box, left: box.left + dx, top: box.top + dy });
      return { side, slime: shift(desired.slime), bubble: shift(desired.bubble) };
    }
  }
  return null;
}

/** Search the free window when the usual anchors are crowded. */
function placeInWindow(input: PlaceInput, placed: ReturnType<typeof candidate>, obstacles: readonly Box[]): Placement {
  const { view, slimeInset = 0 } = input;
  const bounds = { left: EDGE, top: EDGE_TOP, width: view.width - 2 * EDGE, height: view.height - EDGE_TOP - EDGE };
  const found = nearestFree(placed.all, bounds, obstacles);
  if (found) {
    const shift = (box: Box) => ({ ...box, left: box.left + found.left - placed.all.left, top: box.top + found.top - placed.all.top });
    return { side: "inside", slime: shift(placed.slime), bubble: shift(placed.bubble) };
  }
  const ground = nearestFree(groundBox(placed.slime, slimeInset), bounds, obstacles);
  const bubble = nearestFree(placed.bubble, bounds, ground ? [...obstacles, ground] : obstacles);
  if (ground && bubble) return { side: "inside", slime: { ...ground, left: ground.left + slimeInset, width: input.slime }, bubble };
  return candidate("inside", { ...input, spot: null });
}

/** The first side whose group fits in the window and clears the target and other surfaces. */
export function placeGroup(input: PlaceInput): Placement {
  const order = [...input.prefer, ...ALL.filter(side => !input.prefer.includes(side))].filter(side => side !== "inside");
  const clear = [...(input.clear ?? []), ...(input.controls ?? [])];
  const obstacles = input.spot ? [input.spot, ...clear] : clear;
  const fits = ({ all, slime, bubble }: ReturnType<typeof candidate>) => all.left >= 0 && all.left + all.width <= input.view.width &&
    within(slime, input.view) && within(bubble, input.view) &&
    obstacles.every(box => !touches(groundBox(slime, input.slimeInset ?? 0), box) && !touches(bubble, box));
  const inside = candidate("inside", input);
  if (!input.spot && fits(inside)) return inside;
  for (const side of order) {
    const found = candidate(side, input);
    if (fits(found)) return found;
    if (side === "below") continue;
    // A target may be lower than a nearby control or panel. Try again above its top edge.
    for (const box of clear) {
      const top = box.top - SPOT_GAP - found.bubble.height;
      if (top >= found.bubble.top) continue;
      const words = found.slime.left < found.bubble.left ? "after" : "before";
      const raised = { ...group(input, found.slime.left, top, words), side };
      if (fits(raised)) return raised;
    }
  }
  return placeInWindow(input, inside, obstacles);
}
