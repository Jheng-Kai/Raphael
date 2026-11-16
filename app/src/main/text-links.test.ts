// @vitest-environment happy-dom
// Words that are read whole show their web addresses as links (R-LINK-01): one helper draws them (`linkedText`), one
// listener opens them (`link-opener.ts`), and every surface that reads words whole goes through both.
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("./api", async (original) => ({ ...(await original<typeof import("./api")>()), openExternalUrl: vi.fn() }));

import * as api from "./api";
import { closePanel, openEventDetail } from "./calendar-popover";
import { cardHTML } from "./card";
import { connectorCardHTML } from "./connector-card";
import { setLocale } from "./i18n";
import { installLinkOpener } from "./link-opener";
import { mailCardHTML } from "./mail-card";
import { templateContents } from "./member-templates";
import { bareUrl, linkedText } from "./message-content";
import { ownerQuestionHTML, permissionCardHTML } from "./permission-card";
import { roomBoardHTML } from "./room-meeting";
import { routineViewHTML } from "./routine-view";
import { reviewPageHTML } from "./template-review";
import { stepHTML } from "./timeline";
import type { AgentStep, MailDraftCard, OwnerQuestion, PermissionCard, Routine } from "./types";
import { updateHTML } from "./updates";

const opened = vi.mocked(api.openExternalUrl);
const links = (html: string): HTMLAnchorElement[] => {
  const box = document.createElement("div");
  box.innerHTML = html;
  return [...box.querySelectorAll<HTMLAnchorElement>("a")];
};
const shown = (html: string): string[] => links(html).map(link => link.textContent ?? "");
/** The words of the links that plain text becomes. */
const linked = (text: string): string[] => shown(linkedText(text));
const targets = (html: string): string[] => links(html).map(link => link.dataset.url ?? "");

