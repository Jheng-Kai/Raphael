import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import { setLocale, t } from "./i18n";
import type { AppsInventory, AuditEntry, ConnectionGroup, InventoryApp, StoreService } from "./types";

const api = vi.hoisted(() => ({
  connectorsStatus: vi.fn(), connectorsCatalog: vi.fn(), connectorsCategories: vi.fn(), connectorsTools: vi.fn(),
  connectorsSetTools: vi.fn(), connectorsConnect: vi.fn(), connectorsGoogleConnect: vi.fn(), connectorsDisconnect: vi.fn(), connectorsSetKey: vi.fn(),
  toolsetsList: vi.fn(),
  integrationsCatalog: vi.fn(),
  integrationsAudit: vi.fn(),
  integrationsConnect: vi.fn(),
  integrationsConnectCancel: vi.fn(),
  integrationsAdd: vi.fn(),
  integrationsUpdate: vi.fn(),
  integrationsTest: vi.fn(),
  integrationsRefresh: vi.fn(),
  integrationsSetEnabled: vi.fn(),
  integrationsDisconnect: vi.fn(),
  integrationsSetToolEnabled: vi.fn(),
  integrationsSetToolsEnabled: vi.fn(),
  integrationsInventory: vi.fn(),
  core: vi.fn(), membersList: vi.fn(), membersSkillsImport: vi.fn(), membersSkillsList: vi.fn(),
}));
vi.mock("./api", () => api);
vi.mock("./ui", async (original) => ({ ...(await original<typeof import("./ui")>()), toaster: { info: vi.fn() } }));
vi.mock("./member-dialogs", () => ({ confirmDelete: vi.fn(async () => true), openDialog: vi.fn() }));

import {
  type ConnectionForm,
  type ConnectionsView,
  bodyHTML,
  connectionsAddHTML,
  connectionsHTML,
  createConnections,
  emptyConnectionsView,
  examplePrompt,
  iconHTML,
  needsLogin,
  ownGoogleEntry,
  toolLabel,
} from "./connections";
import { ico, toaster } from "./ui";

afterEach(() => setLocale("zh-TW"));

const NOW = Date.UTC(2026, 9, 21, 6, 0);
const CJK = /[㐀-鿿぀-ヿ]/;

const words = (zh: string, en: string, ja: string) => ({ "zh-TW": zh, en, ja });
const service = (id: string, name: string, over: Partial<StoreService> = {}): StoreService => ({
  id, name, publisher: name, url: `https://mcp.${id}.example/mcp`, category: "docs", icon: null, popular: false,
  summary: words(`${name}的一句話`, `${name} in a line`, `${name}の一言`),
  about: words(`${name}的說明`, `About ${name}`, `${name}について`),
  examples: { "zh-TW": [`跟${name}說一`, `跟${name}說二`], en: [`Tell ${name} one`, `Tell ${name} two`], ja: [`${name}に一`, `${name}に二`] },
  server_id: null, ...over,
});
const CATALOG: StoreService[] = [
  service("notion", "Notion", { icon: "notion", popular: true, server_id: "ab12" }),
  service("linear", "Linear", { icon: "linear", popular: true }),
  service("sentry", "Sentry", { icon: "sentry" }),
  service("canva", "Canva", { popular: true }),
];

const notes: ConnectionGroup = {
  id: "ab12", name: "Notion", enabled: true, status: "ready", error: null, auth: "oauth", catalog_id: "notion",
  transport: "http", command: "", url: "https://mcp.notion.example/mcp", env: [], headers: [], args: [],
  tool_count: 3, enabled_count: 2, write_count: 2, read_count: 1, checked_at_ms: NOW,
  tools: [
    { name: "search", description: "Search the workspace.", enabled: true, kind: "read" },
    { name: "create_page", description: "Create a page.", enabled: true, kind: "write" },
    { name: "delete_page", description: "Delete a page.", enabled: false, kind: "write" },
  ],
};
const custom: ConnectionGroup = {
  ...notes, id: "cu1", name: "Files", catalog_id: null, auth: "none", transport: "stdio", command: "npx", url: "", env: ["API_KEY"],
  tool_count: 1, enabled_count: 1, write_count: 0, read_count: 1, tools: [{ name: "list", description: "List.", enabled: true, kind: "read" }],
};
const GROUPS = [notes, custom];
const AUDIT: AuditEntry[] = [{ id: 1, at_ms: NOW - 60_000, server: "Notion", tool: "create_page", approver: "auto", outcome: "ok" }];
/** What the core counts of the two services above: both can be called now. */
const app = (id: string, name: string, over: Partial<InventoryApp> = {}): InventoryApp => ({ id, name, enabled: true, state: "ready", tools: 2, connected: true, ...over });
const inventoryOf = (apps: InventoryApp[]): AppsInventory => ({ state: "complete", count: apps.filter((a) => a.connected).length, apps });
const INVENTORY = inventoryOf([app("ab12", "Notion"), app("cu1", "Files", { tools: 1 })]);
const view = (over: Partial<ConnectionsView> = {}): ConnectionsView => ({
  ...emptyConnectionsView(), groups: GROUPS, catalog: CATALOG, inventory: INVENTORY, audit: AUDIT, now: NOW, ...over,
});
const form = (over: Partial<ConnectionForm> = {}): ConnectionForm => ({
  type: "stdio", name: "", command: "", args: "", url: "", pairLines: "", busy: false, error: null, ...over,
});
const lastToast = (): string => {
  const calls = vi.mocked(toaster.info).mock.calls;
  return calls[calls.length - 1]![0] as string;
};
const installedPage = (id: string, over: Partial<ConnectionsView> = {}): string =>
  connectionsHTML(view({ open: { tab: "installed", id }, ...over }));
const storePage = (id: string, over: Partial<ConnectionsView> = {}): string => connectionsHTML(view({ tab: "store", open: { tab: "store", id }, ...over }));

describe("the two views", () => {
  test("are quiet tabs that say which is open and how many each holds, with the search beside them", () => {
    const html = connectionsHTML(view());
    const bar = html.slice(html.indexOf('class="cs-bar"'), html.indexOf("data-cs-body"));
    expect(bar).toContain('class="tabs plain"');
    expect(bar).toContain('role="tablist"');
    expect(bar).toMatch(/<button[^>]*class="tab"[^>]*role="tab"[^>]*aria-selected="true"[^>]*data-id="installed"[^>]*>已連結<span class="n">2<\/span>/);
    expect(bar).toMatch(/<button[^>]*class="tab"[^>]*role="tab"[^>]*aria-selected="false"[^>]*data-id="store"[^>]*>商店<span class="n">5<\/span>/); // with n8n and the owner's own Google
    expect(bar).toContain('id="conn-search"');
    expect(connectionsHTML(view({ tab: "store" }))).toMatch(/aria-selected="true"[^>]*data-id="store"/);
    // nothing connected yet still says so: 0
    expect(connectionsHTML(view({ groups: [], inventory: inventoryOf([]) }))).toMatch(/data-id="installed"[^>]*>已連結<span class="n">0<\/span>/);
  });

  test("the number beside 已連結 is the core's count, not the rows: an app that waits, failed or duplicates another is a row and no count", () => {
    const waiting: ConnectionGroup = { ...notes, id: "w1", name: "Slack", status: "error", error: "auth" };
    const inventory = inventoryOf([app("ab12", "Notion"), app("cu1", "Files", { tools: 1 }), app("w1", "Slack", { state: "needs_sign_in", connected: false, tools: 0 })]);
    const html = connectionsHTML(view({ groups: [...GROUPS, waiting], inventory }));
    expect(html).toMatch(/data-id="installed"[^>]*>已連結<span class="n">2<\/span>/);
    expect(html.match(/data-conn="open" data-id=/g)!.length / 2).toBe(3); // each row names its id twice: the row and its button
    // while it is read there is no number, and when it cannot be read the tab says so instead of showing one
    expect(connectionsHTML(view({ inventory: "loading" }))).toMatch(/data-id="installed"[^>]*>已連結<\/button>/);
    expect(connectionsHTML(view({ inventory: "failed" }))).toMatch(/data-id="installed"[^>]*>已連結<span class="n">—<\/span>/);
    expect(connectionsHTML(view({ inventory: { state: "partial", count: null, apps: INVENTORY.apps } }))).toMatch(/data-id="installed"[^>]*>已連結<span class="n">—<\/span>/);
  });

  test("the menu that adds a server of the user's own is a dropdown at the end of the 已連結 and 商店 row, away from the close button", () => {
    expect(connectionsAddHTML()).toMatch(/^<button type="button" class="sel cs-add" aria-haspopup="menu" aria-expanded="false" data-k="conn-add"><span>新增<\/span>/);
    const html = connectionsHTML(view());
    expect(html.match(/data-k="conn-add"/g)).toHaveLength(1);
    expect(html).toMatch(/<div class="cs-bar">.*?<\/div><button type="button" class="sel cs-add"[^>]*data-k="conn-add"/s);
  });

  test("the loading and failed states say so", () => {
    expect(connectionsHTML(view({ groups: "loading" }))).toContain("讀取中");
    expect(connectionsHTML(view({ groups: "failed" }))).toContain("無法讀取連接");
    expect(connectionsHTML(view({ tab: "store", catalog: "failed" }))).toContain("無法讀取連接");
  });
});

