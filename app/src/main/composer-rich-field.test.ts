// @vitest-environment happy-dom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { mountRichField, richFieldOf } from "./composer-rich-field";

let host: HTMLElement, input: HTMLTextAreaElement;
const view = () => richFieldOf(host)!.view;
beforeEach(() => {
  document.body.innerHTML = '<div class="cmp-field"><div class="cmp-input"></div></div>';
  host = document.querySelector<HTMLElement>(".cmp-input")!;
  input = mountRichField(host);
  input.focus();
});

/** What the owner's keys do: each letter goes through the editor's own text input (where the typing shortcuts live). */
function type(words: string): void {
  for (const char of words) {
    const editor = view(), { from, to } = editor.state.selection;
    if (!editor.someProp("handleTextInput", handle => handle(editor, from, to, char, () => editor.state.tr.insertText(char, from, to)))) editor.dispatch(editor.state.tr.insertText(char, from, to));
  }
}
const press = (key: string, more: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more });
  host.dispatchEvent(event);
  return event;
};

describe("the field answers as the plain field it replaces", () => {
  test("its words are the Markdown, and set words read back as they were", () => {
    input.value = "hello\n\nworld  ";
    expect(input.value).toBe("hello\n\nworld  ");
    expect(host.hasAttribute("data-empty")).toBe(false);
    input.value = "";
    expect(input.value).toBe("");
    expect(host.hasAttribute("data-empty")).toBe(true);
  });
  test("setting the words puts the caret at their end, and says nothing", () => {
    const heard = vi.fn();
    host.addEventListener("input", heard);
    input.value = "# Title\n\n- a";
    expect(input.selectionStart).toBe(input.value.length);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(heard).not.toHaveBeenCalled();
  });
  test("a selection is offsets of the Markdown, across a heading and a list", () => {
    input.value = "# Title\n\n1. one\n2. two";
    const at = input.value.indexOf("two");
    input.setSelectionRange(at, at + 3);
    expect([input.selectionStart, input.selectionEnd]).toEqual([at, at + 3]);
    expect(view().state.doc.textBetween(view().state.selection.from, view().state.selection.to)).toBe("two");
    input.setSelectionRange(at + 1, at + 1, "forward");
    expect(input.selectionStart).toBe(at + 1);
  });
  test("setRangeText replaces words in the Markdown and puts the caret after them", () => {
    input.value = "請用 @";
    input.setRangeText("@Notion ", 3, 4, "end");
    expect(input.value).toBe("請用 @Notion ");
    expect(input.selectionStart).toBe(input.value.length);
    input.setRangeText("X", 0, 0, "start");
    expect(input.value).toBe("X請用 @Notion ");
    expect(input.selectionStart).toBe(0);
  });
  test("placeholder, disabled and read-only are the field's", () => {
    input.placeholder = "Message";
    expect(host.getAttribute("data-placeholder")).toBe("Message");
    expect(host.querySelector(".cmp-empty")?.getAttribute("data-placeholder")).toBe("Message");
    input.disabled = true;
    expect(host.getAttribute("contenteditable")).toBe("false");
    input.disabled = false;
    expect(host.getAttribute("contenteditable")).toBe("true");
  });
  test("a change says `input` once, after the words have changed", () => {
    const seen: string[] = [];
    host.addEventListener("input", () => seen.push(input.value));
    type("ab");
    expect(seen).toEqual(["a", "ab"]);
  });
});

describe("typing shortcuts at the start of a line", () => {
  test.each([
    ["# ", "head", "# head"], ["## ", "head", "## head"], ["### ", "head", "### head"],
    ["- ", "item", "- item"], ["* ", "item", "- item"], ["1. ", "item", "1. item"], ["[] ", "todo", "- [ ] todo"], ["- [ ] ", "todo", "- [ ] todo"], ["[x] ", "done", "- [x] done"],
    ["> ", "said", "> said"], ["```js ", "code", "```js\ncode\n```"], ["$$ ", "x^2", "$$\nx^2\n$$"], [">> ", "Title", "<details open>\n<summary>Title</summary>\n</details>"],
  ])("%j makes it a block", (shortcut, words, markdown) => {
    type(shortcut + words);
    expect(input.value).toBe(markdown);
  });
  test("--- is a divider and the caret goes on under it", () => {
    type("above");
    press("Enter", { shiftKey: true });
    type("---");
    type("below");
    expect(input.value).toBe("above\n\n---\n\nbelow");
  });
  test("the shortcut only works at the start of a line", () => {
    type("a # b - c 1. d");
    expect(input.value).toBe("a # b - c 1. d");
  });
  test("Backspace right after a shortcut puts back what was typed", () => {
    type("# ");
    expect(view().state.doc.firstChild!.type.name).toBe("heading");
    press("Backspace");
    expect(input.value).toBe("\\# ");
    expect(view().state.doc.firstChild!.type.name).toBe("paragraph");
  });
});

