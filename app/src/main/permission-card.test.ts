import { readFileSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "./i18n";
import { connectionMarkHTML } from "./secret-card";
import { permissionCardHTML, permissionCardsHTML, permissionFor, permissionStateText } from "./permission-card";
import { emptyTimelineState, turnHTML, type TurnLook } from "./timeline";
import type { AgentTurn, PermissionCard } from "./types";

afterEach(() => setLocale("zh-TW"));

test("payment approval shows merchant, amount and card label without expanding details", () => {
  const summary = "Company travel · https://shop.example · NT$ 1,280 · You complete payment.";
  const html = permissionCardHTML(card({ tool: "fill_card", service: "Computer", summary, always: false }));
  expect(html).toContain(`<p class="card-body cc-state">${summary}</p>`);
  expect(actions(html)).toEqual(["perm-once", "perm-deny"]);
  expect(html).not.toContain('class="card-detail"');
});

test("real app permissions name their member and action in all window languages", () => {
  const words = {
    "zh-TW": ["Alex想要傳送 Slack 訊息", "Alex想要寄信", "Alex想要使用 Slack"],
    en: ["Alex wants to send a Slack message", "Alex wants to send an email", "Alex wants to use Slack"],
    ja: ["Alex が Slack のメッセージを送信しようとしています", "Alex がメールを送信しようとしています", "Alex が Slack を使用しようとしています"],
  } as const;
  for (const locale of ["zh-TW", "en", "ja"] as const) {
    setLocale(locale);
    const cases = [
      card({ service: "Slack", tool: "SLACK_SEND_MESSAGE", message: { to: "#planning", body: "Exact message" } }),
      card({ service: "Gmail", tool: "GMAIL_SEND_EMAIL", message: { to: "reader@example.invalid", subject: "Plan", body: "Exact email" } }),
      card({ service: "Slack", tool: "SLACK_UNKNOWN_ACTION" }),
    ];
    cases.forEach((permission, index) => {
      const html = turnHTML(turn({ member_id: 1, permissions: [permission] }), emptyTimelineState(), false, { ...LOOK, memberName: () => "Alex" });
      expect(html).toContain(`<b class="card-title cc-name">${words[locale][index]}</b>`);
      expect(html).not.toContain('class="card-body cc-state"');
      expect(html).not.toContain("Composio");
    });
  }
});

test("Raphael permission headings use the window language even if the roster name is English", () => {
  for (const [locale, title] of [["zh-TW", "拉斐爾想要傳送 Slack 訊息"], ["en", "Raphael wants to send a Slack message"], ["ja", "ラファエル が Slack のメッセージを送信しようとしています"]] as const) {
    setLocale(locale);
    const html = turnHTML(turn({ member_id: 0, permissions: [card({ service: "Slack", tool: "SLACK_SEND_MESSAGE", message: { to: "#planning", body: "Exact message" } })] }), emptyTimelineState(), false, { ...LOOK, memberName: () => "Raphael" });
    expect(html).toContain(`<b class="card-title cc-name">${title}</b>`);
  }
});

test("a router approval uses the real app mark even with a custom connector name", () => {
  const summary = "Allow Composio to run COMPOSIO_MULTI_EXECUTE_TOOL?";
  const html = permissionCardHTML(card({ service: "Team chat", tool: "SLACK_SEND_MESSAGE", summary, message: { to: "#planning", body: "Exact message" } }), true, "Alex");
  expect(html).toContain(connectionMarkHTML("Slack"));
  expect(html).toContain('<b class="card-title cc-name">Alex想要傳送 Team chat 訊息</b>');
  expect(html.match(/<header[\s\S]+?<\/header>/)?.[0]).not.toContain("Composio");
  const batch = permissionCardHTML(card({ service: "", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", summary }), true, "Alex");
  expect(batch).toContain('<b class="card-title cc-name">Alex想要使用 已連結的 app</b>');
  expect(batch).not.toContain('class="card-body"');
  expect(batch).toContain("COMPOSIO_MULTI_EXECUTE_TOOL?");
});

test("pending permissions explain their purpose and disclose the exact action only once", () => {
  for (const locale of ["zh-TW", "en", "ja"] as const) {
    setLocale(locale);
    const html = permissionCardHTML(card());
    const body = html.match(/<p class="card-body cc-state">([^<]+)<\/p>/)?.[1];
    expect(body).toBeUndefined();
    expect(html).toContain("data-card-disclosure");
    expect(html.split("send_email")).toHaveLength(2);
  }
});

test("local command consent names the member, preserves exact code and offers four real answers", () => {
  const local = card({ kind: "local_access" as PermissionCard["kind"], service: "Alex", tool: "local_exec", summary: 'Get-Process | Where-Object CPU -gt 1\nWrite-Output "<cpu>"' });
  const html = permissionCardHTML(local);
  expect(html).toContain("Alex");
  expect(html).toContain("允許所有成員在你的電腦執行指令？");
  expect(html).toContain("&lt;cpu&gt;");
  expect(html).toContain("<pre");
  expect(actions(html)).toEqual(["local-settings", "perm-once", "perm-always", "perm-deny", "perm-never"]);
});

test("later local commands have Allow and Skip without a standing-approval button", () => {
  const html = permissionCardHTML(card({ kind: "local_command" as PermissionCard["kind"], service: "Alex", always: false, tool: "local_exec", summary: "Get-Process" }));
  expect(actions(html)).toEqual(["local-settings", "perm-once", "perm-deny"]);
  expect(html).toContain("略過");
});

test("a local command that waits shows the command itself, its directory and settings, with no disclosure to open", () => {
  const html = permissionCardHTML(card({ kind: "local_command", service: "Alex", summary: "Get-Process", reason: "D:\\Project", always: false }));
  expect(html).toContain('<b class="card-title cc-name">Alex 想要執行指令</b>');
  expect(html).toContain('<p class="card-body cc-state">在你的電腦執行這個指令前，需要你確認。</p>');
  // The owner allows what they can read (owner, 2026-11-08: 「我根本不知道指令是甚麼」).
  expect(html).toContain('<pre class="local-command">Get-Process</pre>');
  expect(html).not.toContain("data-card-disclosure");
  expect(html).toContain("D:\\Project");
  expect(html).toContain('data-act="local-settings"');
  // Once answered the command folds into the details with the rest.
  expect(permissionCardHTML(card({ kind: "local_command", service: "Alex", summary: "Get-Process", state: "allowed", always: false }))).toContain("data-card-disclosure");
});

test("settled permission pills are short and the full decision remains in details", () => {
  for (const [locale, words] of [
    ["zh-TW", ["已允許一次", "已一律允許", "已拒絕", "已逾時", "已取消"]],
    ["en", ["Allowed once", "Always allowed", "Denied", "Expired", "Cancelled"]],
    ["ja", ["今回のみ許可", "常に許可", "拒否済み", "期限切れ", "キャンセル済み"]],
  ] as const) {
    setLocale(locale);
    (["allowed", "always", "denied", "expired", "cancelled"] as const).forEach((state, index) => {
      const html = permissionCardHTML(card({ state }));
      expect(html.match(/data-card-status-text>([^<]+)</)?.[1]).toBe(words[index]);
      expect(html.slice(html.indexOf('class="card-detail"'))).toContain(permissionStateText(card({ state })));
    });
  }
});

test("a connected message shows exact draft rows and body in its disclosure", () => {
  const html = permissionCardHTML(card({ service: "Slack", message: { workspace: "Example studio", to: "#planning", thread: "123.456", body: "Please review the sample plan." } }));
  expect(html).toContain("拉斐爾想要傳送 Slack 訊息");
  expect(html).toContain('<div class="card-field"><span>工作區</span><span>Example studio</span></div>');
  expect(html).toContain('<div class="card-field"><span>收件者</span><span>#planning</span></div>');
  expect(html).toContain('<div class="card-field"><span>討論串</span><span>123.456</span></div>');
  expect(html).toContain('<p class="card-body">Please review the sample plan.</p>');
  expect(permissionCardHTML(card({ state: "allowed", message: { to: "#planning", body: "<sample>" } }))).toContain("&lt;sample&gt;");
});

const card = (over: Partial<PermissionCard> = {}): PermissionCard => ({
  id: "q1", source: "ask", kind: "tool", service: "Gmail", tool: "send_email", summary: "是否讓「Gmail」執行「send_email」（to: a@example.com）？",
  reason: null, digest: "d".repeat(64), always: true, state: "pending", expires_at_ms: 0, ...over,
});

const turn = (over: Partial<AgentTurn> = {}): AgentTurn => ({
  id: 7, created_at_ms: 0, question: "幫我寄信", route: "answer", prefix: "問", text: "", detail: null, status: "confirm", source: "app", steps: [], task: null, ...over,
});

const LOOK: TurnLook = { face: () => "<i></i>" };
// The words as read: a tag is a space, except between the clauses of a line, which a comma joins.
const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ").replace(/(?<=[，、]) /g, "").trim();
const actions = (html: string): string[] => [...html.matchAll(/data-act="([^"]+)"/g)].map((match) => match[1]);

describe("a permission card", () => {
  test("says the exact action in plain words and offers 允許一次, 一律允許 and 拒絕, the primary first", () => {
    const html = permissionCardHTML(card());
    expect(visible(html)).toBe("拉斐爾想要使用 Gmail 需要你允許 顯示內容 Gmail 是否讓「Gmail」執行「send_email」（to: a@example.com）？ 允許一次 一律允許 拒絕");
    expect(actions(html)).toEqual(["perm-once", "perm-always", "perm-deny"]);
    // Real framed buttons, the primary first, each naming its card and who answers it.
    expect(html).toContain('class="btn sm" data-act="perm-deny" data-card="q1" data-source="ask"');
    expect(html).toContain('class="btn sm pri" data-act="perm-once" data-card="q1" data-source="ask"');
    expect(html.indexOf("perm-once")).toBeLessThan(html.indexOf("perm-always"));
    expect(html.indexOf("perm-always")).toBeLessThan(html.indexOf("perm-deny"));
    expect(html).not.toContain(" disabled");
    expect(html).toContain('data-card-state="pending"');
  });

  test("offers no 一律允許 where it cannot take effect, and says which rule had the question asked", () => {
    const html = permissionCardHTML(card({ always: false, reason: "此操作符合安全規則「寄信前先問」。" }));
    expect(actions(html)).toEqual(["perm-once", "perm-deny"]);
    expect(visible(html)).toContain("此操作符合安全規則「寄信前先問」。");
    expect(visible(html)).not.toContain("一律允許");
  });

  test("its buttons cannot be pressed while the window holds no question to answer it with", () => {
    const html = permissionCardHTML(card(), false);
    expect([...html.matchAll(/<button[^>]*data-act="perm-[^>]*>/g)].every((match) => match[0].includes(" disabled"))).toBe(true);
    // A card of a task that went on has its own door, so the window need not hold a question for it.
    const run = permissionCardsHTML(turn({ permissions: [card({ source: "run" })] }), () => false);
    expect(run).not.toContain(" disabled");
    expect(run).toContain('data-source="run"');
  });

  test("names the computer for a step on it, with the computer's icon", () => {
    const html = permissionCardHTML(card({ kind: "step", service: "", tool: "", summary: "要送出這封信嗎？" }));
    expect(visible(html)).toContain("拉斐爾想要使用 電腦 需要你允許");
    expect(html).toContain("要送出這封信嗎？");
    expect(html).toContain("<svg");
  });

  test("each state says what became of the question and keeps the action it was about", () => {
    const outcomes: [PermissionCard["state"], string][] = [
      ["allowed", "已允許一次"], ["always", "已一律允許，之後這個動作不再詢問"], ["denied", "已拒絕，沒有執行"],
      ["expired", "已逾時，沒有執行"], ["cancelled", "已取消，沒有執行"],
    ];
    for (const [state, words] of outcomes) {
      const html = permissionCardHTML(card({ state }));
      expect(visible(html)).toContain(words);
      expect(visible(html)).toContain("是否讓「Gmail」執行「send_email」");
      expect(actions(html)).toEqual([]);
      expect(permissionStateText(card({ state }))).toBe(words);
    }
    expect(permissionCardHTML(card({ state: "allowed" }))).toContain('card-status is-done');
    expect(permissionCardHTML(card({ state: "denied" }))).not.toContain("cc-done");
  });

  test("speaks only the window's language", () => {
    setLocale("en");
    expect(visible(permissionCardHTML(card({ summary: "Allow Gmail to run send_email?" })))).toBe("Raphael wants to use Gmail Approval needed Show details Gmail Allow Gmail to run send_email? Allow once Always allow Deny");
    setLocale("ja");
    expect(visible(permissionCardHTML(card({ summary: "Gmail に send_email を実行させますか？" })))).toBe("ラファエル が Gmail を使用しようとしています 承認が必要 内容を表示 Gmail Gmail に send_email を実行させますか？ 今回だけ許可 常に許可 拒否");
    expect(visible(permissionCardHTML(card({ state: "denied" })))).toContain("拒否しました。実行していません");
  });

  test("escapes what the core said", () => {
    const html = permissionCardHTML(card({ service: "<b>x</b>", summary: "<script>alert(1)</script>", reason: "<i>r</i>" }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>r</i>");
  });

  test("is drawn below the reply of its turn, and a turn with none has none", () => {
    const html = turnHTML(turn({ permissions: [card()] }), emptyTimelineState(), false, LOOK);
    expect(html).toContain('data-permission-card="q1"');
    expect(turnHTML(turn(), emptyTimelineState(), false, LOOK)).not.toContain("permission-card");
  });

  test("finds the card that waits for a question, and none that was answered", () => {
    const turns = [turn({ id: 1, permissions: [card({ id: "old", state: "denied" })] }), turn({ id: 2, permissions: [card({ id: "q2" })] })];
    expect(permissionFor(turns, "q2")?.id).toBe("q2");
    expect(permissionFor(turns, "old")).toBeUndefined();
    expect(permissionFor(turns, "other")).toBeUndefined();
  });
});

test("a long question to the owner wraps whole in its card title instead of ending in an ellipsis", () => {
  const css = readFileSync("src/main/agent.css", "utf8");
  expect(css).toMatch(/\.cc-name \{[^}]*white-space: nowrap;/);
  expect(css).toContain(".owner-question .card-title.cc-name { white-space: normal; overflow: visible; }");
});
