// What the tour draws: a dim over the window with one cut-out, Raphael's slime, and its bubble. The controller (tour.ts)
// says what to show; this measures, places and moves. Nothing here knows what a step means.

import { RAPHAEL_ID, faceHTML } from "../members";
import { bindNavLayer } from "../nav-layers";
import { btn, esc, iconButton, keys, reducedMotion, replay } from "../ui";
import { placeGroup, type Box, type Placement, type Side } from "./place";
import type { Spot } from "./steps";
import "./tour.css";

export type ButtonId = "start" | "later" | "back" | "next" | "done";
/** What the view tells the controller: a button, the ×, or a press on the bubble that only says goodbye. */
export type Pressed = ButtonId | "close" | "dismiss";

export interface ViewModel {
  /** `offer`: the question at the bottom left; `step`: the dim, the cut-out and the walk; `bye`: the last line, nothing dimmed. */
  mode: "offer" | "step" | "bye";
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
  prefer: readonly Side[];
  align: "center" | "start";
  /** Where Raphael comes from while it has no place yet. */
  origin: () => Box | null;
}

export interface TourView {
  render(model: ViewModel, options: { hop: boolean }): void;
  /** Measures the target and places the group again, without a hop. */
  reflow(): void;
  /** Moves the focus to the step's primary button. */
  focusPrimary(): void;
  /** The tab stops of the bubble, in order. */
  stops(): HTMLElement[];
  contains(node: Node | null): boolean;
  /** Fades the group out and then removes it (at once when nothing may move). */
  leave(done: () => void): void;
  destroy(): void;
}

const SLIME = 64;
export const HOP_MS = 300;