describe("linkedText", () => {
  test("a full stop, comma, closing bracket or CJK punctuation after an address ends it", () => {
    expect(linked("See https://example.com/a. Then go.")).toEqual(["https://example.com/a"]);
    expect(linked("Open https://example.com/a, then https://example.com/b; done")).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(linked("請看https://example.com/a。")).toEqual(["https://example.com/a"]);
    expect(linked("網址https://example.com/a，或https://example.com/b、再看")).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(linked("「https://example.com/a」《https://example.com/b》（https://example.com/c）")).toEqual(["https://example.com/a", "https://example.com/b", "https://example.com/c"]);
    expect(linked("He said “https://example.com/a” and left")).toEqual(["https://example.com/a"]);
  });

  test("an address in brackets leaves the bracket out, one with brackets of its own keeps them", () => {
    expect(linked("(see https://example.com/page)")).toEqual(["https://example.com/page"]);
    expect(linked("[https://example.com/page]")).toEqual(["https://example.com/page"]);
    expect(linked("(see https://example.com/page).")).toEqual(["https://example.com/page"]);
    const wiki = "https://en.wikipedia.org/wiki/Mercury_(planet)";
    expect(linked(`Read ${wiki} first`)).toEqual([wiki]);
    expect(linked(`(${wiki})`)).toEqual([wiki]);
  });

  test("percent codes, a query and a fragment stay in the address, which opens whole", () => {
    const url = "https://example.com/a%20b/c_(d)?q=%E9%A2%B1&lang=zh-TW&x=1#part-2";
    const html = linkedText(`看 ${url}。`);
    expect(shown(html)).toEqual([url]);
    expect(targets(html)).toEqual([url]);
    expect(links(html)[0]!.getAttribute("href")).toBe(url);
  });

  test("two addresses on one line are two links, and the words between them stay words", () => {
    const html = linkedText("a https://one.example.com/x and http://two.example.com/y b");
    expect(shown(html)).toEqual(["https://one.example.com/x", "http://two.example.com/y"]);
    const box = document.createElement("div"); box.innerHTML = html;
    expect(box.textContent).toBe("a https://one.example.com/x and http://two.example.com/y b");
  });

  test("Chinese, Japanese or Korean words right after an address end it, unless they start a part of the address", () => {
    expect(linked("https://example.com看這裡")).toEqual(["https://example.com"]);
    expect(linked("詳見https://example.com/docs/intro說明")).toEqual(["https://example.com/docs/intro"]);
    expect(linked("https://example.com/aはこちら")).toEqual(["https://example.com/a"]);
    expect(linked("https://example.com/a여기")).toEqual(["https://example.com/a"]);
    expect(linked("頁面 https://zh.wikipedia.org/wiki/臺北 很長")).toEqual(["https://zh.wikipedia.org/wiki/臺北"]);
    expect(linked("搜尋 https://example.com/search?q=颱風&lang=zh看")).toEqual(["https://example.com/search?q=颱風&lang=zh"]);
    expect(bareUrl("https://example.com看這裡")).toBe("https://example.com");
  });

  test("a very long address is shown whole: its words are the address, never cut", () => {
    const url = `https://example.com/${"segment-".repeat(60)}end?key=${"v".repeat(200)}#frag`;
    expect(linked(`前 ${url} 後`)).toEqual([url]);
    expect(linkedText(url)).not.toContain("…");
  });

  test("everything around the address is escaped, and the address itself can carry no markup", () => {
    const html = linkedText(`<b>"x" & 'y'</b> <https://example.com/a?b=1&c=2> "https://example.com/q"`);
    expect(html).toContain("&lt;b&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/b&gt; &lt;");
    expect(shown(html)).toEqual(["https://example.com/a?b=1&c=2", "https://example.com/q"]);
    expect(html).not.toMatch(/<b>|<script/);
    expect(links(linkedText(`https://example.com/"><img src=x onerror=alert(1)>`))[0]!.dataset.url).toBe("https://example.com/");
    const box = document.createElement("div"); box.innerHTML = linkedText(`https://example.com/"><img src=x onerror=alert(1)>`);
    expect(box.querySelector("img")).toBeNull();
  });

  test("javascript:, data:, file:, a bare www. and an address with a sign-in in it are never links", () => {
    for (const text of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///C:/Users/a.txt", "www.example.com", "ftp://example.com/a", "https://user:pass@example.com/a", "https://"]) {
      expect(links(linkedText(text)), text).toEqual([]);
      const box = document.createElement("div"); box.innerHTML = linkedText(text);
      expect(box.textContent).toBe(text);
    }
  });

  test("a link says the address and nothing else: no title, no label, no other words", () => {
    const [link] = links(linkedText("https://example.com/page"));
    expect(link!.textContent).toBe("https://example.com/page");
    expect(link!.hasAttribute("title")).toBe(false);
    expect(link!.hasAttribute("aria-label")).toBe(false);
    expect(link!.className).toBe("message-link");
    expect(link!.dataset.act).toBe("open-url");
  });
});

