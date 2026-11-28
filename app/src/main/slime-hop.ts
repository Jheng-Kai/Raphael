// How a slime travels on screen: it hops along the floor, a few hops at least and bigger ones the farther it goes, and never
// appears somewhere else at once. Anything that moves a slime from one place to another uses it (the guided tour's Raphael).
//
// A rig is three layers: the ground (the slime's place on the floor; it slides along under the hops), the body (only the
// portrait rises, leans, stretches and squashes) and the glow (the light on the floor, which narrows and dims as the body rises).
// A plan is numbers only: keyframes for each layer, timed in milliseconds. `playHops` runs one on a rig.

import type { Box } from "./tour/place";

export interface TimedFrame extends Keyframe { time: number }
export interface HopPlan {
  ground: TimedFrame[];
  body: TimedFrame[];
  glow: TimedFrame[];
  /** When each hop is at its top and when it touches down again. */
  descents: [apex: number, ground: number][];
  /** When the slime has landed and settled; `duration` can be longer (a cheer after landing). */
  arrival: number;
  duration: number;
}

/** Where the body and its glow are now, read from the screen, so that a new plan starts from an interrupted one. */
export interface Pose {
  y: number; width: number; height: number; tilt: number; opacity: number | string;
  glowWidth: number; glowOpacity: number | string;
  /** The body is on its way down from a hop's top. */
  falling: boolean;
}

export interface HopOptions {
  /** Where the body and glow start, when a hop is cut into; at rest on the floor otherwise. */
  from?: Pose;
  /** The highest a hop may rise (the room above the slime in the window). */
  maxRise?: number;
  /** The glow's resting opacity as a CSS value. */
  glow?: string;
}

/** The glow's resting opacity; the host stylesheet sets `--hop-glow-opacity` (lighter in a dark theme). */
export const GLOW = "var(--hop-glow-opacity, 0.5)";
/** A move smaller than this is a nudge of the layout, not a journey: the slime shifts with it, no hop is worth it. */
export const NUDGE_PX = 6;

const CROUCH_MS = 80;
const CONTACT_MS = 70;
const LAND_MS = 180;
const CHEER_MS = 150;
const CHEER_RISE = 12;
// The number of hops grows with the square root of the distance, so a longer way is covered in fewer, bigger hops than a
// walk of equal steps would take: two hops at the least (one hop would be no hopping at all), six at the most.
const MIN_HOPS = 2;
const MAX_HOPS = 6;
const HOPS_SCALE_PX = 40;
const RISE_PER_PX = 0.35;
const MIN_RISE = 14;
const MAX_RISE = 80;
const AIR_BASE_MS = 200;
const AIR_PER_PX = 0.6;
const MIN_AIR_MS = 240;
const MAX_AIR_MS = 420;

const RISE = "cubic-bezier(0.33, 0.67, 0.67, 1)";
const FALL = "cubic-bezier(0.33, 0, 0.67, 0.33)";
const FALL_IN_PROGRESS = "cubic-bezier(0.33, 0.16, 0.67, 0.5)";

const AT_REST: Pose = { y: 0, width: 1, height: 1, tilt: 0, opacity: 1, glowWidth: 1, glowOpacity: GLOW, falling: false };

function shift(time: number, x: number, y: number, easing = "linear"): TimedFrame {
  return { time, transform: `translate(${x}px, ${y}px)`, easing };
}

function pose(time: number, y: number, width = 1, height = 1, easing = "linear", tilt = 0, opacity: number | string = 1): TimedFrame {
  return { time, transform: `translateY(${y}px) rotate(${tilt}deg) scale(${width}, ${height})`, easing, opacity };
}

function pool(time: number, glow: string, width = 1, opacity: number | string = glow, easing = "linear"): TimedFrame {
  return { time, transform: `scaleX(${width})`, opacity, easing };
}

/** How a move of `distance` pixels is hopped: how many hops, how high each rises and how long each is in the air. */
export function hopsFor(distance: number, maxRise = MAX_RISE): { hops: number; rise: number; air: number } {
  const hops = Math.min(MAX_HOPS, Math.max(MIN_HOPS, Math.round(Math.sqrt(distance / HOPS_SCALE_PX))));
  const span = distance / hops;
  const rise = Math.round(Math.max(MIN_RISE, Math.min(maxRise, MAX_RISE, span * RISE_PER_PX)) * 10) / 10;
  const air = Math.round(Math.min(MAX_AIR_MS, Math.max(MIN_AIR_MS, AIR_BASE_MS + span * AIR_PER_PX)));
  return { hops, rise, air };
}

