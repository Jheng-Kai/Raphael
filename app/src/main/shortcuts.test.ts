// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { openCommandPalette, shortcut } from "./shortcuts";
import { closeMenu } from "./ui";

afterEach(() => { closeMenu(); document.body.innerHTML = ""; });

function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event); return shortcut(event);
}

test.each(["input", "textarea", "select", "div[contenteditable]", "div[role=textbox]"])("typing in %s only permits the palette shortcut", selector => {
  const field = document.createElement(selector.split("[")[0]);
  if (selector.includes("contenteditable")) field.setAttribute("contenteditable", "");
  if (selector.includes("role=")) field.setAttribute("role", "textbox");
  document.body.append(field);
  expect(press(field, "k")).toBe("palette");
  for (const key of ["f", "b", "n", "1"]) expect(press(field, key)).toBeNull();
  expect(press(field, "F", { shiftKey: true })).toBeNull();
  expect(press(field, "ArrowDown", { ctrlKey: false, altKey: true })).toBeNull();
});

test("shortcut modifiers, IME, repeats and modal ownership are respected", () => {
  const body = document.body;
  expect(press(body, "f")).toBe("find");
  expect(press(body, "F", { shiftKey: true })).toBe("search");
  expect(press(body, "9")).toBe("member:9");
  expect(press(body, "b")).toBe("sidebar");
  expect(press(body, "ArrowUp", { ctrlKey: false, altKey: true })).toBe("previous");
  expect(press(body, "ArrowDown", { ctrlKey: false, altKey: true })).toBe("next");
  for (const options of [{ isComposing: true }, { repeat: true }, { altKey: true }, { metaKey: true }]) expect(press(body, "k", options)).toBeNull();
  body.innerHTML = '<div role="dialog"></div>';
  expect(press(body, "b")).toBeNull();
  expect(press(body, "k")).toBeNull();
});

test("mounted hidden settings do not block shortcuts but an open modal owns them", () => {
  document.body.innerHTML = '<div class="modal-scrim" hidden><div role="dialog"></div></div>';
  expect(press(document.body, "k")).toBe("palette");
  expect(press(document.body, "f")).toBe("find");
  document.querySelector<HTMLElement>(".modal-scrim")!.hidden = false;
  expect(press(document.body, "k")).toBeNull();
  expect(press(document.body, "f")).toBeNull();
});

test("palette filters escaped labels, executes once by Enter and dismisses through shared Escape", () => {
  const anchor = document.createElement("button"); document.body.append(anchor); anchor.focus();
  const run = vi.fn();
  openCommandPalette(anchor, [{ id: "find", label: "Find <files>", keys: "Ctrl+F", run }, { id: "home", label: "Home", run: vi.fn() }]);
  const input = document.querySelector<HTMLInputElement>('[data-command-palette] input')!;
  expect(document.activeElement).toBe(input);
  expect(press(input, "k")).toBe("palette");
  expect(document.querySelector("files")).toBeNull();
  input.value = "files"; input.dispatchEvent(new Event("input"));
  expect(document.querySelectorAll("[data-command]")).toHaveLength(1);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  expect(run).toHaveBeenCalledTimes(1);
  expect(document.querySelector("#app-popover")).toBeNull();
  openCommandPalette(anchor, [{ id: "home", label: "Home", run }]);
  document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector("#app-popover")).toBeNull();
  expect(document.activeElement).toBe(anchor);
});
