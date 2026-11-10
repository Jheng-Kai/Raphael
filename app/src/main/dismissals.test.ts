// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { closeAndPress, registerDismissal } from "./dismissals";
import { openDialog } from "./member-dialogs";
import { closeMenu, openConfirmMenu, openMenu } from "./ui";

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
