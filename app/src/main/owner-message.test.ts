// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { messagePlainText, ownerMessageHTML, replyContentHTML } from "./message-content";
import { mentionRanges, type MentionTarget } from "./mention-text";

const html = (text: string, mentions: readonly MentionTarget[] = [], skills?: ReadonlyMap<string, number>): string => ownerMessageHTML(text, "", mentions, skills);
const dom = (text: string): HTMLElement => { const el = document.createElement("div"); el.innerHTML = html(text); return el; };

describe("the owner's own message is drawn as the reply it would be", () => {
  test("a heading and a numbered list of five (what the composer showed)", () => {
    const el = dom("# 拉斐爾分開了\n\n1. 第一\n2. 第二\n3. 第三\n4. 第四\n5. 第五");
    expect(el.querySelector("h1")?.textContent).toBe("拉斐爾分開了");
    expect([...el.querySelectorAll("ol > li")].map(li => li.textContent)).toEqual(["第一", "第二", "第三", "第四", "第五"]);
  });
  test("lists nest, tasks tick, quotes and rules stand, a line carries on its item", () => {
    const el = dom("- a\n  - b\n- [x] done\n- [ ] todo\n\n> quoted\n\n---\n\n1. one\n   still one\n2. two");
    expect(el.querySelector("ul ul li")?.textContent).toBe("b");
    expect([...el.querySelectorAll("input[type=checkbox]")].map(box => (box as HTMLInputElement).checked)).toEqual([true, false]);
    expect(el.querySelector("blockquote")?.textContent).toBe("quoted");
    expect(el.querySelector("hr")).not.toBeNull();
    expect(el.querySelector("ol li")?.innerHTML).toBe("one<br>still one");
  });
  test("plain lines are lines, and a blank line sets paragraphs apart", () => {
    expect(html("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
  });
  test("code is its own words, with no card", () => {
    const el = dom("run:\n\n```sh\nnpm test\n```\n\n`inline` too");
    expect(el.querySelector("pre.owner-code")?.getAttribute("data-language")).toBe("sh");
    expect(el.querySelector("pre.owner-code code")?.textContent).toBe("npm test");
    expect(el.querySelector(".rich-block")).toBeNull();
    expect(el.querySelector("p:last-child code")?.textContent).toBe("inline");
    expect(el.querySelector("code[data-message-path]")).toBeNull();
  });
  test("a table, an equation and a toggle", () => {
    const el = dom("| a | b |\n| --- | ---: |\n| 1 | 2 |\n\nEnergy $E=mc^2$ is\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n<details open>\n<summary>More</summary>\n\nhidden **words**\n\n</details>");
    expect(el.querySelectorAll(".owner-table th")).toHaveLength(2);
    expect(el.querySelector(".owner-table td.align-right")?.textContent).toBe("2");
    expect(el.querySelector(".math-inline[data-math='E=mc^2'] .katex")).not.toBeNull();
    expect(el.querySelector(".math-display[data-math]")?.getAttribute("data-math")).toBe("\\int_0^1 x\\,dx");
    expect(el.querySelector("details.owner-details[open] > summary")?.textContent).toBe("More");
    expect(el.querySelector("details.owner-details .details-body strong")?.textContent).toBe("words");
  });
  test("a price is words, and a star between spaces is no emphasis", () => {
    expect(html("it costs $5 and $10, 2 * 3 * 4")).toBe("<p>it costs $5 and $10, 2 * 3 * 4</p>");
  });
});

describe("what the owner wrote stays the owner's", () => {
  test("an address is a plain link in the words, its underscores are not emphasis, and no site chip is drawn", () => {
    const el = dom("see https://example.com/a_b_c_d and [the page](https://example.com/p)");
    const links = [...el.querySelectorAll("a.message-link")];
    expect(links.map(link => link.textContent)).toEqual(["https://example.com/a_b_c_d", "the page"]);
    expect(el.querySelector(".link-chip, em")).toBeNull();
  });
  test("a /skill is the owner's skill, a path is only words, and an @ is a mention chip", () => {
    const people: MentionTarget[] = [{ name: "Notion", kind: "app", mark: () => "<i></i>" }];
    const out = html("run /outline on /usr/bin and ask @Notion", people, new Map([["outline", 7]]));
    expect(out).toContain('data-act="open-owner-skill" data-skill="7"');
    expect(out).not.toContain("data-message-path");
    expect(out).toContain('<span class="mention-chip" data-mention="app">');
    expect(mentionRanges("ask @Notion", people)).toHaveLength(1);
  });
  test("what is searched for is marked", () => {
    expect(ownerMessageHTML("# Find me here", "find", [])).toContain("<mark");
  });
});

describe("a reply draws the same Markdown, and copies back as it was written", () => {
  test("a toggle is a card that opens, a display equation stands in the words", () => {
    const el = document.createElement("div");
    el.innerHTML = replyContentHTML("<details>\n<summary>Why</summary>\n\nBecause $a^2+b^2=c^2$.\n\n</details>\n\n$$\nx = 1\n$$");
    const toggle = el.querySelector<HTMLDetailsElement>("details.message-details")!;
    expect(toggle.open).toBe(false);
    expect(toggle.querySelector("summary")?.textContent).toBe("Why");
    expect(toggle.querySelector(".math-inline")?.getAttribute("data-math")).toBe("a^2+b^2=c^2");
    expect(el.querySelector(".message-text .math-display")?.getAttribute("data-math")).toBe("x = 1");
  });
  test("copying a reply keeps its equations as written", () => {
    expect(messagePlainText("Is $x^2$ big?\n\n$$\ny = 2\n$$", true)).toBe("Is $x^2$ big?\n$$\ny = 2\n$$");
  });
  test("emphasis needs words against its marks", () => {
    const el = document.createElement("div");
    el.innerHTML = replyContentHTML("2 * 3 * 4 and *real* and ** not ** and __also real__");
    expect([...el.querySelectorAll("em, strong")].map(node => node.textContent)).toEqual(["real", "also real"]);
  });
  test("a streaming toggle that has not closed yet is shown open, its words arriving", () => {
    const el = document.createElement("div");
    el.innerHTML = replyContentHTML("<details>\n<summary>Plan</summary>\n\nstep one", "", true);
    expect(el.querySelector<HTMLDetailsElement>("details")!.open).toBe(true);
  });
});

test("a group draws the owner's address as the chip a reply's is", () => {
  const el = document.createElement("div");
  el.innerHTML = ownerMessageHTML("see https://example.com/page", "", [], undefined, true);
  expect(el.querySelector("a.link-chip")?.getAttribute("data-url")).toBe("https://example.com/page");
});
