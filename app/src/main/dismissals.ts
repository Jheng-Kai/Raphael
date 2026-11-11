// One outside-press policy for modal panels and their nested menus (R-UI-121).
//
// A press outside what is open closes it and is delivered to what was pressed, in the same press, as if nothing had been
// open (owner, 2026-11-11). Two shapes of outside, one rule:
//   - a menu or popover has nothing over the page: the press is simply not stopped, so the page element receives its own
//     pointerdown, focus and click, and the panel closes between pointerup and click;
//   - a scrim (a dialog, the settings window, a drawer) sits over the page and catches the press: the panel closes, then the
//     element under the pointer is found and activated once, with the focus, as the press would have done.
// A press on bare scrim only closes. A press that began inside, or a drag that ended outside, never closes or passes through.
// A panel that may not close right now (canClose) keeps the modal's old promise instead: the press is spent and goes nowhere.
interface Layer {
  panel(): HTMLElement | null;
  close(): void;
  canClose(): boolean;
  anchor?: HTMLElement;
}
const layers: Layer[] = [];
let listening = false;
interface Gesture {
  pointer: number;
  /** The layer that was on top when the pointer went down; a layer that opens during the press is not its to close. */
  top: Layer;
  down: EventTarget | null;
  /** The press was taken: its click is ours to swallow (a scrim's, or a panel that may not close right now). */
  swallow: boolean;
  /** The pointer sequence broke (another button, a cancel): it closes nothing. */
  void: boolean;
}
let gesture: Gesture | null = null;
/** True while a press that goes on to its target is closing panels: they must not take the focus back from it. */
let passing = false;
/** True while an activation made here is dispatched: it is never an outside press itself. */
let delivering = false;

function top(): { layer: Layer; panel: HTMLElement } | null {
  for (let i = layers.length - 1; i >= 0; i--) {
    const panel = layers[i].panel();
    if (panel?.isConnected) return { layer: layers[i], panel };
  }
  return null;
}
const inside = (layer: Layer, panel: HTMLElement, target: EventTarget | null): boolean =>
  target instanceof Node && ((target instanceof Element && !!target.closest("#window-chrome")) || panel.contains(target) || !!layer.anchor?.contains(target));

/** The open layers, top first, that neither end of a press is inside: what it dismisses. Stops at the first it is inside. */
function outsideOf(down: EventTarget | null, up: EventTarget | null): { layer: Layer; panel: HTMLElement }[] {
  const found: { layer: Layer; panel: HTMLElement }[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const panel = layers[i].panel();
    if (!panel?.isConnected) continue;
    if (inside(layers[i], panel, down) || inside(layers[i], panel, up)) break;
    found.push({ layer: layers[i], panel });
  }
  return found;
}

interface Plan {
  /** What the press closes, top first. */
  close: { layer: Layer; panel: HTMLElement }[];
  /** The scrim of a panel that the press landed on, if any. */
  scrim: HTMLElement | null;
  /** The press may go on to what is under that scrim: its panel is the last one open. */
  deliver: boolean;
}

/**
 * A scrim hides everything under it, so a press on one is spent on the panels above that scrim, one layer of menus per
 * press, and reaches the page only when its own panel is the last one: a menu open over a dialog is closed first, and the
 * dialog by the next press. A press on no scrim (a menu over the page, a control beside the panel) closes every panel it is
 * outside of and reaches its target itself.
 */
function planOf(down: EventTarget | null, up: EventTarget | null): Plan {
  const stack = outsideOf(down, up);
  const modal = stack.findIndex(({ panel }) => isBackdrop(up, panel));
  if (modal === -1) return { close: stack, scrim: null, deliver: false };
  return { close: stack.slice(0, Math.max(1, modal)), scrim: up as HTMLElement, deliver: modal === 0 && stack.length === 1 && down === up };
}

/** A target that holds a panel and is no more than the ground around it: a scrim, which catches presses meant for the page. */
const isBackdrop = (target: EventTarget | null, panel: HTMLElement): target is HTMLElement =>
  target instanceof HTMLElement && target !== document.body && target !== document.documentElement && target.contains(panel);

/** The element under a point once `backdrop` stops catching presses (it may still be fading out, or be the whole window). */
function elementBeneath(backdrop: HTMLElement, x: number, y: number): Element | null {
  const value = backdrop.style.getPropertyValue("pointer-events"), priority = backdrop.style.getPropertyPriority("pointer-events");
  backdrop.style.setProperty("pointer-events", "none", "important");
  try {
    // A document without layout (a test's) cannot say what is under a point.
    return typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  } finally {
    if (value) backdrop.style.setProperty("pointer-events", value, priority); else backdrop.style.removeProperty("pointer-events");
  }
}

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

/**
 * Gives a press that a scrim caught to what is under it at the same point: the focus first, as a press gives it, then one
 * real click (or contextmenu) that bubbles from the element itself, so delegated handlers and the nearest control both get it.
 * Bare ground (nothing but the page itself) and anything inert receive nothing. Returns whether something was pressed.
 */
