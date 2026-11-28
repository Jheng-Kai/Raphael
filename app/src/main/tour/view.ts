// What the tour draws: a dim over the window with one cut-out, Raphael's slime, and its bubble. The controller (tour.ts)
// says what to show; this measures, places and moves. Nothing here knows what a step means.

import { RAPHAEL_ID, faceHTML } from "../members";
import { bindNavLayer } from "../nav-layers";
import { btn, esc, headerCloseButton, keys, reducedMotion, replay } from "../ui";
import { dimClip } from "./dim";
import { EDGE, GROUP_GAP, SPOT_GAP, placeAroundLayer, placeGroup, placeInside, type Box, type PlaceInput, type Placement, type Side } from "./place";
import { boxOf, type Spot } from "./steps";
import "./tour.css";

export type ButtonId = "start" | "skip" | "done" | "gotIt";
export type Pressed = ButtonId | "close" | "dismiss";
export const CAPTION_CONTROLS = ".window-chrome .window-controls";

export interface ViewModel {
  /** `offer`: the question at the bottom left; `step`: the dim, the cut-out and the walk; `bye`: the last line, nothing dimmed. */
  mode: "offer" | "step" | "bye";
  step?: string;
  title?: string;
  closeLabel?: string;
  text: string;
  /** The caps drawn under the line (the keys that ask Raphael), as the window names them. */
  keys?: string[];
  progress?: { current: number; total: number; label: string };
  buttons: { id: ButtonId; label: string; primary?: boolean }[];
  controls?: () => HTMLElement[];
  celebrate?: boolean;
  /** What the dialog is called for a reader. */
  label: string;
  /** What is pointed at, measured again whenever the window or the layout moves; `dim: false` only stands beside it. */
  locate: () => (Spot & { dim: boolean }) | null;
  /** What the dim leaves lit, when it is more than the framed target (the whole menu a step works inside, or what a step opened). */
  lit?: () => Spot | null;
  /** The opened thing is being looked at: it is lit and framed, and nothing under the dim takes a press. */
  seeing?: boolean;
  /** While looking, the lit thing still scrolls under the wheel (a long model list). */
  lookArea?: () => HTMLElement | null;
  layer?: () => HTMLElement | null;
  /** An independent anchor when Raphael stands beside a different surface from the cut-out. */
  anchor?: () => Box | null;
  prefer: readonly Side[];
  align: "center" | "start";
  keepControlsClear?: () => readonly Box[];
  slimeFirst?: boolean;
  /** Where Raphael comes from while it has no place yet. */
  origin: () => Box | null;
}

export interface TourView {
  render(model: ViewModel, options: { hop: boolean }): number;
  hideOffer(): void;
  /** Measures the target and places the group again, without a hop. */
  reflow(): void;
  contains(node: Node | null): boolean;
  tab(controls: HTMLElement[], backward: boolean): void;
  keepFocus(controls: HTMLElement[]): void;
  setConfirmation(scrim: HTMLElement | null): void;
  focusButton(id: "skip" | "close"): void;
  /** Fades the group out and then removes it (at once when nothing may move). */
  leave(done: () => void): void;
  destroy(): void;
}

const SLIME = 64;
const GROUND_INSET = 16;
/** The narrowest the bubble gets to stand beside an open layer. */
const MIN_BUBBLE = 200;
// The 64 px portrait has padding around its drawing. Anchor the pose and light at the drawn foot.
const FOOT = 52;
const BODY_HEIGHT = 40;
const ANTICIPATION_MS = 80;
// A chain of small hops along the way: one for about every 110 px, each with its own touch-down, so the travel reads as walking.
const AIR_MS = 250;
const CONTACT_MS = 70;
const HOP_SPAN = 110;
const MAX_HOPS = 5;
const LAND_MS = 180;
const HAPPY_MS = 150;
const RISE = "cubic-bezier(0.33, 0.67, 0.67, 1)";
const FALL = "cubic-bezier(0.33, 0, 0.67, 0.33)";
const FALL_IN_PROGRESS = "cubic-bezier(0.33, 0.16, 0.67, 0.5)";
const GLOW_OPACITY = "var(--tour-glow-opacity)";

