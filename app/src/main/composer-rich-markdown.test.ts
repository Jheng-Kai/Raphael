import { describe, expect, test } from "vitest";
import { looksLikeMarkdown, offsetOf, parseMarkdown, plainWords, positionOf, serializeMarkdown } from "./composer-rich-markdown";
import { composerMarks as M, composerNodes as N, composerSchema as S } from "./composer-rich-schema";

const paragraphOf = (...inline: ReturnType<typeof S.text>[]): ReturnType<typeof N.doc.create> => N.doc.create(null, N.paragraph.create(null, inline));

const write = (text: string): string => serializeMarkdown(parseMarkdown(text)).text;
const shape = (text: string): string => {
  const parts: string[] = [];
  parseMarkdown(text).forEach(node => parts.push(node.type.name + (node.isTextblock && node.childCount === 0 ? "()" : "")));
  return parts.join(",");
};

describe("plain words come back exactly as typed", () => {
  test.each([
    "", " ", "  leading and trailing  ", "one\ntwo", "one\n\ntwo", "one\n\n\nthree", "\n", "ends with a newline\n", "\nstarts with one",
    "Owner words\nPage words <b>", "幫我用 herdr 開兩個分頁", "/usage please", " /Usage ", "a_b_c and snake_case_name", "2 * 3 * 4", "price $5 and $10",
    "C:\\Users\\jack\\file.txt", "cost: 100% (about)", "a | b", "tab\there", "emoji 🙂 text", "<div>not html</div>", "5 > 3 and 2 < 4", "1.5 apples", "#hashtag", "-5 degrees",
    "@Notion 整理這份報告", "https://example.com/a_b_c?x=1&y=2 and more", "[not a link]", "![not an image]", "a\\b", "ends with backslash\\",
  ])("%j", text => { expect(write(text)).toBe(text); });
});

describe("blocks", () => {
  test("a heading, then a numbered list of five (the owner's pasted reply)", () => {
    const text = "# 拉斐爾分開了\n\n1. 第一\n2. 第二\n3. 第三\n4. 第四\n5. 第五";
    expect(shape(text)).toBe("heading,ordered_list");
    const list = parseMarkdown(text).child(1);
    expect(list.childCount).toBe(5);
    expect(write(text)).toBe(text);
  });
  test("one blank line beside a block is its gap, a second one is a line of its own", () => {
    expect(shape("a\n\n# H\n\nb")).toBe("paragraph,heading,paragraph");
    expect(shape("a\n\n\n# H")).toBe("paragraph,paragraph(),heading");
    expect(write("a\n# H\nb")).toBe("a\n\n# H\n\nb");
  });
  test.each([
    ["## Second", "heading"], ["### Third", "heading"], ["- one\n- two", "bullet_list"], ["3. three\n4. four", "ordered_list"],
    ["- [ ] todo\n- [x] done", "bullet_list"], ["> quoted\n> more", "blockquote"], ["```js\nlet a = 1;\n```", "code_block"], ["$$\nx^2 + y^2\n$$", "math_block"], ["---", "horizontal_rule"],
    ["<details open>\n<summary>Title</summary>\n\nbody\n\n</details>", "details"], ["| a | b |\n| --- | --- |\n| 1 | 2 |", "table"],
  ])("%j is a %s", (text, type) => {
    expect(shape(text)).toBe(type);
    expect(write(text)).toBe(text);
  });
  test("lists nest by their indent and keep their numbers and ticks", () => {
    const text = "1. a\n   - b\n   - [x] c\n     1. d\n2. e";
    const doc = parseMarkdown(text);
    expect(doc.childCount).toBe(1);
    expect(write(text)).toBe(text);
    expect(doc.child(0).child(0).childCount).toBe(2);
  });
  test("an ordered list starts where it was written", () => {
    expect(parseMarkdown("5. x\n6. y").child(0).attrs.order).toBe(5);
    expect(write("5. x\n6. y")).toBe("5. x\n6. y");
  });
  test("a code block holds Markdown as words, and a longer fence holds a shorter one", () => {
    const text = "````\n```\n# not a heading\n```\n````";
    expect(shape(text)).toBe("code_block");
    expect(write(text)).toBe(text);
  });
  test("an unfinished fence takes the rest", () => { expect(shape("```py\nprint(1)")).toBe("code_block"); });
  test("a toggle with no body, and one that is closed", () => {
    expect(write("<details>\n<summary>Only a title</summary>\n</details>")).toBe("<details>\n<summary>Only a title</summary>\n</details>");
    expect(parseMarkdown("<details>\n<summary>t</summary>\n</details>").child(0).attrs.open).toBe(false);
    expect(write("<details><summary>One line</summary>body text</details>")).toBe("<details>\n<summary>One line</summary>\n\nbody text\n\n</details>");
  });
  test("a quote holds blocks", () => {
    expect(write("> # Title\n> - a\n> - b")).toBe("> # Title\n>\n> - a\n> - b");
  });
  test("a table keeps its alignment", () => {
    const text = "| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |";
    expect(write(text)).toBe(text);
  });
});

