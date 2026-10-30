// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { messageHTML, messagePlainText, messageUrls, parseMessageBlocks, replyContentHTML, tablePlainText } from "./message-content";

const table = '| Name | Value | Notes |\n| :--- | :---: | ---: |\n| **Alpha** | `a|b` | [site](https://example.com) |\n| <img src=x onerror=alert(1)> | a\\|b | 中文長句 |';
test("typed replies preserve ordered text, aligned tables, code, diagrams and image cards outside bubbles", () => {
  const source = `Before\n\n${table}\n\nAfter\n\n\`\`\`bash\necho hello\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\nA-->B\n\`\`\`\n![preview](https://images.example/a.png?secret=synthetic)\nDone`;
  const blocks = parseMessageBlocks(source);
  expect(blocks.map(block => block.type)).toEqual(["text", "table", "text", "code", "diagram", "image", "text"]);
  const el = document.createElement("div"); el.innerHTML = replyContentHTML(source);
  expect(el.querySelectorAll(".ans")).toHaveLength(3);
  expect(el.querySelector(".ans .rich-block")).toBeNull();
  expect(el.querySelectorAll(".message-table th")).toHaveLength(3);
  expect([...el.querySelectorAll("th")].map(cell => cell.className)).toEqual(["align-left", "align-center", "align-right"]);
  expect(el.querySelector("td code")?.textContent).toBe("a|b");
  expect(el.querySelectorAll(".message-table strong, .message-table a")).toHaveLength(2);
  expect(el.querySelector("img,script,[onerror]")).toBeNull();
  expect(el.textContent).toContain("<img src=x onerror=alert(1)>");
  expect(el.querySelector("[src]")).toBeNull();
  expect(messageUrls(source)).toEqual(["https://example.com/"]);
  expect(messagePlainText(source, true)).toContain(table);
  expect(messagePlainText(source, true)).toContain("flowchart LR\nA-->B");
  expect(tablePlainText(table)).toContain("Alpha\ta|b\tsite (https://example.com/)");
});

test("unclosed fences and streaming table cuts retain usable source until complete", () => {
  const unclosed = parseMessageBlocks('Intro\n```mermaid\nflowchart LR\nA-->');
  expect(unclosed[1]).toMatchObject({ type: "diagram", complete: false, source: "flowchart LR\nA-->" });
  expect(replyContentHTML('```mermaid\nflowchart LR\nA-->')).toContain('data-complete="false"');
  expect(replyContentHTML('```mermaid\nflowchart LR\nA-->B\n```')).not.toContain('rich-language">mermaid<');
  expect(parseMessageBlocks('| A | B |\n| --- | --- |\n| cut', true)[0].type).toBe("text");
  expect(parseMessageBlocks('| A | B |\n| --- | --- |\n| cut | row |\n', true)[0].type).toBe("table");
  expect(parseMessageBlocks('| A | B |\n| --- | --- |\n| final | row |')[0].type).toBe("table");
});

test("headings, quotes, rules, tasks and nested lists remain escaped text inside a bubble", () => {
  const el = document.createElement("div");
  el.innerHTML = replyContentHTML('# Heading\n\n> Quoted **text**\n\n---\n\n- [x] Done\n  - nested\n- [ ] Next\n\n~~old~~ <script>bad()</script>', "nested");
  expect(el.querySelector(".ans h1")?.textContent).toBe("Heading");
  expect(el.querySelector("blockquote strong")?.textContent).toBe("text");
  expect(el.querySelector("hr")).not.toBeNull();
  expect(el.querySelector("ul ul li mark")?.textContent).toBe("nested");
  expect(el.querySelectorAll('input[type="checkbox"]:disabled')).toHaveLength(2);
  expect(el.querySelector("del")?.textContent).toBe("old");
  expect(el.querySelector("script")).toBeNull();
  expect(messageHTML(table, "Alpha", true)).toContain("<mark>Alpha</mark>");
});

test("owner messages retain literal Markdown and never gain rich cards", () => {
  const el = document.createElement("div"); el.innerHTML = messageHTML(table + '\n![alt](https://example.com/a.png)');
  expect(el.querySelector("table,img,.rich-block,strong")).toBeNull();
  expect(el.textContent).toContain("| Name | Value | Notes |");
});

test("image syntax in code and unfinished image URLs never become link-preview requests", () => {
  expect(parseMessageBlocks('`![alt](https://images.example/a.png)`')[0].type).toBe("text");
  expect(messageUrls('`![alt](https://images.example/a.png)`')).toEqual([]);
  expect(messageUrls('![alt](https://images.example/private?secret=partial')).toEqual([]);
  expect(parseMessageBlocks('![alt](https://images.example/a_(b).png)')[0]).toMatchObject({ type: "image", url: "https://images.example/a_(b).png" });
  expect(parseMessageBlocks('\\![alt](https://images.example/a.png)')[0].type).toBe("text");
  expect(messageUrls('\\![alt](https://images.example/a.png)')).toEqual([]);
});
