// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from "vitest";
import { mountRichField, richFieldOf } from "./composer-rich-field";

let host: HTMLElement, input: HTMLTextAreaElement;
beforeEach(() => {
  document.body.innerHTML = '<div class="cmp-field"><div class="cmp-input"></div></div>';
  host = document.querySelector<HTMLElement>(".cmp-input")!;
  input = mountRichField(host);
  input.focus();
});

/** A paste the way the browser makes one: the clipboard holds a kind of each. */
function paste(parts: { html?: string; text?: string; types?: string[]; files?: File[] }): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  const kinds = new Map([["text/html", parts.html ?? ""], ["text/plain", parts.text ?? ""]]);
  Object.defineProperty(event, "clipboardData", { value: { files: parts.files ?? [], types: parts.types ?? [...kinds].filter(([, value]) => value).map(([type]) => type), getData: (type: string) => kinds.get(type) ?? "" } });
  host.dispatchEvent(event);
  return event;
}

describe("a copy of the app's own reply keeps what it showed", () => {
  test("a heading and a numbered list of five (the owner's own example)", () => {
    paste({
      html: '<div class="ans"><div class="message-text"><h1>拉斐爾分開了</h1><ol><li>第一件事</li><li>第二件事</li><li>第三件事</li><li>第四件事</li><li>第五件事</li></ol></div></div>',
      text: "拉斐爾分開了\n第一件事\n第二件事",
    });
    expect(input.value).toBe("# 拉斐爾分開了\n\n1. 第一件事\n2. 第二件事\n3. 第三件事\n4. 第四件事\n5. 第五件事");
  });
  test("code is its own source, an address chip is its address, a task its box, a table its cells", () => {
    paste({
      html: '<div class="message-text"><p>See <a class="message-link link-chip" href="https://example.com/a" data-url="https://example.com/a" data-link-bare><span class="link-mark"><svg></svg></span><span class="link-name">example.com</span></a> and <code>x</code></p>'
        + '<ul><li class="message-task"><input type="checkbox" disabled checked aria-label="a">done</li><li class="message-task"><input type="checkbox" disabled>todo</li></ul></div>'
        + '<section class="rich-block message-code" data-source="let a = 1;\nlet b = 2;" data-language="js"><header class="rich-head"><span>js</span><button>Copy</button></header><pre><code><span class="hl">let</span> a</code></pre></section>'
        + '<section class="rich-block message-table"><header class="rich-head"><span>Table</span></header><div><table><thead><tr><th class="align-left">a</th><th class="align-right">b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div></section>',
    });
    expect(input.value).toBe("See https://example.com/a and `x`\n\n- [x] done\n- [ ] todo\n\n```js\nlet a = 1;\nlet b = 2;\n```\n\n| a | b |\n| :--- | ---: |\n| 1 | 2 |");
  });
});