describe("inline marks", () => {
  test.each([
    "**bold**", "*italic*", "***both***", "~~gone~~", "`code`", "a **b** c", "**bold** and *italic* and `code`", "[a link](https://example.com/x)", "an equation $x^2$ inside", "a [**bold link**](https://example.com/) here",
    "https://example.com/plain_address_with_underscores",
  ])("%j", text => { expect(write(text)).toBe(text); });
  test("emphasis hugs its words: the spaces move outside", () => {
    expect(serializeMarkdown(paragraphOf(S.text(" a ", [M.strong.create()]))).text).toBe(" **a** ");
  });
  test("a stray star or underscore stays plain and is written plain", () => {
    expect(write("2*3 and 4*5")).toBe("2*3 and 4*5");
    expect(write("snake_case_here")).toBe("snake_case_here");
  });
  test("a literal marker that would read as emphasis is escaped, and reads back as it was", () => {
    const written = serializeMarkdown(paragraphOf(S.text("*not italic*"))).text;
    expect(written).toBe("\\*not italic\\*");
    expect(parseMarkdown(written).textContent).toBe("*not italic*");
  });
  test("a line that would be a heading or an item is escaped at its start", () => {
    const text = (words: string): string => serializeMarkdown(paragraphOf(S.text(words))).text;
    expect(text("# not a heading")).toBe("\\# not a heading");
    expect(text("- not an item")).toBe("\\- not an item");
    expect(text("1. not an item")).toBe("1\\. not an item");
    expect(text("> not a quote")).toBe("\\> not a quote");
    expect(parseMarkdown("\\# not a heading").textContent).toBe("# not a heading");
  });
  test("an equation needs no space inside its dollars, so prices are only words", () => {
    expect(shape("$x$")).toBe("paragraph");
    expect(parseMarkdown("pay $5 now, then $10 later").firstChild!.childCount).toBe(1);
  });
});

describe("writing is stable", () => {
  const samples = [
    "# T\n\n- a\n- b\n  - c\n\n1. x\n2. y\n\n> q\n\n```js\nk\n```\n\n---\n\ntext **b**",
    "a\n\n\nb\n# c\n\n\n\nd", "- [ ] one\n- [x] two\n\nplain", "> a\n>\n> b", "1. a\n   continued\n2. b",
    "<details open>\n<summary>S</summary>\n\n# in\n\n- a\n\n</details>\n\nafter",
  ];
  test.each(samples)("%j writes the same twice", text => {
    const once = write(text);
    expect(write(once)).toBe(once);
  });
});

describe("offsets", () => {
  test("a position and its offset find each other across a heading, a list and a quote", () => {
    const text = "# Head\n\n1. one\n2. two\n\n> quoted";
    const doc = parseMarkdown(text), { map } = serializeMarkdown(doc);
    for (const word of ["Head", "one", "two", "quoted"]) {
      const at = text.indexOf(word);
      for (let i = 0; i <= word.length; i++) {
        const pos = positionOf(map, at + i);
        expect(offsetOf(map, pos)).toBe(at + i);
        expect(doc.textBetween(pos, Math.min(doc.content.size, pos + 1), "", "").length).toBeLessThanOrEqual(1);
      }
    }
  });
  test("an escape belongs to the word after it", () => {
    const text = "\\*a\\*", doc = parseMarkdown(text), { map } = serializeMarkdown(doc);
    expect(offsetOf(map, 1)).toBe(0);
    expect(positionOf(map, 3)).toBe(3);
  });
  test("an empty line has a place", () => {
    const text = "a\n\nb", doc = parseMarkdown(text), { map } = serializeMarkdown(doc);
    expect(positionOf(map, 2)).toBe(4);
    expect(offsetOf(map, 4)).toBe(2);
  });
});

describe("what is pasted as Markdown", () => {
  test.each(["# Title", "- a\n- b", "1. one", "> quote", "```\ncode\n```", "some **bold** words", "a `code` word", "[x](https://a.b/c)", "~~gone~~", "| a | b |\n| - | - |\n| 1 | 2 |", "$x$ is"])("%j is", text => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });
  test.each(["just words", "if (a*b < c*d) return", "5 * 3 = 15", "a_b_c", "price $5 and $10", "snake_case_name here", "C:\\path\\x", "1.5 million"])("%j is not", text => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});

test("the sidebar's draft line is plain words", () => {
  expect(plainWords("# Title\n\n- a\n- **b**\n\n> quoted")).toBe("Title a b quoted");
  expect(plainWords("")).toBe("");
});

test("random words, marks and block signs write the same twice (a seeded run; a few exotic pairs of marks may differ)", () => {
  const alphabet = ["a", "b", " ", "\n", "\n", "*", "**", "_", "`", "~~", "$", "[", "](", ")", "- ", "1. ", "> ", "|", "\\", "http://x.y/z ", "[ ] ", "x"];
  let seed = 7;
  const random = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  let unstable = 0;
  for (let run = 0; run < 6000; run++) {
    let text = "";
    for (let i = 1 + Math.floor(random() * 14); i > 0; i--) text += alphabet[Math.floor(random() * alphabet.length)];
    const once = write(text);
    if (write(once) !== once) unstable++;
    parseMarkdown(once).check();
  }
  expect(unstable).toBeLessThanOrEqual(3);
});