export function createView(on: (pressed: Pressed) => void, onTargetPress: (el: Element) => void): TourView {
  const root = document.createElement("div");
  root.className = "tour";
  root.dataset.tourRoot = "";
  root.innerHTML = `<div class="tour-catch"></div><div class="tour-spot" hidden></div>` +
    `<div class="tour-ground" style="--tour-foot:${FOOT}px;--tour-ground-inset:${GROUND_INSET}px" aria-hidden="true"><span class="tour-glow"></span>` +
    `<span class="tour-slime">${faceHTML({ id: RAPHAEL_ID, name: "" }, SLIME)}</span></div>` +
    `<div class="tour-bubble" role="dialog" tabindex="-1"></div>`;
  document.body.append(root);
  const dim = root.querySelector<HTMLElement>(".tour-catch")!;
  const spotEl = root.querySelector<HTMLElement>(".tour-spot")!;
  const ground = root.querySelector<HTMLElement>(".tour-ground")!;
  const slime = root.querySelector<HTMLElement>(".tour-slime")!;
  const glow = root.querySelector<HTMLElement>(".tour-glow")!;
  const bubble = root.querySelector<HTMLElement>(".tour-bubble")!;

  let model: ViewModel | null = null;
  let confirmation: HTMLElement | null = null;
  // The walk owns layer navigation and consumes both directions until Finish.
  bindNavLayer(bubble, () => {}, { active: () => model?.mode === "step", step: () => true });
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

  // Catch presses before the document's outside-press dismissals. The clip supplies pointer hit-testing;
  // this guard also keeps the look-only openings and the margin around a control from taking input.
  const own = (event: Event): void => {
    if (root.inert || !(event.target instanceof Element)) return;
    const target = event.target;
    if (confirmation) {
      if (!confirmation.contains(target)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (model?.mode === "step") {
      if (event.type === "wheel" && model.seeing && model.lookArea?.()?.contains(target)) return;
      const sideButton = event instanceof MouseEvent && (event.button === 3 || event.button === 4);
      const inBubble = bubble.contains(target);
      if (!sideButton && !inBubble && target !== dim) {
        if (target.closest(CAPTION_CONTROLS)) return;
        if (model.controls?.().some(control => control.contains(target))) {
          if (event.type === "click") onTargetPress(target);
          return;
        }
      }
      if (sideButton || !inBubble) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    } else if (!bubble.contains(target)) return;
    event.stopImmediatePropagation();
    if (event.type !== "click") return;
    const button = target.closest<HTMLElement>("[data-tour]");
    if (button) { if (!(button as HTMLButtonElement).disabled) on(button.dataset.tour as Pressed); return; }
    if (model?.mode === "bye") on("dismiss");
  };
  const owned = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "contextmenu", "dblclick", "auxclick", "wheel"];
  for (const type of owned) window.addEventListener(type, own, { capture: true, passive: false });

  function content(next: ViewModel): string {
    const caps = next.keys?.length ? `<div class="tour-keys">${keys(next.keys)}</div>` : "";
    const title = next.title ? `<h2 class="tour-title">${esc(next.title)}</h2>` : "";
    const progress = next.progress;
    const dots = progress ? Array.from({ length: progress.total }, (_, index) =>
      `<span class="tour-dot"${index + 1 === progress.current ? ' data-current=""' : ""}></span>`).join("") : "";
    const count = progress ? `<span class="tour-count" role="img" aria-label="${esc(progress.label)}"><span aria-hidden="true">${dots}</span></span>` : "";
    const buttons = next.buttons.map(button => btn(esc(button.label), `sm${button.primary ? " pri" : ""}`, ` data-tour="${button.id}"`)).join("");
    const head = next.closeLabel ? `<div class="tour-head">${title}${headerCloseButton(next.closeLabel, ' data-tour="close"')}</div>` : title;
    return `${head}<p class="tour-text">${esc(next.text)}</p>${caps}` +
      (count || buttons ? `<div class="tour-foot">${count}<div class="tour-buttons">${buttons}</div></div>` : "");
  }

  /** Beside a layer with a strip too narrow for the words at their width: the bubble narrows to the strip (not below 200 px) and tries again. */
  function besideNarrowed(input: PlaceInput, box: Box, header?: Box): Placement | null {
    const strip = Math.max(box.left - SPOT_GAP - EDGE, input.view.width - EDGE - (box.left + box.width + SPOT_GAP));
    const width = Math.floor(strip - (GROUND_INSET + SLIME + GROUP_GAP)) - 2;
    if (width < MIN_BUBBLE || width >= input.bubble.width) return null;
    bubble.style.maxWidth = `${width}px`;
    const placed = placeAroundLayer({ ...input, bubble: { width: bubble.offsetWidth, height: bubble.offsetHeight } }, box, header);
    if (!placed) bubble.style.removeProperty("max-width");
    return placed;
  }

  // The window's own layers never move for the tour: Raphael stands beside what is open, or, when that fills the window, on it.
  function place(next: ViewModel, anchor: Box | null, clear: readonly Box[], controls: readonly Box[], layer: HTMLElement | null): Placement {
    bubble.style.removeProperty("max-width");
    const input: PlaceInput = {
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
    };
    if (!layer) return placeGroup(input);
    const header = layer.querySelector<HTMLElement>(".cs-top, .set-head, .mb-dlg-head, .cb-head");
    if (header) {
      const title = header.querySelector("h1, h2, h3");
      if (title && title.textContent) {
        const words = document.createRange();
        words.selectNodeContents(title);
        input.controls = [...controls, words.getBoundingClientRect()];
      }
    }
    const box = boxOf(layer), head = header?.getBoundingClientRect();
    const beside = placeAroundLayer(input, box, head) ?? besideNarrowed(input, box, head);
    if (beside) return beside;
    // Only something looked at may be stood on, and only where its title stays clear: nothing there takes a press.
    return next.seeing ? placeInside(input, box) : placeGroup(input);
  }

  function apply(next: ViewModel, hop: boolean, celebrate = false): number {
    const spot = next.locate();
    const layer = next.layer?.() ?? null;
    const anchor = next.anchor?.() ?? null;
    const clear = anchor && spot ? [spot.box] : [];
    const controls = next.keepControlsClear?.() ?? [];
    const placement = place(next, anchor ?? spot?.box ?? null, clear, controls, layer);
    const to = placement.slime;
    const moved = placed?.left !== to.left || placed.top !== to.top;
    const canMove = !reducedMotion() && typeof slime.animate === "function";
    let plan: MotionPlan | undefined;
    if (canMove && hop && (moved || next.mode === "step")) {
      if (placed) {
        // Read all three poses before cancelling or moving their common anchor.
        const currentGround = matrixOf(getComputedStyle(ground).transform);
        const bodyStyle = getComputedStyle(slime), glowStyle = getComputedStyle(glow);
        const currentBody = matrixOf(bodyStyle.transform), currentGlow = matrixOf(glowStyle.transform);
        const from = { ...placed, left: placed.left + currentGround.m41, top: placed.top + currentGround.m42 };
        const time = Number(playing?.body.currentTime);
        // Raphael always travels the whole way in hops, never jumping in place and reappearing elsewhere.
        plan = hopPlan(from.left - to.left, from.top - to.top, {
          y: currentBody.m42, width: Math.hypot(currentBody.m11, currentBody.m12), height: Math.hypot(currentBody.m21, currentBody.m22),
          tilt: Math.atan2(currentBody.m12, currentBody.m11) * 180 / Math.PI, opacity: bodyStyle.opacity || 1,
          glowWidth: currentGlow.m11, glowOpacity: glowStyle.opacity || GLOW_OPACITY,
          falling: playing?.plan.descents.some(([apex, ground]) => time >= apex && time < ground) ?? false,
        });
      } else {
        const from = next.origin();
        if (from) plan = popPlan(from, to);
      }
    }
    if (canMove && celebrate) plan = happyPlan(plan);
    if (!canMove || moved || plan) cancelMotion();
    const ring = next.mode === "step" && spot?.dim ? spot : null;
    // The dim's opening is what is lit; the pulsing frame stays on what is to be pressed (or, while looking, round the lit thing).
    const cut = next.mode === "step" ? next.lit?.() ?? ring : null;
    root.dataset.dim = next.mode !== "step" ? "none" : cut ? "spot" : "all";
    if (next.mode === "step") root.dataset.state = next.seeing ? "see" : "do"; else delete root.dataset.state;
    dim.style.clipPath = cut ? dimClip(cut) : "";
    spotEl.hidden = !ring;
    if (ring) {
      spotEl.style.left = `${ring.box.left}px`; spotEl.style.top = `${ring.box.top}px`;
      spotEl.style.width = `${ring.box.width}px`; spotEl.style.height = `${ring.box.height}px`;
      spotEl.style.borderRadius = `${ring.radius}px`;
    }
    bubble.style.left = `${Math.round(placement.bubble.left)}px`;
    bubble.style.top = `${Math.round(placement.bubble.top)}px`;
    bubble.dataset.side = placement.side;
    if (moved) {
      ground.style.left = `${to.left - GROUND_INSET}px`;
      ground.style.top = `${to.top}px`;
    }
    placed = to;
    if (plan) play(plan);
    else if (!playing) root.classList.toggle("is-idle", canMove);
    return playing ? Math.max(0, playing.plan.arrival - Number(playing.body.currentTime)) : 0;
  }

  const buttons = () => [...bubble.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];

  return {
    render(next, { hop }) {
      clearTimeout(leaving);
      root.classList.remove("is-leaving");
      if (root.inert) {
        root.inert = false;
        root.classList.remove("is-covered");
        placed = null;
        cancelMotion();
      }
      const first = model === null;
      const celebrate = !!next.celebrate && model?.mode !== "bye";
      model = next;
      root.dataset.mode = next.mode;
      if (next.step) root.dataset.step = next.step; else delete root.dataset.step;
      bubble.setAttribute("aria-label", next.label);
      const active = document.activeElement;
      const focused = active instanceof HTMLElement && bubble.contains(active) ? active.dataset.tour : undefined;
      bubble.innerHTML = content(next);
      if (focused) {
        const again = bubble.querySelector<HTMLElement>('[data-tour="' + focused + '"]');
        (again ?? bubble.querySelector<HTMLElement>(".tour-buttons button:last-child") ?? bubble).focus({ preventScroll: true });
      }
      const delay = apply(next, hop, celebrate);
      // The words come once Raphael has landed.
      if (hop || first) { bubble.style.setProperty("--tour-in-delay", `${delay}ms`); replay(bubble, "is-arriving"); }
      return delay;
    },
    hideOffer() {
      root.inert = true;
      root.classList.add("is-covered");
    },
    reflow() { if (model) apply(model, false); },
    contains(node) { return !!node && root.contains(node); },
    tab(controls, backward) {
      const focusable = "button:not(:disabled), input, textarea, [contenteditable]";
      const order = [...controls.flatMap(control => control.matches(focusable) ? [control] :
        [...control.querySelectorAll<HTMLElement>(focusable)].filter(el => el.checkVisibility())), ...buttons()];
      const index = order.findIndex(item => item === document.activeElement);
      const next = index < 0 ? (backward ? order.length - 1 : 0) : (index + (backward ? -1 : 1) + order.length) % order.length;
      (order[next] ?? bubble).focus({ preventScroll: true });
    },
    keepFocus(controls) {
      const active = document.activeElement;
      if (active instanceof Element && (controls.some(control => control.contains(active)) || bubble.contains(active) || active.closest(CAPTION_CONTROLS))) return;
      (bubble.querySelector<HTMLElement>(".tour-buttons button:last-child") ?? bubble).focus({ preventScroll: true });
    },
    setConfirmation(scrim) { confirmation = scrim; bubble.inert = !!scrim; },
    focusButton(id) { bubble.querySelector<HTMLElement>(`[data-tour="${id}"]`)?.focus({ preventScroll: true }); },
    leave(done) {
      if (reducedMotion()) { done(); return; }
      root.classList.add("is-leaving");
      leaving = setTimeout(done, 220);
    },
    destroy() { clearTimeout(leaving); cancelMotion(); for (const type of owned) window.removeEventListener(type, own, true); root.remove(); },
  };
}

type TimedFrame = Keyframe & { time: number };
type Tracks = { ground: TimedFrame[]; body: TimedFrame[]; glow: TimedFrame[] };
type MotionPlan = Tracks & { descents: [apex: number, ground: number][]; arrival: number; duration: number };

function matrixOf(transform: string): DOMMatrixReadOnly {
  return new DOMMatrixReadOnly(transform && transform !== "none" ? transform : undefined);
}

function shift(time: number, x: number, y: number, easing = "linear"): TimedFrame {
  return { time, transform: `translate(${x}px, ${y}px)`, easing };
}

function pose(time: number, y: number, width = 1, height = 1, easing = "linear", tilt = 0, opacity: number | string = 1): TimedFrame {
  return { time, transform: `translateY(${y}px) rotate(${tilt}deg) scale(${width}, ${height})`, easing, opacity };
}

function pool(time: number, width = 1, opacity: number | string = GLOW_OPACITY, easing = "linear"): TimedFrame {
  return { time, transform: `scaleX(${width})`, opacity, easing };
}

/** A landing has one squash and one rebound before the portrait comes to rest. */
function land(tracks: Tracks, descents: MotionPlan["descents"], contact: number): MotionPlan {
  const squash = contact + 35;
  const duration = contact + LAND_MS;
  tracks.ground.push(shift(duration, 0, 0));
  tracks.body.push(pose(contact, 0, 1, 1, "ease-out"), pose(squash, 0, 1.16, 0.84, "ease-out"),
    pose(contact + 100, 0, 0.97, 1.04, "ease-in-out"), pose(duration, 0));
  tracks.glow.push(pool(contact, 1, GLOW_OPACITY, "ease-out"), pool(squash, 1, `calc(${GLOW_OPACITY} * 1.16)`, "ease-out"),
    pool(duration));
  return { ...tracks, descents, arrival: duration, duration };
}

interface CurrentPose {
  y: number; width: number; height: number; tilt: number; opacity: number | string;
  glowWidth: number; glowOpacity: number | string; falling: boolean;
}

/** Each hop travels one segment of the ground line while only the portrait rises. */
function hopPlan(dx: number, dy: number, start: CurrentPose): MotionPlan {
  const distance = Math.hypot(dx, dy);
  const hops = distance < 60 ? 1 : Math.min(MAX_HOPS, Math.max(2, Math.round(distance / HOP_SPAN)));
  const rise = Math.min(40, Math.max(16, distance / hops * 0.35));
  const tilt = -Math.sign(dx) * 3;
  const inFlight = start.y !== 0;
  const falling = inFlight && start.falling;
  let time = inFlight ? 0 : ANTICIPATION_MS;
  const ground = [shift(0, dx, dy)];
  const ease = falling ? FALL_IN_PROGRESS : inFlight ? RISE : "ease-in-out";
  const body = [pose(0, start.y, start.width, start.height, ease, start.tilt, start.opacity)];
  const glow = [pool(0, start.glowWidth, start.glowOpacity, ease)];
  const descents: MotionPlan["descents"] = [];
  if (!inFlight) {
    ground.push(shift(time, dx, dy));
    body.push(pose(time, 0, 1.12, 0.88, RISE));
    glow.push(pool(time, 1, GLOW_OPACITY, RISE));
  }
  for (let hop = 0; hop < hops; hop++) {
    const alreadyFalling = hop === 0 && falling;
    const apex = time + (alreadyFalling ? 0 : AIR_MS / 2);
    const contact = apex + AIR_MS / 2;
    if (!alreadyFalling) {
      body.push(pose(apex, hop === 0 ? Math.min(-rise, start.y) : -rise, 0.94, 1.08, FALL, tilt));
      glow.push(pool(apex, 0.65, `calc(${GLOW_OPACITY} * 0.5)`, FALL));
    }
    descents.push([apex, contact]);
    const remaining = (hops - hop - 1) / hops;
    ground.push(shift(contact, dx * remaining, dy * remaining));
    if (hop === hops - 1) { time = contact; break; }
    time = contact + CONTACT_MS;
    ground.push(shift(time, dx * remaining, dy * remaining));
    body.push(pose(contact, 0, 1, 1, "ease-out"), pose(contact + 20, 0, 1.10, 0.90, "ease-out"), pose(time, 0, 1, 1, RISE));
    glow.push(pool(contact), pool(time, 1, GLOW_OPACITY, RISE));
  }
  return land({ ground, body, glow }, descents, time);
}

/** The goodbye's two hops share the last travel position and begin as its words appear. */
function happyPlan(travel?: MotionPlan): MotionPlan {
  const plan = travel ?? { ground: [shift(0, 0, 0)], body: [pose(0, 0, 1, 1, RISE)], glow: [pool(0, 1, GLOW_OPACITY, RISE)],
    descents: [], arrival: 0, duration: 0 };
  const start = plan.duration;
  plan.body[plan.body.length - 1]!.easing = RISE;
  plan.glow[plan.glow.length - 1]!.easing = RISE;
  for (let hop = 0; hop < 2; hop++) {
    const apex = start + (hop + 0.5) * HAPPY_MS;
    const contact = apex + HAPPY_MS / 2;
    plan.body.push(pose(apex, -12, 1, 1, FALL), pose(contact, 0, 1, 1, RISE));
    plan.glow.push(pool(apex, 0.8, `calc(${GLOW_OPACITY} * 0.7)`, FALL), pool(contact, 1, GLOW_OPACITY, RISE));
    plan.descents.push([apex, contact]);
  }
  plan.duration += 2 * HAPPY_MS;
  plan.ground.push(shift(plan.duration, 0, 0));
  return plan;
}

/** Raphael grows from the button's centre and overshoots the ground before touching down. */
function popPlan(from: Box, to: Box): MotionPlan {
  const scale = 0.3;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + FOOT - BODY_HEIGHT * scale / 2);
  const apex = 180;
  return land({
    ground: [shift(0, dx, 0, RISE), shift(apex, 0, 0)],
    body: [pose(0, dy, scale, scale, RISE, 0, 0.2), pose(apex, -14, 0.94, 1.08, FALL)],
    glow: [pool(0, 0.65, 0), pool(apex, 0.65, 0, FALL)],
  }, [[apex, 250]], 250);
}