describe("a copy from another place", () => {
  test("Google Docs: nested lists written as sibling lists, and a wrapper that is not bold", () => {
    paste({ html: '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1"><ul><li><p>one</p></li><ul><li><p>nested</p></li></ul><li><p>two <strong>bold</strong></p></li></ul></b>' });
    expect(input.value).toBe("- one\n  - nested\n- two **bold**");
  });
  test("Word: list paragraphs with a mark and a level", () => {
    paste({ html: '<p class="MsoListParagraphCxSpFirst" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.<span>&nbsp;</span></span>First</p>'
      + '<p class="MsoListParagraphCxSpMiddle" style="mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">a.<span>&nbsp;</span></span>Nested</p>'
      + '<p class="MsoListParagraphCxSpLast" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2.<span>&nbsp;</span></span>Second</p>' });
    expect(input.value).toBe("1. First\n   1. Nested\n2. Second");
  });
  test("Notion: a toggle, a to-do and a bulleted list", () => {
    paste({ html: '<details open=""><summary>Toggle title</summary><p>inside</p></details><ul class="to-do-list"><li><div class="checkbox checkbox-on"></div><span>done</span></li></ul><ul class="bulleted-list"><li>point</li></ul>' });
    expect(input.value).toBe("<details open>\n<summary>Toggle title</summary>\n\ninside\n\n</details>\n\n- [x] done\n\n- point");
  });
  test("a web page: headings, a quote, emphasis, a link, code; scripts, styles and pictures are dropped", () => {
    paste({ html: '<style>p{color:red}</style><script>alert(1)</script><h2>News</h2><p>A <em>very</em> <b>big</b> <a href="https://example.com/x">story</a>.</p><img src="x.png" alt="pic"><blockquote><p>quoted words</p></blockquote><pre><code class="language-py">print(1)</code></pre>' });
    expect(input.value).toBe("## News\n\nA *very* **big** [story](https://example.com/x).\n\n> quoted words\n\n```py\nprint(1)\n```");
  });
  test("paragraphs stay apart by a blank line, a table keeps its rows", () => {
    paste({ html: "<p>first</p><p>second</p><table><tr><th>h1</th><th>h2</th></tr><tr><td><p>c1</p></td><td>c2</td></tr></table>" });
    expect(input.value).toBe("first\n\nsecond\n\n| h1 | h2 |\n| --- | --- |\n| c1 | c2 |");
  });
  test("an equation drawn by KaTeX is its LaTeX again", () => {
    paste({ html: '<p>Euler: <span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">e^{i\\pi}+1=0</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">e</span></span></p>'
      + '<span class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><mrow></mrow><annotation encoding="application/x-tex">\\int_0^1 x\\,dx</annotation></semantics></math></span></span></span>' });
    expect(input.value).toBe("Euler: $e^{i\\pi}+1=0$\n\n$$\n\\int_0^1 x\\,dx\n$$");
  });
});

describe("a copy of plain words", () => {
  test("Markdown becomes the blocks it says", () => {
    paste({ text: "# Plan\n\n- one\n- two\n\n1. a\n2. b\n\n> note\n\n```\ncode\n```" });
    expect(input.value).toBe("# Plan\n\n- one\n- two\n\n1. a\n2. b\n\n> note\n\n```\ncode\n```");
    expect(host.querySelector("h1")?.textContent).toBe("Plan");
    expect(host.querySelectorAll("li")).toHaveLength(4);
  });
  test("words with a stray star or a price stay as they were typed", () => {
    paste({ text: "if (a*b < c*d) pay $5 and $10\nsnake_case_here" });
    expect(host.querySelector("em, strong")).toBeNull();
    // Only the two stars that would have made words italic are escaped; the price and the underscores are plain.
    expect(input.value).toBe("if (a\\*b < c\\*d) pay $5 and $10\nsnake_case_here");
    expect(host.textContent).toContain("if (a*b < c*d) pay $5 and $10");
  });
  test("each line is a line, a blank one stays blank, and the words join the ones around the caret", () => {
    input.value = "ab";
    input.setSelectionRange(1, 1);
    paste({ text: "X\nY\n\nZ" });
    expect(input.value).toBe("aX\nY\n\nZb");
  });
  test("a code editor's copy is its lines, whatever it dresses them in", () => {
    paste({ html: '<div style="color:#fff"><div>- not a list</div><div>**not bold**</div></div>', text: "- not a list\n**not bold**", types: ["text/plain", "text/html", "vscode-editor-data"] });
    expect(input.value).toBe("\\- not a list\n\\*\\*not bold\\*\\*");
    expect(host.querySelector("ul, strong")).toBeNull();
  });
  test("an address pasted over words makes them its link", () => {
    input.value = "see this";
    input.setSelectionRange(4, 8);
    paste({ text: "https://example.com/page" });
    expect(input.value).toBe("see [this](https://example.com/page)");
  });
  test("an address pasted alone is words like the rest", () => {
    paste({ text: "https://example.com/a_b_c" });
    expect(input.value).toBe("https://example.com/a_b_c");
  });
});

describe("what the page keeps for itself", () => {
  test("a picture on the clipboard is still the attachment's: the field does not take it", () => {
    paste({ files: [new File(["x"], "a.png", { type: "image/png" })], text: "" });
    expect(input.value).toBe("");
    expect(richFieldOf(host)).toBeDefined();
  });
});
