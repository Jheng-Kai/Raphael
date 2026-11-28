// What the tour draws: a dim over the window with one cut-out, Raphael's slime, and its bubble. The controller (tour.ts)
// says what to show; this measures, places and moves. Nothing here knows what a step means.

import { RAPHAEL_ID, faceHTML } from "../members";
import type { NavStep } from "../nav-history";
import { bindNavLayer } from "../nav-layers";
import { btn, esc, iconButton, keys, reducedMotion, replay } from "../ui";
import { dimClip } from "./dim";
import { groundBox, placeGroup, touches, type Box, type Placement, type Side } from "./place";
import type { Spot } from "./steps";
import "./tour.css";

export type ButtonId = "start" | "skip" | "back" | "next" | "done";
/** What the view tells the controller: a button, the ×, or a press on the bubble that only says goodbye. */
export type Pressed = ButtonId | "close" | "dismiss";

export interface ViewModel {
  /** `offer`: the question at the bottom left; `step`: the dim, the cut-out and the walk; `bye`: the last line, nothing dimmed. */
  mode: "offer" | "step" | "bye";
  step?: string;
  state?: "ask" | "done" | "look";
  text: string;
  /** The caps drawn under the line (the keys that ask Raphael), as the window names them. */
  keys?: string[];
  progress?: { shown: string; label: string };
  buttons: { id: ButtonId; label: string; primary?: boolean }[];
  /** The × that ends the tour, with its name; step mode only. */
  closeLabel?: string;
  /** What the dialog is called for a reader. */
  label: string;
  /** What is pointed at, measured again whenever the window or the layout moves; `dim: false` only stands beside it. */
  locate: () => (Spot & { dim: boolean }) | null;
  /** An independent anchor when Raphael stands beside a different surface from the cut-out. */
  anchor?: () => Box | null;
  prefer: readonly Side[];
  align: "center" | "start";
  keepClear?: () => readonly Box[];
  keepControlsClear?: () => readonly Box[];
  slimeFirst?: boolean;
  /** Where Raphael comes from while it has no place yet. */
  origin: () => Box | null;
}

export interface TourView {
  render(model: ViewModel, options: { hop: boolean }): void;
  /** Measures the target and places the group again, without a hop. */
  reflow(): void;
  contains(node: Node | null): boolean;
  /** Fades the group out and then removes it (at once when nothing may move). */
  leave(done: () => void): void;
  destroy(): void;
}

const SLIME = 64;
const GROUND_INSET = 16;
// The 64 px portrait has padding around its drawing. Anchor the pose and light at the drawn foot.
const FOOT = 52;
const BODY_HEIGHT = 40;
const LAND_MS = 80;
const SETTLE_MS = 120;
const RISE = "cubic-bezier(0.33, 0.67, 0.67, 1)";
const FALL = "cubic-bezier(0.33, 0, 0.67, 0.33)";
const FALL_IN_PROGRESS = "cubic-bezier(0.33, 0.16, 0.67, 0.5)";
const GLOW_OPACITY = "var(--tour-glow-opacity)";

