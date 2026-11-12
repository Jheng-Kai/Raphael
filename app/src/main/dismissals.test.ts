// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { closeAndPress, registerDismissal } from "./dismissals";
import { openDialog } from "./member-dialogs";
import { closeMenu, openConfirmMenu, openMenu, pressOverflow } from "./ui";

const disposers: (() => void)[] = [];
afterEach(() => {
  closeMenu();
  for (const dispose of disposers.splice(0)) dispose();
  document.body.innerHTML = "";
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

test("caption buttons and dragging bypass outside dismissal on their first activation", () => {
  document.body.innerHTML = '<header id="window-chrome"><button>Minimize</button><div data-window-drag></div></header><section></section>';
  const close = vi.fn(), act = vi.fn(), panel = document.querySelector("section")!;
  const dispose = registerDismissal(panel, close);
  for (const target of document.querySelectorAll("#window-chrome > *")) {
    target.addEventListener("click", act);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }
  expect(close).not.toHaveBeenCalled();
  expect(act).toHaveBeenCalledTimes(2);
  document.body.click();
  expect(close).toHaveBeenCalledOnce();
  dispose();
});

// ---------- R-UI-121: a press outside closes what is open and goes on to what it pressed ----------

/** A press the way the browser makes it: down, up, then the click on what both ends share. */
function press(start: Element, end: Element = start, o: { button?: number; x?: number; y?: number } = {}): { down: PointerEvent; up: PointerEvent; click: MouseEvent } {
  const init = { bubbles: true, cancelable: true, button: o.button ?? 0, pointerId: 1, isPrimary: true, clientX: o.x ?? 5, clientY: o.y ?? 5 };
  const down = new PointerEvent("pointerdown", init), up = new PointerEvent("pointerup", init);
  start.dispatchEvent(down);
  end.dispatchEvent(up);
  const click = new MouseEvent("click", { ...init, detail: 1 });
  (start === end ? end : document.body).dispatchEvent(click);
  return { down, up, click };
}
/** Whatever is under the pointer once the scrim stops catching it; `seen` records how the scrim was set for the look. */
function pointerOver(target: Element | null, scrim: HTMLElement): { seen: string[] } {
  const seen: string[] = [];
  (document as { elementFromPoint?: unknown }).elementFromPoint = () => { seen.push(scrim.style.pointerEvents); return target; };
  return { seen };
}
function scrimWith(close: () => void, canClose?: () => boolean): { scrim: HTMLElement; panel: HTMLElement } {
  const scrim = document.createElement("div"), panel = document.createElement("section");
  scrim.className = "mb-scrim"; panel.innerHTML = '<button id="in">Inside</button>'; scrim.append(panel); document.body.append(scrim);
  const stop = registerDismissal(panel, () => { stop(); scrim.remove(); close(); }, canClose);
  disposers.push(stop);
  return { scrim, panel };
}

test("a press on a control outside an open popover closes it and the control's handler runs once, with the focus on it", () => {
  const anchor = document.createElement("button"), other = document.createElement("button"), act = vi.fn();
  document.body.append(anchor, other);
  other.addEventListener("click", act);
  other.addEventListener("pointerdown", () => other.focus());
  openMenu(anchor, [{ value: "a", label: "A" }], "a", () => {});
  expect(document.getElementById("app-popover")).not.toBeNull();
  const { down, up, click } = press(other);
  expect(document.getElementById("app-popover")).toBeNull();
  expect(act).toHaveBeenCalledTimes(1);
  // Nothing is stopped: the page sees the whole press, and the focus is the pressed control's, not the opener's.
  expect(down.defaultPrevented || up.defaultPrevented || click.defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(other);
});

test("a press on a scrim over a control closes the dialog and activates that control once", () => {
  const button = document.createElement("button"), act = vi.fn(), close = vi.fn();
  document.body.append(button); button.addEventListener("click", act);
  const { scrim } = scrimWith(close);
  const over = pointerOver(button, scrim);
  const { up } = press(scrim, scrim, { x: 30, y: 40 });
  expect(close).toHaveBeenCalledTimes(1);
  expect(act).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(button);
  // The scrim was out of the way for the look under it, and its own press is spent.
  expect(over.seen).toEqual(["none"]);
  expect(up.defaultPrevented).toBe(true);
  expect(act.mock.calls[0]![0]).toMatchObject({ clientX: 30, clientY: 40, detail: 1, bubbles: true });
});

test("a delegated handler above the pressed element hears the delivered click", () => {
  const list = document.createElement("div"), row = document.createElement("span"), heard = vi.fn();
  list.append(row); document.body.append(list); list.addEventListener("click", event => heard(event.target));
  const { scrim } = scrimWith(() => {});
  pointerOver(row, scrim);
  press(scrim);
  expect(heard).toHaveBeenCalledWith(row);
});

test("a press on bare scrim only closes: nothing is pressed under it", () => {
  const act = vi.fn(), close = vi.fn();
  document.body.addEventListener("click", act);
  const { scrim } = scrimWith(close);
  pointerOver(document.body, scrim);
  press(scrim);
  expect(close).toHaveBeenCalledTimes(1);
  // Only the press's own click reached the body, and it was swallowed on the way.
  expect(act).not.toHaveBeenCalled();
  document.body.removeEventListener("click", act);
});

test("a press inside, a drag that began inside, and one that began on the scrim and ended inside, leave it open and press nothing", () => {
  const button = document.createElement("button"), act = vi.fn(), close = vi.fn();
  document.body.append(button); button.addEventListener("click", act);
  const { scrim, panel } = scrimWith(close);
  const over = pointerOver(button, scrim);
  press(panel.querySelector("#in")!);
  press(panel.querySelector("#in")!, scrim);
  press(scrim, panel.querySelector("#in")!);
  expect(close).not.toHaveBeenCalled();
  expect(act).not.toHaveBeenCalled();
  expect(over.seen).toEqual([]);
});

test("a drag from the scrim to a control beyond it closes the dialog, and the browser's click lands on their shared ancestor, not the control", () => {
  const button = document.createElement("button"), act = vi.fn();
  document.body.append(button); button.addEventListener("click", act);
  const { scrim } = scrimWith(() => {});
  pointerOver(button, scrim);
  press(scrim, button);
  expect(act).toHaveBeenCalledTimes(0);
  // The browser's click for it lands on the shared ancestor, which is not a control: nothing to double.
  expect(scrim.isConnected).toBe(false);
});

test("a stacked dialog gives the press to what is under the top one only when nothing else is open", () => {
  const first = vi.fn(), second = vi.fn(), action = vi.fn();
  const lower = scrimWith(second), upper = scrimWith(first);
  lower.panel.querySelector("#in")!.addEventListener("click", action);
  pointerOver(lower.panel.querySelector("#in"), upper.scrim);
  press(upper.scrim);
  // The lower dialog's scrim is still over the page, so the press is spent on the top one.
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  expect(action).not.toHaveBeenCalled();
});

test("a menu open over a dialog is closed first and the press goes no further, the next press closes the dialog and goes on", () => {
  const button = document.createElement("button"), act = vi.fn(), close = vi.fn();
  document.body.append(button); button.addEventListener("click", act);
  const { scrim, panel } = scrimWith(close);
  const anchor = panel.querySelector<HTMLElement>("#in")!;
  openMenu(anchor, [{ value: "a", label: "A" }], "a", () => {});
  pointerOver(button, scrim);
  press(scrim);
  expect(document.getElementById("app-popover")).toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(act).not.toHaveBeenCalled();
  press(scrim);
  expect(close).toHaveBeenCalledTimes(1);
  expect(act).toHaveBeenCalledTimes(1);
});

test("a panel that may not close keeps its old promise: the press is spent and nothing is pressed", () => {
  const button = document.createElement("button"), act = vi.fn(), close = vi.fn();
  document.body.append(button); button.addEventListener("click", act);
  const { scrim } = scrimWith(close, () => false);
  pointerOver(button, scrim);
  const { down, click } = press(scrim);
  expect(close).not.toHaveBeenCalled();
  expect(act).not.toHaveBeenCalled();
  expect(down.defaultPrevented).toBe(true);
  expect(click.defaultPrevented).toBe(true);
});

test("a panel that may not close also stops a press on a control beside it", () => {
  const plain = document.createElement("section"), outside = document.createElement("button"), pressed = vi.fn(), refuse = vi.fn();
  document.body.append(plain, outside); outside.addEventListener("click", pressed);
  disposers.push(registerDismissal(plain, refuse, () => false));
  press(outside);
  expect(refuse).not.toHaveBeenCalled();
  expect(pressed).not.toHaveBeenCalled();
});

test("an inert thing under the pointer is not pressed", () => {
  const shell = document.createElement("div"), button = document.createElement("button"), act = vi.fn();
  shell.setAttribute("inert", ""); shell.append(button); document.body.append(shell); button.addEventListener("click", act);
  const { scrim } = scrimWith(() => {});
  pointerOver(button, scrim);
  press(scrim);
  expect(act).not.toHaveBeenCalled();
});

test("a right click outside closes the popover and still opens the menu of what it pressed", () => {
  const anchor = document.createElement("button"), row = document.createElement("div"), opened = vi.fn();
  document.body.append(anchor, row); row.addEventListener("contextmenu", opened);
  openMenu(anchor, [{ value: "a", label: "A" }], "a", () => {});
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 9, clientY: 9 });
  row.dispatchEvent(event);
  expect(document.getElementById("app-popover")).toBeNull();
  expect(opened).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(false);
});

test("a right click on a scrim closes the dialog and hands the right click to what is under it", () => {
  const row = document.createElement("div"), opened = vi.fn(), close = vi.fn();
  document.body.append(row); row.addEventListener("contextmenu", opened);
  const { scrim } = scrimWith(close);
  pointerOver(row, scrim);
  scrim.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 12, clientY: 14 }));
  expect(close).toHaveBeenCalledTimes(1);
  expect(opened).toHaveBeenCalledTimes(1);
  expect(opened.mock.calls[0]![0]).toMatchObject({ clientX: 12, clientY: 14, button: 2 });
});

