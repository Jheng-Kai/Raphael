// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { composioAction, composioText, isComposioTool } from "./composio-result";
import { setLocale } from "./i18n";
import { messageHTML, replyContentHTML } from "./message-content";
import { permissionCardHTML, permissionStateText } from "./permission-card";
import { emptyTimelineState, latestProgress, stepHTML, turnHTML } from "./timeline";
import type { AgentTurn, PermissionCard } from "./types";

const result = { data: { results: [{ tool_slug: "GMAIL_FETCH_EMAILS", response: { successful: true,
  data: { subject: "Synthetic schedule", snippet: "Two meetings next week", access_token: "synthetic-private-token" } } }] } };
const raw = JSON.stringify(result);
afterEach(() => setLocale("zh-TW"));

test("nested Composio results expose an app name and useful fields without changing raw data", () => {
  setLocale("en");
  expect(composioText(raw)).toBe("Gmail · Completed: Synthetic schedule · Two meetings next week");
  expect(JSON.stringify(result)).toBe(raw);
  expect(composioText(raw)).not.toContain("synthetic-private-token");
});

test("failure status and bounded multi-action summaries use the window language", () => {
  for (const [locale, word] of [["zh-TW", "未完成"], ["en", "Failed"], ["ja", "失敗"]] as const) {
    setLocale(locale);
    expect(composioText(JSON.stringify({ tool_slug: "SLACK_SEND_MESSAGE", response: { successful: false, error: { internal: "raw failure" } } }))).toBe(`Slack · ${word}`);
  }
  expect(composioText(JSON.stringify({ results: Array.from({ length: 5 }, () => result.data.results[0]) })).split("\n")).toHaveLength(4);
});

test("app brands omit operation verbs and results use each locale's separator", () => {
  for (const [locale, done, label, separator] of [["zh-TW", "已完成", "結果", "："], ["en", "Completed", "Result", ": "], ["ja", "完了", "結果", "："]] as const) {
    setLocale(locale);
    for (const [action, app] of [["GMAIL_FETCH_EMAILS", "Gmail"], ["GOOGLECALENDAR_EVENTS_LIST", "Google Calendar"], ["NOTION_SEARCH", "Notion"], [undefined, label], ["COMPOSIO_MULTI_EXECUTE_TOOL", label], ["execute", label]]) {
      expect(composioText(JSON.stringify({ successful: true, data: { title: "範例排程" } }), action))
        .toBe(`${app} · ${done}${separator}範例排程`);
    }
    expect(composioText('{"data":', undefined, "tool")).toContain(`${label} · `);
  }
});

test("private replies, room replies, step details and permission summaries never render the raw object", () => {
  const card = { id: "synthetic", source: "ask", kind: "tool", state: "pending", service: "Composio",
    tool: "COMPOSIO_MULTI_EXECUTE_TOOL", summary: raw, digest: "synthetic", always: false } as PermissionCard;
  const html = [replyContentHTML(`Result:\n\n\`\`\`json\n${raw}\n\`\`\``), messageHTML(raw, "", true),
    stepHTML({ kind: "tool", server: "Composio", tool: "COMPOSIO_MULTI_EXECUTE_TOOL", outcome: "ok", reason: null, ms: 100, at_ms: 1, detail: raw }, false),
    permissionCardHTML(card)];
  for (const rendered of html) {
    document.body.innerHTML = rendered;
    expect(document.body.textContent).toContain("Gmail");
    expect(document.body.textContent).not.toContain("tool_slug");
    expect(document.body.textContent).not.toContain("synthetic-private-token");
  }
  expect(card.summary).toBe(raw);
});

test("ordinary code examples and the owner's plain text retain their exact source", () => {
  const source = '{"answer":42}';
  expect(composioText(source)).toBe(source);
  expect(replyContentHTML(`\`\`\`json\n${source}\n\`\`\``)).toContain("message-code");
  expect(messageHTML(raw)).toContain("tool_slug");
});

test("a Composio turn preserves the member's fenced and inline JSON config", () => {
  const config = '{"theme":"dark","retry":3}', source = `Use this config:\n\n\`\`\`json\n${config}\n\`\`\`\n\nInline: ${config}`;
  const turn: AgentTurn = { id: 2, created_at_ms: 1, question: "", route: "answer", prefix: "", text: source, detail: `Detail:\n\n${source}`, status: "done",
    steps: [{kind:"tool",server:"Composio",tool:"COMPOSIO_MULTI_EXECUTE_TOOL",outcome:"ok",reason:null,ms:100,at_ms:1}] };
  expect(composioText(source, "COMPOSIO_MULTI_EXECUTE_TOOL")).toBe(source);
  expect(composioText(JSON.stringify({ padding: "x".repeat(70000) }), "COMPOSIO_MULTI_EXECUTE_TOOL"))
    .toBe(JSON.stringify({ padding: "x".repeat(70000) }));
  document.body.innerHTML = turnHTML(turn, emptyTimelineState(), true, { face: () => "" });
  expect(document.querySelector('[data-message="reply"] code')?.textContent).toBe(config);
  expect(document.querySelector('[data-message="reply"]')?.textContent).toContain(`Inline: ${config}`);
  expect(document.querySelector(".tn-detail code")?.textContent).toBe(config);
  expect(latestProgress({ ...turn, messages: [{seq:1,kind:"progress",text:config,at_ms:1}] })).toBe(config);
  expect(turn.text).toBe(source);
});

