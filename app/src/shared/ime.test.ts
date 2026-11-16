// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fromIme, guardImeKeys } from "./ime";

/** A keydown as the webview fires it; the test DOM's constructor does not take keyCode from the init. */
const key = (target: EventTarget, init: KeyboardEventInit & { keyCode?: number }): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: init.keyCode });
  target.dispatchEvent(event);
  return event;
};

let release: () => void;
beforeEach(() => { document.body.innerHTML = '<textarea></textarea><input><div contenteditable="true"></div><button>b</button>'; release = guardImeKeys(); });
afterEach(() => release());

test("an IME key is one Chromium marks as composing or one WebKit gives keyCode 229", () => {
  expect(fromIme({ isComposing: true, keyCode: 13 })).toBe(true);
  expect(fromIme({ isComposing: false, keyCode: 229 })).toBe(true);
  expect(fromIme({ isComposing: false, keyCode: 13 })).toBe(false);
});

test("the Enter that picks a candidate in WebKit never reaches the page's handlers of a text field", () => {
  for (const selector of ["textarea", "input", "[contenteditable]"]) {
    const field = document.querySelector(selector)!;
    const handler = vi.fn();
    field.addEventListener("keydown", handler);
    document.addEventListener("keydown", handler, true);
    // WebKit: compositionend has come, isComposing is false, keyCode is 229.
    key(field, { key: "Enter", keyCode: 229 });
    // Chromium: still composing.
    key(field, { key: "Escape", isComposing: true });
    key(field, { key: "ArrowDown", keyCode: 229 });
    expect(handler, selector).not.toHaveBeenCalled();
    // A plain Enter after the candidate was picked is the owner's own.
    key(field, { key: "Enter", keyCode: 13 });
    expect(handler, selector).toHaveBeenCalledTimes(2);
    field.removeEventListener("keydown", handler);
    document.removeEventListener("keydown", handler, true);
  }
});

test("letters, modifiers and keys outside text fields still pass, and nothing is prevented", () => {
  const textarea = document.querySelector("textarea")!, button = document.querySelector("button")!;
  const handler = vi.fn();
  document.addEventListener("keydown", handler);
  expect(key(textarea, { key: "Process", keyCode: 229 }).defaultPrevented).toBe(false);
  key(textarea, { key: "Alt", code: "AltRight", keyCode: 229 });
  key(button, { key: "Enter", keyCode: 229 });
  expect(handler).toHaveBeenCalledTimes(3);
  expect(key(textarea, { key: "Enter", keyCode: 229 }).defaultPrevented).toBe(false);
  document.removeEventListener("keydown", handler);
});

test("every window with a text field guards its IME keys before anything else runs", () => {
  const main = readFileSync("src/main/main.ts", "utf8");
  const body = main.replace(/^(import[^;]*;\s*)+/, "");
  expect(body.trimStart().startsWith("guardImeKeys();"), "main.ts must call guardImeKeys() first, after its imports").toBe(true);
});