test("a press outside an 'are you sure' step abandons it and goes on to what it pressed", () => {
  const anchor = document.createElement("button"), other = document.createElement("button"), act = vi.fn(), run = vi.fn();
  document.body.append(anchor, other); other.addEventListener("click", act);
  openConfirmMenu(anchor, { label: "Delete", ask: "Really?", run });
  const item = document.querySelector<HTMLElement>("[data-confirm-item]")!;
  item.click();
  expect(item.textContent).toContain("Really?");
  press(other);
  expect(document.getElementById("app-popover")).toBeNull();
  expect(run).not.toHaveBeenCalled();
  expect(act).toHaveBeenCalledTimes(1);
});

test("a dialog's scrim hands the press to a control beside it, the way the sidebar's member is pressed", () => {
  const member = document.createElement("button"), pick = vi.fn(), after = vi.fn();
  document.body.append(member); member.addEventListener("click", pick);
  const dialog = openDialog({ title: "Dialog", body: "<input>", actions: {}, onAct: () => {}, onClose: after });
  const scrim = dialog.el.parentElement as HTMLElement;
  pointerOver(member, scrim);
  press(scrim);
  expect(dialog.el.isConnected).toBe(false);
  expect(after).toHaveBeenCalledTimes(1);
  expect(pick).toHaveBeenCalledTimes(1);
  expect(document.activeElement).toBe(member);
});