export function createView(on: (pressed: Pressed) => void, move: (direction: NavStep) => void): TourView {
  const root = document.createElement("div");
  root.className = "tour";
  root.dataset.tourRoot = "";
  root.innerHTML = `<div class="tour-catch"></div><div class="tour-spot" hidden></div>` +
    `<div class="tour-ground" style="--tour-foot:${FOOT}px;--tour-ground-inset:${GROUND_INSET}px" aria-hidden="true"><span class="tour-glow"></span>` +
    `<span class="tour-slime">${faceHTML({ id: RAPHAEL_ID, name: "" }, SLIME)}</span></div>` +
    `<div class="tour-bubble" role="dialog"></div>`;
  document.body.append(root);
  const dim = root.querySelector<HTMLElement>(".tour-catch")!;
  const spotEl = root.querySelector<HTMLElement>(".tour-spot")!;
  const ground = root.querySelector<HTMLElement>(".tour-ground")!;
  const slime = root.querySelector<HTMLElement>(".tour-slime")!;
  const glow = root.querySelector<HTMLElement>(".tour-glow")!;
  const bubble = root.querySelector<HTMLElement>(".tour-bubble")!;

  let model: ViewModel | null = null;
  // The window can navigate the focused bubble once its own layers are clear.
  bindNavLayer(bubble, () => move("back"), {
    active: () => model?.mode === "step" && bubble.contains(document.activeElement),
    step: direction => { move(direction); return true; },
  });
  let placed: Box | null = null;
  let leaving: ReturnType<typeof setTimeout> | undefined;
  let playing: { plan: MotionPlan; body: Animation; tracks: Animation[] } | null = null;

  function cancelMotion(): void {
    if (!playing) return;
    playing.body.onfinish = null;
    for (const track of playing.tracks) track.cancel();
    playing = null;
  }

  function play(plan: MotionPlan): void {
    root.classList.remove("is-idle");
    const animate = (element: HTMLElement, frames: TimedFrame[]) => element.animate(
      frames.map(({ time, ...frame }) => ({ ...frame, offset: time / plan.duration })),
      { duration: plan.duration, fill: "backwards" },
    );
    const body = animate(slime, plan.body);
    playing = { plan, body, tracks: [body, animate(ground, plan.ground), animate(glow, plan.glow)] };
    body.onfinish = () => {
      if (playing?.body !== body) return;
      playing = null;
      root.classList.add("is-idle");
    };
  }

  // A press on the tour is the tour's alone. The window's dismissals (Settings close on a press outside them, menus too) listen at the
  // document in the capture phase, so the tour takes its events one step earlier, at the window, and lets nothing past.
  const own = (event: Event): void => {
    if (!(event.target instanceof Node) || !bubble.contains(event.target)) return;
    event.stopPropagation();
    if (event.type !== "click") return;
    const target = event.target as Element;
    const button = target.closest<HTMLElement>("[data-tour]");
    if (button) { if (!(button as HTMLButtonElement).disabled) on(button.dataset.tour as Pressed); return; }
    if (model?.mode === "bye" && target.closest(".tour-bubble")) on("dismiss");
  };
  const owned = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "contextmenu", "dblclick", "auxclick", "wheel"];
  for (const type of owned) window.addEventListener(type, own, { capture: true, passive: false });

  function content(next: ViewModel): string {
    const caps = next.keys?.length ? `<div class="tour-keys">${keys(next.keys)}</div>` : "";
    const close = next.closeLabel ? iconButton("x", next.closeLabel, ' data-tour="close"', "row tour-x") : "";
    const progress = next.progress ? `<span class="tour-count" aria-label="${esc(next.progress.label)}">${esc(next.progress.shown)}</span>` : "";
    const buttons = next.buttons.map(button => btn(esc(button.label), `sm${button.primary ? " pri" : ""}`, ` data-tour="${button.id}"`)).join("");
    return close + `<p class="tour-text">${sentences(next.text)}</p>${caps}` + (progress || buttons ? `<div class="tour-foot">${progress}<div class="tour-buttons">${buttons}</div></div>` : "");
  }

  function place(next: ViewModel, anchor: Box | null, clear: readonly Box[], controls: readonly Box[]): Placement {
    return placeGroup({
      spot: anchor,
      view: { width: document.documentElement.clientWidth || innerWidth, height: document.documentElement.clientHeight || innerHeight },
      bubble: { width: bubble.offsetWidth, height: bubble.offsetHeight },
      slime: SLIME,
      slimeInset: GROUND_INSET,
      clear,
      controls,
      slimeFirst: next.slimeFirst,
      prefer: next.prefer,
      align: next.align,
    });
  }

  function apply(next: ViewModel, hop: boolean): number {
    const spot = next.locate();
    const anchor = next.anchor?.() ?? null;
    const clear = [...(next.keepClear?.() ?? []), ...(anchor && spot ? [spot.box] : [])];
    const controls = next.keepControlsClear?.() ?? [];
    const placement = place(next, anchor ?? spot?.box ?? null, clear, controls);
    const to = placement.slime;
    const moved = placed?.left !== to.left || placed.top !== to.top;
    const canMove = !reducedMotion() && typeof slime.animate === "function";
    let plan: MotionPlan | undefined;
    if (canMove && hop && moved && !placement.hideSlime && !ground.hidden) {
      if (placed) {
        // Read all three poses before cancelling or moving their common anchor.
        const currentGround = matrixOf(getComputedStyle(ground).transform);
        const bodyStyle = getComputedStyle(slime), glowStyle = getComputedStyle(glow);
        const currentBody = matrixOf(bodyStyle.transform), currentGlow = matrixOf(glowStyle.transform);
        const from = { ...placed, left: placed.left + currentGround.m41, top: placed.top + currentGround.m42 };
        if (clearHop(from, to, currentBody.m42, [...clear, ...controls])) plan = hopPlan(from.left - to.left, from.top - to.top, {
          y: currentBody.m42, width: currentBody.m11, height: currentBody.m22, opacity: bodyStyle.opacity || 1,
          glowWidth: currentGlow.m11, glowOpacity: glowStyle.opacity || GLOW_OPACITY,
          falling: !!playing && Number(playing.body.currentTime) >= playing.plan.apex,
        });
      } else {
        const from = next.origin();
        if (from) plan = popPlan(from, to);
      }
    }
    if (!canMove || moved || placement.hideSlime) cancelMotion();
    const cut = next.mode === "step" && spot?.dim ? spot : null;
    root.dataset.dim = next.mode !== "step" ? "none" : cut ? "spot" : "all";
    dim.style.clipPath = cut ? dimClip(cut) : "";
    spotEl.hidden = !cut;
    if (cut) {
      spotEl.style.left = `${cut.box.left}px`; spotEl.style.top = `${cut.box.top}px`;
      spotEl.style.width = `${cut.box.width}px`; spotEl.style.height = `${cut.box.height}px`;
      spotEl.style.borderRadius = `${cut.radius}px`;
    }
    bubble.style.left = `${Math.round(placement.bubble.left)}px`;
    bubble.style.top = `${Math.round(placement.bubble.top)}px`;
    bubble.dataset.side = placement.side;
    ground.hidden = !!placement.hideSlime;
    if (moved) {
      ground.style.left = `${to.left - GROUND_INSET}px`;
      ground.style.top = `${to.top}px`;
    }
    placed = to;
    if (plan) play(plan);
    else if (!playing) root.classList.toggle("is-idle", canMove);
    return playing ? Math.max(0, playing.plan.landed - Number(playing.body.currentTime)) : 0;
  }

  return {
    render(next, { hop }) {
      clearTimeout(leaving);
      root.classList.remove("is-leaving");
      const first = model === null;
      model = next;
      root.dataset.mode = next.mode;
      if (next.step) root.dataset.step = next.step; else delete root.dataset.step;
      if (next.state) root.dataset.state = next.state; else delete root.dataset.state;
      bubble.setAttribute("aria-label", next.label);
      const active = document.activeElement;
      const focused = active instanceof HTMLElement && bubble.contains(active) ? active.dataset.tour : undefined;
      bubble.innerHTML = content(next);
      if (focused) {
        const again = bubble.querySelector<HTMLElement>('[data-tour="' + focused + '"]');
        (again ?? bubble.querySelector<HTMLElement>(".tour-buttons button:last-child"))?.focus({ preventScroll: true });
      }
      const delay = apply(next, hop);
      // The words come once Raphael has landed.
      if (hop || first) { bubble.style.setProperty("--tour-in-delay", `${delay}ms`); replay(bubble, "is-arriving"); }
    },
    reflow() { if (model) apply(model, false); },
    contains(node) { return !!node && root.contains(node); },
    leave(done) {
      if (reducedMotion()) { done(); return; }
      root.classList.add("is-leaving");
      leaving = setTimeout(done, 220);
    },
    destroy() { clearTimeout(leaving); cancelMotion(); for (const type of owned) window.removeEventListener(type, own, true); root.remove(); },
  };
}

