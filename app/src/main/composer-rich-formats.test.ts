// @vitest-environment happy-dom
// Every format of the composer, by its de-facto shortcut and by its typing rule, and its Markdown both ways (R-COMPOSER-RICH-06).
import { beforeEach, describe, expect, test, vi } from "vitest";
import { mountRichField, richFieldOf } from "./composer-rich-field";
import { parseMarkdown, serializeMarkdown } from "./composer-rich-markdown";
import { ownerMessageHTML, replyContentHTML } from "./message-content";

let host: HTMLElement, input: HTMLTextAreaElement;
const view = () => richFieldOf(host)!.view;
beforeEach(() => {
  document.body.innerHTML = '<div class="cmp-field"><div class="cmp-input"></div></div>';
  host = document.querySelector<HTMLElement>(".cmp-input")!;
  input = mountRichField(host);
  input.focus();
});

function type(words: string): void {
  for (const char of words) {
    const editor = view(), { from, to } = editor.state.selection;
    if (!editor.someProp("handleTextInput", handle => handle(editor, from, to, char, () => editor.state.tr.insertText(char, from, to)))) editor.dispatch(editor.state.tr.insertText(char, from, to));
  }
}
/** A key as a browser sends it: with Shift a letter is its capital, and every key has its code (ProseMirror's keymap reads both). */
const press = (key: string, more: KeyboardEventInit = {}): KeyboardEvent => {
  const code = key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0;
  const event = new KeyboardEvent("keydown", { key: more.shiftKey && /^[a-z]$/.test(key) ? key.toUpperCase() : key, keyCode: code, bubbles: true, cancelable: true, ...more });
  host.dispatchEvent(event);
  return event;
};
/** Selects the first `of` in the words, as the owner drags over it. */
const select = (of: string): void => { const at = input.value.indexOf(of); input.setSelectionRange(at, at + of.length); };
const write = (markdown: string): string => serializeMarkdown(parseMarkdown(markdown)).text;

describe("every inline format has its shortcut", () => {
  test.each([
    ["b", {}, "**word**"], ["i", {}, "*word*"], ["u", {}, "<u>word</u>"], ["s", { shiftKey: true }, "~~word~~"], ["x", { shiftKey: true }, "~~word~~"],
    ["e", {}, "`word`"], ["h", { shiftKey: true }, "==word=="],
  ])("Ctrl+%j %j makes the selection %j, and the same keys take it off again", (key, more, markdown) => {
    input.value = "a word b";
    select("word");
    const first = press(key, { ctrlKey: true, ...more });
    expect(first.defaultPrevented).toBe(true);
    expect(input.value).toBe(`a ${markdown} b`);
    press(key, { ctrlKey: true, ...more });
    expect(input.value).toBe("a word b");
  });
  test("with the caret alone, the next words typed take the format", () => {
    type("a ");
    press("b", { ctrlKey: true });
    type("bold");
    press("b", { ctrlKey: true });
    type(" b");
    expect(input.value).toBe("a **bold** b");
  });
  test("formats stack, in any order, and read back as the same", () => {
    input.value = "word";
    select("word");
    for (const [key, more] of [["b", {}], ["i", {}], ["u", {}], ["s", { shiftKey: true }], ["h", { shiftKey: true }]] as const) press(key, { ctrlKey: true, ...more });
    const written = input.value;
    expect(written).toContain("word");
    expect(write(written)).toBe(written);
    expect(parseMarkdown(written).textContent).toBe("word");
    const marks = parseMarkdown(written).firstChild!.firstChild!.marks.map(mark => mark.type.name).sort();
    expect(marks).toEqual(["bold", "highlight", "italic", "strike", "underline"]);
  });
});