describe("已安裝", () => {
  const html = connectionsHTML(view());
  const items = (out: string): string[] => out.split(/<div class="cs-item(?: mcp-item)?"/).slice(1);

  test("is one list, a row for each service: its mark, its name and a line, a switch, a chevron; the row opens the dialog", () => {
    expect(html.match(/class="cs-list"/g)).toHaveLength(1);
    expect(html).toContain('class="cs-list" data-stagger="installed"');
    const rows = items(html);
    expect(rows).toHaveLength(2);
    const [notion, files] = rows;
    expect(notion).toMatch(/^ data-conn="open" data-id="ab12">/);
    expect(notion).toMatch(/<button type="button" class="btn cs-open" data-conn="open" data-id="ab12" data-k="cs-open:ab12" aria-haspopup="dialog" title="查看 Notion">/);
    expect(notion).toContain('<span class="nm">Notion</span>');
    expect(notion).toContain('<span class="ds">Notion的一句話</span>');
    expect(notion).toContain('class="logo"');
    expect(notion).toMatch(/class="tg" role="switch" aria-checked="true" aria-label="開啟 Notion" data-conn="enable" data-id="ab12"/);
    // the chevron is a picture of where the row goes, not a second button
    expect(notion).toMatch(/<span class="chev" aria-hidden="true"><svg/);
    expect(notion.match(/<button/g)).toHaveLength(2);
    // A server of the user's own: where it is reached, and a neutral plug.
    expect(files).toContain("Files");
    expect(files).toContain("npx");
    expect(files).toContain(ico("plug"));
    expect(files).not.toContain(">F<");
    const remote = connectionsHTML(view({ groups: [{ ...custom, transport: "http", url: "https://example.com/mcp" }] }));
    expect(remote).toContain('class="ds">https://example.com/mcp</span>');
  });

  test("the app switch is on exactly when the app is enabled, independently of tool exclusions", () => {
    expect(connectionsHTML(view({ groups: [{ ...notes, enabled: false, status: "disabled" }] }))).toMatch(/aria-checked="false" aria-label="開啟 Notion"/);
    expect(connectionsHTML(view({ groups: [notes] }))).toMatch(/aria-checked="true" aria-label="開啟 Notion"/);
    const allOn: ConnectionGroup = { ...notes, tools: notes.tools.map((x) => ({ ...x, enabled: true })) };
    expect(connectionsHTML(view({ groups: [allOn] }))).toMatch(/aria-checked="true" aria-label="開啟 Notion"/);
    // Tool exclusions never create a middle state, even before a managed tool list is read.
    const managed: ConnectionGroup = { ...allOn, source: "composio", tools: [], disabled_tools: ["NOTION_DELETE"] };
    expect(connectionsHTML(view({ groups: [managed] }))).toMatch(/aria-checked="true" aria-label="開啟 Notion"/);
  });

  test("says what is wrong with a service in its line; the way to sign in again is in its dialog", () => {
    const login: ConnectionGroup = { ...notes, status: "error", error: "auth" };
    expect(needsLogin(login)).toBe(true);
    expect(needsLogin({ ...login, error: "timeout" })).toBe(false);
    expect(needsLogin({ ...login, auth: "none" })).toBe(false);
    const out = connectionsHTML(view({ groups: [login] }));
    expect(out).toContain("需要重新登入");
    expect(out).not.toContain('data-conn="relogin"');
    const failed = connectionsHTML(view({ groups: [{ ...notes, status: "error", error: "timeout" }] }));
    expect(failed).toContain("連線失敗：太久沒有回應");
    expect(connectionsHTML(view({ groups: [{ ...notes, status: "unchecked" }] }))).toContain("還沒有讀取工具");
  });

  test("empty connections and unmatched searches have concise empty states", () => {
    expect(connectionsHTML(view({ groups: [] }))).toContain(t("conn.emptyInstalled"));
    expect(connectionsHTML(view({ search: "zzz" }))).toContain("沒有符合的項目");
    const found = bodyHTML(view({ search: "files" }));
    expect(found).toContain("Files");
    expect(found).not.toContain("Notion");
  });

  test("keeps the list clean: the tools and the latest actions are in each service's dialog, not here", () => {
    expect(html).not.toContain("最近的動作");
    expect(html).not.toContain("create_page");
    expect(html).not.toContain('role="dialog"');
  });
});