test("a member's pasted Composio envelope is projected with or without a preceding action", () => {
  setLocale("en");
  const envelope = JSON.stringify({ successful: true, data: { subject: "Synthetic schedule" } });
  for (const action of [undefined, "GMAIL_FETCH_EMAILS"]) {
    const source = `Result:\n\n\`\`\`json\n${envelope}\n\`\`\`\n\nInline: ${envelope}`;
    const readable = composioText(source, action);
    expect(readable).toContain("Completed: Synthetic schedule");
    expect(readable).not.toContain("successful");
  }
  const turn: AgentTurn = { id: 3, created_at_ms: 1, question: "", route: "answer", prefix: "", text: envelope, detail: envelope, status: "done",
    steps: [{kind:"tool",server:"Composio",tool:"GMAIL_FETCH_EMAILS",outcome:"ok",reason:null,ms:100,at_ms:1}] };
  document.body.innerHTML = turnHTML(turn, emptyTimelineState(), true, { face: () => "" });
  expect(document.body.textContent).toContain("Gmail · Completed: Synthetic schedule");
  expect(document.body.textContent).not.toContain("successful");
  expect(turn.text).toBe(envelope);
});

test("trusted Composio step details and permission summaries also project unmarked JSON", () => {
  setLocale("en");
  const source = '{"subject":"Synthetic schedule"}', action = "GMAIL_FETCH_EMAILS";
  const card = { id: "synthetic", source: "ask", kind: "tool", state: "pending", service: "Composio",
    tool: action, summary: source, digest: "synthetic", always: false } as PermissionCard;
  expect(composioText(source, action)).toBe(source);
  expect(permissionStateText(card)).toBe("Gmail · Details: Synthetic schedule");
  for (const html of [permissionCardHTML(card), stepHTML({kind:"tool",server:"Composio",tool:action,outcome:"ok",reason:null,ms:100,at_ms:1,detail:source}, false)]) {
    document.body.innerHTML = html;
    expect(document.body.textContent).toContain("Gmail · Details: Synthetic schedule");
    expect(document.body.textContent).not.toContain(source);
  }
  expect(card.summary).toBe(source);
});

test("Composio action detection shares server and tool matching across consumers", () => {
  expect(isComposioTool("composio", "GMAIL_FETCH_EMAILS")).toBe(true);
  expect(isComposioTool(null, "COMPOSIO_MULTI_EXECUTE_TOOL")).toBe(true);
  expect(isComposioTool("local", "GMAIL_FETCH_EMAILS")).toBe(false);
  expect(isComposioTool(undefined, undefined)).toBe(false);
  expect(composioAction({ steps: [
    {kind:"tool",server:"Composio",tool:"GMAIL_FETCH_EMAILS",outcome:"ok",reason:null,ms:100,at_ms:1},
    {kind:"tool",server:null,tool:"COMPOSIO_MULTI_EXECUTE_TOOL",outcome:"ok",reason:null,ms:100,at_ms:2},
    {kind:"tool",server:"local",tool:"READ_FILE",outcome:"ok",reason:null,ms:100,at_ms:3},
  ] })).toBe("COMPOSIO_MULTI_EXECUTE_TOOL");
});

test("multiline inline envelopes, incomplete results and large results stay readable", () => {
  expect(composioText(`Results: ${JSON.stringify(result.data.results)}`)).not.toContain("tool_slug");
  expect(composioText(`Result:\n${JSON.stringify(result, null, 2)}\nNext step.`)).not.toContain('"data"');
  expect(composioText('{"tool_slug":"GMAIL_FETCH_EMAILS",')).not.toContain("tool_slug");
  expect(composioText('{"data":', "GMAIL_FETCH_EMAILS", "tool")).not.toContain('"data"');
  expect(composioText('{"data":', "GMAIL_FETCH_EMAILS")).toBe('{"data":');
  expect(composioText(JSON.stringify({ ...result, padding: "x".repeat(70000) }))).not.toContain("padding");
});

test("conversation progress and legacy reply detail use the same readable projection", () => {
  const turn: AgentTurn = { id: 1, created_at_ms: 1, question: "", route: "answer", prefix: "", text: raw, detail: raw, status: "done",
    steps: [{kind:"tool",server:"Composio",tool:"COMPOSIO_MULTI_EXECUTE_TOOL",outcome:"ok",reason:null,ms:100,at_ms:1}],
    messages: [{seq:1,kind:"progress",text:raw,at_ms:1}] };
  expect(latestProgress(turn)).toContain("Gmail");
  expect(latestProgress(turn)).not.toContain("tool_slug");
  const html = turnHTML({ ...turn, messages: [] }, emptyTimelineState(), true, { face: () => "" });
  expect(html).toContain("Gmail");
  expect(html).not.toContain("synthetic-private-token");
  expect(turn.text).toBe(raw);
});