/** A landing has one squash and one rebound before the portrait comes to rest. */
function land(plan: Pick<HopPlan, "ground" | "body" | "glow" | "descents">, contact: number, glow: string): HopPlan {
  const squash = contact + 35;
  const duration = contact + LAND_MS;
  plan.ground.push(shift(duration, 0, 0));
  plan.body.push(pose(contact, 0, 1, 1, "ease-out"), pose(squash, 0, 1.16, 0.84, "ease-out"),
    pose(contact + 100, 0, 0.97, 1.04, "ease-in-out"), pose(duration, 0));
  plan.glow.push(pool(contact, glow, 1, glow, "ease-out"), pool(squash, glow, 1, `calc(${glow} * 1.16)`, "ease-out"), pool(duration, glow));
  return { ...plan, arrival: duration, duration };
}

/**
 * The hops from `dx, dy` away (the start, relative to where the slime ends) to its new place. The ground covers an equal part of
 * the way during each hop and waits on every touch-down; only the body rises, leaning the way it goes.
 */
export function hopPlan(dx: number, dy: number, options: HopOptions = {}): HopPlan {
  const glow = options.glow ?? GLOW;
  const start = options.from ?? { ...AT_REST, glowOpacity: glow };
  const { hops, rise, air } = hopsFor(Math.hypot(dx, dy), options.maxRise);
  const tilt = -Math.sign(dx) * 3;
  const inFlight = start.y !== 0;
  const falling = inFlight && start.falling;
  let time = inFlight ? 0 : CROUCH_MS;
  const ease = falling ? FALL_IN_PROGRESS : inFlight ? RISE : "ease-in-out";
  const plan: Pick<HopPlan, "ground" | "body" | "glow" | "descents"> = {
    ground: [shift(0, dx, dy)],
    body: [pose(0, start.y, start.width, start.height, ease, start.tilt, start.opacity)],
    glow: [pool(0, glow, start.glowWidth, start.glowOpacity, ease)],
    descents: [],
  };
  if (!inFlight) {
    plan.ground.push(shift(time, dx, dy));
    plan.body.push(pose(time, 0, 1.12, 0.88, RISE));
    plan.glow.push(pool(time, glow, 1, glow, RISE));
  }
  for (let hop = 0; hop < hops; hop++) {
    const fallingNow = hop === 0 && falling;
    const apex = time + (fallingNow ? 0 : air / 2);
    const contact = apex + air / 2;
    if (!fallingNow) {
      plan.body.push(pose(apex, hop === 0 ? Math.min(-rise, start.y) : -rise, 0.94, 1.08, FALL, tilt));
      plan.glow.push(pool(apex, glow, rise > 50 ? 0.5 : 0.65, `calc(${glow} * 0.5)`, FALL));
    }
    plan.descents.push([apex, contact]);
    const left = (hops - hop - 1) / hops;
    plan.ground.push(shift(contact, dx * left, dy * left));
    if (hop === hops - 1) return land(plan, contact, glow);
    time = contact + CONTACT_MS;
    plan.ground.push(shift(time, dx * left, dy * left));
    plan.body.push(pose(contact, 0, 1, 1, "ease-out"), pose(contact + 20, 0, 1.1, 0.9, "ease-out"), pose(time, 0, 1, 1, RISE));
    plan.glow.push(pool(contact, glow), pool(time, glow, 1, glow, RISE));
  }
  return land(plan, time, glow);
}

/** A slime that comes out of a button: it grows from the button's centre and overshoots the floor before touching down. */
export function popPlan(from: Box, to: Box, { foot, bodyHeight, glow = GLOW }: { foot: number; bodyHeight: number; glow?: string }): HopPlan {
  const scale = 0.3;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + foot - bodyHeight * scale / 2);
  const apex = 180;
  return land({
    ground: [shift(0, dx, 0, RISE), shift(apex, 0, 0)],
    body: [pose(0, dy, scale, scale, RISE, 0, 0.2), pose(apex, -14, 0.94, 1.08, FALL)],
    glow: [pool(0, glow, 0.65, 0), pool(apex, glow, 0.65, 0, FALL)],
    descents: [[apex, 250]],
  }, 250, glow);
}

