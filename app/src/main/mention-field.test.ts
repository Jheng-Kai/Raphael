// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import { wholeLinks } from "./composer-links";
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

test("a full-width mention keeps the mirror's words and length and deletes as one chip", () => {
  const text = "see ＠小森";
  typeText(text);
  expect(chips()).toEqual(["＠小森"]);
  expect(mirror.textContent!.replace("​", "")).toBe(text);
  expect(input.value).toBe(text);
  expect(press("Backspace").defaultPrevented).toBe(true);
  expect(input.value).toBe("see ");
  typeText("＠Notion go", 0);
  expect(press("Delete").defaultPrevented).toBe(true);
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

const LINK = "https://x.com/someone/status/2115177376921293212?ref_src=twsrc%5Etfw";
const NAME = "x.com/someone/status/2115177376…";
const clipboardEvent = (type: string, text = "", files: File[] = []): Event & { clipboardData: { setData: ReturnType<typeof vi.fn> } } => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  return Object.assign(event, { clipboardData: { files, getData: () => text, setData: vi.fn() } });
};

test("a pasted link stands as a chip with its short name, and the words go out with the whole address", () => {
  input.value = "看 "; input.setSelectionRange(2, 2);
  const event = clipboardEvent("paste", LINK);
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(input.value).toBe(`看 ${NAME}`);
  expect(chips()).toEqual([NAME]);
  expect(field.classList.contains("has-mentions")).toBe(true);
  expect(wholeLinks(input.value)).toBe(`看 ${LINK}`);
});

test("a paste with no link, and a paste of files, are not the field's to change", () => {
  const words = clipboardEvent("paste", "plain words"), withFile = clipboardEvent("paste", LINK, [new File(["x"], "a.png")]);
  input.dispatchEvent(words); input.dispatchEvent(withFile);
  expect(words.defaultPrevented).toBe(false);
  expect(withFile.defaultPrevented).toBe(false);
});

test("words put back from elsewhere show their links as chips too", () => {
  input.value = `${LINK} 這個`;
  expect(input.value).toBe(`${NAME} 這個`);
  expect(chips()).toEqual([NAME]);
  input.setRangeText(LINK, 0, input.value.length, "end");
  expect(input.value).toBe(NAME);
});

test("a link chip is one unit: backspace takes all of it, and the caret never rests inside", () => {
  typeText(`${LINK} 這個`, NAME.length);
  press("Backspace");
  expect(input.value).toBe(" 這個");
  typeText(`a ${LINK}`);
  input.setSelectionRange(5, 5);
  document.dispatchEvent(new Event("selectionchange"));
  expect(caret()).toEqual([2, 2]);
});

test("copying or cutting a link gives the whole address", () => {
  typeText(`看 ${LINK}`);
  input.setSelectionRange(0, input.value.length);
  const copied = clipboardEvent("copy");
  input.dispatchEvent(copied);
  expect(copied.clipboardData.setData).toHaveBeenCalledWith("text/plain", `看 ${LINK}`);
  expect(input.value).toBe(`看 ${NAME}`);
  const cut = clipboardEvent("cut");
  input.dispatchEvent(cut);
  expect(cut.clipboardData.setData).toHaveBeenCalledWith("text/plain", `看 ${LINK}`);
  expect(input.value).toBe("");
});

test("a mention inside a link's name stays part of the link", () => {
  typeText("https://medium.com/@小森/post");
  expect(input.value).toBe("medium.com/@小森/post");
  expect(mirror.querySelectorAll(".url-chip")).toHaveLength(1);
  expect(chips()).toEqual(["medium.com/@小森/post"]);
});