// ---------- R-UI-124: the control that opened a panel is its toggle ----------

/** A control that opens a scrim dialog when pressed; `opened` counts the times it did. */
function dialogOpener(): { button: HTMLButtonElement; opened: ReturnType<typeof vi.fn>; closed: ReturnType<typeof vi.fn>; scrim(): HTMLElement } {
  const button = document.createElement("button"), opened = vi.fn(), closed = vi.fn();
  button.id = "opener"; document.body.append(button);
  let scrim: HTMLElement | null = null;
  button.addEventListener("click", () => { opened(); scrim = scrimWith(closed).scrim; });
  return { button, opened, closed, scrim: () => scrim! };
}
/** The key's own events, in the order a browser sends them: Enter acts at once, Space when it is let go. */
function keyPress(target: Element, key: "Enter" | " "): { click: MouseEvent } {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key }));
  if (key === "Enter") {
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 });
    target.dispatchEvent(click);
    target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key }));
    return { click };
  }
  target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key }));
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 });
  target.dispatchEvent(click);
  return { click };
}

test("a press on the control that opened a dialog closes it through the scrim and does not open it again", () => {
  const { button, opened, closed, scrim } = dialogOpener();
  press(button);
  expect(opened).toHaveBeenCalledTimes(1);
  const over = pointerOver(button, scrim());
  press(scrim());
  expect(closed).toHaveBeenCalledTimes(1);
  expect(scrim().isConnected).toBe(false);
  // The opener lay under the scrim and was found there, and not pressed: it is the dialog's toggle.
  expect(over.seen).toEqual(["none"]);
  expect(opened).toHaveBeenCalledTimes(1);
  // With nothing open any more it opens again, as a control does.
  press(button);
  expect(opened).toHaveBeenCalledTimes(2);
});