describe("typing marks", () => {
  test.each([
    ["**bold**", "**bold**"], ["*it*", "*it*"], ["_it_", "*it*"], ["`code`", "`code`"], ["~~gone~~", "~~gone~~"], ["__b__", "**b**"],
    ["say **bold** now", "say **bold** now"], ["[a](https://example.com/x)", "[a](https://example.com/x)"], ["energy $E=mc^2$ is", "energy $E=mc^2$ is"],
  ])("%s", (typed, markdown) => {
    type(typed);
    expect(input.value).toBe(markdown);
  });
  test("what follows a mark is not marked", () => {
    type("**b** after");
    expect(view().state.doc.firstChild!.lastChild!.marks).toHaveLength(0);
  });
  test("a price is not an equation", () => {
    type("it costs $5 and $10");
    expect(input.value).toBe("it costs $5 and $10");
  });
  test("an equation is one unit; Backspace after it opens its source to edit", () => {
    type("$x$a");
    expect(view().state.doc.firstChild!.child(0).type.name).toBe("math_inline");
    // The browser deletes the letter itself; the next Backspace is the editor's.
    view().dispatch(view().state.tr.delete(view().state.selection.from - 1, view().state.selection.from));
    press("Backspace");
    expect(input.value).toBe("$x");
    type("$");
    expect(view().state.doc.firstChild!.child(0).type.name).toBe("math_inline");
  });
});

describe("Shift+Enter", () => {
  test("in a numbered list it starts the next number", () => {
    type("1. one");
    press("Enter", { shiftKey: true });
    type("two");
    press("Enter", { shiftKey: true });
    type("three");
    expect(input.value).toBe("1. one\n2. two\n3. three");
  });
  test("it counts on from where the list was typed to start", () => {
    type("3. c");
    press("Enter", { shiftKey: true });
    type("d");
    expect(input.value).toBe("3. c\n4. d");
  });
  test("on an empty item it leaves the list, and on an empty nested item it leaves one level", () => {
    type("- a");
    press("Enter", { shiftKey: true });
    press("Tab");
    type("b");
    press("Enter", { shiftKey: true });
    press("Enter", { shiftKey: true });
    type("c");
    press("Enter", { shiftKey: true });
    press("Enter", { shiftKey: true });
    type("after");
    expect(input.value).toBe("- a\n  - b\n- c\n\nafter");
  });
  test("a task starts the next task unticked", () => {
    type("[x] one");
    press("Enter", { shiftKey: true });
    type("two");
    expect(input.value).toBe("- [x] one\n- [ ] two");
  });
  test("elsewhere it is a new line, and in code a line of it, and twice at the end it leaves the code", () => {
    type("one");
    press("Enter", { shiftKey: true });
    type("two");
    expect(input.value).toBe("one\ntwo");
    type("\n");
    input.value = "";
    type("``` ");
    type("a");
    press("Enter", { shiftKey: true });
    type("b");
    press("Enter", { shiftKey: true });
    press("Enter", { shiftKey: true });
    type("after");
    expect(input.value).toBe("```\na\nb\n```\n\nafter");
  });
  test("in a toggle's title it goes under it, and an empty line under it leaves the toggle", () => {
    type(">> Title");
    press("Enter", { shiftKey: true });
    type("inside");
    press("Enter", { shiftKey: true });
    press("Enter", { shiftKey: true });
    type("outside");
    expect(input.value).toBe("<details open>\n<summary>Title</summary>\n\ninside\n\n</details>\n\noutside");
  });
  test("in a quote it adds a line, and an empty one leaves the quote", () => {
    type("> a");
    press("Enter", { shiftKey: true });
    type("b");
    press("Enter", { shiftKey: true });
    press("Enter", { shiftKey: true });
    type("c");
    expect(input.value).toBe("> a\n> b\n\nc");
  });
  test("it never sends: Enter is the page's", () => {
    expect(press("Enter", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(press("Enter").defaultPrevented).toBe(false);
  });
});

describe("Tab, Shift+Tab and Backspace", () => {
  test("Tab nests an item under the one before it and Shift+Tab brings it back", () => {
    type("- a");
    press("Enter", { shiftKey: true });
    type("b");
    press("Tab");
    expect(input.value).toBe("- a\n  - b");
    press("Shift-Tab".replace("Shift-", ""), { shiftKey: true });
    expect(input.value).toBe("- a\n- b");
  });
  test("the first item cannot nest, and Tab is still the list's", () => {
    type("- a");
    expect(press("Tab").defaultPrevented).toBe(true);
    expect(input.value).toBe("- a");
  });
  test("Backspace at the start of a block turns it back into a paragraph", () => {
    for (const shortcut of ["- ", "1. ", "> ", "[] "]) {
      input.value = "";
      type(shortcut + "words");
      input.setSelectionRange(input.value.indexOf("words"), input.value.indexOf("words"));
      press("Backspace");
      expect(input.value, shortcut).toBe("words");
    }
    input.value = "## Head";
    input.setSelectionRange(3, 3);
    press("Backspace");
    expect(input.value).toBe("Head");
  });
  test("Backspace joins a paragraph to the one before it as it always did", () => {
    input.value = "one\ntwo";
    input.setSelectionRange(4, 4);
    press("Backspace");
    expect(input.value).toBe("onetwo");
  });
});

describe("what is copied out", () => {
  test("the selection leaves as Markdown", () => {
    input.value = "# T\n\n- a\n- b";
    const clipboard = new Map<string, string>();
    const data = { setData: (type: string, value: string) => clipboard.set(type, value), getData: (type: string) => clipboard.get(type) ?? "", clearData: () => clipboard.clear() };
    view().state.doc.nodesBetween(0, 0, () => false);
    const slice = view().state.doc.slice(0, view().state.doc.content.size);
    const text = view().someProp("clipboardTextSerializer", serialize => serialize(slice, view()));
    expect(text).toBe("# T\n\n- a\n- b");
    expect(data.getData("text/plain")).toBe("");
  });
});