describe("the link opener", () => {
  beforeAll(() => installLinkOpener());
  beforeEach(() => { opened.mockReset(); opened.mockResolvedValue(undefined); document.body.innerHTML = ""; });

  /** Words with a link inside a row that opens on a press, as a list row or a card that opens does. */
  const row = (): { row: HTMLElement; link: HTMLAnchorElement; outer: ReturnType<typeof vi.fn> } => {
    const outer = vi.fn();
    const row = document.createElement("div");
    row.setAttribute("role", "button"); row.tabIndex = 0;
    row.innerHTML = `<span class="words">${linkedText("詳見 https://example.com/report 的內容")}</span>`;
    row.addEventListener("click", outer);
    document.body.append(row);
    return { row, link: row.querySelector("a")!, outer };
  };
  const press = (target: Element, init: MouseEventInit & { type?: string } = {}): MouseEvent => {
    const event = new MouseEvent(init.type ?? "click", { bubbles: true, cancelable: true, button: 0, ...init });
    target.dispatchEvent(event);
    return event;
  };

  test("a press opens the address once in the browser and never the row around it, which a press beside the link still opens", () => {
    const { row: around, link, outer } = row();
    const event = press(link);
    expect(event.defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith("https://example.com/report");
    expect(outer).not.toHaveBeenCalled();
    press(around.querySelector(".words")!);
    expect(outer).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledTimes(1);
  });

  test("Ctrl, Shift and a middle click open it the same way, and a right click is left to the app's menu", () => {
    const { link, outer } = row();
    press(link, { ctrlKey: true });
    press(link, { shiftKey: true });
    const middle = press(link, { type: "auxclick", button: 1 });
    expect(middle.defaultPrevented).toBe(true);
    expect(opened).toHaveBeenCalledTimes(3);
    const right = press(link, { type: "auxclick", button: 2 });
    expect(right.defaultPrevented).toBe(false);
    expect(opened).toHaveBeenCalledTimes(3);
    expect(outer).not.toHaveBeenCalled();
  });

  test("only an http or https address reaches the shell, and a disabled opener opens nothing", () => {
    document.body.innerHTML = `<a href="#" data-act="open-url" data-url="javascript:alert(1)">x</a><button type="button" data-act="open-url" data-url="https://example.com/" disabled>y</button>`;
    press(document.querySelector("a")!);
    press(document.querySelector("button")!);
    expect(opened).not.toHaveBeenCalled();
  });

  test("an address the shell refuses tells the owner instead of failing silently", async () => {
    opened.mockRejectedValueOnce(new Error("that link may not be opened"));
    const { toaster } = await import("./ui");
    const info = vi.spyOn(toaster, "info").mockImplementation(() => undefined as never);
    press(row().link);
    await vi.waitFor(() => expect(info).toHaveBeenCalledTimes(1));
    info.mockRestore();
  });
});

describe("every surface that reads words whole", () => {
  beforeAll(() => installLinkOpener());
  beforeEach(() => { opened.mockReset(); opened.mockResolvedValue(undefined); document.body.innerHTML = ""; setLocale("zh-TW"); });
  afterEach(() => closePanel());

  const URL_IN_WORDS = "從任務看板同步。詳細內容請看https://notes.example.com/p/weekly-report-1f2e3d4c?pvs=4#summary。下週再確認。";
  const TARGET = "https://notes.example.com/p/weekly-report-1f2e3d4c?pvs=4#summary";
  /** Mounted in a row that opens on a press, as a page's own delegated handler would be: the link alone opens, once. */
  const pressedOnce = (html: string): void => {
    const outer = vi.fn();
    const host = document.createElement("div");
    host.innerHTML = html;
    host.addEventListener("click", outer);
    document.body.append(host);
    const link = [...host.querySelectorAll<HTMLAnchorElement>("a.message-link")].find(a => a.dataset.url === TARGET);
    expect(link, "the address is a link").toBeTruthy();
    expect(link!.textContent).toBe(TARGET);
    link!.click();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith(TARGET);
    expect(outer).not.toHaveBeenCalled();
    opened.mockClear();
    host.remove();
  };

  test("the calendar's detail card links the address in its notes, opens it once and stays open", () => {
    const onEdit = vi.fn(), onClose = vi.fn();
    const start = new Date(2026, 9, 24).getTime();
    const panel = openEventDetail({ left: 100, right: 200, top: 100 }, { id: "own:9", kind: "own", title: "專案週報", start, end: start + 86_400_000, allDay: true, source: "own", notes: URL_IN_WORDS }, { onEdit, onClose });
    const notes = panel.el.querySelector(".au-pop-notes")!;
    expect(notes.textContent).toBe(URL_IN_WORDS);
    const link = notes.querySelector<HTMLAnchorElement>("a.message-link")!;
    expect(link.textContent).toBe(TARGET);
    link.click();
    expect(opened).toHaveBeenCalledTimes(1);
    expect(opened).toHaveBeenCalledWith(TARGET);
    expect(panel.el.isConnected).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("a card's words and a question's title link the address", () => {
    pressedOnce(cardHTML({ title: "整理完成", status: "done", body: URL_IN_WORDS }));
    const question: OwnerQuestion = { id: "q", task_id: 1, turn_id: 1, member_id: 1, kind: "ask_owner", card_id: "", question: `要用這一份嗎？${TARGET}`, options: ["好", "不要"], free_text: false, state: "asked", result: null, subtitle: URL_IN_WORDS };
    const html = ownerQuestionHTML(question);
    expect(targets(html)).toEqual([TARGET, TARGET]);
    pressedOnce(html.replace(/(<b class="card-title[^>]*>)[\s\S]*?<\/b>/, "$1</b>"));
    // A card title that is one line, cut short, stays words.
    expect(links(cardHTML({ title: TARGET, status: "done" }))).toEqual([]);
  });

  test("a permission card links the message it would send and the step it asks for", () => {
    const card: PermissionCard = { id: "p", source: "ask", kind: "tool", service: "Slack", tool: "SLACK_SEND_MESSAGE", summary: `讀取 ${TARGET}`, reason: null, digest: "d", always: false, state: "pending", expires_at_ms: 0,
      message: { workspace: "範例", to: "#規劃", body: URL_IN_WORDS } } as PermissionCard;
    // The message it would send stands in its well; a step with no message shows the step itself there.
    pressedOnce(permissionCardHTML(card));
    pressedOnce(permissionCardHTML({ ...card, message: undefined }));
  });

  test("a sent mail's words, a connection's technical reason and a room's decisions link the address", () => {
    const mail = { id: "m", mode: "card", state: "sent", version: 1, digest: "a".repeat(64), from: { key: "k", name: "Gmail" }, senders: [], to: "mei@example.com", cc: "",
      subject: "週報", body: URL_IN_WORDS, offer: null, error: null, holder_id: 1, author_name: "" } as MailDraftCard;
    pressedOnce(mailCardHTML(mail));
    pressedOnce(connectorCardHTML({ id: "c", app: "notes", name: "Notes", state: "failed", error: "unknown", detail: URL_IN_WORDS, reconnect: false, tool_count: null, expires_at_ms: 0, resumed: false } as never));
    pressedOnce(roomBoardHTML([], [{ text: URL_IN_WORDS } as never]));
  });

  test("a routine's instructions link the address", () => {
    const routine: Routine = { id: 4, member_id: 1, title: "週報", prompt: URL_IN_WORDS, schedule: { kind: "daily", time: "08:00" }, enabled: true, last_run: null, next_run: null };
    pressedOnce(routineViewHTML(routine, []));
  });

  test("a template's words, a connected step's result and the release notes link the address", () => {
    const template = { format: "raphael-member", version: 1, name: "Planner", role: "Planner", personality: "", instructions: URL_IN_WORDS, reply_style: "full", skills: [], routines: [], connections: [], description: "" } as never;
    pressedOnce(reviewPageHTML(template, { kind: "context" }).body);
    pressedOnce(templateContents(template));
    const step = { tool: "GMAIL_FETCH_EMAILS", server: "composio", outcome: "ok", ms: 10, detail: URL_IN_WORDS, args: {} } as unknown as AgentStep;
    pressedOnce(stepHTML(step, false));
    pressedOnce(updateHTML({ state: "found", version: "1.5.0", notes: URL_IN_WORDS, error: "" }, false));
  });

  test("text that is edited stays text: the calendar's form keeps the address in its field", async () => {
    const { openEventEditor } = await import("./calendar-popover");
    const start = new Date(2026, 9, 24, 9).getTime();
    const panel = openEventEditor({ left: 100, right: 200, top: 100 }, { id: 9, title: "專案週報", start, end: start + 3_600_000, allDay: false, notes: URL_IN_WORDS }, { onSaved: () => undefined });
    expect(panel.el.querySelector("textarea")!.value).toBe(URL_IN_WORDS);
    expect(panel.el.querySelector("a")).toBeNull();
  });
});
