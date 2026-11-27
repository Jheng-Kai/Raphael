// @vitest-environment happy-dom
// The bar over a selection: what it shows, where the focus stays, how it closes, the link editor and the keyboard (R-COMPOSER-RICH-08).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mountRichField, richFieldOf } from "./composer-rich-field";
import { linkAddress } from "./composer-rich-toolbar";
import { getLocale, setLocale } from "./i18n";
import { closeMenu } from "./ui";

let host: HTMLElement, input: HTMLTextAreaElement;
const bar = (): HTMLElement | null => document.querySelector<HTMLElement>(".cmp-fmt");
const shown = (): boolean => !!bar() && !bar()!.hidden;
const editor = () => richFieldOf(host)!.editor;
/** The bar follows the selection a frame or two later (a menu closing and the focus coming back each ask for one). */
const settle = async (): Promise<void> => { for (let frame = 0; frame < 2; frame++) await new Promise<void>(done => requestAnimationFrame(() => done())); await Promise.resolve(); };
const select = async (of: string): Promise<void> => { const at = input.value.indexOf(of); input.setSelectionRange(at, at + of.length); await settle(); };
const control = (id: string): HTMLButtonElement => bar()!.querySelector<HTMLButtonElement>(`[data-bar="${id}"]`)!;
const press = (key: string, more: KeyboardEventInit = {}, target: HTMLElement = host): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0, bubbles: true, cancelable: true, ...more });
  target.dispatchEvent(event);
  return event;
};

let locale = getLocale();
beforeEach(() => {
  locale = getLocale(); setLocale("en");
  document.body.innerHTML = '<div class="cmp-field"><div class="cmp-input"></div></div>';
  host = document.querySelector<HTMLElement>(".cmp-input")!;
  input = mountRichField(host);
  input.focus();
});
afterEach(() => { closeMenu(); richFieldOf(host)?.destroy(); document.body.innerHTML = ""; setLocale(locale); });

describe("the bar over a selection", () => {
  test("it is there while words are selected, and only then", async () => {
    input.value = "a word b";
    await settle();
    expect(shown()).toBe(false);
    await select("word");
    expect(shown()).toBe(true);
    input.setSelectionRange(2, 2);
    await settle();
    expect(shown()).toBe(false);
  });
  test("its buttons are named, say which formats are on, and a press formats the selection without taking the caret", async () => {
    input.value = "a word b";
    await select("word");
    for (const id of ["bold", "italic", "underline", "strike", "code", "highlight", "link", "math"]) expect(control(id).getAttribute("aria-label"), id).toBeTruthy();
    expect(control("bold").getAttribute("title")).toMatch(/Ctrl\+B$/);
    expect(control("bold").getAttribute("aria-pressed")).toBe("false");
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    control("bold").dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    control("bold").click();
    expect(input.value).toBe("a **word** b");
    await settle();
    expect(control("bold").getAttribute("aria-pressed")).toBe("true");
    expect(shown()).toBe(true);
    control("underline").click();
    control("highlight").click();
    expect(editor().state.selection.empty).toBe(false);
    expect(parseMarks()).toEqual(["bold", "highlight", "underline"]);
    control("bold").click();
    await settle();
    expect(control("bold").getAttribute("aria-pressed")).toBe("false");
  });
  test("an inline equation made of the selected words is its button's", async () => {
    input.value = "x^2 here";
    await select("x^2");
    control("math").click();
    expect(input.value).toBe("$x^2$ here");
  });
  test("the block's kind is named, and its menu turns the line into another", async () => {
    input.value = "a word b";
    await select("word");
    expect(bar()!.querySelector(".cmp-fmt-kind")!.textContent).toBe("Text");
    control("block").click();
    const menu = document.querySelector<HTMLElement>("#app-popover")!;
    const rows = [...menu.querySelectorAll("button")].map(button => button.textContent);
    for (const name of ["Text", "Heading 1", "Heading 2", "Heading 3", "Bulleted list", "Numbered list", "Task list", "Quote", "Toggle", "Code block", "Equation", "Divider", "Table"]) expect(rows.some(row => row!.startsWith(name)), name).toBe(true);
    menu.querySelector<HTMLElement>('[data-value="h2"]')!.click();
    expect(input.value).toBe("## a word b");
    await settle();
    expect(bar()!.querySelector(".cmp-fmt-kind")!.textContent).toBe("Heading 2");
    input.setSelectionRange(5, 9);
    await settle();
    control("block").click();
    document.querySelector<HTMLElement>('#app-popover [data-value="tasks"]')!.click();
    expect(input.value).toBe("- [ ] a word b");
  });
  test("it sits in the code and the equation blocks as a block's menu only: marks are words there", async () => {
    input.value = "```js\nlet a = 1;\n```";
    await select("let");
    expect(shown()).toBe(true);
    for (const id of ["bold", "italic", "link", "math"]) expect(control(id).disabled, id).toBe(true);
    expect(control("block").disabled).toBe(false);
    const language = bar()!.querySelector<HTMLInputElement>('input[data-bar="language"]')!;
    expect(language.hidden).toBe(false);
    expect(language.value).toBe("js");
    language.value = "TS";
    language.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(input.value).toBe("```ts\nlet a = 1;\n```");
  });
  test("a table's words have its menu: rows and columns in, rows and columns out", async () => {
    input.value = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    await select("1");
    expect(control("table").hidden).toBe(false);
    control("table").click();
    const names = [...document.querySelectorAll("#app-popover button")].map(button => button.textContent);
    expect(names).toEqual(["Insert row above", "Insert row below", "Insert column left", "Insert column right", "Delete row", "Delete column", "Delete table"]);
    document.querySelector<HTMLElement>('#app-popover [data-value="rowBelow"]')!.click();
    expect(input.value.split("\n").filter(line => line.startsWith("|"))).toHaveLength(4);
    await settle();
    expect(control("table").hidden).toBe(false);
  });
  test("the words outside a table have no table menu", async () => {
    input.value = "a word b";
    await select("word");
    expect(control("table").hidden).toBe(true);
  });
});