test("a press through a scrim still reaches every control that did not open the dialog", () => {
  const { button, opened, closed, scrim } = dialogOpener();
  const other = document.createElement("button"), act = vi.fn();
  document.body.append(other); other.addEventListener("click", act);
  press(button);
  pointerOver(other, scrim());
  press(scrim());
  expect(closed).toHaveBeenCalledTimes(1);
  expect(act).toHaveBeenCalledTimes(1);
  expect(opened).toHaveBeenCalledTimes(1);
});

test("an opener that the page drew again is still the opener: its twin is not pressed either", () => {
  const list = document.createElement("div");
  list.innerHTML = '<button type="button" data-k="more:2" aria-label="More">...</button>';
  document.body.append(list);
  const opened = vi.fn(), closed = vi.fn(), made: { scrim?: HTMLElement } = {};
  list.addEventListener("click", event => { if ((event.target as Element).closest("[data-k]")) { opened(); made.scrim = scrimWith(closed).scrim; } });
  press(list.querySelector("button")!);
  // The list is drawn anew while the dialog is open.
  list.innerHTML = '<button type="button" data-k="more:2" aria-label="More">...</button><button type="button" data-k="more:3" aria-label="More">...</button>';
  const scrim = made.scrim!;
  const over = pointerOver(list.querySelector('[data-k="more:2"]'), scrim);
  press(scrim);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(opened).toHaveBeenCalledTimes(1);
  expect(over.seen).toEqual(["none"]);
  // The row beside it is another control, and is pressed as always.
  const second = scrimWith(vi.fn());
  pointerOver(list.querySelector('[data-k="more:3"]'), second.scrim);
  press(second.scrim);
  expect(opened).toHaveBeenCalledTimes(2);
});

test("a menu's anchor is the menu's toggle: the second press closes it and the first press opened it once", () => {
  const anchor = document.createElement("button"), opened = vi.fn();
  document.body.append(anchor);
  anchor.addEventListener("click", () => { opened(); openMenu(anchor, [{ value: "a", label: "A" }], "a", () => {}); });
  press(anchor);
  expect(document.getElementById("app-popover")).not.toBeNull();
  const second = press(anchor);
  expect(document.getElementById("app-popover")).toBeNull();
  expect(opened).toHaveBeenCalledTimes(1);
  expect(second.click.defaultPrevented).toBe(true);
  expect(anchor.getAttribute("aria-expanded")).toBe("false");
  press(anchor);
  expect(opened).toHaveBeenCalledTimes(2);
  expect(document.getElementById("app-popover")).not.toBeNull();
});

test("a right click on a menu's anchor activates nothing: the menu stays open", () => {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  anchor.addEventListener("click", () => openMenu(anchor, [{ value: "a", label: "A" }], "a", () => {}));
  press(anchor);
  anchor.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 9, clientY: 9 }));
  expect(document.getElementById("app-popover")).not.toBeNull();
});