describe("every inline format is Markdown both ways", () => {
  test.each([
    "<u>under</u>", "==marked==", "a ==marked== word", "**<u>both</u>**", "**==bold in a mark==**", "*<u>~~three~~</u>*", "[<u>a link</u>](https://example.com/)",
    "`code` and <u>under</u>", "**`bold code`**", "[`code link`](https://example.com/)",
  ])("%j", text => { expect(write(text)).toBe(text); });
  test("marks nest in one order, whichever way they were written", () => {
    expect(write("<u>**both**</u>")).toBe("**<u>both</u>**");
    expect(write("==**bold in a mark**==")).toBe("**==bold in a mark==**");
    expect(write(write("~~<u>*a*</u>~~"))).toBe(write("~~<u>*a*</u>~~"));
    expect(parseMarkdown("<u>**both**</u>").textContent).toBe("both");
  });
  test("an underline is the tag the reply renderer reads, and a highlight is two equals", () => {
    const marks = (text: string) => parseMarkdown(text).firstChild!.firstChild!.marks.map(mark => mark.type.name);
    expect(marks("<u>x</u>")).toEqual(["underline"]);
    expect(marks("==x==")).toEqual(["highlight"]);
  });
  test.each(["a == b", "x==y", "a ==b", "1 == 1 and 2 == 2", "<u>", "</u> alone", "an <u>open underline", "a<ul>b", "==", "===", "= = ="])("words that only look like them stay plain: %j", text => {
    const doc = parseMarkdown(text);
    expect(doc.firstChild!.firstChild!.marks).toHaveLength(0);
    expect(write(text)).toBe(text);
  });
  test("a literal tag or pair of equals the owner means as words is escaped, and reads back as it was", () => {
    const schema = parseMarkdown("").type.schema;
    const doc = schema.node("doc", null, schema.node("paragraph", null, schema.text("<u>x</u> and ==y==")));
    const written = serializeMarkdown(doc).text;
    expect(written).not.toBe("<u>x</u> and ==y==");
    expect(parseMarkdown(written).textContent).toBe("<u>x</u> and ==y==");
    expect(parseMarkdown(written).firstChild!.childCount).toBe(1);
  });
});

describe("typing a mark closes it", () => {
  test.each([
    ["<u>under</u>", "<u>under</u>"], ["==marked==", "==marked=="], ["say ==it== now", "say ==it== now"], ["他說==重點==", "他說==重點=="],
  ])("%s", (typed, markdown) => {
    type(typed);
    expect(input.value).toBe(markdown);
    expect(parseMarkdown(markdown).firstChild!.childCount).toBeGreaterThan(0);
  });
  test("a comparison is no highlight", () => {
    type("if a == b and c == d");
    expect(input.value).toBe("if a == b and c == d");
  });
});

describe("every block has its shortcut", () => {
  test.each([
    ["1", { ctrlKey: true, altKey: true }, "# "], ["2", { ctrlKey: true, altKey: true }, "## "], ["3", { ctrlKey: true, altKey: true }, "### "],
    ["8", { ctrlKey: true, shiftKey: true }, "- "], ["7", { ctrlKey: true, shiftKey: true }, "1. "], ["9", { ctrlKey: true, shiftKey: true }, "- [ ] "],
    ["b", { ctrlKey: true, shiftKey: true }, "> "], ["c", { ctrlKey: true, altKey: true }, "```\n"],
  ])("%j with %j starts %j", (key, more, start) => {
    input.value = "words";
    const found = press(key, more);
    expect(found.defaultPrevented).toBe(true);
    expect(input.value.startsWith(start)).toBe(true);
    expect(input.value).toContain("words");
  });
  test("Ctrl+Alt+0 is a paragraph again", () => {
    input.value = "## words";
    input.setSelectionRange(4, 4);
    press("0", { ctrlKey: true, altKey: true });
    expect(input.value).toBe("words");
  });
  test("the task shortcut makes a plain list a task list and takes it back", () => {
    input.value = "- a\n- b";
    input.setSelectionRange(3, 3);
    press("9", { ctrlKey: true, shiftKey: true });
    expect(input.value).toBe("- [ ] a\n- b");
    input.value = "- [ ] a\n- [x] b";
    input.setSelectionRange(0, input.value.length);
    press("9", { ctrlKey: true, shiftKey: true });
    expect(input.value).toBe("- a\n- b");
  });
});