describe("how the bar closes", () => {
  test("Escape closes it and is not the page's; the next Escape is", async () => {
    input.value = "a word b";
    await select("word");
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    const first = press("Escape");
    expect(shown()).toBe(false);
    expect(first.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
    press("Escape");
    expect(seen).toHaveBeenCalledTimes(1);
    document.removeEventListener("keydown", seen);
    // A new selection brings it back.
    await select("b");
    expect(shown()).toBe(true);
  });
  test("typing over the selection closes it", async () => {
    input.value = "a word b";
    await select("word");
    const view = editor().view;
    view.dispatch(view.state.tr.insertText("x", view.state.selection.from, view.state.selection.to));
    await settle();
    expect(shown()).toBe(false);
  });
  test("it is not there while an input method composes, or when the field cannot be edited", async () => {
    input.value = "a word b";
    input.disabled = true;
    await select("word");
    expect(shown()).toBe(false);
    input.disabled = false;
    await select("word");
    expect(shown()).toBe(true);
    Object.defineProperty(editor().view, "composing", { configurable: true, get: () => true });
    editor().view.dispatch(editor().state.tr.setMeta("x", 1));
    await settle();
    expect(shown()).toBe(false);
  });
  test("it follows the editor out of the page: the focus gone elsewhere closes it", async () => {
    input.value = "a word b";
    document.body.insertAdjacentHTML("beforeend", '<input id="other">');
    await select("word");
    expect(shown()).toBe(true);
    document.querySelector<HTMLInputElement>("#other")!.focus();
    await settle();
    expect(shown()).toBe(false);
  });
});

describe("the link editor", () => {
  test("Mod+K takes the bar's place with the address to write, and Enter makes the words a link", async () => {
    input.value = "a word b";
    await select("word");
    const key = press("k", { ctrlKey: true });
    expect(key.defaultPrevented).toBe(true);
    const form = bar()!.querySelector<HTMLFormElement>(".cmp-fmt-link")!;
    expect(form.hidden).toBe(false);
    expect(bar()!.querySelector<HTMLElement>('[data-row="format"]')!.hidden).toBe(true);
    const address = form.querySelector<HTMLInputElement>("input")!;
    expect(document.activeElement).toBe(address);
    expect(form.querySelector<HTMLElement>('[data-bar="unlink"]')!.hidden).toBe(true);
    address.value = "example.com/docs";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(input.value).toBe("a [word](https://example.com/docs) b");
    expect(bar()!.querySelector<HTMLElement>('[data-row="format"]')!.hidden).toBe(false);
    expect(document.activeElement).toBe(host);
  });
  test("an address a reply would not draw as a link is refused where it stands", async () => {
    input.value = "a word b";
    await select("word");
    press("k", { ctrlKey: true });
    const form = bar()!.querySelector<HTMLFormElement>(".cmp-fmt-link")!, address = form.querySelector<HTMLInputElement>("input")!;
    for (const bad of ["", "two words", "javascript:alert(1)", "ftp://x.y/z"]) {
      address.value = bad;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect(address.getAttribute("aria-invalid"), bad).toBe("true");
      expect(input.value).toBe("a word b");
    }
  });
  test("a link is edited and taken off from the caret in it, and Escape goes back to the words", async () => {
    input.value = "a [word](https://example.com/x) b";
    input.setSelectionRange(5, 5);
    press("k", { ctrlKey: true });
    await settle();
    expect(shown()).toBe(true);
    const form = bar()!.querySelector<HTMLFormElement>(".cmp-fmt-link")!, address = form.querySelector<HTMLInputElement>("input")!;
    expect(address.value).toBe("https://example.com/x");
    expect(form.querySelector<HTMLElement>('[data-bar="unlink"]')!.hidden).toBe(false);
    address.value = "https://example.org/y";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(input.value).toBe("a [word](https://example.org/y) b");
    press("k", { ctrlKey: true });
    await settle();
    press("Escape", {}, bar()!.querySelector<HTMLElement>("input")!);
    expect(bar()!.querySelector<HTMLElement>('[data-row="format"]')!.hidden).toBe(false);
    expect(document.activeElement).toBe(host);
    expect(input.value).toBe("a [word](https://example.org/y) b");
    press("k", { ctrlKey: true });
    await settle();
    control("unlink").click();
    expect(input.value).toBe("a word b");
  });
  test("the caret in a word with no link takes the word, and in no word the key does nothing but is the editor's", async () => {
    input.value = "one two";
    input.setSelectionRange(5, 5);
    press("k", { ctrlKey: true });
    await settle();
    expect(shown()).toBe(true);
    expect(editor().state.doc.textBetween(editor().state.selection.from, editor().state.selection.to)).toBe("two");
    press("Escape", {}, bar()!.querySelector<HTMLElement>("input")!);
    input.value = "one  two";
    input.setSelectionRange(4, 4);
    const key = press("k", { ctrlKey: true });
    expect(key.defaultPrevented).toBe(true);
  });
  test.each([
    ["example.com", "https://example.com"], ["http://a.b/c?d=e", "http://a.b/c?d=e"], ["  https://a.b  ", "https://a.b"],
    ["", null], ["a b", null], ["javascript:alert(1)", null], ["mailto:a@b.c", null], ["file:///etc/passwd", null],
  ])("the address of %j is %j", (words, address) => { expect(linkAddress(words)).toBe(address); });
});

describe("from the keyboard", () => {
  test("Alt+F10 goes to the bar, the arrows move along it, a key presses, Escape goes back to the words", async () => {
    input.value = "a word b";
    await select("word");
    const key = press("F10", { altKey: true });
    expect(key.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(control("block"));
    press("ArrowRight", {}, control("block"));
    expect(document.activeElement).toBe(control("bold"));
    press("ArrowRight", {}, control("bold"));
    expect(document.activeElement).toBe(control("italic"));
    press("ArrowLeft", {}, control("italic"));
    expect(document.activeElement).toBe(control("bold"));
    press("End", {}, control("bold"));
    expect(document.activeElement).toBe(control("link"));
    press("Home", {}, control("link"));
    expect(document.activeElement).toBe(control("block"));
    expect(control("bold").tabIndex).toBe(-1);
    control("bold").focus();
    control("bold").click();
    expect(input.value).toBe("a **word** b");
    await settle();
    expect(shown()).toBe(true);
    press("Escape", {}, control("bold"));
    expect(document.activeElement).toBe(host);
    expect(shown()).toBe(true);
  });
  test("Alt+F10 with nothing selected is the field's own", () => {
    input.value = "a word";
    expect(press("F10", { altKey: true }).defaultPrevented).toBe(false);
  });
  test("the bar is a toolbar the page names", async () => {
    input.value = "a word b";
    await select("word");
    expect(bar()!.getAttribute("role")).toBe("toolbar");
    expect(bar()!.getAttribute("aria-label")).toBe("Formatting");
  });
});

function parseMarks(): string[] {
  const { from } = editor().state.selection;
  return editor().state.doc.resolve(from + 1).marks().map(mark => mark.type.name).sort();
}