test("a control beside a popover that opened it, and is not its anchor, toggles it too", () => {
  const field = document.createElement("input"), plus = document.createElement("button"), other = document.createElement("button");
  const opened = vi.fn(), act = vi.fn();
  document.body.append(field, plus, other); other.addEventListener("click", act);
  plus.addEventListener("click", () => { opened(); openMenu(field, [{ value: "a", label: "A" }], "a", () => {}); });
  press(plus);
  expect(document.getElementById("app-popover")).not.toBeNull();
  press(plus);
  expect(document.getElementById("app-popover")).toBeNull();
  expect(opened).toHaveBeenCalledTimes(1);
  // Any other control is pressed through as before.
  press(plus);
  press(other);
  expect(document.getElementById("app-popover")).toBeNull();
  expect(act).toHaveBeenCalledTimes(1);
});

test("a press in a field the menu is anchored to leaves the menu open: a caret is not an opener", () => {
  const field = document.createElement("textarea");
  document.body.append(field);
  press(field);
  openMenu(field, [{ value: "a", label: "A" }], "a", () => {});
  press(field);
  expect(document.getElementById("app-popover")).not.toBeNull();
});

test("Enter and Space on the focused opener close its menu and leave it closed", () => {
  const anchor = document.createElement("button"), opened = vi.fn();
  document.body.append(anchor);
  anchor.addEventListener("click", () => { opened(); openMenu(anchor, [{ value: "a", label: "A" }], "a", () => {}); });
  for (const key of ["Enter", " "] as const) {
    anchor.focus();
    keyPress(anchor, key);
    expect(document.getElementById("app-popover")).not.toBeNull();
    const second = keyPress(anchor, key);
    expect(document.getElementById("app-popover")).toBeNull();
    expect(second.click.defaultPrevented).toBe(true);
  }
  expect(opened).toHaveBeenCalledTimes(2);
  // Escape is unchanged: it closes and gives the focus back.
  anchor.focus(); keyPress(anchor, "Enter");
  anchor.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }));
  expect(document.getElementById("app-popover")).toBeNull();
  expect(document.activeElement).toBe(anchor);
  expect(opened).toHaveBeenCalledTimes(3);
});

test("Enter on the control that opened a dialog closes the dialog and does not open it again", () => {
  const { button, opened, closed } = dialogOpener();
  button.focus();
  keyPress(button, "Enter");
  expect(opened).toHaveBeenCalledTimes(1);
  keyPress(button, "Enter");
  expect(closed).toHaveBeenCalledTimes(1);
  expect(opened).toHaveBeenCalledTimes(1);
});

test("a dialog opened from a menu item is opened by the menu's own opener", () => {
  const more = document.createElement("button"), opened = vi.fn(), closed = vi.fn();
  document.body.append(more);
  const made: { scrim?: HTMLElement } = {};
  more.addEventListener("click", () => {
    opened();
    openMenu(more, [{ value: "delete", label: "Delete" }], "", () => { made.scrim = scrimWith(closed).scrim; });
  });
  press(more);
  press(document.querySelector<HTMLElement>('#app-popover [data-value="delete"]')!);
  const scrim = made.scrim!;
  expect(scrim.isConnected).toBe(true);
  pointerOver(more, scrim);
  press(scrim);
  expect(closed).toHaveBeenCalledTimes(1);
  expect(opened).toHaveBeenCalledTimes(1);
  expect(document.getElementById("app-popover")).toBeNull();
});

test("a left press on the row whose right click opened a menu closes it and presses the row", () => {
  const row = document.createElement("div"), body = document.createElement("button"), more = document.createElement("button"), act = vi.fn();
  more.setAttribute("data-overflow", ""); more.dataset.k = "row-more:1";
  row.append(body, more); document.body.append(row);
  body.addEventListener("click", act);
  more.addEventListener("click", () => openMenu(more, [{ value: "a", label: "A" }], "a", () => {}));
  pressOverflow(more, { x: 12, y: 14 });
  expect(document.getElementById("app-popover")).not.toBeNull();
  press(body);
  expect(document.getElementById("app-popover")).toBeNull();
  // The row is what the press was for: it is not the control that opened the menu.
  expect(act).toHaveBeenCalledTimes(1);
});