describe("Mod+K is the link", () => {
  test("it asks for the link editor of the words selected, and nothing else handles the key", () => {
    const open = vi.fn(() => true);
    richFieldOf(host)!.onLink(open);
    input.value = "a word b";
    select("word");
    const event = press("k", { ctrlKey: true });
    expect(open).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });
  test("a link set on the selection reads and writes as Markdown, and unsets", () => {
    input.value = "a word b";
    select("word");
    richFieldOf(host)!.editor.chain().setLink({ href: "https://example.com/x" }).run();
    expect(input.value).toBe("a [word](https://example.com/x) b");
    richFieldOf(host)!.editor.chain().extendMarkRange("link").unsetLink().run();
    expect(input.value).toBe("a word b");
  });
  test("a link needs an address the reply renderer would draw", () => {
    input.value = "a word b";
    select("word");
    expect(richFieldOf(host)!.editor.chain().setLink({ href: "javascript:alert(1)" }).run()).toBe(false);
    expect(input.value).toBe("a word b");
  });
});

describe("Enter is the page's, in every block", () => {
  test.each([
    "plain", "# heading", "- item", "1. one", "- [ ] task", "> quote", "```\ncode\n```", "$$\nx\n$$", "<details open>\n<summary>t</summary>\n</details>", "| a | b |\n| --- | --- |\n| 1 | 2 |",
  ])("%j is left as it is by Enter, and Enter is not kept from the page", text => {
    input.value = text;
    const before = input.value;
    const plain = press("Enter"), withCtrl = press("Enter", { ctrlKey: true });
    expect(plain.defaultPrevented).toBe(false);
    expect(withCtrl.defaultPrevented).toBe(false);
    expect(input.value).toBe(before);
  });
  test("a shortcut's marks typed to the end of a line are not made by Enter", () => {
    for (const typed of ["#", "-", "1.", ">", "**b**", "[] ", "```", "$$", "=="]) {
      input.value = "";
      type(typed);
      const before = input.value;
      press("Enter");
      expect(input.value, typed).toBe(before);
    }
  });
});

describe("the owner's bubble and a reply draw what the composer writes", () => {
  // Each format is typed or set in the field, written as Markdown, and read by the renderer both ways.
  const tags: [string, string, string][] = [
    ["**word**", "strong", "word"], ["*word*", "em", "word"], ["<u>word</u>", "u", "word"], ["~~word~~", "del", "word"], ["==word==", "mark.message-mark", "word"],
    ["`word`", "code", "word"], ["[word](https://example.com/x)", "a", "word"], ["# word", "h1", "word"], ["> word", "blockquote", "word"], ["- word", "ul > li", "word"], ["1. word", "ol > li", "word"],
  ];
  test.each(tags)("%j is a <%s> in the bubble and in a reply", (markdown, selector, words) => {
    input.value = markdown;
    expect(input.value).toBe(markdown);
    const owner = document.createElement("div"), reply = document.createElement("div");
    owner.innerHTML = ownerMessageHTML(input.value, "", []);
    reply.innerHTML = replyContentHTML(input.value);
    for (const el of [owner, reply]) expect(el.querySelector(selector)?.textContent, selector).toContain(words);
  });
  test.each(["a == b", "1 == 1 and x==y", "an <u>open tag", "2 * 3 * 4"])("words that only look like a mark are no mark in either: %j", words => {
    const owner = document.createElement("div"), reply = document.createElement("div");
    owner.innerHTML = ownerMessageHTML(words, "", []);
    reply.innerHTML = replyContentHTML(words);
    for (const el of [owner, reply]) expect(el.querySelector("mark.message-mark, u, em, strong"), words).toBeNull();
  });
  test("a task, a toggle and an equation stay what they were", () => {
    input.value = "- [ ] todo\n- [x] done\n\n<details open>\n<summary>Title</summary>\n\nbody\n\n</details>\n\nenergy $E=mc^2$";
    const owner = document.createElement("div");
    owner.innerHTML = ownerMessageHTML(input.value, "", []);
    expect(owner.querySelectorAll("input[type=checkbox]")).toHaveLength(2);
    expect(owner.querySelector("details > summary")?.textContent).toBe("Title");
    expect(owner.querySelector(".math-inline")).not.toBeNull();
  });
});
