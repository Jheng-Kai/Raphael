// What the tour draws: a dim over the window with one cut-out, Raphael's slime, and its bubble. The controller (tour.ts)
// says what to show; this measures, places and moves. Nothing here knows what a step means.

import { RAPHAEL_ID, faceHTML } from "../members";
import { bindNavLayer } from "../nav-layers";
import { btn, esc, headerCloseButton, reducedMotion, replay } from "../ui";
import { dimClip } from "./dim";
import { NUDGE_PX, cheerPlan, facingOf, groundOffset, hopPlan, playHops, popPlan, poseOf, type HopPlan, type PlayingHops, type Rig } from "../slime-hop";
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
  /** The caps drawn under the line (the keys that ask Raphael), as the window names them, and which of them is held down. */
  keys?: string[];
  keysDown?: boolean[];
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
  /** The instruction is done with: its words fade out where they stand, and the bubble stays empty until the next words land. */
  hush(): void;
  /** Lights each key cap that is held down. */
  pressKeys(down: boolean[]): void;
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
/** How long the words being left fade out in place (tour.css `tour-words-out`, with a little room). */
const GHOST_MS = 220;
// The 64 px portrait has padding around its drawing. Anchor the pose and light at the drawn foot.
const FOOT = 52;
const BODY_HEIGHT = 40;

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
  const rig: Rig = { ground, body: slime, glow };
  let playing: PlayingHops | null = null;

  function cancelMotion(): void {
    delete root.dataset.facing;
    playing?.cancel();
    playing = null;
  }

  function play(plan: HopPlan, facing?: "left" | "right"): void {
    root.classList.remove("is-idle");
    // In the air Raphael looks where it is going, turned to its side; it faces the person again once it lands.
    if (facing) root.dataset.facing = facing; else delete root.dataset.facing;
    playing = playHops(rig, plan, () => {
      playing = null;
      delete root.dataset.facing;
      root.classList.add("is-idle");
      // Landed: if the place moved on meanwhile, the next hops start from here, again on a straight line.
      if (model) apply(model, false);
    });
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
    // Large keyboard keys, as a keyboard draws them: each lights up while it is held.
    const caps = next.keys?.length ? `<div class="tour-keys" aria-hidden="false">${next.keys.map((label, index) =>
      `<kbd class="tour-key"${next.keysDown?.[index] ? " data-down" : ""}>${esc(label)}</kbd>`).join('<span class="tour-plus">+</span>')}</div>` : "";
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
    // Hops under way keep their course, one straight line from start to end: a move the layout forces meanwhile waits for the
    // landing (`play` looks again then). Only a new step turns Raphael from where it is.
    const holdCourse = !hop && !!playing && !!placed;
    const to = holdCourse ? placed! : placement.slime;
    const moved = placed?.left !== to.left || placed.top !== to.top;
    const canMove = !reducedMotion() && typeof slime.animate === "function";
    let plan: HopPlan | undefined;
    let facing: "left" | "right" | undefined;
    // Raphael never appears somewhere else at once: a step hops there, and so does a move the layout forces (a resize, a layer that opened).
    const journey = !!placed && Math.hypot(placed.left - to.left, placed.top - to.top) > NUDGE_PX;
    if (canMove && (hop ? moved || next.mode === "step" : journey)) {
      if (placed) {
        // Read where the ground and the body are before cancelling or moving their common anchor.
        const offset = groundOffset(rig);
        const from = { ...placed, left: placed.left + offset.x, top: placed.top + offset.y };
        facing = facingOf(from.left - to.left);
        plan = hopPlan(from.left - to.left, from.top - to.top, { from: poseOf(rig, playing), maxRise: Math.min(from.top, to.top) - 4 });
      } else {
        const from = next.origin();
        if (from) plan = popPlan(from, to, { foot: FOOT, bodyHeight: BODY_HEIGHT });
      }
    }
    if (canMove && celebrate) plan = cheerPlan(plan);
    // A nudge of the layout mid-hop only shifts where the hops land; stopping them would show Raphael at the end at once.
    if (!canMove || plan) cancelMotion();
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
    if (plan) play(plan, facing);
    else if (!playing) root.classList.toggle("is-idle", canMove);
    return playing ? Math.max(0, playing.plan.arrival - playing.elapsed()) : 0;
  }

  const buttons = () => [...bubble.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];

  /** A copy of the words on screen fades out in place, so moving on never makes them vanish at once. */
  function fadeWords(): void {
    if (reducedMotion() || bubble.classList.contains("is-hushed") || !bubble.childElementCount) return;
    const ghost = bubble.cloneNode(true) as HTMLElement;
    ghost.classList.remove("is-arriving");
    ghost.classList.add("tour-ghost");
    for (const name of ["role", "tabindex", "aria-label"]) ghost.removeAttribute(name);
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    root.append(ghost);
    setTimeout(() => ghost.remove(), GHOST_MS);
  }

  return {
    render(next, { hop }) {
      clearTimeout(leaving);
      root.classList.remove("is-leaving");
      const covered = root.inert;
      if (covered) {
        root.inert = false;
        root.classList.remove("is-covered");
        placed = null;
        cancelMotion();
      }
      const first = model === null;
      if (hop && !first && !covered) fadeWords();
      bubble.classList.remove("is-hushed");
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
    hush() {
      fadeWords();
      bubble.classList.add("is-hushed");
      // The frame goes with the words: what was pressed is done with, and the next frame comes with the next words.
      spotEl.hidden = true;
    },
    pressKeys(down) {
      bubble.querySelectorAll<HTMLElement>(".tour-key").forEach((cap, index) => cap.toggleAttribute("data-down", !!down[index]));
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
