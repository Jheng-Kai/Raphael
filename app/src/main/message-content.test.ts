// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { messageHTML, messagePlainText, messageUrls, ownerTextHTML, replyContentHTML, shortUrl } from "./message-content";
import { peerChatHTML } from "./peer-chat";
import type { HandoffView } from "./types";
import { mountMessagePaths } from "./message-paths";
import { toaster } from "./ui";
import { t } from "./i18n";

const api = vi.hoisted(() => ({ checkMessagePaths: vi.fn(), openMessagePath: vi.fn() }));
vi.mock("./api", () => api);
vi.mock("../shared/platform", async importOriginal => ({
  ...await importOriginal<typeof import("../shared/platform")>(),
  IS_MAC: false,
}));

test("authored Windows paths display as native paths in bare, code and Markdown forms", () => {
  const el = document.createElement("div");
  const text = 'Report /D:/Team/report.md, `D:/Team/notes.txt` and [folder](</D:/Team/Some Folder>).\n\n```\nD:/Team/example.txt\n```';
  el.innerHTML = messageHTML(text, "", true);
  expect([...el.querySelectorAll("code[data-message-path]")].map(code => code.textContent)).toEqual([
    "D:\\Team\\report.md", "D:\\Team\\notes.txt", "D:\\Team\\Some Folder",
  ]);
  expect(el.querySelector("pre code")?.textContent).toBe("D:/Team/example.txt");
  expect(el.querySelector('[role="link"]')).toBeNull();
  expect(messageHTML("Report /Users/me/report.md", "", true)).toContain(">/Users/me/report.md</code>");
});

test("a link to a file by its file:// address shows the path it names, which a table can wrap, never the raw link", () => {
  // A reply linked Docker.raw as file:///Users/…: the whole link stood as words, too long to break, and its table ran past
  // the card, hiding the columns on the right (R-UI-167).
  const el = document.createElement("div");
  const table = "| 量測項目 | 清理前 | 清理後 |\n| --- | --- | --- |\n" +
    "| Docker 虛擬磁碟（[Docker.raw](file:///Users/me/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw)） | 19.33 GB | 14.45 GB |";
  el.innerHTML = replyContentHTML(table, "");
  expect(el.textContent).not.toContain("](file:");
  expect(el.textContent).not.toContain("file://");
  const path = el.querySelector<HTMLElement>(".message-table td code[data-message-path]");
  expect(path?.dataset.messagePath).toBe("/Users/me/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw");
  expect(path?.closest("td")?.classList.contains("short")).toBe(false);
  expect(messageHTML("[報告](file:///Users/me/My%20Files/report.md)", "", true)).toContain(">/Users/me/My Files/report.md</code>");
  expect(messageHTML("[D](file:///D:/Team/a.txt)", "", true)).toContain(">D:\\Team\\a.txt</code>");
  // Another host's address is no path of this computer, and stays as it was written.
  expect(messageHTML("[x](file://server/share/a.txt)", "", true)).not.toContain("data-message-path");
});

