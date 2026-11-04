// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { RECALL, bindComposerHistory } from "./composer-history";
import { closeMenu, openMenu } from "./ui";

let input: HTMLTextAreaElement;
const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const setup = (texts: string[] = ["third", "second", "first"]) => {
  const sent = vi.fn().mockResolvedValue(texts);
  bindComposerHistory(input, sent);
  return { sent };
};
/** The owner typing: the browser changes the words without the page writing them, so no write of the page is involved. */
const typeText = (value: string, caret = value.length): void => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value); input.setSelectionRange(caret, caret); input.dispatchEvent(new Event("input", { bubbles: true })); };
/** A key press; `await flush()` after the first ArrowUp, which reads the history. */
const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  // A key an input method handles reports keyCode 229; the constructor of a test DOM does not take it from the init.
  if (init.keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: init.keyCode });
  input.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  closeMenu(); document.body.innerHTML = "";
  input = document.createElement("textarea"); document.body.append(input); input.focus();
});

test("Up brings back what was sent, newest first, and Down walks forward to the draft that was there before", async () => {
  const { sent } = setup();
  typeText("a draft in the making");
  expect(press("ArrowUp").defaultPrevented).toBe(true); await flush();
  expect(input.value).toBe("third");
  for (const expected of ["second", "first"]) { expect(press("ArrowUp").defaultPrevented).toBe(true); expect(input.value).toBe(expected); }
  expect(press("ArrowUp").defaultPrevented).toBe(false);
  expect(input.value).toBe("first");
  for (const expected of ["second", "third", "a draft in the making"]) { expect(press("ArrowDown").defaultPrevented).toBe(true); expect(input.value).toBe(expected); }
  expect(input.selectionStart).toBe(input.value.length);
  expect(press("ArrowDown").defaultPrevented).toBe(false);
  expect(sent).toHaveBeenCalledTimes(1);
});

test("an empty box has its empty draft back at the end of the walk", async () => {
  setup();
  press("ArrowUp"); await flush();
  expect(input.value).toBe("third");
  press("ArrowDown");
  expect(input.value).toBe("");
});

test("nothing is read until the first Up, and a walk that finds nothing leaves the field as it is", async () => {
  const { sent } = setup([]);
  expect(sent).not.toHaveBeenCalled();
  typeText("keep me");
  press("ArrowUp"); await flush();
  expect(sent).toHaveBeenCalledTimes(1);
  expect(input.value).toBe("keep me");
  expect(press("ArrowDown").defaultPrevented).toBe(false);
});

test("a core that cannot answer changes nothing, and the next Up asks again", async () => {
  const sent = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(["last"]);
  bindComposerHistory(input, sent);
  typeText("draft");
  press("ArrowUp"); await flush();
  expect(input.value).toBe("draft");
  press("ArrowUp"); await flush();
  expect(input.value).toBe("last");
});

test("the arrows are the field's own off the first and the last line", async () => {
  const { sent } = setup(["one\ntwo", "older"]);
  typeText("first line\nsecond line");
  expect(press("ArrowUp").defaultPrevented).toBe(false);
  expect(sent).not.toHaveBeenCalled();
  typeText("first line\nsecond line", 4);
  press("ArrowUp"); await flush();
  expect(input.value).toBe("one\ntwo");
  input.setSelectionRange(0, 0);
  expect(press("ArrowDown").defaultPrevented).toBe(false);
  expect(input.value).toBe("one\ntwo");
  input.setSelectionRange(input.value.length, input.value.length);
  expect(press("ArrowDown").defaultPrevented).toBe(true);
  expect(input.value).toBe("first line\nsecond line");
});

test("an input method composing owns the keys, and so do modifiers, a selection and an open menu", async () => {
  const { sent } = setup();
  for (const init of [{ isComposing: true }, { keyCode: 229 }, { shiftKey: true }, { altKey: true }, { ctrlKey: true }, { metaKey: true }]) expect(press("ArrowUp", init).defaultPrevented, JSON.stringify(init)).toBe(false);
  typeText("abc", 0); input.setSelectionRange(0, 2);
  expect(press("ArrowUp").defaultPrevented).toBe(false);
  input.setSelectionRange(0, 0);
  openMenu(input, [{ value: "a", label: "a" }], "", () => {});
  // The menu's own handler takes the arrow: it moves the focus to its last item, and the history is not read.
  press("ArrowUp");
  expect(document.activeElement).not.toBe(input);
  closeMenu();
  await flush();
  expect(sent).not.toHaveBeenCalled();
  expect(input.value).toBe("abc");
});

test("walking on past an edited line keeps the edit, and the history itself is never changed", async () => {
  const { sent } = setup();
  press("ArrowUp"); await flush();
  typeText("third, edited");
  press("ArrowUp");
  expect(input.value).toBe("second");
  press("ArrowDown");
  expect(input.value).toBe("third, edited");
  press("ArrowDown");
  expect(input.value).toBe("");
  press("ArrowUp"); await flush();
  expect(input.value).toBe("third");
  expect(sent).toHaveBeenCalledTimes(2);
});

test("a field emptied by a send or filled by another conversation ends the walk: the next Up starts a new one", async () => {
  const { sent } = setup();
  press("ArrowUp"); await flush();
  press("ArrowUp");
  input.value = "";
  typeText("next draft");
  press("ArrowUp"); await flush();
  expect(sent).toHaveBeenCalledTimes(2);
  expect(input.value).toBe("third");
  press("ArrowDown");
  expect(input.value).toBe("next draft");
});

test("a recall says input with its own type, so what follows typing can tell it apart", async () => {
  setup();
  const types: string[] = [];
  input.addEventListener("input", event => types.push((event as InputEvent).inputType));
  press("ArrowUp"); await flush();
  expect(types).toEqual([RECALL]);
});

test("typing while the history is being read cancels the walk", async () => {
  let finish!: (texts: string[]) => void;
  bindComposerHistory(input, () => new Promise<string[]>(resolve => { finish = resolve; }));
  typeText("one");
  press("ArrowUp");
  typeText("one two");
  finish(["recalled"]); await flush();
  expect(input.value).toBe("one two");
});
