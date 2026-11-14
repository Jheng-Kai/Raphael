// The mouse's side buttons and Alt+Left / Alt+Right as back and forward in the main window. The
// steps themselves are in nav-history.ts. This file hears the buttons and keys, and keeps WebView2
// from acting on them: it would go back or forward in its own history, which holds no page of ours.
// It also hears every other press and key, so the history can see each view the person goes into.

import type { NavStep } from "./nav-history";

/** The side buttons of a mouse as `MouseEvent.button` numbers them: the back one and the forward one. */
const BACK_BUTTON = 3;
const FORWARD_BUTTON = 4;

/** The step that a mouse button asks for; null for any other button. */
export function stepOfButton(button: number): NavStep | null {
  if (button === BACK_BUTTON) return "back";
  return button === FORWARD_BUTTON ? "forward" : null;
}

export interface NavKeyInput {
  code: string;
  type: "keydown" | "keyup";
  repeat: boolean;
  /** Either Alt is down. */
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  /** Something heard the key before and took it (it called preventDefault). */
  handled: boolean;
}

export interface NavKeyState {
  /** Which Alt keys are down, as far as this window has seen. */
  altLeft: boolean;
  altRight: boolean;
  /** A step was taken with the left Alt: its release is swallowed too (see `reduceNavKey`). */
  swallowAltUp: boolean;
}

export const emptyNavKeyState = (): NavKeyState => ({ altLeft: false, altRight: false, swallowAltUp: false });

/**
 * Pure keyboard transition: Alt+Left is back and Alt+Right is forward, with the left Alt only. The
 * right Alt is Raphael's dictation key, and window-hotkeys.ts owns it and the chords that start
 * with it: no step is taken while it is down, and it is never swallowed here. A key that something
 * else took first (a menu, the key recorder) is not a step, nor is one pressed with Ctrl, Shift or
 * the Windows key as well.
 */
export function reduceNavKey(previous: NavKeyState, event: NavKeyInput): {
  state: NavKeyState; step: NavStep | null; preventDefault: boolean;
} {
  const state = { ...previous };
  const down = event.type === "keydown";
  // `altKey` is true while either Alt is down: it puts right an Alt release this window never heard.
  if (!event.altKey) {
    state.altLeft = false;
    state.altRight = false;
  }
  let step: NavStep | null = null;
  let preventDefault = false;
  if (event.code === "AltLeft") {
    state.altLeft = down;
    // An Alt that comes up after a key the page took would count as an Alt-only tap and activate
    // WebView2's menu handling; window-hotkeys.ts swallows the release of its chords for the same reason.
    if (!down && previous.swallowAltUp) preventDefault = true;
    state.swallowAltUp = false;
  } else if (event.code === "AltRight") {
    state.altRight = down;
  } else if (
    down && !event.handled && (event.code === "ArrowLeft" || event.code === "ArrowRight") &&
    state.altLeft && !state.altRight && !event.ctrlKey && !event.shiftKey && !event.metaKey
  ) {
    // WebView2 would go back or forward itself, even where this window has nowhere to go.
    preventDefault = true;
    state.swallowAltUp = true;
    // Holding the key repeats it: one step each time it is pressed.
    if (!event.repeat) step = event.code === "ArrowLeft" ? "back" : "forward";
  }
  return { state, step, preventDefault };
}

/** The window's own ways back are marked with this attribute: a press on one is a step back, as the side button is. */
export const NAV_BACK_ATTR = "data-nav-back";

/** Whether a key may take the window elsewhere. A letter typed into a field never does, nor a modifier on its own. */
export function keyMayMove(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "isComposing">): boolean {
  if (event.isComposing || ["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "Process"].includes(event.key)) return false;
  return event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey;
}

/**
 * Tells `heard` of each press and key that may take the window somewhere, before the page acts on it, and whether it is
 * one of the window's own ways back (an element marked `data-nav-back`, or Escape). The side buttons and Alt+Left /
 * Alt+Right are steps themselves (`installNavInput`), not moves to note. Returns how to stop listening.
 */
export function installNavNotes(target: EventTarget, heard: (back: boolean) => void): () => void {
  const press = (raw: Event): void => {
    const event = raw as MouseEvent;
    if (stepOfButton(event.button) !== null) return;
    const on = event.target instanceof Element ? event.target : null;
    heard(!!on?.closest(`[${NAV_BACK_ATTR}]`));
  };
  const key = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    if (!keyMayMove(event)) return;
    if (event.altKey && (event.code === "ArrowLeft" || event.code === "ArrowRight")) return;
    heard(event.key === "Escape");
  };
  const first = { capture: true };
  target.addEventListener("click", press, first);
  target.addEventListener("keydown", key, first);
  return () => {
    target.removeEventListener("click", press, first);
    target.removeEventListener("keydown", key, first);
  };
}

/**
 * Listens on `target` (the window) for the side buttons and the keys. `step` is called once for each
 * press and decides whether there is anywhere to go. Returns how to stop listening.
 */
export function installNavInput(target: EventTarget, step: (direction: NavStep) => void): () => void {
  let state = emptyNavKeyState();
  const mouse = (raw: Event): void => {
    const event = raw as MouseEvent;
    const direction = stepOfButton(event.button);
    if (direction === null) return;
    // On all three events: which of them WebView2 acts on is not ours to know.
    event.preventDefault();
    // The step comes with the press, as it does with the keys: a release that began in another
    // program is no request.
    if (event.type === "mousedown") step(direction);
  };
  const key = (raw: Event): void => {
    const event = raw as KeyboardEvent;
    const result = reduceNavKey(state, {
      code: event.code, type: event.type as NavKeyInput["type"], repeat: event.repeat,
      altKey: event.altKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, metaKey: event.metaKey,
      handled: event.defaultPrevented,
    });
    state = result.state;
    if (result.preventDefault) event.preventDefault();
    if (result.step) step(result.step);
  };
  // A window that lost the focus with a key down gets no release for it.
  const blur = (): void => {
    state = emptyNavKeyState();
  };
  // The buttons are taken before any page code can see them. The keys come last, after the keys a
  // menu, the language picker or the key recorder take for themselves.
  const first = { capture: true };
  const buttonEvents = ["mousedown", "mouseup", "auxclick"];
  const keyEvents = ["keydown", "keyup"];
  buttonEvents.forEach((type) => target.addEventListener(type, mouse, first));
  keyEvents.forEach((type) => target.addEventListener(type, key));
  target.addEventListener("blur", blur);
  return () => {
    buttonEvents.forEach((type) => target.removeEventListener(type, mouse, first));
    keyEvents.forEach((type) => target.removeEventListener(type, key));
    target.removeEventListener("blur", blur);
  };
}
