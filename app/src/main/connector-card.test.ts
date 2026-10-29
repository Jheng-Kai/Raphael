import { afterEach, describe, expect, test } from "vitest";
import { connectorCardHTML, resumedLineHTML } from "./connector-card";
import { setLocale, t } from "./i18n";
import { entryIcon } from "./service-mark";
import { emptyTimelineState, turnHTML, type TurnLook } from "./timeline";
import type { AgentTurn, ConnectorCard } from "./types";

afterEach(() => setLocale("zh-TW"));

const card = (over: Partial<ConnectorCard> = {}): ConnectorCard => ({
  id: "c1", app: "gmail", name: "Gmail", state: "pending", error: null, reconnect: false, tool_count: null,
  expires_at_ms: 0, resumed: false, ...over,
});

const turn = (over: Partial<AgentTurn> = {}): AgentTurn => ({
  id: 7, created_at_ms: 0, question: "請找主旨含 GX-7 的信", route: "answer", prefix: "", text: "請先連結 Gmail，連好後就繼續找這封信。",
  detail: null, status: "done", source: "app", steps: [], task: null, ...over,
});

const LOOK: TurnLook = { face: () => "<i></i>" };
const visible = (html: string): string => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const actions = (html: string): string[] => [...html.matchAll(/data-act="([^"]+)"/g)].map(match => match[1]);

describe("a connector card", () => {
  test("omits pending helper copy for every locale while retaining essential sign-in states", () => {
    for (const locale of ["zh-TW", "en", "ja"] as const) {
      setLocale(locale);
      const pending = connectorCardHTML(card());
      expect(pending).not.toContain('class="cc-state"');
      expect(visible(pending)).toBe(`Gmail ${t("card.connect")}`);
      expect(connectorCardHTML(card({ reconnect: true }))).toContain(t("card.expiredAuth"));
    }
  });
  test("uses a complete authorizing status rather than an ellipsis in every locale", () => {
    for (const locale of ["zh-TW", "en", "ja"] as const) {
      setLocale(locale);
      expect(t("card.authorizing")).not.toMatch(/…|\.\.\./);
    }
  });
  test("uses the same validated catalog logo as the store, including after resumption", () => {
    const logo = "https://logos.composio.dev/api/slack";
    const mark = entryIcon({ name: "slack", logo }, "md");
    expect(connectorCardHTML(card({ app: "slack", name: "Slack", logo }))).toContain(mark);
    expect(resumedLineHTML(turn({ resumed_apps: ["slack"], resumed_app_names: ["Slack"], resumed_app_logos: [logo] }))).toContain(mark);
    expect(connectorCardHTML(card({ app: "slack", logo: "https://untrusted.example/slack" }))).not.toContain("untrusted.example");
  });
  test("shows the app's own mark, bare, and one framed action for each state that has one", () => {
    const pending = connectorCardHTML(card());
    expect(pending).toContain(entryIcon({ name: "gmail" }, "md"));
    expect(pending).not.toContain("tile");
    expect(pending).toContain('class="btn sm pri" data-act="card-connect" data-card="c1"');
    expect(visible(pending)).toBe("Gmail 連結");
    expect(actions(connectorCardHTML(card({ state: "authorizing" })))).toEqual(["card-cancel"]);
    expect(actions(connectorCardHTML(card({ state: "cancelled" })))).toEqual(["card-connect"]);
    expect(actions(connectorCardHTML(card({ state: "failed", error: "denied" })))).toEqual(["card-connect"]);
    expect(actions(connectorCardHTML(card({ state: "failed", error: "not_configured" })))).toEqual(["card-settings"]);
    expect(actions(connectorCardHTML(card({ state: "connected", tool_count: 2 })))).toEqual([]);
    expect(actions(connectorCardHTML(card({ state: "expired" })))).toEqual([]);
  });

  test("says where the sign-in stands, with the real tool count and a reconnect for an expired grant", () => {
    expect(visible(connectorCardHTML(card({ state: "authorizing" })))).toContain(t("card.authorizing"));
    expect(visible(connectorCardHTML(card({ state: "connected", tool_count: 2 })))).toContain("已連結 · 2 個工具");
    const expired = connectorCardHTML(card({ reconnect: true }));
    expect(visible(expired)).toContain("授權已過期");
    expect(visible(expired)).toContain("重新連結");
    expect(visible(connectorCardHTML(card({ state: "connected", reconnect: true, tool_count: 2 })))).toContain("已重新連結 · 2 個工具");
    expect(visible(connectorCardHTML(card({ state: "failed", error: "scope" })))).toContain(t("card.scope"));
    expect(visible(connectorCardHTML(card({ state: "failed", error: "unheard-of" })))).toContain(t("card.error"));
  });

  test("speaks only the window's language", () => {
    setLocale("en");
    expect(visible(connectorCardHTML(card({ app: "googlecalendar", name: "Google Calendar" })))).toBe("Google Calendar Connect");
    setLocale("ja");
    expect(visible(connectorCardHTML(card({ state: "connected", tool_count: 1 })))).toContain("接続済み · ツール 1 個");
  });
});

describe("a turn with a card", () => {
  test("a catalog app keeps its persisted display name in its card and resumed line", () => {
    expect(visible(connectorCardHTML(card({ app: "catalog-slug", name: "Catalog App" })))).toBe("Catalog App 連結");
    expect(visible(resumedLineHTML(turn({ resumed_apps: ["catalog-slug"], resumed_app_names: ["Catalog App"] })))).toBe("Catalog App 已連結，繼續原本的工作");
  });

  test("draws its cards below what it said", () => {
    const html = turnHTML(turn({ connectors: [card()] }), emptyTimelineState(), false, LOOK);
    expect(html.indexOf("data-connector=\"c1\"")).toBeGreaterThan(html.indexOf("請先連結 Gmail"));
  });

  test("a resumed task opens with one centred line naming the app, not the owner's words again", () => {
    const resumed = turn({ id: 8, source: "connector", resumed_apps: ["gmail"], text: "找到了，確認碼是 MC-1。" });
    const html = turnHTML(resumed, emptyTimelineState(), false, LOOK);
    expect(html).not.toContain("owner-message");
    expect(html).toContain('data-resumed="8"');
    expect(visible(resumedLineHTML(resumed))).toBe("Gmail 已連結，繼續原本的工作");
    expect(html).toContain(entryIcon({ name: "gmail" }, "md"));
  });
});
