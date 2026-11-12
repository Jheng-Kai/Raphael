// One outside-press policy for modal panels and their nested menus (R-UI-121).
//
// A press outside what is open closes it and is delivered to what was pressed, in the same press, as if nothing had been
// open (owner, 2026-11-11). Two shapes of outside, one rule:
//   - a menu or popover has nothing over the page: the press is simply not stopped, so the page element receives its own
//     pointerdown, focus and click, and the panel closes between pointerup and click;
//   - a scrim (a dialog, the settings window) sits over the page and catches the press: the panel closes and the press is spent
//     (owner, 2026-11-13: 「如果點 dialog 外面就是把 dialog 關掉就好，不用可以直接點到後面的東西」): nothing behind the scrim is pressed,
//     focused or right-clicked. Only a drawer's scrim (`closeAndPress`, the narrow sidebar and the details panel) hands the press down.
// A press that began inside, or a drag that ended outside, never closes or passes through.
// A panel that may not close right now (canClose) keeps the modal's old promise instead: the press is spent and goes nowhere.
//
// The control that opened a panel is a toggle (R-UI-124). Every panel records its opener when it registers: the control the
// last click activated (a menu item that opened it counts as the menu's own opener), kept as the element and, for a list that
// is drawn again, as a key that finds its twin. A press on that control closes the panel and does nothing else, wherever it
// lands: through a scrim, beside a popover, on the anchor of a menu, or as Enter / Space on the focused control.
interface Layer {
  panel(): HTMLElement | null;
  close(): void;
  canClose(): boolean;
  anchor?: HTMLElement;
  /** The control whose activation opened the panel, if one did. */
  opener?: Opener;
}
/** A control, and what finds it again when the page draws its list anew. */
interface Opener { el: Element; key: string }
const layers: Layer[] = [];

/** What can be activated: the nearest of these around a click is the control that was pressed. */
const CONTROL = 'button, a[href], summary, select, input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"], [role="button"], [role="menuitem"], [role="menuitemradio"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"], [role="radio"], [tabindex="0"]';
/** Fields that take typing: a click in one places a caret, it opens nothing. */
const TEXT_ENTRY = 'textarea, [contenteditable]:not([contenteditable="false"]), input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="color"])';
/** How long a click can be the cause of a panel that opens later (after a read, a redraw), with no input between. */
const ACTIVATION_MS = 10_000;
/** The click that is likely to be what opens the next panel: replaced by the next click, dropped by the next press or key. */
let activation: { opener: Opener; /** What a menu item that closed itself stands for. */ via?: Opener; at: number } | null = null;

/** What stays the same about a control when it is drawn again: its tag, id, data and label, or else its words and place. */
function keyOf(el: Element): string {
  const data = el.getAttributeNames().filter(name => name.startsWith("data-") && name !== "data-tooltip").sort();
  const label = el.getAttribute("aria-label");
  const parts = [el.localName, el.id, el.getAttribute("role") ?? "", ...data.map(name => `${name}=${el.getAttribute(name)}`), label ?? ""];
  if (!el.id && !data.length && !label) {
    const parent = el.parentElement;
    parts.push((el.textContent ?? "").trim().slice(0, 40), [...el.classList].join("."), parent ? `${parent.localName}.${parent.className}:${[...parent.children].indexOf(el)}` : "");
  }
  return parts.join("|");
}

/** Whether `target` is, or is inside, the control `opener` names: the element itself while it stands, else its twin in a new drawing. */
function isOpener(opener: Opener | undefined, target: EventTarget | null): boolean {
  if (!opener || !(target instanceof Element)) return false;
  if (opener.el.isConnected) return opener.el.contains(target);
  const control = target.closest(CONTROL);
  return !!control && keyOf(control) === opener.key;
}
const pressesOpener = (layer: Layer, down: EventTarget | null, up: EventTarget | null): boolean => isOpener(layer.opener, down) && isOpener(layer.opener, up);

/** True while the page presses a control on the person's behalf (a right click presses the row's ⋯): that control is no opener. */
let unopened = false;
/** Runs a press that stands for another gesture, so that the control it presses is not the opener of what it opens. */
export function pressWithoutOpener(press: () => void): void {
  unopened = true;
  try { press(); } finally { unopened = false; }
}

