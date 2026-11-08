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
  test("an ended card says how it ended, never that it is ready", () => {
    for (const [state, words] of [["expired", "已逾時"], ["cancelled", "已取消"]] as const) {
      const html = connectorCardHTML(card({ state }));
      expect(html).toContain(`<span data-card-status-text>${words}</span>`);
      expect(html).not.toContain("準備就緒");
    }
  });
  test("names the inline key connection in its title", () => {
    expect(connectorCardHTML(card({ needs: "key" }))).toContain('<b class="card-title cc-name">連結 Gmail</b>');
  });
  test("omits pending helper copy for every locale while retaining essential sign-in states", () => {
    for (const locale of ["zh-TW", "en", "ja"] as const) {
      setLocale(locale);
      const pending = connectorCardHTML(card());
      expect(pending).not.toContain('class="cc-state"');
      expect(visible(pending)).toBe(`Gmail ${t("cards.needsYou")} ${t("cards.connectWhy")} ${t("card.connect")}`);
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
    expect(visible(pending)).toBe("Gmail 需要你 連結後就能繼續這項工作，隨時可以在設定中斷連結。 連結");
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

  test("an app that needs the owner's own key or developer app says so, and its one button opens the form", () => {
    const key = card({ app: "acme", name: "Acme", needs: "key", toolkit: "acme" });
    const pending = connectorCardHTML(key);
    expect(visible(pending)).toBe("連結 Acme 等你填入 需要你的 API 金鑰 填入金鑰");
    expect(actions(pending)).toEqual(["card-setup"]);
    expect(pending).toContain('data-toolkit="acme" data-needs="key" data-name="Acme"');
    expect(pending).not.toContain("<input"); // the key is never asked for in the chat
    const own = connectorCardHTML(card({ app: "orbit", name: "Orbit", needs: "own_app", toolkit: "orbit" }));
    expect(visible(own)).toBe("連結 Orbit 等你填入 需要你自己的開發者應用程式 設定開發者應用程式");
    // A failure names what is missing and offers the form again, never a bare "retry".
    const rejected = connectorCardHTML({ ...key, state: "failed", error: "key_rejected" });
    expect(visible(rejected)).toBe("連結 Acme 未能完成 這把金鑰沒有被接受，請再填一次 填入金鑰"); // closed by the × at its top right (owner, 2026-11-08)
    expect(actions(rejected)).toEqual(["card-setup"]);
    expect(actions(connectorCardHTML({ ...key, state: "cancelled" }))).toEqual(["card-setup"]);
    expect(actions(connectorCardHTML({ ...key, state: "authorizing" }))).toEqual(["card-cancel"]);
  });

  test("with no Composio key the failed card says so and opens the settings, not a vague retry", () => {
    const failed = connectorCardHTML(card({ state: "failed", error: "needs_composio_key" }));
    expect(visible(failed)).toBe("Gmail 未能完成 還沒有 Composio 金鑰，請到「設定 › 連接 › 商店」開啟 Composio 表單，依表單指引取得金鑰後填入並儲存。 開啟連接設定");
    const shared = connectorCardHTML(card({ state: "failed", error: "needs_composio_key", missing: {resource: "composio", requirement: "composio_key", state: "missing", repair: "store"} }));
    expect(visible(shared)).toContain("設定 › 連接 › 商店");
    expect(shared).toContain('data-missing-repair="store"');
    expect(actions(shared)).toEqual([]);
    expect(actions(failed)).toEqual(["card-settings"]);
    expect(visible(connectorCardHTML(card({ state: "failed", error: "not_configured" })))).toContain(t("card.notConfigured"));
  });

  test("speaks only the window's language", () => {
    setLocale("en");
    expect(visible(connectorCardHTML(card({ app: "googlecalendar", name: "Google Calendar" })))).toBe("Google Calendar Action needed Connect this app to continue the task. Disconnect it in Settings at any time. Connect");
    setLocale("ja");
    expect(visible(connectorCardHTML(card({ state: "connected", tool_count: 1 })))).toContain("接続済み · ツール 1 個");
  });
});

describe("a turn with a card", () => {
  test("a catalog app keeps its persisted display name in its card and resumed line", () => {
    expect(visible(connectorCardHTML(card({ app: "catalog-slug", name: "Catalog App" })))).toBe("Catalog App 需要你 連結後就能繼續這項工作，隨時可以在設定中斷連結。 連結");
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
