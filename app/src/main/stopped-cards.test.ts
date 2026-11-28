import { afterEach, describe, expect, test } from "vitest";
import { setLocale } from "./i18n";
import { connectorCardsHTML } from "./connector-card";
import { mailCardsHTML } from "./mail-card";
import { mcpProposalsHTML } from "./mcp-proposal";
import { ownerQuestionsHTML, permissionCardsHTML } from "./permission-card";
import { secretCardsHTML } from "./secret-card";
import type { AgentTurn } from "./types";

afterEach(() => setLocale("zh-TW"));

const turn = (over: Partial<AgentTurn>): AgentTurn => ({
  id: 7, created_at_ms: 0, question: "幫我寄信", route: "answer", prefix: "", text: "", detail: null, status: "confirm", source: "app", steps: [], task: null, ...over,
});
const status = (html: string): string => html.match(/<span data-card-status-text>([^<]*)<\/span>/)?.[1] ?? "";
// What a card offers to press: its answers and its ×, not the disclosure that unfolds its words.
const buttons = (html: string): number => [...html.matchAll(/<button[^>]*(?:data-act|data-card-close|data-owner-answer)/g)].length;

const permission = { id: "q1", source: "ask", kind: "tool", service: "Gmail", tool: "send_email", summary: "是否讓「Gmail」執行「send_email」？", reason: null, digest: "d".repeat(64), always: true, state: "cancelled", expires_at_ms: 0 };
const connector = { id: "c1", app: "gmail", name: "Gmail", state: "cancelled", error: null, reconnect: false, tool_count: null, expires_at_ms: 0, resumed: false };
const secret = { id: "k1", name: "Notion", secret: "NOTION_TOKEN", state: "cancelled", error: null, expires_at_ms: 0, resumed: false };
const question = { id: "o1", task_id: 1, turn_id: 7, member_id: 0, kind: "ask_owner", card_id: "", question: "哪一天寄出？", options: ["星期一"], free_text: true, state: "cancelled", result: { state: "cancelled" } };
const proposal = { id: "p1", revision: 1, state: "cancelled", error: null, first_local: false, groups: [], fields: { transport: "http", name: "Search", url: "https://search.example/mcp", headers: [], env: [], command: "", args: [] }, tools: [] };
const draft = { id: "m1", mode: "card", kind: "email", state: "discarded", subject: "週報", to: ["a@example.com"], from: { key: "mcp:gmail/send", name: "Gmail" }, senders: [], version: 1, digest: "d", body: "內容" };

const cards = (t: AgentTurn): Record<string, string> => ({
  permission: permissionCardsHTML(t, () => true, true),
  connector: connectorCardsHTML(t),
  secret: secretCardsHTML(t),
  question: ownerQuestionsHTML(t, true),
  proposal: mcpProposalsHTML(t),
  draft: mailCardsHTML(t),
});
const content = (over: Partial<AgentTurn>): AgentTurn => turn({
  permissions: [permission], connectors: [connector], secrets: [secret], owner_questions: [question], connection_proposals: [proposal], drafts: [draft], ...over,
} as Partial<AgentTurn>);

describe("a card closed by the owner's Stop (R-CHAT-STOP-02)", () => {
  test("keeps its title with no status word and no buttons, whichever kind of card it is", () => {
    for (const stopped of [{ status: "cancelled" as const }, { status: "done" as const, task: { id: 1, state: "cancelled" } }]) {
      const html = cards(content(stopped as Partial<AgentTurn>));
      for (const [kind, card] of Object.entries(html)) {
        expect(card, kind).not.toBe("");
        expect(status(card), kind).toBe("");
        expect(card, kind).not.toMatch(/已取消|已逾時|已中止|已停止/);
        expect(buttons(card), kind).toBe(0);
      }
      expect(html.permission).toContain("Gmail");
      expect(html.question).toContain("哪一天寄出？");
    }
  });

  test("a card closed in any other turn keeps its own words, sent over by a newer message, or left as it was", () => {
    for (const other of ["superseded", "done"] as const) {
      const html = cards(content({ status: other }));
      expect(status(html.permission)).toBe("已取消");
      expect(status(html.connector)).toBe("已取消");
      expect(status(html.question)).toBe("已取消");
      expect(html.permission).toContain("已取消");
    }
  });
});