/** Remembers the control a click activated, for the panel that this click is about to open. */
function noteActivation(event: MouseEvent): void {
  if (unopened) { activation = null; return; }
  const target = event.target instanceof Element ? event.target : null;
  const control = target?.closest(CONTROL);
  // Ground, text and fields that take typing open nothing: a click there is no opener for what comes next.
  if (!target || !control || target.closest(TEXT_ENTRY)) { activation = null; return; }
  // A control in a menu that is open is gone once the menu has closed: the panel it opens belongs to the menu's own opener.
  const menu = [...layers].reverse().find(layer => layer.anchor && layer.panel()?.contains(target));
  activation = { opener: { el: control, key: keyOf(control) }, via: menu?.opener, at: performance.now() };
}
/** The opener for a panel that registers now: what was clicked a moment ago, unless that control went with a menu. */
function openerNow(): Opener | undefined {
  if (!activation || performance.now() - activation.at > ACTIVATION_MS) return undefined;
  return activation.opener.el.isConnected ? activation.opener : activation.via ?? activation.opener;
}
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
/** Enter or Space is down on the control that opened a panel and closed it: its activation, when it comes, is spent. */
let held: EventTarget | null = null;
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

/**
 * The open layers, top first, that neither end of a press is inside: what it dismisses. Stops at the first it is inside, which
 * is returned too: a press on the anchor of a menu is inside it, and is the opener's toggle when the anchor opened it.
 */
function outsideOf(down: EventTarget | null, up: EventTarget | null): { found: { layer: Layer; panel: HTMLElement }[]; stop: { layer: Layer; panel: HTMLElement } | null } {
  const found: { layer: Layer; panel: HTMLElement }[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const panel = layers[i].panel();
    if (!panel?.isConnected) continue;
    if (inside(layers[i], panel, down) || inside(layers[i], panel, up)) return { found, stop: { layer: layers[i], panel } };
    found.push({ layer: layers[i], panel });
  }
  return { found, stop: null };
}

interface Plan {
  /** What the press closes, top first. */
  close: { layer: Layer; panel: HTMLElement }[];
  /** The scrim of a panel that the press landed on, if any. */
  scrim: HTMLElement | null;
  /** The press is on the control that opened a panel it closes: it only closes, and its click is spent. */
  onOpener: boolean;
}

/**
 * A scrim hides everything under it, so a press on one is spent on the panels above that scrim, one layer of menus per
 * press, and never reaches the page: a menu open over a dialog is closed first, and the dialog by the next press. A press on no scrim (a menu over the page, a control beside the panel) closes every panel it is
 * outside of and reaches its target itself, unless that target opened one of them: then it only closes (R-UI-124).
 */
