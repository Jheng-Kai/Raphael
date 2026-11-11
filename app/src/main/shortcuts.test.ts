// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { openCommandPalette, shortcut } from "./shortcuts";
import { closeMenu } from "./ui";

afterEach(() => { closeMenu(); document.body.innerHTML = ""; });

function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, ctrlKey: true, bubbles: true, cancelable: true, ...options });
  target.dispatchEvent(event); return shortcut(event);
}

test.each(["input", "textarea", "select", "div[contenteditable]", "div[role=textbox]"])("typing in %s permits the palette and the Ctrl navigation shortcuts but keeps what the text uses", selector => {
  const field = document.createElement(selector.split("[")[0]);
  if (selector.includes("contenteditable")) field.setAttribute("contenteditable", "");
  if (selector.includes("role=")) field.setAttribute("role", "textbox");
  document.body.append(field);
  expect(press(field, "k")).toBe("palette");
  expect(press(field, "n")).toBe("new");
  expect(press(field, "b")).toBe("sidebar");
  expect(press(field, "f")).toBe("find");
  expect(press(field, "F", { shiftKey: true })).toBe("search");
  for (const digit of ["1", "5", "9"]) expect(press(field, digit)).toBe(`member:${digit}`);
  // What a field uses itself, Alt+arrows and a combination with another modifier stay with the text.
  for (const key of ["a", "c", "v", "x", "z", "y", "Enter", "ArrowLeft", "ArrowRight", "Backspace", "0"]) expect(press(field, key)).toBeNull();
  for (const key of ["z", "Z"]) expect(press(field, key, { shiftKey: true })).toBeNull();
  expect(press(field, "n", { shiftKey: true })).toBeNull();
  expect(press(field, "n", { altKey: true })).toBeNull();
  expect(press(field, "ArrowDown", { ctrlKey: false, altKey: true })).toBeNull();
  expect(press(field, "ArrowUp", { ctrlKey: false, altKey: true })).toBeNull();
});

test("a field takes no navigation shortcut while an IME composes or a dialog is open", () => {
  const field = document.createElement("textarea");
  document.body.append(field);
  expect(press(field, "n", { isComposing: true })).toBeNull();
  expect(press(field, "b", { keyCode: 229 })).toBeNull();
  expect(press(field, "1", { repeat: true })).toBeNull();
  document.body.insertAdjacentHTML("beforeend", '<div role="dialog"></div>');
  expect(press(field, "n")).toBeNull();
  expect(press(field, "k")).toBeNull();
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