export function createView(on: (pressed: Pressed) => void): TourView {
  const root = document.createElement("div");
  root.className = "tour";
  root.dataset.tourRoot = "";
  root.innerHTML = `<div class="tour-catch"></div><div class="tour-spot" hidden></div>` +
    `<span class="tour-slime" aria-hidden="true">${faceHTML({ id: RAPHAEL_ID, name: "" }, SLIME)}</span>` +
    `<div class="tour-bubble" role="dialog"></div>`;
  document.body.append(root);
  const spotEl = root.querySelector<HTMLElement>(".tour-spot")!;
  const slime = root.querySelector<HTMLElement>(".tour-slime")!;
  const bubble = root.querySelector<HTMLElement>(".tour-bubble")!;

  let model: ViewModel | null = null;
  // The walk owns the mouse's back and forward buttons while it lasts (Tour.navigate answers first, even with Settings open; this is the same owner for the layers).
  bindNavLayer(bubble, () => on("back"), { active: () => model?.mode === "step", step: direction => { on(direction === "back" ? "back" : "next"); return true; } });
  let placed: Box | null = null;
  let leaving: ReturnType<typeof setTimeout> | undefined;

  // A press on the tour is the tour's alone. The window's dismissals (Settings close on a press outside them, menus too) listen at the
  // document in the capture phase, so the tour takes its events one step earlier, at the window, and lets nothing past.
  const own = (event: Event): void => {
    if (!(event.target instanceof Node) || !root.contains(event.target)) return;
    event.stopPropagation();
    if (event.type === "wheel") { if (model?.mode === "step") event.preventDefault(); return; }
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

  function place(next: ViewModel): { placement: Placement; spot: (Spot & { dim: boolean }) | null } {
    const spot = next.locate();
    const placement = placeGroup({
      spot: spot?.box ?? null,
      view: { width: document.documentElement.clientWidth || innerWidth, height: document.documentElement.clientHeight || innerHeight },
      bubble: { width: bubble.offsetWidth, height: bubble.offsetHeight },
      slime: SLIME,
      prefer: next.prefer,
      align: next.align,
    });
    return { placement, spot };
  }

  function apply(next: ViewModel, hop: boolean): void {
    const { placement, spot } = place(next);
    const cut = next.mode === "step" && spot?.dim ? spot : null;
    root.dataset.dim = next.mode !== "step" ? "none" : cut ? "spot" : "all";
    spotEl.hidden = !cut;
    if (cut) {
      spotEl.style.left = `${cut.box.left}px`; spotEl.style.top = `${cut.box.top}px`;
      spotEl.style.width = `${cut.box.width}px`; spotEl.style.height = `${cut.box.height}px`;
      spotEl.style.borderRadius = `${cut.radius}px`;
    }
    bubble.style.left = `${Math.round(placement.bubble.left)}px`;
    bubble.style.top = `${Math.round(placement.bubble.top)}px`;
    bubble.dataset.side = placement.side;
    const from = placed ?? (hop ? next.origin() : null);
    slime.style.left = `${Math.round(placement.slime.left)}px`;
    slime.style.top = `${Math.round(placement.slime.top)}px`;
    const to = placement.slime;
    if (hop && from && !reducedMotion() && typeof slime.animate === "function") {
      if (placed) moveSlime(slime, from, to); else popSlime(slime, from, to);
    }
    placed = to;
  }

  return {
    render(next, { hop }) {
      clearTimeout(leaving);
      root.classList.remove("is-leaving");
      const first = model === null;
      model = next;
      root.dataset.mode = next.mode;
      bubble.setAttribute("aria-label", next.label);
      bubble.toggleAttribute("aria-modal", next.mode === "step");
      bubble.innerHTML = content(next);
      apply(next, hop);
      // The words come once Raphael has landed.
      if (hop || first) { bubble.style.setProperty("--tour-in-delay", hop && !reducedMotion() && placed ? `${HOP_MS - 80}ms` : "0ms"); replay(bubble, "is-arriving"); }
    },
    reflow() { if (model) apply(model, false); },
    focusPrimary() { bubble.querySelector<HTMLElement>(".btn.pri")?.focus({ preventScroll: true }); },
    stops() { return [...bubble.querySelectorAll<HTMLElement>("button:not(:disabled)")]; },
    contains(node) { return !!node && root.contains(node); },
    leave(done) {
      if (reducedMotion()) { done(); return; }
      root.classList.add("is-leaving");
      leaving = setTimeout(done, 220);
    },
    destroy() { clearTimeout(leaving); for (const type of owned) window.removeEventListener(type, own, true); root.remove(); },
  };
}

/**
 * Each sentence on a line of its own, and a long Chinese or Japanese sentence broken after its comma, so that a line never breaks in the middle
 * of a phrase (the text itself is unchanged: the break is drawn, not typed).
 */
function sentences(text: string): string {
  const lines = esc(text).replace(/([。！？])(?!$)/g, "$1\n").replace(/([.!?])\s+/g, "$1 \n").split("\n");
  return lines.map(line => line.length > 16 ? line.replace(/([，、])(?!$)/g, "$1<br>") : line).join("<br>");
}

/** A hop from `from` to `to`: up in an arc, a squash on landing. Only transform moves (the box already stands at `to`). */
function moveSlime(slime: HTMLElement, from: Box, to: Box): void {
  const dx = from.left - to.left, dy = from.top - to.top;
  const rise = Math.round(Math.min(90, Math.max(28, Math.hypot(dx, dy) / 6)));
  slime.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(1, 1)`, offset: 0, easing: "cubic-bezier(0.3, 0.7, 0.4, 1)" },
    { transform: `translate(${dx / 2}px, ${dy / 2 - rise}px) scale(0.94, 1.08)`, offset: 0.5, easing: "cubic-bezier(0.6, 0, 0.8, 0.4)" },
    { transform: "translate(0px, 0px) scale(1.12, 0.88)", offset: 0.86, easing: "ease-out" },
    { transform: "translate(0px, 0px) scale(1, 1)", offset: 1 },
  ], { duration: HOP_MS });
}

/** Raphael springs out of the control it lives in: small at first, a little too tall, then settled. */
function popSlime(slime: HTMLElement, from: Box, to: Box): void {
  const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
  slime.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(0.3)`, offset: 0, opacity: 0.2, easing: "cubic-bezier(0.2, 0.8, 0.3, 1)" },
    { transform: "translate(0px, -12px) scale(0.92, 1.12)", offset: 0.55, opacity: 1, easing: "cubic-bezier(0.5, 0, 0.8, 0.4)" },
    { transform: "translate(0px, 0px) scale(1.14, 0.86)", offset: 0.82, opacity: 1, easing: "ease-out" },
    { transform: "translate(0px, 0px) scale(1, 1)", offset: 1, opacity: 1 },
  ], { duration: 420 });
}
