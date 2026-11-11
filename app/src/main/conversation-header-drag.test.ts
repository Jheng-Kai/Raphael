// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { installWindowChrome, type WindowChromeWindow } from "./window-chrome";

// A conversation's header is the window's top row (R-TOP-01): its empty parts move the window and maximise it as the strip does, and
// the pill and the round buttons in it still press.
const header = `<section class="mb-chat"><div class="page-head mb-head" data-window-drag>` +
  `<span class="mb-head-l"><button type="button" class="btn icon" id="search"></button></span>` +
  `<span class="mb-head-c"><button type="button" class="btn conversation-trigger" id="pill"><span class="mb-pill" id="name">Name</span></button></span>` +
  `<div class="ra-tools"><button type="button" class="btn icon" id="share"></button></div></div></section>`;

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ""; });

test("the empty parts of a conversation's header move the window and a double press maximises it once, while its pill and buttons are not taken", async () => {
  document.body.innerHTML = header;
  const calls: string[] = [];
  let maximized = false;
  const window: WindowChromeWindow = {
    minimize: async () => { calls.push("minimize"); },
    toggleMaximize: async () => { calls.push("maximize"); maximized = !maximized; },
    close: async () => { calls.push("close"); },
    startDragging: async () => { calls.push("drag"); },
    startResizeDragging: async () => { calls.push("resize"); },
    isMaximized: async () => maximized,
    onResized: async () => () => {},
  };
  dispose = installWindowChrome(document, window, () => {}, () => {});
  const press = (type: string, element: Element, detail = 1): MouseEvent => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, detail });
    element.dispatchEvent(event);
    return event;
  };
  const head = document.querySelector<HTMLElement>(".mb-head")!;
  // The pill (a button, and what stands in it) and the round buttons are left to press.
  for (const id of ["search", "pill", "name", "share"]) expect(press("mousedown", document.getElementById(id)!).defaultPrevented, id).toBe(false);
  expect(calls).toEqual([]);
  // What is empty moves the window: the header itself, and the spans that hold the buttons.
  expect(press("mousedown", head).defaultPrevented).toBe(true);
  press("mousedown", document.querySelector(".mb-head-l")!);
  press("mousedown", document.querySelector(".ra-tools")!);
  expect(calls).toEqual(["drag", "drag", "drag"]);
  // A double press maximises once, even when the native drag also answers the second press.
  calls.length = 0;
  press("mousedown", head, 1);
  press("mousedown", head, 2);
  press("dblclick", head, 2);
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  expect(calls.filter(call => call === "maximize")).toHaveLength(1);
});