/** Two small happy hops in place, after the plan's landing (or at once): they begin as the words they go with appear. */
export function cheerPlan(after?: HopPlan, glow = GLOW): HopPlan {
  const plan = after ?? { ground: [shift(0, 0, 0)], body: [pose(0, 0, 1, 1, RISE)], glow: [pool(0, glow, 1, glow, RISE)], descents: [], arrival: 0, duration: 0 };
  const start = plan.duration;
  plan.body[plan.body.length - 1]!.easing = RISE;
  plan.glow[plan.glow.length - 1]!.easing = RISE;
  for (let hop = 0; hop < 2; hop++) {
    const apex = start + (hop + 0.5) * CHEER_MS;
    const contact = apex + CHEER_MS / 2;
    plan.body.push(pose(apex, -CHEER_RISE, 1, 1, FALL), pose(contact, 0, 1, 1, RISE));
    plan.glow.push(pool(apex, glow, 0.8, `calc(${glow} * 0.7)`, FALL), pool(contact, glow, 1, glow, RISE));
    plan.descents.push([apex, contact]);
  }
  plan.duration += 2 * CHEER_MS;
  plan.ground.push(shift(plan.duration, 0, 0));
  return plan;
}

/** The way a move goes across the screen, when it is wide enough for the slime to turn to its side. */
export function facingOf(dx: number): "left" | "right" | undefined {
  return Math.abs(dx) > 24 ? (dx > 0 ? "left" : "right") : undefined;
}

export interface Rig { ground: HTMLElement; body: HTMLElement; glow: HTMLElement }

export interface PlayingHops {
  readonly plan: HopPlan;
  /** Milliseconds played. */
  elapsed(): number;
  /** Stops the hops where they are; the layers fall back to their resting styles. */
  cancel(): void;
}

function matrixOf(transform: string): DOMMatrixReadOnly {
  return new DOMMatrixReadOnly(transform && transform !== "none" ? transform : undefined);
}

/** Where the ground has got to on its way, in pixels from where it ends. */
export function groundOffset(rig: Rig): { x: number; y: number } {
  const matrix = matrixOf(getComputedStyle(rig.ground).transform);
  return { x: matrix.m41, y: matrix.m42 };
}

/** The body's and glow's pose on screen now, read before a playing plan is cancelled. */
export function poseOf(rig: Rig, playing: PlayingHops | null): Pose {
  const bodyStyle = getComputedStyle(rig.body), glowStyle = getComputedStyle(rig.glow);
  const body = matrixOf(bodyStyle.transform), glow = matrixOf(glowStyle.transform);
  const time = playing?.elapsed() ?? 0;
  return {
    y: body.m42, width: Math.hypot(body.m11, body.m12), height: Math.hypot(body.m21, body.m22),
    tilt: Math.atan2(body.m12, body.m11) * 180 / Math.PI, opacity: bodyStyle.opacity || 1,
    glowWidth: glow.m11, glowOpacity: glowStyle.opacity || GLOW,
    falling: playing?.plan.descents.some(([apex, ground]) => time >= apex && time < ground) ?? false,
  };
}

/** Runs a plan on a rig; `done` is called once it has played to the end (not when it is cancelled). */
export function playHops(rig: Rig, plan: HopPlan, done: () => void): PlayingHops {
  const animate = (element: HTMLElement, frames: TimedFrame[]) => element.animate(
    frames.map(({ time, ...frame }) => ({ ...frame, offset: time / plan.duration })),
    { duration: plan.duration, fill: "backwards" },
  );
  const body = animate(rig.body, plan.body);
  const tracks = [body, animate(rig.ground, plan.ground), animate(rig.glow, plan.glow)];
  let live = true;
  body.onfinish = () => { if (live) { live = false; done(); } };
  return {
    plan,
    elapsed: () => Number(body.currentTime) || 0,
    cancel() { live = false; body.onfinish = null; for (const track of tracks) track.cancel(); },
  };
}