test("closeAndPress does not press the control that opened the drawer, and presses any other", () => {
  const scrim = document.createElement("div"), trigger = document.createElement("button"), member = document.createElement("button");
  const closed = vi.fn(), pressed = vi.fn(), other = vi.fn();
  document.body.append(trigger, member, scrim); trigger.addEventListener("click", pressed); member.addEventListener("click", other);
  scrim.addEventListener("click", event => closeAndPress(event, scrim, closed, trigger));
  pointerOver(trigger, scrim);
  press(scrim, scrim, { x: 4, y: 6 });
  expect(closed).toHaveBeenCalledTimes(1);
  expect(pressed).not.toHaveBeenCalled();
  pointerOver(member, scrim);
  press(scrim);
  expect(closed).toHaveBeenCalledTimes(2);
  expect(other).toHaveBeenCalledTimes(1);
});

test("closeAndPress closes a drawer's scrim and presses what was under it, but a key only closes", () => {
  const scrim = document.createElement("div"), member = document.createElement("button"), act = vi.fn(), close = vi.fn();
  document.body.append(member, scrim); member.addEventListener("click", act);
  pointerOver(member, scrim);
  scrim.addEventListener("click", event => closeAndPress(event, scrim, close));
  press(scrim, scrim, { x: 4, y: 6 });
  expect(close).toHaveBeenCalledTimes(1);
  expect(act).toHaveBeenCalledTimes(1);
  scrim.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
  expect(close).toHaveBeenCalledTimes(2);
  expect(act).toHaveBeenCalledTimes(1);
});

// ---------- A frame is another document: the app sees no pointer event of a press inside it, only the focus going there ----------

/** What the browser does when a frame is pressed: the frame takes the focus, the pointer is over it, and the window blurs. */
async function pressFrame(frame: HTMLIFrameElement, pointerOverIt = true): Promise<void> {
  const matches = frame.matches.bind(frame);
  (frame as { matches(selector: string): boolean }).matches = selector => selector === ":hover" ? pointerOverIt : matches(selector);
  Object.defineProperty(document, "activeElement", { configurable: true, get: () => frame });
  try {
    window.dispatchEvent(new Event("blur"));
    await new Promise(resolve => setTimeout(resolve, 5));
  } finally {
    delete (document as { activeElement?: unknown }).activeElement;
  }
}

test("a press inside a frame closes every panel the frame is outside of, and the frame keeps the focus", async () => {
  document.body.innerHTML = '<button id="model">Model</button><section id="card"></section><section id="sub"></section><iframe id="page"></iframe>';
  const frame = document.querySelector<HTMLIFrameElement>("#page")!, focus = vi.fn();
  const closeCard = vi.fn(), closeSub = vi.fn();
  document.querySelector<HTMLElement>("#model")!.addEventListener("focus", focus);
  disposers.push(registerDismissal(document.querySelector<HTMLElement>("#card")!, closeCard), registerDismissal(document.querySelector<HTMLElement>("#sub")!, closeSub));
  await pressFrame(frame);
  expect(closeSub).toHaveBeenCalledOnce();
  expect(closeCard).toHaveBeenCalledOnce();
  // Nothing is handed back to the control that opened the card: the page has the press.
  expect(focus).not.toHaveBeenCalled();
});

test("a frame that takes the focus with no pointer over it, or that stands inside the open panel, closes nothing", async () => {
  document.body.innerHTML = '<section id="card"><iframe id="inner"></iframe></section><iframe id="page"></iframe>';
  const close = vi.fn(), refuse = vi.fn();
  disposers.push(registerDismissal(document.querySelector<HTMLElement>("#card")!, close));
  // The focus went into the frame by itself (a page that focuses a field, the Tab key): nobody pressed it.
  await pressFrame(document.querySelector<HTMLIFrameElement>("#page")!, false);
  expect(close).not.toHaveBeenCalled();
  // A frame that is part of what is open is inside it.
  await pressFrame(document.querySelector<HTMLIFrameElement>("#inner")!);
  expect(close).not.toHaveBeenCalled();
  // The window losing the focus to another program is no press either.
  window.dispatchEvent(new Event("blur"));
  await new Promise(resolve => setTimeout(resolve, 5));
  expect(close).not.toHaveBeenCalled();
  // A panel that may not close now stays, as for any outside press.
  disposers.push(registerDismissal(document.createElement("section"), refuse, () => false));
  await pressFrame(document.querySelector<HTMLIFrameElement>("#page")!);
  expect(refuse).not.toHaveBeenCalled();
});
