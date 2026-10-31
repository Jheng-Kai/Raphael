// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { bindMentionField } from "./mention-field";
import type { MentionTarget } from "./mention-text";

const target = (name: string, kind: MentionTarget["kind"] = "member"): MentionTarget => ({ name, kind, mark: () => "<i></i>" });
const TEAM = [target("小森"), target("小晴"), target("Notion", "app")];
let input: HTMLTextAreaElement, field: HTMLElement, mirror: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = `<div class="cmp-field"><textarea class="cmp-input"></textarea><div class="cmp-mirror"></div></div>`;
  input = document.querySelector("textarea")!; field = document.querySelector(".cmp-field")!; mirror = document.querySelector(".cmp-mirror")!;
  input.focus();
  bindMentionField(input, () => TEAM);
});
const chips = (): string[] => [...mirror.querySelectorAll(".mention-chip")].map(chip => chip.textContent!);
const typeText = (value: string, caret = value.length): void => { input.value = value; input.setSelectionRange(caret, caret); input.dispatchEvent(new Event("input", { bubbles: true })); };
const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => { const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }); input.dispatchEvent(event); return event; };
const caret = (): [number, number] => [input.selectionStart, input.selectionEnd];

test("the words become chips only where they address someone, and then the textarea stops painting its own text", () => {
  typeText("hello");
  expect(field.classList.contains("has-mentions")).toBe(false);
  expect(mirror.textContent).toBe("");
  typeText("hi @小森 and @Nobody and @Notion ");
  expect(field.classList.contains("has-mentions")).toBe(true);
  expect(chips()).toEqual(["@小森", "@Notion"]);
  expect(mirror.textContent!.replace("​", "")).toBe("hi @小森 and @Nobody and @Notion ");
});

test("every write of the words redraws them: a restored draft, a send that empties the field, a paste", () => {
  input.value = "請 @小晴 幫忙";
  expect(chips()).toEqual(["@小晴"]);
  input.value = "";
  expect(field.classList.contains("has-mentions")).toBe(false);
  input.setRangeText("@Notion ", 0, 0, "end");
  expect(chips()).toEqual(["@Notion"]);
});

test("a chip is derived from the words: a letter typed against it makes it plain text again, a space does not", () => {
  typeText("@小森 ");
  expect(chips()).toEqual(["@小森"]);
  typeText("@小森x");
  expect(chips()).toEqual([]);
  typeText("@小森 x");
  expect(chips()).toEqual(["@小森"]);
});

test("Backspace after a chip deletes all of it, Delete before it likewise, and each says input", () => {
  const heard = vi.fn(); input.addEventListener("input", heard);
  typeText("see @小森"); heard.mockClear();
  const back = press("Backspace");
  expect(back.defaultPrevented).toBe(true);
  expect(input.value).toBe("see ");
  expect(heard).toHaveBeenCalled();
  typeText("@Notion go", 0);
  const forward = press("Delete");
  expect(forward.defaultPrevented).toBe(true);
  expect(input.value).toBe(" go");
});

test("Backspace beside a space or inside plain words is the field's own", () => {
  typeText("@小森 ");
  expect(press("Backspace").defaultPrevented).toBe(false);
  typeText("plain text");
  expect(press("Backspace").defaultPrevented).toBe(false);
});

test("the arrow keys cross a chip in one step, and Shift takes it into the selection whole", () => {
  typeText("a @小森 b", 5);
  expect(press("ArrowLeft").defaultPrevented).toBe(true);
  expect(caret()).toEqual([2, 2]);
  expect(press("ArrowRight").defaultPrevented).toBe(true);
  expect(caret()).toEqual([5, 5]);
  input.setSelectionRange(2, 2);
  press("ArrowRight", { shiftKey: true });
  expect(caret()).toEqual([2, 5]);
  expect(input.selectionDirection).toBe("forward");
  typeText("a @小森 b", 5);
  press("ArrowLeft", { shiftKey: true });
  expect(caret()).toEqual([2, 5]);
  expect(input.selectionDirection).toBe("backward");
});

test("a caret or selection edge dropped inside a chip goes to the nearer edge, a selection takes the whole chip", () => {
  typeText("a @小森 b");
  input.focus(); input.setSelectionRange(3, 3); document.dispatchEvent(new Event("selectionchange"));
  expect(caret()).toEqual([2, 2]);
  input.setSelectionRange(4, 4); document.dispatchEvent(new Event("selectionchange"));
  expect(caret()).toEqual([5, 5]);
  input.setSelectionRange(0, 3); document.dispatchEvent(new Event("selectionchange"));
  expect(caret()).toEqual([0, 5]);
});

test("an input method composing next to a chip is left alone and its words are drawn underlined", () => {
  typeText("@小森 ㄅ");
  const updated = Object.assign(new Event("compositionupdate"), { data: "ㄅ" });
  input.dispatchEvent(updated);
  input.dispatchEvent(Object.assign(new Event("input", { bubbles: true }), { isComposing: true }));
  expect(mirror.querySelector(".cmp-composing")?.textContent).toBe("ㄅ");
  input.setSelectionRange(5, 5);
  expect(press("Backspace", { isComposing: true }).defaultPrevented).toBe(false);
  input.setSelectionRange(2, 2); document.dispatchEvent(new Event("selectionchange"));
  expect(caret()).toEqual([2, 2]);
  input.dispatchEvent(new Event("compositionend"));
  expect(mirror.querySelector(".cmp-composing")).toBeNull();
});