function deliverBeneath(backdrop: HTMLElement, x: number, y: number, type: "click" | "contextmenu" = "click"): boolean {
  if (delivering) return false;
  const below = elementBeneath(backdrop, x, y);
  if (!below || below === document.body || below === document.documentElement || below.closest("[inert]")) return false;
  delivering = true;
  try {
    if (type === "click") {
      const focusable = below.closest<HTMLElement>(FOCUSABLE);
      if (focusable && !(focusable as HTMLButtonElement).disabled) focusable.focus({ preventScroll: true });
    }
    below.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
      button: type === "click" ? 0 : 2, detail: type === "click" ? 1 : 0,
    }));
  } finally {
    delivering = false;
  }
  return true;
}

/**
 * For a scrim that closes by its own click and is no registered layer (the narrow sidebar's drawer, the details panel):
 * `close` it, then give the press to what was under it. A click with no pointer behind it (a key) only closes.
 */
export function closeAndPress(event: MouseEvent, backdrop: HTMLElement, close: () => void): void {
  if (delivering) return;
  passing = true;
  try { close(); } finally { passing = false; }
  if (event.target === backdrop && event.detail !== 0) deliverBeneath(backdrop, event.clientX, event.clientY);
}

/** Whether a press is closing panels on its way to what it pressed: they leave the focus where that press put it. */
export const pressWentThrough = (): boolean => passing;

/** Closes what `stack` holds, top first; false when a panel may not close now, which stops it with the rest still open. */
function closeAll(stack: { layer: Layer }[]): boolean {
  for (const { layer } of stack) {
    // A menu with levels closes them all with its first layer.
    if (!layers.includes(layer)) continue;
    if (!layer.canClose()) return false;
    layer.close();
  }
  return true;
}

function listen(): void {
  if (listening) return;
  listening = true;
  document.addEventListener("pointerdown", (event) => {
    const current = top();
    gesture = event.button === 0 && event.isPrimary !== false && current ? {
      pointer: event.pointerId, top: current.layer, down: event.target, swallow: false, void: false,
    } : null;
    if (!gesture || !current) return;
    const plan = planOf(event.target, event.target);
    // Nothing is taken from a press that reaches the page: its own mousedown and focus follow. A press on a scrim, or one
    // that a panel which may not close will refuse, keeps the focus where it is (and starts no selection) instead.
    if (plan.close.length && (plan.scrim || !plan.close.every(({ layer }) => layer.canClose()))) event.preventDefault();
  }, true);
  document.addEventListener("pointerup", (event) => {
    const press = gesture;
    if (!press || press.void) return;
    if (event.button !== 0 || event.pointerId !== press.pointer) { press.void = true; return; }
    const current = top();
    if (!current || current.layer !== press.top) return;
    const plan = planOf(press.down, event.target);
    if (!plan.close.length) return;
    // On a scrim the page never saw the press; anywhere else it reaches its target by itself.
    passing = !plan.scrim;
    let closed: boolean;
    try { closed = closeAll(plan.close); } finally { passing = false; }
    if (!closed || plan.scrim) {
      press.swallow = true;
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (closed && plan.deliver && plan.scrim) deliverBeneath(plan.scrim, event.clientX, event.clientY);
  }, true);
  const cancel = (): void => { if (gesture) gesture.void = true; };
  document.addEventListener("pointercancel", cancel, true);
  window.addEventListener("blur", cancel);
  document.addEventListener("keydown", () => { gesture = null; }, true);
  document.addEventListener("click", (event) => {
    if (delivering) return;
    const press = gesture;
    gesture = null;
    if (event.button !== 0) return;
    // A click that counts presses belongs to the pointer sequence just seen; one that counts none (a key, assistive
    // technology, code) has none, so a gesture left over from a click that never came is no business of it.
    if (event.detail !== 0) {
      if (press?.swallow) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    // A keyboard or assistive activation dismisses what it is outside of and then acts.
    const plan = planOf(event.target, event.target);
    if (!plan.close.length) return;
    // No pointer put the focus anywhere, so the panel gives it back to its opener as Escape does.
    if (!closeAll(plan.close)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  // A right click outside closes what is open and then opens the menu of what it pressed, if that has one (context-menu.ts).
  // Over a scrim the pressed thing is under it, so the right click is handed down the same way a left click is.
  document.addEventListener("contextmenu", (event) => {
    if (delivering || event.button !== 2) return;
    const plan = planOf(event.target, event.target);
    if (!plan.close.length) return;
    passing = !plan.scrim;
    let closed: boolean;
    try { closed = closeAll(plan.close); } finally { passing = false; }
    if (closed && !plan.scrim) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (closed && plan.deliver && plan.scrim) deliverBeneath(plan.scrim, event.clientX, event.clientY, "contextmenu");
  }, true);
}

/** Register a panel, or a getter when rendering replaces its DOM; dispose with its close/reset. */
export function registerDismissal(
  panel: HTMLElement | (() => HTMLElement | null), close: () => void,
  canClose: () => boolean = () => true, anchor?: HTMLElement,
): () => void {
  listen();
  const layer: Layer = { panel: typeof panel === "function" ? panel : () => panel, close, canClose, anchor };
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index !== -1) layers.splice(index, 1);
  };
}

/** Escape and focus handlers use the same layer order as outside presses. */
export const isTopLayer = (panel: HTMLElement | null): boolean => !!panel && top()?.panel === panel;