describe("the apps that cannot be called", () => {
  const slack: ConnectionGroup = { ...notes, id: "w1", name: "Slack", status: "error", error: "auth", description: "Slack的一句話" };
  const twin: ConnectionGroup = { ...notes, id: "d1", name: "Notion 2", description: "Notion again" };
  const empty: ConnectionGroup = { ...custom, id: "e1", name: "Empty" };
  const off: ConnectionGroup = { ...custom, id: "o1", name: "Notes", enabled: false, status: "disabled", env: [], args: ["-y", "notes"] };
  const inventory = inventoryOf([
    app("ab12", "Notion"), app("cu1", "Files", { tools: 1 }), app("w1", "Slack", { state: "needs_sign_in", connected: false, tools: 0 }),
    app("d1", "Notion 2", { state: "duplicate", connected: false }), app("e1", "Empty", { state: "no_tools", connected: false, tools: 0 }),
    app("o1", "Notes", { state: "disabled", enabled: false, connected: false, tools: 0 }),
  ]);
  const all = view({ groups: [notes, custom, slack, twin, empty, off], inventory });

  test("the apps that can be called now come first; the others follow under their own heading, each with its switch and its dialog", () => {
    // The 推薦 section under the list (owner, 2026-11-08) is the store's, checked on its own.
    const html = bodyHTML(all).split('<section class="cs-sec cs-recommended">')[0]!;
    const [now, later] = html.split(`<h2>${"尚未連結"}</h2>`);
    expect(now).toContain("<h2>應用程式</h2>");
    expect([...now!.matchAll(/class="nm">([^<]+)</g)].map((m) => m[1])).toEqual(["Notion", "Files"]);
    expect([...later!.matchAll(/class="nm">([^<]+)</g)].map((m) => m[1])).toEqual(["Slack", "Notion 2", "Empty", "Notes"]);
    expect(later).toContain('data-stagger="installed-not"');
    // why each one is not one of the connected: a sign-in is waited for, a second way to an app that is counted, every tool off
    expect(later).toContain("需要重新登入");
    expect(later).toContain("與另一個連線重複");
    expect(later).toContain("工具已全部關閉");
    // one that is switched off says it with its switch, and keeps the words it always had
    expect(later).toContain("npx -y notes");
    expect(later).toMatch(/aria-checked="false" aria-label="開啟 Notes"/);
    expect(later!.match(/data-conn="enable"/g)).toHaveLength(4);
    // With every app connected the list is one list and needs no heading.
    expect(bodyHTML(view())).not.toContain("<h2>應用程式</h2>");
  });

  test("the dialog holds connectors only: no skills section, no import button, no skill rows (owner, 2026-11-07)", () => {
    // Skills belong to each member and are managed in that member's own panel.
    for (const state of [view(), all, view({ groups: [] }), view({ search: "zzz" }), view({ tab: "store" }), view({ open: { tab: "installed", id: "ab12" } })]) {
      const html = connectionsHTML(state);
      expect(html).not.toMatch(/data-skills-section|skill-discover|skill-open|skill-enable|retry-skills|cs-skill|data-library-skill|data-dialog="skill/);
      expect(html).not.toMatch(/<h2>技能<\/h2>|技能|匯入/);
    }
    expect(connectionsHTML(view())).toContain("data-cs-body");
  });

  test("while the count is not read, or cannot be, the apps are one list as before", () => {
    for (const inv of ["loading", "failed"] as const) {
      const html = bodyHTML(view({ groups: [notes, slack], inventory: inv }));
      expect(html.match(/class="cs-list"/g)).toHaveLength(1);
      expect(html).not.toContain("尚未連結");
    }
  });

  test("an inventory that is not whole says which app it could not read, and counts none of them", () => {
    const partial = { state: "partial" as const, count: null, apps: [app("ab12", "Notion", { state: "unknown", connected: false, tools: 0 })] };
    const html = connectionsHTML(view({ groups: [notes], inventory: partial }));
    expect(html).toMatch(/data-id="installed"[^>]*>已連結<span class="n">—<\/span>/);
    expect(html).toContain("無法讀取");
  });

  test("the dialog of an app says its account: a row for each account of a managed one, the owner's own Google, a signed-in server", () => {
    const managed: ConnectionGroup = { ...notes, source: "composio", accounts: [{ status: "ACTIVE" }, { status: "EXPIRED" }] };
    const d = installedPage("ab12", { groups: [managed, custom] }).split('<div class="cs-scrim"')[1]!;
    expect(d).toMatch(/<div class="cs-acct">.*帳號 1<\/span><span class="st"><span class="dot ok"><\/span>已連結<\/span><\/div><div class="cs-acct">.*帳號 2<\/span><span class="st err"><span class="dot err"><\/span>已過期/);
    const google: ConnectionGroup = { ...notes, id: "google", source: "google", accounts: [{ status: "ACTIVE" }] };
    expect(installedPage("google", { groups: [google] })).toContain("你的 Google 帳號");
    // never an account's name or address: the core does not give one, and the page invents none
    expect(d).not.toMatch(/@|\bca_/);
    // a server that is signed in to has one row; one that needs no login has none
    expect(installedPage("ab12", { groups: [notes] }).split('<div class="cs-scrim"')[1]).toContain("已登入");
    expect(installedPage("cu1")).not.toContain('class="cs-acct"');
    // after it signs in again the old account may still be there: both are told, and the app is still one
    expect(installedPage("ab12", { groups: [{ ...managed, status: "error", error: "auth" }] })).toContain("需要重新登入");
  });
});

describe("the dialog of a connected service", () => {
  const dialog = (html: string): string => html.slice(html.indexOf('<div class="cs-scrim"'));

  test("opens over the list, which stays under it: a modal dialog named by the service, that grows in once", () => {
    const html = installedPage("ab12");
    expect(html).toContain("data-cs-body");
    expect(html).toContain('<div class="cs-scrim" data-conn="scrim" data-dialog="ab12">');
    expect(html).toContain('<div class="cs-dialog" id="cs-dialog" role="dialog" aria-modal="true" aria-labelledby="cs-dlg-title" tabindex="-1" data-trap>');
    expect(dialog(html)).toContain('<h2 class="cs-dlg-name" id="cs-dlg-title">Notion</h2>');
  });

  test("has the mark, the switch, a close button, the name, what it is and the count of its tools", () => {
    const d = dialog(installedPage("ab12"));
    expect(d).toMatch(/class="mono xl logo-mono"/);
    expect(d).toMatch(/role="switch" aria-checked="true" aria-label="開啟 Notion" data-conn="enable" data-id="ab12" data-k="cs-dlg-enable"/);
    expect(d).toMatch(/<button type="button" class="btn icon" aria-label="關閉" title="關閉" data-conn="close"/);
    expect(d).toContain("Notion的說明");
    // how many of its tools are on, of all it has: Delete page is off
    expect(d).toContain("已開啟 2/3 個工具（2 個會改動、1 個只讀取）");
  });

  test("kind permissions are always reachable above the folded tools, with binary switches and counts", () => {
    const d = dialog(installedPage("ab12"));
    expect(d).toContain('會改動<em class="num">1/2</em>');
    expect(d).toContain('只讀取<em class="num">1/1</em>');
    expect(d).toMatch(/aria-checked="false"[^>]*data-conn="kind"[^>]*data-kind="write"/);
    expect(d).toMatch(/aria-checked="true"[^>]*data-conn="kind"[^>]*data-kind="read"/);
    expect(d.indexOf('data-conn="kind"')).toBeLessThan(d.indexOf('data-conn="tool-list"'));
    const onlyRead = dialog(installedPage("cu1"));
    expect(onlyRead).toMatch(/aria-checked="false"[^>]*data-kind="write"[^>]*disabled/);
    for (const state of [view(), view({ open: { tab: "installed", id: "ab12" } }), view({ tab: "store" })]) {
      expect(connectionsHTML(state)).not.toContain('aria-checked="mixed"');
    }
  });

  test("its tools are one folded line, which unfolds into them under write and read headings, a switch each", () => {
    const folded = dialog(installedPage("ab12"));
    expect(folded).toMatch(/data-conn="tool-list" aria-expanded="false" data-k="cs-count"/);
    expect(folded).not.toContain('data-conn="tool"');
    expect(folded).not.toContain('class="cs-plugin-tools"');
    const open = dialog(installedPage("ab12", { toolsOpen: true }));
    expect(open).toMatch(/data-conn="tool-list" aria-expanded="true" data-k="cs-count"/);
    expect(open.match(/data-conn="tool"/g)).toHaveLength(3);
    expect(open).toContain(">Create page<");
    expect(open).toContain(">Search<");
    expect(open).toContain('title="search"'); // the raw name stays in the tooltip
    expect(open).toMatch(/aria-checked="false" aria-label="開啟工具 Delete page" data-conn="tool" data-id="ab12" data-tool="delete_page"/);
    expect(dialog(installedPage("cu1", { toolsOpen: true })).match(/data-conn="tool"/g)).toHaveLength(1);
    // no button holds another control
    expect(open).not.toMatch(/<button(?:(?!<\/button>).)*<button/s);
  });




  test("the store service's primary try button is localized in a Chinese window", () => {
    expect(dialog(installedPage("ab12"))).toMatch(/<button type="button" class="btn pri" data-conn="try" data-id="ab12" data-k="cs-try">試用<\/button>/);
    expect(examplePrompt(CATALOG[0])).toBe("跟Notion說一");
    setLocale("en");
    expect(dialog(installedPage("ab12"))).toContain('data-k="cs-try">Try it</button>');
    expect(examplePrompt(CATALOG[0])).toBe("Tell Notion one");
    expect(examplePrompt(undefined)).toBeNull();
    expect(examplePrompt({ ...CATALOG[0], examples: { "zh-TW": [], en: [], ja: [] } })).toBeNull();
    // a server of the user's own has nothing to try
    expect(dialog(installedPage("cu1"))).not.toContain('data-conn="try"');
  });

  test("keeps disconnect in the detail overflow and secondary controls before Try it", () => {
    const d = dialog(installedPage("ab12"));
    const acts = d.slice(d.indexOf('class="action-row cs-acts is-sticky"'));
    expect(d).toContain('data-conn="server-menu"');
    expect(d).not.toContain('data-conn="disconnect"');
    expect(acts.indexOf('data-conn="refresh"')).toBeLessThan(acts.indexOf('data-conn="try"'));
    expect(acts).toMatch(/class="btn sm" data-conn="relogin" data-id="ab12"[^>]*>重新登入</);
    expect(acts).toMatch(/class="btn sm" data-conn="refresh" data-id="ab12"[^>]*>重新讀取工具</);
    // a service with no login has none to do again
    expect(dialog(installedPage("cu1"))).not.toContain('data-conn="relogin"');
  });

  test("a login that ran out is said at the top with its button; while it is open, every sign-in waits", () => {
    const out = dialog(installedPage("ab12", { groups: [{ ...notes, status: "error", error: "auth" }] }));
    expect(out).toContain("需要重新登入");
    expect(out).toMatch(/<div class="ca-alert">.*data-conn="relogin" data-id="ab12" data-k="cs-relogin-top"/);
    expect(out.match(/data-conn="relogin"/g)).toHaveLength(1);
    const waiting = installedPage("ab12", { groups: [{ ...notes, status: "error", error: "auth" }], login: { target: "ab12", name: "Notion" } });
    expect(waiting).toMatch(/data-conn="relogin"[^>]*disabled[^>]*>請在瀏覽器登入…/);
  });

  test("has that service's own latest actions, folded under a row that counts them, and the note that no content is kept", () => {
    const audit = [...AUDIT, { ...AUDIT[0], id: 2, server: "Files", tool: "list" }];
    const folded = dialog(installedPage("ab12", { audit }));
    expect(folded).toMatch(/<button type="button" class="btn gr" data-conn="audit" aria-expanded="false" data-k="cs-audit"><span class="gt">最近的動作<em class="num">1<\/em>/);
    expect(folded).not.toContain("自動執行");
    const open = dialog(installedPage("ab12", { audit, auditOpen: true }));
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("Create page");
    expect(open).not.toContain(">List<");
    expect(open).toContain("自動執行");
    expect(open).toContain("只記錄時間、工具和結果，不記錄內容。");
    expect(dialog(installedPage("cu1"))).not.toContain("最近的動作"); // none of its own
    expect(dialog(installedPage("ab12", { audit: [] }))).not.toContain("最近的動作");
    expect(open).not.toMatch(/T[0-3]\b/);
  });

  test("has no levels, no review step and no word about pending tools", () => {
    for (const html of [installedPage("ab12", { toolsOpen: true }), installedPage("ab12"), connectionsHTML(view()), storePage("linear")]) {
      expect(html).not.toMatch(/T[0-3]\b|決定權限|先問我|按住確認|待決定|conn-tier|conn-draft|conn-all|review/);
    }
  });

  test("a server that changed its tools shows them all the same, new ones on", () => {
    const grown: ConnectionGroup = { ...notes, tools: [...notes.tools, { name: "fresh", description: "New.", enabled: true, kind: "read" }], tool_count: 4, read_count: 2, enabled_count: 3 };
    expect(installedPage("ab12", { groups: [grown] })).toContain("已開啟 3/4 個工具（2 個會改動、2 個只讀取）"); // Delete page is still off
    const html = installedPage("ab12", { groups: [grown], toolsOpen: true });
    expect(html).toMatch(/aria-checked="true" aria-label="開啟工具 Fresh"/);
    expect(html).not.toMatch(/>新<|待決定/);
  });

  test("a server of the user's own has no store words: the command and the names of its secrets", () => {
    const d = dialog(installedPage("cu1"));
    expect(d).toContain('<p class="cs-desc">自訂伺服器</p>');
    expect(d).not.toContain("由 ");
    expect(d).toContain("npx");
    expect(d).toContain("API_KEY");
    expect(d).toContain("已開啟 1/1 個工具（0 個會改動、1 個只讀取）");
  });

  test("tools not read yet say how to read them", () => {
    expect(installedPage("cu1", { groups: [{ ...custom, tools: [], tool_count: 0, status: "unchecked" }] })).toContain("按「重新讀取工具」");
  });

  test("a dialog whose service is gone is the list alone", () => {
    const html = installedPage("nope");
    expect(html).toContain("data-cs-body");
    expect(html).not.toContain("cs-scrim");
  });
});

describe("商店", () => {
  const html = connectionsHTML(view({ tab: "store" }));

  test("the store tab and every pager count the same addable apps, including popular apps but excluding connected ones", () => {
    const catalog = [...CATALOG, ...Array.from({ length: 38 }, (_, index) => service(`extra-${index}`, `Extra ${String(index).padStart(2, "0")}`))];
    const seen = new Set<string>();
    // Linear, Sentry, Canva, the extras, n8n and the owner's own Google: 43.
    for (let storePage = 0; storePage < 3; storePage++) {
      const out = connectionsHTML(view({ tab: "store", catalog, storePage }));
      expect(out).toMatch(/data-id="store"[^>]*>商店<span class="n">43<\/span>/);
      expect(out).toContain(`${storePage * 18 + 1}–${Math.min((storePage + 1) * 18, 43)} / 43`);
      const ids = [...out.matchAll(/data-conn="join" data-id="([^"]+)"/g)].map(match => match[1]!);
      expect(ids).toHaveLength(storePage < 2 ? 18 : 7);
      for (const id of ids) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(seen.size).toBe(43);
    expect(seen.has("n8n")).toBe(true);
    expect(seen.has("google")).toBe(true);
    expect(seen.has("linear")).toBe(true);
    expect(seen.has("notion")).toBe(false);
  });

  test("the rows and their count share one pass over the managed catalog", () => {
    const composioCatalog = [service("slack", "Slack", { source: "composio" })];
    const filter = vi.spyOn(composioCatalog, "filter");
    const out = connectionsHTML(view({ tab: "store", configured: true, composioCatalog }));
    expect(out).toContain('data-k="cs-store:slack"');
    expect(out).toMatch(/data-id="store"[^>]*>商店<span class="n">6<\/span>/);
    expect(filter).toHaveBeenCalledTimes(1);
  });

  test("the store is one list of the apps not added yet, popular ones first (owner, 2026-11-08)", () => {
    const titles = [...html.matchAll(/<h2>([^<]+)<\/h2>/g)].map(match => match[1]);
    expect(titles).toEqual(["全部"]);
    expect([...html.matchAll(/class="nm">([^<]+)</g)].map(match => match[1])).toEqual(["Linear", "Canva", "Google（私人連接）", "n8n", "Sentry"]);
    expect(html).not.toContain("已安裝");
    expect(html).not.toContain('data-k="conn-category"');
    expect(html.match(/data-conn="store-group"/g)).toHaveLength(10);
  });

  test("a card is a container with the button that opens the page and, inside it, the button that adds; no button is in a button", () => {
    const cards = html.split('<div class="cs-card">').slice(1);
    const card = cards.find((c) => c.includes('data-id="linear"'))!;
    expect(card).toMatch(/class="btn cs-main" data-conn="open-store" data-id="linear" data-k="cs-store:linear"/);
    expect(card).toContain("Linear的一句話");
    // the container holds both, and nothing is nested
    expect(html).toMatch(/<div class="cs-card"><button[^>]*cs-main[^>]*>(?:(?!<\/button>).)*<\/button><button[^>]*data-conn="join"/);
    // the mark sits bare in its own slot, as in the list
    expect(card).toMatch(/<span class="ic"><span class="mono md logo-mono"/);
    for (const c of cards) expect(c.match(/<button/g)!.length).toBeLessThanOrEqual(2);
    expect(html).not.toMatch(/<button(?:(?!<\/button>).)*<button/);
    expect(card).toMatch(/<button[^>]*class="btn sm" data-conn="join" data-id="linear"[^>]*>.*加入<\/button>/);
    // Notion is connected: it is in 已連結, not in the store.
    expect(cards.some((c) => c.includes('data-id="notion"'))).toBe(false);
  });

  test("n8n is set up in the conversation: its row asks nothing, and an n8n connection takes it out of the store", () => {
    const card = html.split('<div class="cs-card">').find((c) => c.includes('data-id="n8n"'))!;
    // What it needs is said in the conversation, not on a row (owner, 2026-11-09).
    expect(card).not.toContain('class="need"');
    expect(card).toMatch(/<span class="mono md logo-mono" style="--brand:#EA4B71">/);
    expect(storePage("n8n")).not.toContain('class="cs-needs"');
    // a connection that already is n8n, however it was named, takes it out of the store
    const own: ConnectionGroup = { ...custom, id: "n1", name: "Workflows", transport: "http", url: "https://n8n.example.com/mcp-server/http" };
    expect(connectionsHTML(view({ tab: "store", groups: [...GROUPS, own] }))).not.toContain('data-id="n8n"');
  });

  test("a service with no bundled mark uses a plug, and known marks keep their brand colour", () => {
    expect(html).toContain(ico("plug"));
    expect(html).not.toContain(">C<");
    expect(html).toMatch(/class="mono md logo-mono" style="--brand:#5E6AD2"/); // Linear
    expect(connectionsHTML(view({ tab: "store", catalog: [service("notion", "Notion", { icon: "notion" })] }))).toMatch(/class="mono md logo-mono">/); // Notion, not added: the colour of the text
    expect(html).not.toMatch(/class="mono[^"]*tile|background/);
  });

  test("while a login is open the card says so with a button to cancel, and the other 加入 buttons wait", () => {
    const out = connectionsHTML(view({ tab: "store", login: { target: "linear", name: "Linear" } }));
    const linear = out.slice(out.indexOf('data-id="linear"'));
    expect(linear.slice(0, linear.indexOf("</div>"))).toContain("請在瀏覽器登入…");
    expect(linear.slice(0, linear.indexOf("</div>"))).toContain('data-conn="cancel-login"');
    expect(out).toMatch(/data-conn="join" data-id="sentry"[^>]*disabled/);
  });

  test("a search with a typo or swapped letters still finds the app by its name, after what it finds as typed (owner, 2026-11-08)", () => {
    const catalog = [service("gmail", "Gmail", { icon: "gmail" }), service("gmailer", "Mailer Gmail Tools"), ...CATALOG];
    const names = (search: string): string[] => [...bodyHTML(view({ tab: "store", catalog, search })).matchAll(/class="nm">([^<]+)</g)].map((m) => m[1]!);
    expect(names("gamil")).toEqual(["Gmail", "Mailer Gmail Tools"]);
    expect(names("linaer")).toEqual(["Linear"]);
    expect(names("sentry")).toEqual(["Sentry"]); // as typed, nothing near is added
    expect(names("360")).toEqual([]);
  });

  test("searches by name, publisher and summary, and then lists the matches once", () => {
    const found = bodyHTML(view({ tab: "store", search: "linear" }));
    expect(found).not.toContain("<h2>熱門</h2>");
    expect(found).toContain("<h2>全部</h2>");
    expect([...found.matchAll(/class="nm">([^<]+)</g)].map((m) => m[1])).toEqual(["Linear"]);
    expect(bodyHTML(view({ tab: "store", search: "zzz" }))).toContain("沒有符合的項目");
  });

  test("a large provider catalog stays bounded and late apps remain reachable by page, slug and alias", () => {
    const composioCatalog = Array.from({ length: 1800 }, (_, index) => service(`catalog-${String(index).padStart(4, "0")}`, `App ${String(index).padStart(4, "0")}`, { source: "composio", category: `category-${index}` }));
    composioCatalog.push(service("googledrive", "Google Drive", { source: "composio", category: "storage" }));
    const base = view({ tab: "store", configured: true, catalog: [], composioCatalog });
    const first = bodyHTML(base);
    expect(first.match(/class="cs-card"/g)).toHaveLength(18); // Popular apps share the result page.
    expect(first.match(/data-conn="store-group"/g)).toHaveLength(10);
    expect(first).not.toContain('data-k="conn-category"');
    expect(bodyHTML({ ...base, storePage: 100 })).toContain('data-id="catalog-1799"');
    const late = bodyHTML({ ...base, search: "catalog-1799" });
    expect(late.match(/class="cs-card"/g)).toHaveLength(1);
    expect(late).toContain('data-id="catalog-1799"');
    expect(bodyHTML({ ...base, search: "雲端硬碟" })).toContain('data-id="googledrive"');
    expect(bodyHTML({ ...base, category: "documents" }).match(/class="cs-card"/g)).toHaveLength(1);
  });
});

describe("the names of tools", () => {
  const tool = (name: string, title?: string | null) => ({ name, description: "", enabled: true, kind: "read" as const, title });
  test("the title a server gives is used", () => {
    expect(toolLabel(tool("notion-search", "Search Notion"), "Notion")).toBe("Search Notion");
    expect(toolLabel(tool("x", "  "), "")).toBe("X");
  });
  test("otherwise the name is made readable: the service's prefix off, dashes and underscores as spaces, a capital", () => {
    expect(toolLabel(tool("notion-create-pages"), "Notion")).toBe("Create pages");
    expect(toolLabel(tool("notion_get_users"), "Notion")).toBe("Get users");
    expect(toolLabel(tool("create_page"), "Notion")).toBe("Create page");
    expect(toolLabel(tool("list-issues"), "Linear")).toBe("List issues");
    expect(toolLabel(tool("linear"), "Linear")).toBe("Linear"); // a name that is only the prefix stays
    expect(toolLabel(tool("-_"), "")).toBe("-_");
    expect(toolLabel(tool("getUser"), "")).toBe("GetUser");
  });
});

describe("the page of a store service", () => {
  test("has a big mark, the name, who provides it, the button that adds, things to say, what it is and the server", () => {
    const html = storePage("linear");
    expect(html).toContain('data-conn="back"');
    expect(html).toMatch(/class="mono xl logo-mono"/);
    expect(html).toContain('<h2 class="big">Linear</h2>');
    expect(html).toContain("由 Linear 提供");
    expect(html).toMatch(/<button[^>]*class="btn pri" data-conn="join" data-id="linear">.*加入<\/button>/);
    expect(html).toContain("對拉斐爾說說看");
    expect(html).toContain("跟Linear說一");
    expect(html).toContain("跟Linear說二");
    expect(html).toContain("Linear的說明");
    expect(html).toContain("https://mcp.linear.example/mcp");
  });

  test("an added service says so and opens its own page", () => {
    const html = storePage("notion");
    expect(html).toContain("已安裝");
    expect(html).toContain('data-conn="manage" data-id="ab12"');
    expect(html).not.toContain('data-conn="join"');
  });

  test("a public service has no login to wait for: it says it is connecting, in card and page", () => {
    const open = service("context7", "Context7", { icon: "context7", auth: "none" });
    const login = { target: "context7", name: "Context7" };
    const base = { catalog: [...CATALOG, open], login };
    const card = connectionsHTML(view({ ...base, tab: "store" }));
    expect(card.slice(card.indexOf('data-id="context7"'))).toContain("連線中…");
    const page = storePage("context7", base);
    expect(page).toContain("連線中…");
    expect(page).not.toContain("請在瀏覽器登入");
  });

  test("waiting for the browser it says so and has 取消; a failed login says why and the button is back", () => {
    const waiting = storePage("linear", { login: { target: "linear", name: "Linear" } });
    expect(waiting).toContain("請在瀏覽器登入…");
    expect(waiting).toContain('data-conn="cancel-login"');
    expect(waiting).not.toContain('data-conn="join"');
    const denied = storePage("linear", { loginError: { target: "linear", kind: "denied" } });
    expect(denied).toContain("你在瀏覽器上拒絕了，所以沒有加入。");
    expect(denied).toContain('data-conn="join"');
    expect(storePage("linear", { loginError: { target: "linear", kind: "timeout" } })).toContain("太久沒有登入");
    expect(storePage("linear", { loginError: { target: "linear", kind: "network" } })).toContain(t("conn.err.network"));
    expect(storePage("sentry", { loginError: { target: "linear", kind: "denied" } })).not.toContain("拒絕");
  });
});

describe("the form that connects a server of the user's own", () => {
  test("takes the place of the tab with a transport dropdown, multiline fields and test and save actions", () => {
    const html = connectionsHTML(view({ form: form() }));
    expect(html).toContain("新增 MCP 伺服器");
    expect(html).toContain('data-k="conn-type"');
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('id="conn-args" rows="4"');
    expect(html).toContain('id="conn-command"');
    expect(html).toContain("只接你信任的程式。");
    expect(html).not.toContain('class="cd-help"');
    expect(html).toContain('data-conn="connect"');
    expect(html).toContain('data-conn="form-cancel"');
    expect(html.indexOf('data-conn="form-cancel"')).toBeLessThan(html.indexOf('data-conn="connect"'));
    expect(html).toContain('class="action-row add-acts is-sticky"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('role="dialog"');
  });

  test("an address and a header for the network type; the values of secrets are never printed", () => {
    const f = form({ id: "remote", type: "http", name: "Remote", url: "https://example.com/mcp", pairLines: "Authorization=" });
    const html = connectionsHTML(view({ form: f }));
    expect(html).toContain('id="conn-url"');
    expect(html).not.toContain('id="conn-command"');
    expect(html).toContain("Authorization");
    expect(html).toContain("標頭");
    expect(html).not.toContain("TOPSECRET");
    expect(html).toContain('id="conn-pairs"');
    expect(html).toContain('id="conn-limit"');
  });
});

describe("the rules for this tab", () => {
  // Slack waits for its sign-in (two accounts, one expired)
  const slack: ConnectionGroup = { ...notes, id: "w1", name: "Slack", source: "composio", status: "error", error: "auth", accounts: [{ status: "EXPIRED" }, { status: "ACTIVE" }] };
  const more = {
    groups: [...GROUPS, slack],
    inventory: inventoryOf([app("ab12", "Notion"), app("cu1", "Files", { tools: 1 }), app("w1", "Slack", { state: "needs_sign_in", connected: false, tools: 0 })]),
  };
  const pages = (): string[] => [
    connectionsHTML(view()),
    connectionsHTML(view(more)),
    installedPage("w1", more),
    connectionsHTML(view({ tab: "store" })),
    connectionsHTML(view({ tab: "store", login: { target: "linear", name: "Linear" } })),
    installedPage("ab12", { confirmingDisconnect: "ab12", auditOpen: true }),
    installedPage("ab12", { toolsOpen: true }),
    installedPage("ab12", { groups: [{ ...notes, status: "error", error: "auth" }] }),
    storePage("linear", { loginError: { target: "linear", kind: "denied" } }),
    connectionsHTML(view({ form: form({ pairLines: "TOKEN=" }) })),
    storePage("notion"),
  ];

  test("everything that does something is a button or a switch with a shape, and every choice is a dropdown", () => {
    const all = pages().join("");
    // A row of the list and the dimmed part around a dialog take a click too, each beside a real
    // button that does the same (the row's name, the dialog's ×).
    const acts = [...all.matchAll(/<(\w+)[^>]*data-conn="([\w-]+)"/g)].filter((m) => !(m[1] === "div" && ["open", "scrim"].includes(m[2]!))).map((m) => m[1]);
    expect(acts.length).toBeGreaterThan(30);
    expect(new Set(acts)).toEqual(new Set(["button"]));
    for (const tag of all.match(/<button[^>]*>/g)!) expect(tag).toMatch(/class="(btn[ "]|sel[ "]|tg|tab")/);
    expect(all).not.toMatch(/<a[ >]/);
    expect(all).not.toContain("<select");
    expect(all).not.toContain('type="radio"');
    expect(all).not.toContain("onclick");
  });

  test("the tabs are real buttons, not clickable text", () => {
    const tabs = connectionsHTML(view()).match(/<button[^>]*role="tab"[^>]*>/g)!;
    expect(tabs).toHaveLength(2);
    for (const tag of tabs) expect(tag).toContain('class="tab"');
  });

  test("the icon-only buttons (close, back) are named in their label and tooltip", () => {
    for (const html of [installedPage("ab12"), installedPage("ab12", { toolsOpen: true })]) {
      for (const tag of html.match(/<button[^>]*class="btn icon"[^>]*>/g)!) expect(tag).toMatch(/aria-label="[^"]+" title="[^"]+"/);
    }
  });

  test.each(["en", "ja"] as const)("is in one language at a time (%s)", (locale) => {
    setLocale(locale);
    const all = pages().join("");
    for (const zh of ["已安裝", "已連結", "商店", "加入", "中斷連線", "熱門", "只讀取", "會改動", "請在瀏覽器登入", "重新登入", "重新讀取工具", "最近的動作", "沒有符合", "技能", "尚未連結", "帳號"]) expect(all).not.toContain(zh);
    if (locale === "en") {
      // what the service itself says (here the fake store's own words) is the catalog's, in English
      expect(all).toContain("Installed");
      expect(all).toContain(">Connected<");
      expect(all).toContain("Sign in in your browser…");
      expect(all).toContain("2/3 tools on (2 write, 1 read)");
      expect(all).toContain("Tell Linear one");
      expect(all).toContain(">Try it<");
      expect(all).not.toContain("Skills");
      expect(all).toContain("Not connected");
      expect(all).toContain("Account 1");
      expect(all).not.toMatch(CJK);
    } else {
      expect(all).toContain("接続済み");
      expect(all).toContain("ブラウザでログインしてください…");
      expect(all).toContain("Linearに一");
      expect(all).not.toContain("スキル");
      expect(all).toContain("未接続");
      expect(all).toContain("アカウント 1");
      expect(all).not.toMatch(/Installed|Popular|Sign in|Contains|Recent actions|Disconnect|Private skills|Not connected|Account/);
      expect(all).not.toContain("跟");
    }
  });
});

describe("what the tab does", () => {
  const host = { visible: () => true, redraw: vi.fn(), tryPrompt: vi.fn() };
  const button = (conn: string, extra: Record<string, string> = {}): Element =>
    ({ closest: () => ({ dataset: { conn, ...extra } }) }) as unknown as Element;
  const key = (k: string): KeyboardEvent => {
    const e = { key: k, target: null, defaultPrevented: false, preventDefault: vi.fn(() => void (e.defaultPrevented = true)) };
    return e as unknown as KeyboardEvent;
  };
  const input = (id: string, value: string): HTMLInputElement => ({ id, value }) as HTMLInputElement;
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    vi.mocked(toaster.info).mockReset();
    api.toolsetsList.mockResolvedValue({ groups: GROUPS });
    api.connectorsStatus.mockResolvedValue({ connectors: [], composio_configured: true, google_configured: false });
    api.connectorsCatalog.mockResolvedValue({ categories: [], items: CATALOG.map(s => ({ slug: s.id, name: s.name, description: s.summary["zh-TW"], logo: "", categories: [], needs: "sign_in", no_auth: false })) });
    api.connectorsCategories.mockResolvedValue({ items: [] });
    api.integrationsCatalog.mockResolvedValue({ services: CATALOG });
    api.integrationsAudit.mockResolvedValue({ entries: AUDIT });
    api.integrationsInventory.mockResolvedValue(INVENTORY);
    api.membersList.mockResolvedValue({ members: [{ id: 0, name: "拉斐爾" }, { id: 1, name: "Ada" }, { id: 2, name: "Ben" }], groups: [] });
    for (const name of ["integrationsRefresh", "integrationsSetEnabled", "integrationsSetToolEnabled"] as const) api[name].mockResolvedValue({});
    api.integrationsDisconnect.mockResolvedValue({ removed: true, revoked: true });
    api.integrationsConnectCancel.mockResolvedValue({ cancelled: true });
    host.redraw.mockReset();
    host.tryPrompt.mockReset();
  });

  test("reads the services, the store, the latest actions and the core's count, and starts on 已連結", async () => {
    const c = createConnections(host);
    expect(c.view().groups).toBe("loading");
    expect(c.view().inventory).toBe("loading");
    await c.load();
    expect(c.view().groups).toEqual(GROUPS);
    expect((c.view().catalog as StoreService[]).map(s => s.id)).toEqual(CATALOG.map(s => s.id));
    expect(c.view().audit).toEqual(AUDIT);
    expect(c.view().inventory).toEqual(INVENTORY);
    expect(c.view().tab).toBe("installed");
  });

  test("the count is the core's: read with the services, unknown when it cannot be read, and read again by every change", async () => {
    api.integrationsInventory.mockRejectedValueOnce("down");
    const c = createConnections(host);
    await c.load();
    expect(c.view().inventory).toBe("failed");
    expect(c.view().groups).toEqual(GROUPS); // the list is there; only the number is not
    await c.load();
    expect(c.view().inventory).toEqual(INVENTORY);
    // a switch, a sign-in, an uninstall: the services and the count are read again together
    api.integrationsInventory.mockResolvedValue(inventoryOf([app("cu1", "Files", { tools: 1 })]));
    c.followEvent({ type: "ConnectionsChanged" });
    await settle();
    expect((c.view().inventory as AppsInventory).count).toBe(1);
  });

  test("never reads a member's skills, and a change of a member's skills leaves the dialog alone", async () => {
    const c = createConnections(host);
    await c.load(); await settle();
    host.redraw.mockClear();
    c.followEvent({ type: "MembersChanged" });
    await settle();
    expect(api.membersSkillsList).not.toHaveBeenCalled();
    expect(api.membersSkillsImport).not.toHaveBeenCalled();
    expect(api.core.mock.calls.filter(([method]) => String(method).startsWith("members.skills"))).toHaveLength(0);
    expect(host.redraw).not.toHaveBeenCalled();
    expect("skills" in c.view() || "skill" in c.view()).toBe(false);
  });

  test("edits a custom server with blank existing secrets, tests without saving, then persists the draft", async () => {
    api.integrationsTest.mockResolvedValue({ ok: true, tools: ["list"] });
    api.integrationsUpdate.mockResolvedValue({ server: custom });
    const c = createConnections(host);
    await c.load();
    c.click(button("edit-server", { id: "cu1" }));
    expect(c.view().form).toMatchObject({ id: "cu1", pairLines: "API_KEY=", command: "npx", limit: 8000 });
    c.input(input("conn-command", "uvx"));
    c.input(input("conn-limit", "2400"));
    c.click(button("test-draft")); await settle();
    expect(api.integrationsTest).toHaveBeenCalledWith(expect.objectContaining({ id: "cu1", command: "uvx", env: [{ name: "API_KEY", value: "" }], result_size_limit: 2400 }));
    expect(api.integrationsUpdate).not.toHaveBeenCalled();
    expect(c.view().form).not.toBeNull();
    c.click(button("connect")); await settle();
    expect(api.integrationsUpdate).toHaveBeenCalledWith("cu1", expect.objectContaining({ command: "uvx", result_size_limit: 2400 }));
    expect(c.view().form).toBeNull();
    c.click(button("test-server", { id: "cu1" })); await settle();
    expect(api.integrationsTest).toHaveBeenLastCalledWith({ id: "cu1" });
  });

  test("with nothing connected yet it starts on the store, once", async () => {
    api.toolsetsList.mockResolvedValue({ groups: [] });
    const c = createConnections(host);
    await c.load();
    expect(c.view().tab).toBe("store");
    c.click(button("tab", { id: "installed" }));
    await c.load();
    expect(c.view().tab).toBe("installed");
  });

  test("read in the background at launch, it opens at once on what it holds, on the store when nothing is connected", async () => {
    api.toolsetsList.mockResolvedValue({ groups: [] });
    let shown = false;
    const c = createConnections({ ...host, visible: () => shown });
    await c.load(); await settle();
    // Unseen, the read decides nothing about where the page opens.
    expect(c.view().tab).toBe("installed");
    expect(c.view().catalog).toEqual(CATALOG);
    shown = true; c.reset();
    expect(c.view().groups).toEqual([]);
    expect(c.view().tab).toBe("store");
    c.reset();
    expect(c.view().tab).toBe("installed");
  });

  test("says the services cannot be had when the first read fails, and keeps the old ones when a later one does", async () => {
    api.toolsetsList.mockRejectedValueOnce("down");
    api.connectorsStatus.mockRejectedValueOnce("down");
    const c = createConnections(host);
    await c.load();
    expect(c.view().groups).toBe("failed");
    expect(c.view().catalog).toEqual(CATALOG);
    await c.load();
    api.toolsetsList.mockRejectedValueOnce("down");
    api.connectorsStatus.mockRejectedValueOnce("down");
    await c.load();
    expect(c.view().groups).toEqual(GROUPS);
    expect((c.view().catalog as StoreService[]).map(s => s.id)).toEqual(CATALOG.map(s => s.id));
  });

  test("changes view, opens a page or a dialog and goes back; one whose service is gone closes", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("tab", { id: "store" }));
    expect(c.view().tab).toBe("store");
    c.click(button("open-store", { id: "linear" }));
    expect(c.view().open).toEqual({ tab: "store", id: "linear" });
    c.click(button("back"));
    expect(c.view().open).toBeNull();
    c.click(button("tab", { id: "installed" }));
    c.click(button("open", { id: "ab12" }));
    expect(c.view().open).toEqual({ tab: "installed", id: "ab12" });
    api.toolsetsList.mockResolvedValue({ groups: [custom] });
    await c.load();
    expect(c.view().open).toBeNull();
  });

  test("opening a loaded store draws its snapshot once while its refresh is pending", async () => {
    const c = createConnections(host);
    await c.load();
    await settle();
    const catalog = c.view().composioCatalog;
    let reply!: (value: { categories: []; items: [] }) => void;
    api.connectorsCatalog.mockReturnValueOnce(new Promise(resolve => { reply = resolve; }));
    host.redraw.mockClear();
    c.click(button("tab", { id: "store" }));
    expect(c.view().composioCatalog).toBe(catalog);
    expect(host.redraw).toHaveBeenCalledTimes(1);
    reply({ categories: [], items: [] });
    await settle();
    expect(c.view().composioCatalog).toEqual([]);
    expect(host.redraw).toHaveBeenCalledTimes(2);
  });

  test("an unchanged catalog refresh keeps the rendered store while changed rows still redraw", async () => {
    const c = createConnections(host);
    await c.load();
    await settle();
    const catalog = c.view().composioCatalog;
    host.redraw.mockClear();
    c.click(button("tab", { id: "store" }));
    await settle();
    expect(api.connectorsCatalog).toHaveBeenCalledTimes(2);
    expect(c.view().composioCatalog).toEqual(catalog);
    expect(host.redraw).toHaveBeenCalledTimes(1);
    api.connectorsCatalog.mockResolvedValueOnce({ categories: [], items: [] });
    c.click(button("tab", { id: "store" }));
    await settle();
    expect(c.view().composioCatalog).toEqual([]);
    expect(host.redraw).toHaveBeenCalledTimes(3);
  });

  test("a store page opens the dialog of the service it was added as, over 已安裝", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("tab", { id: "store" }));
    c.click(button("open-store", { id: "notion" }));
    c.click(button("manage", { id: "ab12" }));
    expect(c.view().open).toEqual({ tab: "installed", id: "ab12" });
    expect(c.view().tab).toBe("installed");
  });

  test("the app switch changes only the enabled flag and leaves all tool permissions intact", async () => {
    const c = createConnections(host); await c.load();
    c.click(button("enable", { id: "ab12" })); await settle();
    expect(api.integrationsSetEnabled).toHaveBeenLastCalledWith("ab12", false);
    api.toolsetsList.mockResolvedValueOnce({ groups: [{ ...notes, enabled: false }] }); await c.load();
    c.click(button("enable", { id: "ab12" })); await settle();
    expect(api.integrationsSetEnabled).toHaveBeenLastCalledWith("ab12", true);
    expect(api.integrationsSetToolsEnabled).not.toHaveBeenCalled();
    expect(api.integrationsSetToolEnabled).not.toHaveBeenCalled(); c.reset();
  });

  test("server kind switches use one bulk call, preserve the other kind, and never enable the app", async () => {
    api.integrationsSetToolsEnabled.mockResolvedValue({});
    const c = createConnections(host); await c.load();
    c.click(button("kind", { id: "ab12", kind: "write" })); await settle();
    expect(api.integrationsSetToolsEnabled).toHaveBeenLastCalledWith("ab12", ["create_page", "delete_page"], true);
    c.click(button("kind", { id: "ab12", kind: "read" })); await settle();
    expect(api.integrationsSetToolsEnabled).toHaveBeenLastCalledWith("ab12", ["search"], false);
    c.click(button("kind", { id: "ab12", kind: "unknown" })); await settle();
    expect(api.integrationsSetToolsEnabled).toHaveBeenCalledTimes(2);
    expect(api.integrationsSetToolEnabled).not.toHaveBeenCalled();
    expect(api.integrationsSetEnabled).not.toHaveBeenCalled(); c.reset();
  });

  test("the dialog unfolds its list of tools and folds it again, and unfolds the latest actions", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("open", { id: "ab12" }));
    expect(c.view()).toMatchObject({ toolsOpen: false, auditOpen: false });
    c.click(button("tool-list"));
    expect(c.view().toolsOpen).toBe(true);
    c.click(button("tool-list"));
    expect(c.view().toolsOpen).toBe(false);
    c.click(button("tool-list"));
    c.click(button("audit"));
    expect(c.view().auditOpen).toBe(true);
    // opening it again starts folded
    c.click(button("close"));
    c.click(button("open", { id: "ab12" }));
    expect(c.view()).toMatchObject({ open: { tab: "installed", id: "ab12" }, toolsOpen: false, auditOpen: false });
  });

  test("the dialog controller closes with its X or Escape and leaves raw backdrop targets to shared gesture handling", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("open", { id: "ab12" }));
    c.click(button("close"));
    expect(c.view().open).toBeNull();
    c.click(button("open", { id: "ab12" }));
    const esc = key("Escape");
    expect(c.key(esc)).toBe(true);
    expect(esc.preventDefault).toHaveBeenCalled();
    expect(c.view().open).toBeNull();
    // Esc with no dialog is the panel's (it closes the settings)
    expect(c.key(key("Escape"))).toBe(false);
    c.click(button("open", { id: "ab12" }));
    const scrim: { dataset: { conn: string }; closest?: () => unknown } = { dataset: { conn: "scrim" } };
    scrim.closest = () => scrim;
    // a click inside the dialog on no control finds the dimmed part around it, and does nothing
    expect(c.click({ closest: () => scrim } as unknown as Element)).toBe(true);
    expect(c.view().open).not.toBeNull();
    // A raw target cannot establish where the pointer press began.
    expect(c.click(scrim as unknown as Element)).toBe(true);
    expect(c.view().open).not.toBeNull();
    c.click(button("close"));
    expect(c.view().open).toBeNull();
  });

  test("the search filters what is under the bar without drawing the page again", async () => {
    const browser = new Window();
    browser.document.body.innerHTML = '<div data-cs-body></div>';
    const body = browser.document.querySelector("[data-cs-body]")!;
    vi.stubGlobal("document", browser.document);
    try {
      const c = createConnections(host);
      await c.load();
      host.redraw.mockReset();
      expect(c.input(input("conn-search", "files"))).toBe(true);
      expect(c.view().search).toBe("files");
      expect(body.innerHTML).toContain("Files");
      expect(body.innerHTML).not.toContain("Notion");
      expect(host.redraw).not.toHaveBeenCalled();
      c.click(button("tab", { id: "store" }));
      expect(c.view().search).toBe(""); // another view starts with no search
    } finally {
      vi.unstubAllGlobals();
      await browser.happyDOM.abort();
    }
  });

  test.each([true, false])("selecting an overflow category reveals the whole chip with prior focus %s", async (focused) => {
    const c = createConnections(host);
    await c.load();
    c.click(button("tab", { id: "store" }));
    const browser = new Window();
    browser.document.body.innerHTML = connectionsHTML(c.view());
    const geometry = vi.spyOn(browser.HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains("cs-store-groups")) return new browser.DOMRect(0, 0, 100, 28);
      if (this.dataset.conn === "store-group") return new browser.DOMRect(90 - this.parentElement!.scrollLeft, 0, 40, 28);
      return new browser.DOMRect();
    });
    vi.stubGlobal("document", browser.document);
    try {
      const groups = browser.document.querySelector(".cs-store-groups")! as unknown as HTMLElement;
      groups.scrollLeft = 20;
      const last = groups.querySelector<HTMLButtonElement>('[data-id="other"]')!;
      if (focused) last.focus();
      c.click(last);
      const replaced = browser.document.querySelector(".cs-store-groups")! as unknown as HTMLElement;
      const selected = replaced.querySelector<HTMLButtonElement>('[data-id="other"]')!;
      expect(selected.getAttribute("aria-pressed")).toBe("true");
      if (focused) expect(browser.document.activeElement).toBe(selected);
      expect(replaced.scrollLeft).toBe(30);
      expect(selected.getBoundingClientRect().right).toBe(replaced.getBoundingClientRect().right);
    } finally {
      geometry.mockRestore();
      vi.unstubAllGlobals();
      await browser.happyDOM.abort();
    }
  });

  test("switching store tabs preserves the settings shell and avoids a full settings redraw", async () => {
    const c = createConnections(host);
    await c.load();
    const browser = new Window();
    browser.document.body.innerHTML = connectionsHTML(c.view());
    vi.stubGlobal("document", browser.document);
    try {
      const shell = browser.document.querySelector('.cs');
      const storeTab = browser.document.querySelector('[data-conn="tab"][data-id="store"]')! as unknown as HTMLButtonElement;
      const searchInput = browser.document.querySelector('#conn-search')!;
      storeTab.focus();
      const focus = vi.spyOn(browser.HTMLElement.prototype, 'focus');
      host.redraw.mockClear();
      c.click(storeTab as unknown as Element);
      expect(browser.document.querySelector('.cs-store')).toBe(shell);
      expect(browser.document.activeElement).toBe(storeTab);
      expect(browser.document.querySelector('#conn-search')).toBe(searchInput);
      expect(storeTab.getAttribute('aria-selected')).toBe('true');
      expect(focus).not.toHaveBeenCalled();
      expect(browser.document.querySelector('.cs-card')).not.toBeNull();
      expect(host.redraw).not.toHaveBeenCalled();
      c.click(browser.document.querySelector('[data-conn="tab"][data-id="installed"]')! as unknown as Element);
      expect(browser.document.querySelector('.cs')).toBe(shell);
      expect(shell!.classList.contains('cs-store')).toBe(false);
      expect(browser.document.querySelector('.cs-item')).not.toBeNull();
    } finally { vi.unstubAllGlobals(); await browser.happyDOM.abort(); }
  });

  // Owner, 2026-11-09: 「一律全部都在對話中進行…除非真的是登入就結束 或是輸入金鑰匙就結束」.
  test("加入 on n8n, or on an app that needs a developer app, leaves for the conversation with the owner's words", async () => {
    api.integrationsCatalog.mockResolvedValue({ services: [...CATALOG, service("acme", "Acme", { needs: "own_app" })] });
    const c = createConnections(host);
    await c.load();
    c.click(button("join", { id: "n8n" }));
    expect(host.tryPrompt).toHaveBeenLastCalledWith("幫我連接 n8n");
    expect(c.view().form).toBeNull();
    c.click(button("join", { id: "acme" }));
    expect(host.tryPrompt).toHaveBeenLastCalledWith("幫我連接 Acme");
    expect(api.integrationsConnect).not.toHaveBeenCalled();
    expect(api.connectorsConnect).not.toHaveBeenCalled();
  });

  // Owner request (10-25, 「接上 Composio 與自己的 Google 授權」): the owner's own Google is reachable where the Google row is.
  test("the store offers the owner's own Google, and its 加入 leaves for the conversation where the card walks the steps", async () => {
    const c = createConnections(host);
    await c.load();
    const html = connectionsHTML(c.view());
    c.click(button("tab", { id: "store" }));
    const entry = ownGoogleEntry(null);
    expect(entry).toMatchObject({ id: "google", name: "Google（私人連接）", icon: "gmail", server_id: null });
    expect(entry.about["zh-TW"]).toContain("不經過 Composio");
    c.click(button("join", { id: "google" }));
    expect(host.tryPrompt).toHaveBeenLastCalledWith("幫我連接我自己的 Google 帳號");
    expect(c.view().form).toBeNull();
    // Nothing is sent from here: no Composio call, no form of its own.
    expect(api.connectorsConnect).not.toHaveBeenCalled();
    expect(api.connectorsGoogleConnect).not.toHaveBeenCalled();
    // Once the private Google connection exists the row is added.
    expect(ownGoogleEntry("google").server_id).toBe("google");
    expect(html).toBeTruthy();
  });

  test.each(["finish", "switch", "reset"])("store paints visible rows first and cancels stale fill on %s", async (ending) => {
    api.connectorsStatus.mockResolvedValue({ connectors: [], composio_configured: false, google_configured: false });
    api.integrationsCatalog.mockResolvedValue({ services: Array.from({ length: 24 }, (_, i) => service(`app-${i}`, `App ${i}`)) });
    const c = createConnections(host);
    await c.load();
    await settle();
    const browser = new Window();
    browser.document.body.innerHTML = connectionsHTML(c.view());
    const frames: FrameRequestCallback[] = [];
    vi.useFakeTimers();
    vi.stubGlobal("document", browser.document);
    vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) => { frames.push(frame); return frames.length; });
    try {
      c.click(browser.document.querySelector('[data-conn="tab"][data-id="store"]')! as unknown as Element);
      const first = browser.document.querySelector('.cs-card [data-conn="open-store"]');
      expect(browser.document.querySelectorAll('.cs-card [data-conn="open-store"]')).toHaveLength(12);
      expect(browser.document.querySelectorAll('[data-cs-pending]')).toHaveLength(18);
      c.click(browser.document.querySelector('[data-conn="store-group"][data-id=""]')! as unknown as Element);
      expect(browser.document.querySelector('.cs-card [data-conn="open-store"]')).toBe(first);
      expect(browser.document.querySelectorAll('[data-cs-pending]')).toHaveLength(18);
      frames.shift()!(0);
      // requestAnimationFrame runs before paint; hydration must wait for the following task.
      expect(browser.document.querySelectorAll('[data-cs-pending]')).toHaveLength(18);
      if (ending === "switch") c.click(button("tab", { id: "installed" }));
      if (ending === "reset") c.reset();
      await vi.runOnlyPendingTimersAsync();
      if (ending !== "finish") {
        expect(frames).toHaveLength(0);
        expect(browser.document.querySelectorAll('.cs-card [data-conn="open-store"]')).toHaveLength(ending === "reset" ? 12 : 0);
        return;
      }
      expect(browser.document.querySelectorAll('[data-cs-pending]')).toHaveLength(16);
      while (frames.length) { frames.shift()!(0); await vi.runOnlyPendingTimersAsync(); }
      expect(browser.document.querySelector('[data-cs-pending]')).toBeNull();
      expect(browser.document.querySelectorAll('.cs-card [data-conn="open-store"]')).toHaveLength(18);
      expect(browser.document.querySelector('.cs-card [data-conn="open-store"]')).toBe(first);
      expect(browser.document.querySelector('.cs-store-pages .num')!.textContent).toContain('/ 26'); // and n8n and the owner's own Google
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); await browser.happyDOM.abort(); }
  });

  test("switches a service on or off, a tool on or off, and reads its tools again", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("enable", { id: "cu1" }));
    await settle();
    expect(api.integrationsSetEnabled).toHaveBeenCalledWith("cu1", false);
    c.click(button("tool", { id: "ab12", tool: "delete_page" }));
    await settle();
    expect(api.integrationsSetToolEnabled).toHaveBeenLastCalledWith("ab12", "delete_page", true);
    c.click(button("tool", { id: "ab12", tool: "search" }));
    await settle();
    expect(api.integrationsSetToolEnabled).toHaveBeenLastCalledWith("ab12", "search", false);
    c.click(button("refresh", { id: "ab12" }));
    await settle();
    expect(api.integrationsRefresh).toHaveBeenCalledWith("ab12");
  });

  test("disconnects only on the second press, and tells where else the access can be taken away", async () => {
    vi.useFakeTimers();
    try {
      const c = createConnections(host);
      await c.load();
      c.click(button("open", { id: "ab12" }));
      c.click(button("disconnect", { id: "ab12" }));
      expect(c.view().confirmingDisconnect).toBe("ab12");
      expect(api.integrationsDisconnect).not.toHaveBeenCalled();
      vi.advanceTimersByTime(5100);
      expect(c.view().confirmingDisconnect).toBeNull();
      api.toolsetsList.mockResolvedValue({ groups: [custom] });
      c.click(button("disconnect", { id: "ab12" }));
      c.click(button("disconnect", { id: "ab12" }));
      await vi.advanceTimersByTimeAsync(0);
      expect(api.integrationsDisconnect).toHaveBeenCalledTimes(1);
      expect(api.integrationsDisconnect).toHaveBeenCalledWith("ab12");
      expect(c.view().open).toBeNull();
      expect(lastToast()).toContain("Notion 自己的設定");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a service whose login ran out signs in again from its dialog, which stays open", async () => {
    api.toolsetsList.mockResolvedValue({ groups: [{ ...notes, status: "error", error: "auth" }, custom] });
    api.integrationsConnect.mockResolvedValue({ connected: true, server: { id: "ab12" } });
    const c = createConnections(host);
    await c.load();
    c.click(button("open", { id: "ab12" }));
    c.click(button("relogin", { id: "ab12" }));
    expect(api.integrationsConnect).toHaveBeenCalledWith({ id: "ab12" });
    await settle();
    expect(c.view().open).toEqual({ tab: "installed", id: "ab12" });
    expect(c.view().dialogNotice).toEqual({ text: "已重新登入 Notion", kind: "ok" });
    expect(toaster.info).not.toHaveBeenCalled();
  });

  describe("a server of the user's own", () => {
    const menu = (c: ReturnType<typeof createConnections>) => c.menuFor("conn-add")!;

    test("the add menu offers a form, JSON paste and app discovery", async () => {
      const c = createConnections(host);
      await c.load();
      expect(menu(c).choices.map((x) => x.value)).toEqual(["custom", "paste", "import"]);
      menu(c).pick("custom");
      expect(c.view().form).not.toBeNull();
      expect(c.menuFor("nothing")).toBeNull();
    });

    test("the values go to the core once, the names stay, the form is dropped, and the service is under 已安裝", async () => {
      api.integrationsAdd.mockResolvedValue({ server: { id: "new1" } });
      const c = createConnections(host);
      await c.load();
      c.click(button("tab", { id: "store" }));
      menu(c).pick("custom");
      c.input(input("conn-name", " Notes "));
      c.input(input("conn-command", "npx"));
      c.input(input("conn-args", "-y\nnotes-server\npath with spaces"));
      c.input(input("conn-pairs", "API_KEY=TOPSECRET"));
      c.click(button("connect"));
      await settle();
      expect(api.integrationsAdd).toHaveBeenCalledWith({
        name: "Notes", transport: "stdio", command: "npx", args: ["-y", "notes-server", "path with spaces"], env: [{ name: "API_KEY", value: "TOPSECRET" }], headers: undefined, result_size_limit: 8000,
      });
      expect(api.integrationsRefresh).not.toHaveBeenCalled();
      expect(c.view().form).toBeNull();
      expect(c.view().tab).toBe("installed");
      expect(JSON.stringify(c.view())).not.toContain("TOPSECRET");
    });

    test("an address with a header; a half-typed pair and missing fields are told before anything is sent", async () => {
      api.integrationsAdd.mockResolvedValue({ server: { id: "new2" } });
      const c = createConnections(host);
      await c.load();
      menu(c).pick("custom");
      c.click(button("connect"));
      expect(c.view().form!.error!()).toBe("請填名稱");
      c.input(input("conn-name", "Remote"));
      c.click(button("connect"));
      expect(c.view().form!.error!()).toBe("請填指令");
      c.menuFor("conn-type")!.pick("http");
      c.click(button("connect"));
      expect(c.view().form!.error!()).toBe("請填網址");
      c.input(input("conn-url", "https://example.com/mcp"));
      c.input(input("conn-pairs", "Authorization"));
      c.click(button("connect"));
      await settle();
      expect(c.view().form!.error!()).toBe("請使用每行 KEY=value 的格式");
      c.input(input("conn-pairs", "Authorization=Bearer TOKEN"));
      c.click(button("connect"));
      await settle();
      expect(api.integrationsAdd).toHaveBeenCalledTimes(1);
      expect(api.integrationsAdd).toHaveBeenCalledWith({
        name: "Remote", transport: "http", url: "https://example.com/mcp", headers: [{ name: "Authorization", value: "Bearer TOKEN" }], env: undefined, result_size_limit: 8000,
      });
    });

    test("a refused connection keeps the form and says why; cancelling drops what was typed", async () => {
      api.integrationsAdd.mockRejectedValue("[-32602] Invalid params: A plugin with this name exists already");
      const c = createConnections(host);
      await c.load();
      menu(c).pick("custom");
      c.input(input("conn-name", "Notes"));
      c.input(input("conn-command", "npx"));
      c.click(button("connect"));
      await settle();
      expect(c.view().form!.busy).toBe(false);
      expect(c.view().form!.error!()).toContain(t("missing.unknown"));
      c.click(button("form-cancel"));
      expect(c.view().form).toBeNull();
    });
  });

  test("leaving the tab drops the form, the page, the search and a pending disconnect, but not a login that is under way", async () => {
    api.integrationsConnect.mockReturnValue(new Promise(() => undefined));
    const c = createConnections(host);
    await c.load();
    c.click(button("open", { id: "ab12" }));
    c.click(button("disconnect", { id: "ab12" }));
    c.click(button("join", { id: "linear" }));
    c.menuFor("conn-add")!.pick("custom");
    c.input(input("conn-name", "Half"));
    c.input(input("conn-pairs", "TOKEN=TOPSECRET"));
    c.reset();
    expect(c.view()).toMatchObject({ tab: "installed", open: null, toolsOpen: false, auditOpen: false, form: null, confirmingDisconnect: null, search: "" });
    expect(c.view().login).not.toBeNull();
    expect(JSON.stringify(c.view())).not.toContain("TOPSECRET");
  });

  test("ignores a click that is none of its own", () => {
    const c = createConnections(host);
    expect(c.click({ closest: () => null } as unknown as Element)).toBe(false);
  });
});

test("unknown connections use a plug at both sizes without exposing the name as markup or initials", () => {
  for (const size of ["md", "xl"] as const) {
    for (const name of ["Files", "\u7b46\u8a18", "<img src=x onerror=alert(1)>", ""]) {
      expect(iconHTML(name, null, size)).toBe(`<span class="mono ${size}" aria-hidden="true">${ico("plug")}</span>`);
    }
  }
});
