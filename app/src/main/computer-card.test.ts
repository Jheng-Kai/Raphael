import { afterEach, describe, expect, test } from "vitest";
import { computerCardHTML, computerResumedLineHTML, computerStateText } from "./computer-card";
import { setLocale } from "./i18n";
import { emptyTimelineState, turnHTML, type TurnLook } from "./timeline";
import type { AgentTurn, ComputerCard } from "./types";

afterEach(() => setLocale("zh-TW"));

const card = (over: Partial<ComputerCard> = {}): ComputerCard => ({
  id: "p1", seq: 1, reason: "sign_in", app: "Google Chrome", state: "control", error: null, note: null, expires_at_ms: 0, ...over,
});

const turn = (over: Partial<AgentTurn> = {}): AgentTurn => ({
  id: 12, created_at_ms: 0, question: "請在電腦上看一下 YouTube Studio 的上傳頁", route: "answer", prefix: "",
  text: "請在瀏覽器登入，完成後在這裡按「我完成了」。", detail: null, status: "done", source: "app", steps: [], task: null, ...over,
});

const LOOK: TurnLook = { face: () => "<i></i>" };
// The words as read: a tag is a space, except between the clauses of a line, which a comma joins.
const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ").replace(/(?<=[，、]) /g, "").trim();
const actions = (html: string): string[] => [...html.matchAll(/data-act="([^"]+)"/g)].map(match => match[1]);

describe("a computer card", () => {
  test("the Chrome handback opens the tab and reuses the same Done and Stop actions", () => {
    const html = computerCardHTML(card({ browser: true }));
    expect(actions(html)).toEqual(["card-stop", "card-done", "card-browser-focus"]);
    expect(html).not.toContain("data-card-screen");
    setLocale("en");
    expect(visible(computerCardHTML(card({ browser: true, reason: "certificate" }))))
      .toContain("Choose or confirm the certificate in Google Chrome.");
  });

  test("names the window to use, says the computer is the owner's and offers 接手 and 我完成了, its × skipping", () => {
    const html = computerCardHTML(card());
    expect(visible(html)).toBe("電腦 需要你 請在「Google Chrome」登入你的帳號，完成後交還控制 接手 我完成了");
    expect(actions(html)).toEqual(["card-stop", "card-takeover", "card-takeover", "card-done"]);
    // Real framed buttons; skipping is the × at the top right, never a button in the footer. No 開啟電腦 step on the owner's own computer.
    const head = html.slice(0, html.indexOf("</header>"));
    expect(head).toContain('class="btn icon row card-close" aria-label="略過" title="略過" data-act="card-stop" data-card="p1"');
    expect(html).not.toContain(">略過</button>");
    expect(html).toContain('class="btn sm pri" data-act="card-takeover" data-card="p1"');
    expect(html).not.toContain("開啟電腦");
    expect(html).toContain("<svg");
    expect(html).not.toContain("tile");
  });

  test("says why it is the owner's, in each reason's words", () => {
    expect(computerStateText(card({ reason: "password" }))).toBe("請在「Google Chrome」輸入密碼，完成後交還控制");
    expect(computerStateText(card({ reason: "payment" }))).toBe("請在「Google Chrome」完成付款，完成後交還控制");
    expect(computerStateText(card({ reason: "captcha" }))).toBe("請在「Google Chrome」完成驗證，完成後交還控制");
    expect(computerStateText(card({ reason: "other" }))).toBe("請在「Google Chrome」接手這一步，完成後交還控制");
    expect(computerStateText(card({ reason: "unheard-of" }))).toContain("接手這一步");
    // A task that had looked at no window names the computer itself.
    expect(computerStateText(card({ app: "" }))).toBe("請在「電腦」登入你的帳號，完成後交還控制");
  });

  test("each state has the actions it can take, and a form that is still there is said", () => {
    expect(actions(computerCardHTML(card({ state: "returning" })))).toEqual(["card-stop"]);
    for (const state of ["done", "stopped", "expired", "failed", "cancelled"] as const) {
      expect(actions(computerCardHTML(card({ state })))).toEqual([]);
    }
    const still = computerCardHTML(card({ note: "still" }));
    expect(visible(still)).toContain("看起來還沒完成，請再試一次");
    expect(actions(still)).toEqual(["card-stop", "card-takeover", "card-takeover", "card-done"]);
    expect(visible(computerCardHTML(card({ state: "returning" })))).toContain("已交還控制，繼續中…");
    expect(visible(computerCardHTML(card({ state: "returning" })))).not.toContain("你正在控制");
    expect(visible(computerCardHTML(card({ state: "done" })))).toContain("已交還控制 · 工作已繼續");
    // The clauses stay whole when the line wraps, in the words of Chinese and Japanese; English wraps at its spaces.
    expect(computerCardHTML(card())).toContain('請在「Google Chrome」登入你的帳號，完成後交還控制');
    setLocale("en");
    expect(computerCardHTML(card())).not.toContain("cc-clause");
    setLocale("zh-TW");
    expect(visible(computerCardHTML(card({ state: "stopped" })))).toContain("已停止，這項工作沒有繼續");
    expect(visible(computerCardHTML(card({ state: "expired" })))).toContain("已逾時，這項工作沒有繼續");
    expect(visible(computerCardHTML(card({ state: "failed", error: "interrupted" })))).toContain("連線中斷，這項工作沒有繼續");
    // Closed by its ×, or left behind when the owner wrote again: a quiet pill, never 完成.
    expect(visible(computerCardHTML(card({ state: "cancelled" })))).toMatch(/^電腦 已取消/);
    expect(visible(computerCardHTML(card({ state: "cancelled", error: "skipped" })))).toMatch(/^電腦 未回答/);
  });

  test("speaks only the window's language", () => {
    setLocale("en");
    expect(visible(computerCardHTML(card()))).toBe("Computer Action needed Sign in to your account in Google Chrome, then hand control back Take over I'm done");
    setLocale("ja");
    expect(visible(computerCardHTML(card()))).toBe("コンピューター 操作が必要 Google Chrome でアカウントにサインインし、完了したら操作を返してください 引き継ぐ 完了しました");
  });

  test("escapes the app's name", () => {
    const html = computerCardHTML(card({ app: '<script>alert(1)</script>' }));
    expect(html).not.toContain("<script>");
  });
});

describe("a turn with a computer card", () => {
  test("draws its card below what it said", () => {
    const html = turnHTML(turn({ computers: [card()] }), emptyTimelineState(), false, LOOK);
    expect(html.indexOf('data-computer-card="p1"')).toBeGreaterThan(html.indexOf("請在瀏覽器登入"));
  });

  test("a task resumed after the owner gave the computer back opens with one centred line, not the owner's words again", () => {
    const resumed = turn({ id: 13, source: "connector", resumed_computers: ["Google Chrome"], text: "頁面上的確認碼是 YT-4F2A。" });
    const html = turnHTML(resumed, emptyTimelineState(), false, LOOK);
    expect(html).not.toContain("owner-message");
    expect(html).toContain('data-resumed="13"');
    expect(visible(computerResumedLineHTML(resumed))).toBe("電腦 已交還控制，繼續原本的工作");
    expect(computerResumedLineHTML(turn())).toBe("");
  });
});
