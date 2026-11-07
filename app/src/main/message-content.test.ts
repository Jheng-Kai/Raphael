// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { messageHTML, messagePlainText, messageUrls, shortUrl } from "./message-content";

test("URLs stop at CJK punctuation, and a bare link shows its whole address", () => {
  const url = "https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_WARN.html?lang=zh-TW&full=1";
  const text = `《答。${url}（颱風警報）。「https://example.com/a_(b)」》`;
  expect(messageUrls(text)).toEqual([url, "https://example.com/a_(b)"]);
  const el = document.createElement("div"); el.innerHTML = messageHTML(text);
  expect([...el.querySelectorAll("a")].map(a => a.dataset.url)).toEqual(messageUrls(text));
  expect([...el.querySelectorAll("a")].map(a => a.textContent)).toEqual([url, "https://example.com/a_(b)"]);
  expect(el.querySelector("a")!.getAttribute("href")).toBe(url);
  expect(el.querySelector("a")!.classList.contains("message-link")).toBe(true);
  expect(el.querySelector("a")!.hasAttribute("title")).toBe(false);
  expect(el.querySelector("a")!.hasAttribute("aria-label")).toBe(false);
  expect(el.textContent).toContain("（颱風警報）。");
});

test("a link to a file on a computer shows its path, not the markdown around it", () => {
  const el = document.createElement("div");
  el.innerHTML = messageHTML("檔案在 [index.html](/home/cua/team/office/index.html)，也可以用 [報告](C:\\Users\\me\\report.pdf)。", "", true);
  expect(el.textContent).toBe("檔案在 index.html，也可以用 C:\\Users\\me\\report.pdf。");
  expect(el.querySelectorAll("code")).toHaveLength(1);
  expect(el.querySelector("a")).toBeNull();
});

test("a file in the team folder is a real button that opens it, however the reply wrote its path", () => {
  const el = document.createElement("div");
  el.innerHTML = messageHTML("看 [頁面](/home/cua/team/office/index.html) 和 `/home/cua/team/office/check.png`，不是 `/home/cua/workspace/a.png`。", "", true);
  const buttons = [...el.querySelectorAll<HTMLButtonElement>('button[data-act="team-file-open"]')];
  expect(buttons.map(button => button.dataset.path)).toEqual(["/home/cua/team/office/index.html", "/home/cua/team/office/check.png"]);
  expect(buttons.map(button => button.textContent)).toEqual(["index.html", "check.png"]);
  expect(buttons[0].type).toBe("button");
  expect(el.querySelector("code")!.textContent).toBe("/home/cua/workspace/a.png");
});

test("a long bare link keeps its whole address on screen and in copied text, once", () => {
  const url = "https://example.com/" + "a".repeat(60) + "?secret=full#target";
  const el = document.createElement("div"); el.innerHTML = messageHTML(`See ${url}（資料）`);
  expect(el.querySelector("a")!.textContent).toBe(url);
  expect(el.querySelector("a")!.dataset.url).toBe(url);
  expect(messagePlainText(`See ${url}（資料）`, true)).toBe(`See ${url}（資料）`);
});

test("a link with its own label keeps the label and copies as label plus address", () => {
  const el = document.createElement("div");
  el.innerHTML = messageHTML("[官網](https://example.com/a?x=1)", "", true);
  expect(el.querySelector("a")!.textContent).toBe("官網");
  expect(messagePlainText("看 [官網](https://example.com/a?x=1)", true)).toBe("看 官網 (https://example.com/a?x=1)");
});

test("shortUrl still names a page by host and path, capped at 32 characters, for the places that need a short name", () => {
  expect(shortUrl("https://example.com/forecast?city=Taipei#today")).toBe("example.com/forecast");
  expect(shortUrl("https://example.com/?city=Taipei#today")).toBe("example.com");
  const url = "https://example.com/" + "a".repeat(60) + "?secret=full#target";
  expect(shortUrl(url)).toBe("example.com/" + "a".repeat(19) + "…");
  expect(shortUrl(url)).toHaveLength(32);
});

test("reply markdown renders lists, emphasis, breaks and copyable code without interpreting HTML", () => {
  const el = document.createElement("div");
  el.innerHTML = messageHTML('**bold** and *italic* with `a < b`\nnext\n\n- one\n- two\n\n1. first\n2. second\n\n```js\n<script>alert(1)</script>\n```\n<img src=x onerror=alert(1)>\n[bad](javascript:alert(1))\n[site](https://example.com/a?x=1&y=2)', "", true);
  expect(el.querySelector("strong")?.textContent).toBe("bold");
  expect(el.querySelector("em")?.textContent).toBe("italic");
  expect(el.querySelectorAll("ul li")).toHaveLength(2);
  expect(el.querySelectorAll("ol li")).toHaveLength(2);
  expect(el.querySelector("br")).not.toBeNull();
  expect(el.querySelector("pre code")?.textContent).toBe("<script>alert(1)</script>");
  expect(el.querySelector('[data-act="copy-code"]')).not.toBeNull();
  expect(el.querySelector("script,img,[onerror]")).toBeNull();
  expect(el.querySelectorAll("a")).toHaveLength(1);
  expect(el.querySelector("a")?.dataset.url).toBe("https://example.com/a?x=1&y=2");
  expect(messageUrls('`https://code.example`\n```\nhttps://code.example\n```\n[site](https://example.com)')).toEqual(["https://example.com/"]);
});