/** Start each sentence on its own line. The browser wraps within a sentence. */
function sentences(text: string): string {
  return esc(text).replace(/([。！？])(?!$)/g, "$1<br>").replace(/([.!?])\s+/g, "$1 <br>");
}

type TimedFrame = Keyframe & { time: number };
type Tracks = { ground: TimedFrame[]; body: TimedFrame[]; glow: TimedFrame[] };
type MotionPlan = Tracks & { apex: number; landed: number; duration: number };

function matrixOf(transform: string): DOMMatrixReadOnly {
  return new DOMMatrixReadOnly(transform && transform !== "none" ? transform : undefined);
}

function shift(time: number, x: number, y: number, easing = "linear"): TimedFrame {
  return { time, transform: `translate(${x}px, ${y}px)`, easing };
}

function pose(time: number, y: number, width = 1, height = 1, easing = "linear", opacity: number | string = 1): TimedFrame {
  return { time, transform: `translateY(${y}px) scale(${width}, ${height})`, easing, opacity };
}

function pool(time: number, width = 1, opacity: number | string = GLOW_OPACITY, easing = "linear"): TimedFrame {
  return { time, transform: `scaleX(${width})`, opacity, easing };
}

/** The pop and hop share the contact, squash and single settling rebound. */
function land(tracks: Tracks, apex: number, contact: number): MotionPlan {
  const squash = contact + 35;
  const landed = contact + LAND_MS;
  const duration = landed + SETTLE_MS;
  tracks.ground.push(shift(duration, 0, 0));
  tracks.body.push(pose(contact, 0, 1, 1, "ease-out"), pose(squash, 0, 1.16, 0.84, "ease-out"),
    pose(landed, 0, 1.03, 0.97, "ease-out"), pose(landed + 48, 0, 0.97, 1.04, "ease-in-out"), pose(duration, 0));
  tracks.glow.push(pool(contact, 1, GLOW_OPACITY, "ease-out"), pool(squash, 1, `calc(${GLOW_OPACITY} * 1.16)`, "ease-out"),
    pool(landed), pool(duration));
  return { ...tracks, apex, landed, duration };
}

