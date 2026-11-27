// Where Raphael and its bubble stand beside what the tour points at. Pure geometry: the view measures, this decides.

export interface Box { left: number; top: number; width: number; height: number }
/** The side of the target the group stands on; `inside` is for a target that fills the window (Settings): the group stands in its lower right. */
export type Side = "right" | "left" | "above" | "below" | "inside";

export interface PlaceInput {
  /** What is pointed at, with the room it is given round it; null when nothing is (the group stands in the middle). */
  spot: Box | null;
  view: { width: number; height: number };
  bubble: { width: number; height: number };
  /** Raphael's slime is a square of this side. */
  slime: number;
  /** The sides to try, best first; the others follow, `inside` last. */
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

const touches = (a: Box, b: Box): boolean =>
  a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

/** The two boxes of a group, from where its slime stands (`slimeLeft` to its left edge, with the words on the side `words` says). */
function group(input: PlaceInput, slimeLeft: number, bubbleTop: number, words: "after" | "before"): Placement & { all: Box } {
  const { slime, bubble } = input;
  const bubbleLeft = words === "after" ? slimeLeft + slime + GROUP_GAP : slimeLeft - GROUP_GAP - bubble.width;
  const bubbleBox: Box = { left: bubbleLeft, top: bubbleTop, width: bubble.width, height: bubble.height };
  // Raphael stands on the ground of the words: its feet at the bubble's foot.
  const slimeBox: Box = { left: slimeLeft, top: bubbleTop + Math.max(0, bubble.height - slime), width: slime, height: slime };
  const left = Math.min(bubbleBox.left, slimeBox.left), right = Math.max(bubbleBox.left + bubbleBox.width, slimeBox.left + slimeBox.width);
  const top = Math.min(bubbleBox.top, slimeBox.top), bottom = Math.max(bubbleBox.top + bubbleBox.height, slimeBox.top + slimeBox.height);
  return { side: "inside", slime: slimeBox, bubble: bubbleBox, all: { left, top, width: right - left, height: bottom - top } };
}

function candidate(side: Side, input: PlaceInput): (Placement & { all: Box }) | null {
  const { spot, view, bubble, slime, align = "center" } = input;
  if (!spot) {
    const width = slime + GROUP_GAP + bubble.width;
    const left = Math.round((view.width - width) / 2), top = Math.round((view.height - bubble.height) / 2);
    return { ...group(input, left, top, "after"), side: "inside" };
  }
  const middleY = spot.top + spot.height / 2;
  const vertical = clamp(middleY - bubble.height / 2, EDGE_TOP, Math.max(EDGE_TOP, view.height - EDGE - bubble.height));
  if (side === "right") return { ...group(input, spot.left + spot.width + SPOT_GAP, vertical, "after"), side };
  if (side === "left") return { ...group(input, spot.left - SPOT_GAP - slime, vertical, "before"), side };
  if (side === "above" || side === "below") {
    const top = side === "above" ? spot.top - SPOT_GAP - bubble.height : spot.top + spot.height + SPOT_GAP;
    const slimeLeft = align === "start" ? spot.left : spot.left + spot.width / 2 - slime / 2;
    // The words go to the right of Raphael; where the window has no room for them, to its left.
    const after = slimeLeft + slime + GROUP_GAP + bubble.width <= view.width - EDGE;
    const placed = group(input, slimeLeft, top, after ? "after" : "before");
    // A group that sticks out sideways slides back in, Raphael still over (or under) the target.
    const shift = placed.all.left < EDGE ? EDGE - placed.all.left : placed.all.left + placed.all.width > view.width - EDGE ? view.width - EDGE - (placed.all.left + placed.all.width) : 0;
    return { ...group(input, slimeLeft + shift, top, after ? "after" : "before"), side };
  }
  // inside: the lower right of the target, kept in the window.
  const right = Math.min(spot.left + spot.width, view.width) - 24, bottom = Math.min(spot.top + spot.height, view.height) - 24;
  const top = Math.max(EDGE_TOP, bottom - bubble.height);
  return { ...group(input, right - bubble.width - GROUP_GAP - slime, top, "after"), side };
}

/** The first side, best first, whose group lies in the window and clear of the target; `inside` always answers. */
export function placeGroup(input: PlaceInput): Placement {
  const order = [...input.prefer, ...ALL.filter(side => !input.prefer.includes(side))];
  for (const side of order) {
    const found = candidate(side, input);
    if (!found) continue;
    const { all, ...placement } = found;
    if (side === "inside" || !input.spot) return placement;
    if (within(all, input.view) && !touches(all, input.spot)) return placement;
  }
  const { all: _all, ...last } = candidate("inside", input)!;
  return last;
}