test("a file linked under its own name shows that name, with its whole path as the title and the press", () => {
  // A file manager's reply listed four files of one folder as four whole paths, and [`.lab`](…/.lab) said its name twice
  // (R-UI-185). The owner's three link forms: a plain name, a name in code marks, and an encoded space.
  const el = document.createElement("div");
  el.innerHTML = messageHTML("實驗紀錄（[`.lab`](file:///Users/me/HeHe/.lab)）\n\n- [firebase-defines.json](file:///Users/me/HeHe/.lab/firebase-defines.json)、" +
    "[ios.xcconfig](file:///Users/me/HeHe/.lab/ios.xcconfig)\n- [Antigravity](file:///Users/me/Library/Application%20Support/Antigravity/)\n" +
    "- [uv 快取](file:///Users/me/.cache/uv)", "", true);
  const codes = [...el.querySelectorAll<HTMLElement>("code[data-message-path]")];
  expect(codes.map(code => code.textContent)).toEqual([".lab", "firebase-defines.json", "ios.xcconfig", "Antigravity", "/Users/me/.cache/uv"]);
  expect(codes.map(code => code.dataset.messagePath)).toEqual(["/Users/me/HeHe/.lab", "/Users/me/HeHe/.lab/firebase-defines.json",
    "/Users/me/HeHe/.lab/ios.xcconfig", "/Users/me/Library/Application Support/Antigravity/", "/Users/me/.cache/uv"]);
  expect(codes.slice(0, 4).map(code => code.title)).toEqual(codes.slice(0, 4).map(code => code.dataset.messagePath));
  // A label of other words keeps them beside the whole path.
  expect(el.textContent).toContain("uv 快取 /Users/me/.cache/uv");
  expect(el.textContent).not.toMatch(/\]\(|file:|%20|`/);
});

test("only a checked path becomes a plain-looking keyboard link with a quiet failure notice", async () => {
  const root = document.createElement("div");
  const path = "/Users/me/allowed/report.md";
  const outside = "/Users/me/elsewhere/report.md";
  root.innerHTML = `<div data-path-member="7">${messageHTML(`Report ${path} or ${outside}`, "report", true)}</div>`;
  api.checkMessagePaths.mockResolvedValue({ allowed: [path] });
  api.openMessagePath.mockResolvedValue(undefined);
  mountMessagePaths(root)([root]);
  const [inside, external] = root.querySelectorAll("code");
  expect(inside.getAttribute("role")).toBeNull();
  await Promise.resolve();
  expect(api.checkMessagePaths).toHaveBeenCalledWith(7, [path, outside]);
  expect(inside.getAttribute("role")).toBe("link");
  expect(inside.tabIndex).toBe(0);
  expect(inside.querySelector("mark")?.textContent).toBe("report");
  expect(inside.hasAttribute("title")).toBe(false);
  expect(inside.hasAttribute("data-tooltip")).toBe(false);
  expect(external.getAttribute("role")).toBeNull();
  expect(external.hasAttribute("tabindex")).toBe(false);
  external.click();
  expect(api.openMessagePath).not.toHaveBeenCalled();
  inside.click();
  expect(api.openMessagePath).toHaveBeenCalledExactlyOnceWith(7, path);

  const notice = vi.spyOn(toaster, "info").mockImplementation(() => {});
  try {
    api.openMessagePath.mockRejectedValueOnce(new Error("file unavailable"));
    inside.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await Promise.resolve();
    expect(api.openMessagePath).toHaveBeenCalledTimes(2);
    expect(notice).toHaveBeenCalledExactlyOnceWith(t("agent.pathUnavailable"));
  } finally {
    notice.mockRestore();
  }

  const css = readFileSync(join(import.meta.dirname, "agent.css"), "utf8");
  const style = 'code[data-message-path][role="link"]';
  const hover = css.split(`${style}:is(:hover, :focus-visible) {`)[1]?.split("}")[0];
  expect(hover).toContain("cursor: pointer");
  expect(hover).toContain("text-decoration: underline");
  expect(hover).not.toMatch(/\bcolor:/);
  expect(css).toContain(`:root[data-keys] ${style}:focus-visible { outline: 2px solid var(--focus)`);
});

test("URLs stop at CJK punctuation, and a bare link is a chip that says its site", () => {
  const url = "https://www.cwa.gov.tw/V8/C/P/Typhoon/TY_WARN.html?lang=zh-TW&full=1";
  const text = `《答。${url}（颱風警報）。「https://example.com/a_(b)」》`;
  expect(messageUrls(text)).toEqual([url, "https://example.com/a_(b)"]);
  const el = document.createElement("div"); el.innerHTML = messageHTML(text);
  expect([...el.querySelectorAll("a")].map(a => a.dataset.url)).toEqual(messageUrls(text));
  expect([...el.querySelectorAll("a")].map(a => a.textContent)).toEqual(["cwa.gov.tw", "example.com"]);
  expect(el.querySelector("a")!.classList.contains("link-chip")).toBe(true);
  expect(el.querySelector("a")!.getAttribute("href")).toBe(url);
  expect(el.querySelector("a")!.classList.contains("message-link")).toBe(true);
  expect(el.querySelector("a")!.hasAttribute("title")).toBe(false);
  expect(el.querySelector("a")!.hasAttribute("aria-label")).toBe(false);
  expect(el.textContent).toContain("（颱風警報）。");
});

test("a link to a file on a computer shows its path, not the markdown around it", () => {
  const el = document.createElement("div");
  el.innerHTML = messageHTML("檔案在 [index.html](/home/cua/team/office/index.html)，也可以用 [報告](C:\\Users\\me\\report.pdf)。", "", true);
  expect(el.textContent).toBe("檔案在 index.html，也可以用 報告 C:\\Users\\me\\report.pdf。");
  expect(el.querySelectorAll("code")).toHaveLength(1);
  expect(el.querySelector("a")).toBeNull();
});

test("a link in <...> or with a title is read as CommonMark reads it, whatever model wrote it", () => {
  const el = document.createElement("div");
  el.innerHTML = messageHTML('[開啟新聞課](<D:\\Documentation\\bots\\raphael\\daily lesson.html>) 與 [範本](<D:\\x\\template.html> "範本")，來源 [NHK](https://www3.nhk.or.jp/news/ "NHK")。', "", true);
  expect(el.textContent).toBe("開啟新聞課 D:\\Documentation\\bots\\raphael\\daily lesson.html 與 範本 D:\\x\\template.html，來源 NHK。");
  expect(el.innerHTML).not.toContain("](");
  expect([...el.querySelectorAll("code")].map(code => code.textContent)).toEqual(["D:\\Documentation\\bots\\raphael\\daily lesson.html", "D:\\x\\template.html"]);
  expect(el.querySelector("a")!.dataset.url).toBe("https://www3.nhk.or.jp/news/");
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

test("a long bare link says its site on screen, opens its whole address and copies it whole, once", () => {
  const url = "https://example.com/" + "a".repeat(60) + "?secret=full#target";
  const el = document.createElement("div"); el.innerHTML = messageHTML(`See ${url}（資料）`);
  expect(el.querySelector("a")!.textContent).toBe("example.com");
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

test("an unclosed link label cannot swallow a later link or list item", () => {
  const el = document.createElement("div");
  el.innerHTML = messageHTML("1. [Unfinished [Vendor](https://example.com/)\n2. Keep reading.", "", true);
  expect(el.querySelector("a")?.textContent).toBe("Vendor");
  expect(el.querySelector("li")?.textContent).toBe("Unfinished Vendor");
  expect(el.querySelector("li:last-child")?.textContent).toBe("Keep reading.");
  el.innerHTML = messageHTML("[Draft](https://example.com/path\n\nAfter the draft.", "", true);
  expect(el.querySelector("p:last-child")?.textContent).toBe("After the draft.");
});

test("a code fence at end of reply keeps all source readable", () => {
  const el = document.createElement("div");
  el.innerHTML = messageHTML('Before\n\n```json\n{"text":"Example"}\nmore source', "", true);
  expect(el.querySelector("p")?.textContent).toBe("Before");
  expect(el.querySelector("pre code")?.textContent).toBe('{"text":"Example"}\nmore source');
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

const IDENTIFIERS = "請用 connections_list 查詢，回報 your_connections 與 COMPOSIO_SEARCH_TOOLS、COMPOSIO_MULTI_EXECUTE_TOOL，再讀 GMAIL_GET_PROFILE 和 GOOGLESHEETS_GET_SPREADSHEET_INFO 的 spreadsheet_id";

test("an underscore inside a word is never emphasis: identifiers keep their underscores and nothing turns italic", () => {
  const el = document.createElement("div");
  for (const html of [messageHTML(IDENTIFIERS, "", true), replyContentHTML(IDENTIFIERS)]) {
    el.innerHTML = html;
    expect(el.querySelector("em, strong")).toBeNull();
    expect(el.textContent).toBe(IDENTIFIERS);
  }
  for (const text of ["connections_list your_connections COMPOSIO_SEARCH_TOOLS spreadsheet_id", "用connections_list查詢，回報your_connections", "中文_list_中文", "a_b_c_d", "snake__case__name and my_module__init__x"]) {
    el.innerHTML = messageHTML(text, "", true);
    expect(el.querySelector("em, strong")).toBeNull();
    expect(el.textContent).toBe(text);
  }
});

test("the owner's own words and a message handed between members show their underscores as written", () => {
  const el = document.createElement("div");
  el.innerHTML = ownerTextHTML(IDENTIFIERS, "", []);
  expect(el.querySelector("em")).toBeNull();
  expect(el.textContent).toBe(IDENTIFIERS);
  const task = { task_id: 9, source_turn_id: 1, work_turn_id: 2, member_id: 3, member_name: "行銷", from_member_id: 4, stage_id: "s", mode: "work", state: "done", reason: null,
    created_at_ms: 1000, ready_at_ms: 1000, dispatch_policy: "immediate", request: IDENTIFIERS, result: "已查 connections_list 與 your_connections", evidence: [] } as HandoffView;
  el.innerHTML = peerChatHTML(4, [task], (id, fallback) => ({ name: fallback || String(id), face: "", accent: "#000" }), 2000);
  expect(el.querySelector(".peer-thread em")).toBeNull();
  const said = [...el.querySelectorAll(".message-text")].map(node => node.textContent);
  expect(said).toEqual([IDENTIFIERS, "已查 connections_list 與 your_connections"]);
});

test("emphasis between word boundaries still works beside identifiers", () => {
  const el = document.createElement("div");
  el.innerHTML = messageHTML("_real_ and **bold** and *star* and __loud__ and 這是，_重點_，也有 snake_case 與 _again_ 以及 **用 your_connections 查**", "", true);
  expect([...el.querySelectorAll("em")].map(node => node.textContent)).toEqual(["real", "star", "重點", "again"]);
  expect([...el.querySelectorAll("strong")].map(node => node.textContent)).toEqual(["bold", "loud", "用 your_connections 查"]);
  expect(el.textContent).toContain("snake_case");
  el.innerHTML = messageHTML("_one_two_ and (_in parentheses_) and `a_b` and [x_y](https://example.com/a_b_c)", "", true);
  expect([...el.querySelectorAll("em")].map(node => node.textContent)).toEqual(["one_two", "in parentheses"]);
  expect(el.querySelector("code")?.textContent).toBe("a_b");
});