interface CurrentPose {
  y: number; width: number; height: number; opacity: number | string;
  glowWidth: number; glowOpacity: number | string; falling: boolean;
}

const hopRise = (distance: number): number => Math.round(Math.min(90, Math.max(28, distance / 5)));

function clearHop(from: Box, to: Box, currentY: number, clear: readonly Box[]): boolean {
  const left = Math.min(from.left, to.left);
  const rise = Math.max(-currentY, hopRise(Math.hypot(from.left - to.left, from.top - to.top)));
  const top = Math.min(from.top, to.top) - rise - 6;
  const sweep = groundBox({ left, top, width: Math.max(from.left, to.left) + SLIME - left, height: Math.max(from.top, to.top) + SLIME - top }, GROUND_INSET);
  return clear.every(box => !touches(sweep, box));
}

/** The two surfaces travel together along the ground line. Only the portrait has a vertical arc. */
function hopPlan(dx: number, dy: number, start: CurrentPose): MotionPlan {
  const distance = Math.hypot(dx, dy);
  const rise = hopRise(distance);
  const short = distance < 80;
  const inFlight = start.y !== 0;
  const falling = inFlight && start.falling;
  const anticipation = inFlight ? 0 : short ? 35 : 100;
  const air = falling ? 155 : inFlight ? 240 : short ? 220 : 300;
  const apex = falling ? 0 : anticipation + air / 2;
  const contact = anticipation + air;
  const ground = [shift(0, dx, dy)];
  const body = [pose(0, start.y, start.width, start.height, falling ? FALL_IN_PROGRESS : inFlight ? RISE : "ease-in-out", start.opacity)];
  const glow = [pool(0, start.glowWidth, start.glowOpacity, falling ? FALL_IN_PROGRESS : RISE)];
  if (!inFlight) {
    ground.push(shift(anticipation, dx, dy));
    // The stretch lies 24% into the ascent, on the same eased arc as the top of the hop.
    const stretch = anticipation + (apex - anticipation) * 0.24;
    body.push(pose(anticipation, 0, 1.12, 0.88, "cubic-bezier(0.33, 0.38, 0.67, 0.71)"),
      pose(stretch, -rise * 0.4224, 0.92, 1.1, RISE));
    glow.push(pool(anticipation, 1, GLOW_OPACITY, RISE));
  }
  ground.push(shift(contact, 0, 0));
  if (!falling) {
    body.push(pose(apex, Math.min(-rise, start.y), 1, 1, FALL));
    glow.push(pool(apex, 0.65, `calc(${GLOW_OPACITY} * 0.5)`, FALL));
  }
  return land({ ground, body, glow }, apex, contact);
}

/** Raphael grows from the button's centre and overshoots the ground before touching down. */
function popPlan(from: Box, to: Box): MotionPlan {
  const scale = 0.3;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + FOOT - BODY_HEIGHT * scale / 2);
  const apex = 180;
  return land({
    ground: [shift(0, dx, 0, RISE), shift(apex, 0, 0)],
    body: [pose(0, dy, scale, scale, RISE, 0.2), pose(apex, -14, 0.92, 1.1, FALL)],
    glow: [pool(0, 0.65, 0), pool(apex, 0.65, 0, FALL)],
  }, apex, 250);
}