function planOf(down: EventTarget | null, up: EventTarget | null, activating = true): Plan {
  const { found: stack, stop } = outsideOf(down, up);
  const modal = stack.findIndex(({ panel }) => isBackdrop(up, panel));
  if (modal === -1) {
    // The press stopped at a layer it is on the anchor of: when that anchor opened it, the press closes it as well.
    // The caption's buttons are the window's own and never close or toggle anything (R-MP-04).
    const caption = (target: EventTarget | null): boolean => target instanceof Element && !!target.closest("#window-chrome");
    // A right click activates nothing, so it never toggles.
    const toggled = activating && stop && !caption(down) && !caption(up) && !stop.panel.contains(down as Node) && !stop.panel.contains(up as Node) && pressesOpener(stop.layer, down, up) ? [stop] : [];
    const close = [...stack, ...toggled];
    return { close, scrim: null, onOpener: close.some(({ layer }) => pressesOpener(layer, down, up)) };
  }
  return { close: stack.slice(0, Math.max(1, modal)), scrim: up as HTMLElement, onOpener: false };
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
function deliverBeneath(backdrop: HTMLElement, x: number, y: number, type: "click" | "contextmenu" = "click", closed: readonly (Opener | undefined)[] = []): boolean {
  if (delivering) return false;
  const below = elementBeneath(backdrop, x, y);
  if (!below || below === document.body || below === document.documentElement || below.closest("[inert]")) return false;
  // The control that opened what has just closed is not pressed again: it opened the panel, this press closes it (R-UI-124).
  if (type === "click" && closed.some(opener => isOpener(opener, below))) return false;
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
 * `close` it, then give the press to what was under it. A click with no pointer behind it (a key) only closes. The control
 * that opened the panel (`opener`, when it is one the page can name) is not pressed again by the press that closes it.
 */
export function closeAndPress(event: MouseEvent, backdrop: HTMLElement, close: () => void, opener?: Element | null): void {
  if (delivering) return;
  passing = true;
  try { close(); } finally { passing = false; }
  if (event.target === backdrop && event.detail !== 0) deliverBeneath(backdrop, event.clientX, event.clientY, "click", [opener ? { el: opener, key: keyOf(opener) } : undefined]);
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

/**
 * A frame is another document (a page open in the conversation's place, a computer's screen): a press inside it gives this
 * document no pointer event at all, only the loss of the focus to that frame. That is the outside press, so every panel the
 * frame is outside of closes, and the frame keeps the press and the focus it took (R-UI-121; owner, 2026-11-12: the model
 * card stayed open over a page until the sidebar was pressed). The pointer must be over the frame: a frame that takes the
 * focus by itself, or by the Tab key, has not been pressed, and a frame under a scrim cannot be.
 */
function pressedIntoFrame(): void {
  const frame = document.activeElement;
  if (!(frame instanceof HTMLIFrameElement) || !top()) return;
  let under = false;
  try { under = frame.matches(":hover"); } catch { /* A document without pointer state has no press to speak of. */ }
  if (!under) return;
  const { found } = outsideOf(frame, frame);
  if (!found.length) return;
  passing = true;
  try { closeAll(found); } finally { passing = false; }
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
    } else if (plan.onOpener) {
      // The press went to the control that opened the panel: it closed it, and its click is not the control's to act on.
      press.swallow = true;
    }
  }, true);
  const cancel = (): void => { if (gesture) gesture.void = true; };
  document.addEventListener("pointercancel", cancel, true);
  // The focus is read once the blur has settled: only then does the document name the frame that took it.
  window.addEventListener("blur", () => { cancel(); setTimeout(pressedIntoFrame); });
  document.addEventListener("pointerdown", () => { activation = null; held = null; }, true);
  document.addEventListener("keydown", (event) => {
    gesture = null;
    if (!event.repeat) held = null;
    if (event.key !== "Enter" && event.key !== " ") { activation = null; held = null; return; }
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    // Enter or Space on the control that opened a panel closes it now (Space would otherwise act at the key's release, after
    // the panel has already gone, and open it again), and the activation that follows is spent.
    const plan = planOf(event.target, event.target);
    if (plan.onOpener && !plan.scrim) {
      held = event.target;
      closeAll(plan.close);
    }
  }, true);
  document.addEventListener("keyup", () => setTimeout(() => { held = null; }), true);
  document.addEventListener("click", (event) => {
    if (delivering) { noteActivation(event); return; }
    const press = gesture;
    gesture = null;
    if (event.button !== 0) return;
    // A click that counts presses belongs to the pointer sequence just seen; one that counts none (a key, assistive
    // technology, code) has none, so a gesture left over from a click that never came is no business of it.
    if (event.detail !== 0) {
      if (press?.swallow) { event.preventDefault(); event.stopImmediatePropagation(); activation = null; return; }
      noteActivation(event);
      return;
    }
    // The activation that follows Enter or Space on an opener that has just closed its panel is spent.
    if (held && event.target instanceof Node && held instanceof Node && held.contains(event.target)) {
      event.preventDefault(); event.stopImmediatePropagation(); activation = null;
      return;
    }
    // A keyboard or assistive activation dismisses what it is outside of and then acts, unless it is the opener's own.
    const plan = planOf(event.target, event.target);
    if (plan.close.length) {
      // No pointer put the focus anywhere, so the panel gives it back to its opener as Escape does.
      if (!closeAll(plan.close) || plan.onOpener) { event.preventDefault(); event.stopImmediatePropagation(); activation = null; return; }
    }
    noteActivation(event);
  }, true);
  // A right click outside closes what is open and then opens the menu of what it pressed, if that has one (context-menu.ts).
  document.addEventListener("contextmenu", (event) => {
    if (delivering || event.button !== 2) return;
    const plan = planOf(event.target, event.target, false);
    if (!plan.close.length) return;
    passing = !plan.scrim;
    let closed: boolean;
    try { closed = closeAll(plan.close); } finally { passing = false; }
    if (closed && !plan.scrim) return;
    // Over a scrim the right click closes the dialog and is spent, as a left press is.
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

/** Register a panel, or a getter when rendering replaces its DOM; dispose with its close/reset. */
export function registerDismissal(
  panel: HTMLElement | (() => HTMLElement | null), close: () => void,
  canClose: () => boolean = () => true, anchor?: HTMLElement,
): () => void {
  listen();
  // Whatever opens a panel is its opener: the control the last click activated, nothing when the panel came without one (a key, a timer).
  const layer: Layer = { panel: typeof panel === "function" ? panel : () => panel, close, canClose, anchor, opener: openerNow() };
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index !== -1) layers.splice(index, 1);
  };
}

// The clicks that open panels come before the first panel does, so the page is listened to from the start.
if (typeof document !== "undefined") listen();

/** Escape and focus handlers use the same layer order as outside presses. */
export const isTopLayer = (panel: HTMLElement | null): boolean => !!panel && top()?.panel === panel;
