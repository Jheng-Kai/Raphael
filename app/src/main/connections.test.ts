/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Window } from "happy-dom";
import { setLocale, t } from "./i18n";
import type { AppsInventory, AuditEntry, ConnectionGroup, InventoryApp, StoreService } from "./types";

const api = vi.hoisted(() => ({
  connectorsStatus: vi.fn(), connectorsCatalog: vi.fn(), connectorsCategories: vi.fn(), connectorsTools: vi.fn(),
  connectorsSetTools: vi.fn(), connectorsConnect: vi.fn(), connectorsGoogleConnect: vi.fn(), connectorsDisconnect: vi.fn(), connectorsRemoveAccount: vi.fn(), connectorsSetKey: vi.fn(),
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
  fitChips,
  iconHTML,
  moreRows,
  needsLogin,
  ownGoogleEntry,
  toolLabel,
} from "./connections";
import { STORE_GROUPS } from "./store-finder";
import { ico, toaster } from "./ui";
import { confirmDelete } from "./member-dialogs";

const browsers: Window[] = [];
afterEach(async () => {
  setLocale("zh-TW");
  for (const browser of browsers.splice(0)) await browser.happyDOM.abort();
});

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
// All four are of the category "docs" (檔案與文件); Notion is connected, and Linear is one of the well-known apps.
const CATALOG: StoreService[] = [
  service("notion", "Notion", { icon: "notion", popular: true, server_id: "ab12" }),
  service("linear", "Linear", { icon: "linear", popular: true }),
  service("sentry", "Sentry", { icon: "sentry" }),
  service("canva", "Canva", { popular: true }),
];
/** `count` more apps of the category "docs", named "Extra 000", "Extra 001" and so on. */
const many = (count: number, over: Partial<StoreService> = {}): StoreService[] =>
  Array.from({ length: count }, (_, n) => service(`extra-${n}`, `Extra ${String(n).padStart(3, "0")}`, over));

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
/** The page of a connected app (by the id of its connection), and the page of an app of the catalog (by the id of its entry). */
const groupPage = (id: string, over: Partial<ConnectionsView> = {}): string => connectionsHTML(view({ open: { kind: "group", id }, ...over }));
const appPage = (id: string, over: Partial<ConnectionsView> = {}): string => connectionsHTML(view({ open: { kind: "app", id }, ...over }));
const connectedList = (over: Partial<ConnectionsView> = {}): string => connectionsHTML(view({ screen: "connected", ...over }));

/** The markup as a document, to be asked by selector. */
function dom(html: string): Document {
  const browser = new Window();
  browsers.push(browser);
  browser.document.body.innerHTML = html;
  return browser.document as unknown as Document;
}
const texts = (root: ParentNode, selector: string): string[] => [...root.querySelectorAll(selector)].map((el) => (el.textContent ?? "").trim());
/** The names of the apps a view lists, in order. */
const namesIn = (html: string): string[] => texts(dom(html), ".cs-card .nm");
/** The sections of 全部: their titles, the apps in them, and whether they offer 查看全部. */
const sectionsOf = (html: string) => [...dom(html).querySelectorAll(".cs-sec")].map((sec) => ({
  title: sec.querySelector("h2")!.textContent, names: texts(sec, ".cs-card .nm"), all: sec.querySelector(".cs-viewall")?.getAttribute("data-conn") ?? null,
}));
const cardOf = (id: string, over: Partial<ConnectionsView> = {}): HTMLElement =>
  dom(connectionsHTML(view(over))).querySelector(`.cs-card [data-id="${id}"]`)!.closest(".cs-card") as HTMLElement;
/** The rows of an app page's information card, as label -> value. */
const infoOf = (html: string): Record<string, string> =>
  Object.fromEntries([...dom(html).querySelectorAll(".cs-info-row")].map((r) => [r.querySelector(".k")!.textContent, r.querySelector(".v")!.textContent]));

describe("the one view", () => {
  test("is one view with no tabs: the bar, the chips of the categories, then the sections", () => {
    const html = connectionsHTML(view());
    const d = dom(html);
    expect(d.querySelectorAll(".cs.cs-apps")).toHaveLength(1);
    // the tabs, the pager, the store's pending fill and the modal of an app are gone
    for (const gone of ['[role="tab"]', '[role="tablist"]', ".tabs", '[data-conn="tab"]', ".cs-store-pages", ".cs-store-groups", "[data-cs-pending]", ".cs-dialog", ".cs-scrim", ".cs-list", ".cs-item"]) {
      expect(d.querySelector(gone), gone).toBeNull();
    }
    const order = ["cs-top", 'id="conn-search"', 'data-k="conn-add"', "data-cs-chips", "data-cs-body"].map((x) => html.indexOf(x));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(d.querySelector(".cs-results > .cs-body[data-cs-body]")).not.toBeNull();
    expect(d.querySelector("#conn-search")!.getAttribute("aria-label")).toBe("搜尋應用程式");
    expect(d.querySelector<HTMLInputElement>("#conn-search")!.placeholder).toBe("搜尋應用程式");
    expect(connectionsHTML(view({ search: "linear" }))).toContain('value="linear"');
  });

  test("the menu that adds a server of the user's own is a dropdown at the end of the bar, beside the search", () => {
    expect(connectionsAddHTML()).toMatch(/^<button type="button" class="sel cs-add" aria-haspopup="menu" aria-expanded="false" data-k="conn-add"><span>新增<\/span>/);
    const d = dom(connectionsHTML(view()));
    expect(d.querySelectorAll('[data-k="conn-add"]')).toHaveLength(1);
    const bar = d.querySelector(".cs-bar")!;
    expect(bar.querySelector("#conn-search")).not.toBeNull();
    expect((bar.lastElementChild as HTMLElement).dataset.k).toBe("conn-add");
  });

  test("the dialog's heading from the Settings page stands at the top of the view, over a page and over the connected list", () => {
    const heading = '<h2 class="cs-title">連結應用程式</h2>';
    const top = dom(connectionsHTML(view(), heading)).querySelector(".cs-top")!;
    expect(top.firstElementChild!.className).toBe("cs-title");
    expect(top.querySelector('[data-conn="connected"]')).not.toBeNull();
    for (const html of [connectionsHTML(view({ screen: "connected" }), heading), connectionsHTML(view({ open: { kind: "group", id: "ab12" } }), heading)]) {
      expect(dom(html).querySelector(".cs-vh")!.innerHTML).toBe(heading);
    }
  });

  test("the loading and failed states of the catalog say so, and a failed one can be read again", () => {
    expect(connectionsHTML(view({ catalog: "loading" }))).toContain("讀取中");
    const failed = dom(connectionsHTML(view({ catalog: "failed" })));
    expect(failed.querySelector(".core-note")!.textContent).toContain("無法讀取連接");
    expect(failed.querySelector('[data-conn="retry-builtin-store"]')).not.toBeNull();
    // the connected apps being read or not to be had never keeps the apps from being listed
    for (const groups of ["loading", "failed"] as const) {
      const d = dom(connectionsHTML(view({ groups })));
      expect(d.querySelector('[data-conn="connected"]')).toBeNull();
      expect(d.querySelectorAll(".cs-card").length).toBeGreaterThan(0);
    }
  });

  test("the managed catalog: the way to its key, its loading, and a failed read that can be tried again", () => {
    const setup = dom(connectionsHTML(view({ configured: false })));
    expect(setup.querySelector(".cs-composio-setup")!.textContent).toContain(t("plugins.moreApps"));
    expect(setup.querySelector('.cs-composio-setup [data-conn="configure-composio"]')).not.toBeNull();
    expect(connectionsHTML(view({ configured: true, composioCatalog: "loading" }))).toContain("讀取中");
    const failed = dom(connectionsHTML(view({ configured: true, composioCatalog: "failed" })));
    expect(failed.querySelector('[data-conn="retry-store"]')).not.toBeNull();
    // nothing about Composio while it is not known whether it is set up
    expect(connectionsHTML(view({ configured: null }))).not.toContain("configure-composio");
  });

  test("the key dialog of Composio stands over the view and over a page, and is the only modal dialog", () => {
    for (const html of [connectionsHTML(view({ keyOpen: true })), connectionsHTML(view({ keyOpen: true, open: { kind: "group", id: "ab12" } }))]) {
      const d = dom(html);
      expect(d.querySelector('.cs-scrim[data-conn="scrim"][data-dialog="composio-key"]')).not.toBeNull();
      const dialog = d.querySelector(".cs-dialog")!;
      expect(dialog.getAttribute("role")).toBe("dialog");
      expect(dialog.getAttribute("aria-modal")).toBe("true");
      expect(dialog.querySelector<HTMLInputElement>("#conn-key")!.type).toBe("password");
      expect(dialog.querySelector('[data-conn="save-key"]')).not.toBeNull();
      expect(dialog.querySelector('[data-conn="close"]')!.getAttribute("aria-label")).toBe("關閉");
      expect(d.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    }
    expect(connectionsHTML(view({ keyOpen: true, keyError: "auth" }))).toContain('role="alert"');
    expect(connectionsHTML(view())).not.toContain("cs-scrim");
  });
});

describe("the chip of the connected apps", () => {
  const chip = (over: Partial<ConnectionsView> = {}): HTMLElement | null => dom(connectionsHTML(view(over))).querySelector<HTMLElement>('[data-conn="connected"]');

  test("shows the core's count and the marks of the apps, and is a button that opens the connected list", () => {
    const shown = chip()!;
    expect(shown.tagName).toBe("BUTTON");
    expect(shown.dataset.k).toBe("cs-have");
    expect(shown.querySelector(".cs-have-t")!.textContent).toBe("2 個已連結");
    expect(shown.querySelectorAll(".cs-mini")).toHaveLength(2);
    expect(shown.querySelector(".cs-minis")!.getAttribute("aria-hidden")).toBe("true");
    setLocale("en");
    expect(chip()!.querySelector(".cs-have-t")!.textContent).toBe("2 connected");
  });

  test("never shows more than four marks, and its number is the core's, not the rows: an app that waits, failed or duplicates another is a row and no count", () => {
    const groups = Array.from({ length: 6 }, (_, n) => ({ ...notes, id: `g${n}`, name: `App ${n}` }));
    const inventory = inventoryOf(groups.map((g, n) => app(g.id, g.name, n < 3 ? {} : { state: "needs_sign_in", connected: false, tools: 0 })));
    const shown = chip({ groups, inventory })!;
    expect(shown.querySelector(".cs-have-t")!.textContent).toBe("3 個已連結");
    // a mark for each connected app, and none for the three that wait
    expect(shown.querySelectorAll(".cs-mini")).toHaveLength(3);
    const every = chip({ groups, inventory: inventoryOf(groups.map((g) => app(g.id, g.name))) })!;
    expect(every.querySelectorAll(".cs-mini")).toHaveLength(4);
  });

  test("says only 已連結 while the count is not read, cannot be read, is not whole or is nothing, and is absent with no connected apps", () => {
    const partial: AppsInventory = { state: "partial", count: null, apps: INVENTORY.apps };
    for (const inventory of ["loading", "failed", partial, inventoryOf([])] as const) {
      expect(chip({ inventory })!.querySelector(".cs-have-t")!.textContent, JSON.stringify(inventory)).toBe("已連結");
    }
    expect(chip({ groups: [], inventory: inventoryOf([]) })).toBeNull();
    expect(chip({ groups: "loading" })).toBeNull();
    expect(chip({ groups: "failed" })).toBeNull();
  });

  test("no count of the catalogue appears anywhere: not on the chips, the sections, a list or the search", () => {
    const catalog = [...CATALOG, ...many(37)]; // with n8n and the owner's own Google: 43 apps, 41 of them in 檔案與文件
    for (const over of [{}, { category: "documents" }, { search: "Extra" }, { search: "zzz" }, { recommendedAll: true }] as Partial<ConnectionsView>[]) {
      const d = dom(connectionsHTML(view({ catalog, ...over })));
      expect(d.querySelector(".cs-apps .n, .cs-apps .num, .cs-apps .cs-count"), JSON.stringify(over)).toBeNull();
      const text = d.body.textContent ?? "";
      expect(text, JSON.stringify(over)).not.toMatch(/\b(41|42|43)\b/);
      expect(text, JSON.stringify(over)).not.toMatch(/\d+\s*[–-]\s*\d+\s*\/\s*\d+/);
    }
  });
});

describe("the sections of 全部", () => {
  test("start with 為你推薦, then a section for each category in order, the connected standing among the others", () => {
    expect(sectionsOf(connectionsHTML(view()))).toEqual([
      { title: "為你推薦", names: ["Linear"], all: null },
      { title: "生產力", names: ["Google（私人連接）", "n8n"], all: null },
      { title: "檔案與文件", names: ["Notion", "Canva", "Sentry"], all: null },
    ]);
    setLocale("en");
    expect(sectionsOf(connectionsHTML(view())).map((s) => s.title)).toEqual(["Recommended for you", "Productivity", "Files and documents"]);
  });

  test("a section shows six apps, and 查看全部 chooses its category; 為你推薦 has its own that lists every one", () => {
    const catalog = [...CATALOG, ...many(8)];
    const [, , documents] = sectionsOf(connectionsHTML(view({ catalog })));
    expect(documents!.title).toBe("檔案與文件");
    expect(documents!.names).toHaveLength(6);
    expect(documents!.all).toBe("store-group");
    const all = dom(connectionsHTML(view({ catalog }))).querySelector('.cs-viewall[data-conn="store-group"]')!;
    expect(all.getAttribute("data-id")).toBe("documents");
    expect(all.textContent).toBe("查看全部");
    expect(all.tagName).toBe("BUTTON");
    // nothing more than six in any section, however long the catalogue is
    for (const section of sectionsOf(connectionsHTML(view({ catalog: [...CATALOG, ...many(200)] })))) expect(section.names.length).toBeLessThanOrEqual(6);
  });

  test("the recommended never repeat in the category sections, and every one that is left stands in its own", () => {
    const popular = ["gmail", "slack", "github", "outlook", "telegram", "discord", "jira", "spotify"].map((id) => service(id, id.charAt(0).toUpperCase() + id.slice(1)));
    const catalog = [...CATALOG, ...popular]; // nine well-known apps that are not connected: Linear and these
    const [recommended, ...rest] = sectionsOf(connectionsHTML(view({ catalog })));
    expect(recommended!.title).toBe("為你推薦");
    expect(recommended!.names).toEqual(["Gmail", "Slack", "Github", "Outlook", "Telegram", "Discord"]); // the order of the well-known list
    expect(recommended!.all).toBe("recommended-all");
    const elsewhere = rest.flatMap((section) => section.names);
    for (const name of recommended!.names) expect(elsewhere).not.toContain(name);
    expect(elsewhere).toEqual(expect.arrayContaining(["Linear", "Jira", "Spotify"]));
    // 查看全部 of 為你推薦 lists them all, and then there is no button
    const [every, ...others] = sectionsOf(connectionsHTML(view({ catalog, recommendedAll: true })));
    expect(every!.names).toHaveLength(9);
    expect(every!.all).toBeNull();
    for (const name of every!.names) expect(others.flatMap((section) => section.names)).not.toContain(name);
  });

  test("an app that is connected is never recommended, however it was added; it stays in its category with a check", () => {
    const slack: ConnectionGroup = { ...notes, id: "s1", name: "Slack", catalog_id: null };
    const catalog = [...CATALOG, service("slack", "Slack"), service("gmail", "Gmail", { server_id: "g1" })];
    const sections = sectionsOf(connectionsHTML(view({ catalog, groups: [...GROUPS, slack] })));
    expect(sections[0]).toEqual({ title: "為你推薦", names: ["Linear"], all: null });
    const rest = sections.slice(1).flatMap((section) => section.names);
    expect(rest).toEqual(expect.arrayContaining(["Slack", "Gmail", "Notion"]));
    expect(cardOf("gmail", { catalog, groups: [...GROUPS, slack] }).querySelector(".cs-state")).not.toBeNull();
    // with nothing left to recommend there is no such section
    const none = sectionsOf(connectionsHTML(view({ catalog: [service("sentry", "Sentry")] })));
    expect(none.map((s) => s.title)).not.toContain("為你推薦");
  });

  test("a large provider catalog stays bounded, and late apps stay reachable by category, slug and alias", () => {
    const composioCatalog = Array.from({ length: 1800 }, (_, index) => service(`catalog-${String(index).padStart(4, "0")}`, `App ${String(index).padStart(4, "0")}`, { source: "composio", category: `category-${index}` }));
    composioCatalog.push(service("googledrive", "Google Drive", { source: "composio", category: "storage" }));
    const base = view({ configured: true, catalog: [], composioCatalog });
    const first = sectionsOf(bodyHTML(base));
    for (const section of first) expect(section.names.length).toBeLessThanOrEqual(6);
    expect(first.find((s) => s.title === "其他")!.all).toBe("store-group");
    expect(first[0]).toEqual({ title: "為你推薦", names: ["Google Drive"], all: null });
    expect(dom(bodyHTML({ ...base, category: "other" })).querySelectorAll(".cs-card")).toHaveLength(24);
    expect(bodyHTML({ ...base, category: "other", shown: 2000 })).toContain('data-id="catalog-1799"');
    const late = dom(bodyHTML({ ...base, search: "catalog-1799" }));
    expect(late.querySelectorAll(".cs-card")).toHaveLength(1);
    expect(late.querySelector('[data-id="catalog-1799"]')).not.toBeNull();
    expect(bodyHTML({ ...base, search: "雲端硬碟" })).toContain('data-id="googledrive"');
    expect(dom(bodyHTML({ ...base, category: "documents" })).querySelectorAll(".cs-card")).toHaveLength(1);
  });
});

describe("the chips of the categories", () => {
  const chipsOf = (over: Partial<ConnectionsView> = {}): HTMLElement[] => [...dom(connectionsHTML(view(over))).querySelectorAll<HTMLElement>('[data-cs-chips] [data-conn="store-group"]')];

  test("are 全部 and a chip for each category, real buttons; the first five stand in the row and the others are capped into 更多", () => {
    const chips = chipsOf();
    expect(chips.map((c) => c.dataset.id)).toEqual(["", ...STORE_GROUPS]);
    for (const c of chips) {
      expect(c.tagName).toBe("BUTTON");
      expect(c.classList.contains("cs-chip")).toBe(true);
    }
    expect(chips.filter((c) => !c.hidden).map((c) => c.dataset.id)).toEqual(["", ...STORE_GROUPS.slice(0, 5)]);
    expect(chips.filter((c) => c.hidden).map((c) => c.dataset.id)).toEqual(STORE_GROUPS.slice(5));
    expect(chips.filter((c) => c.hasAttribute("data-capped")).map((c) => c.dataset.id)).toEqual(STORE_GROUPS.slice(5));
    expect(chips[0]!.textContent).toBe("全部");
    expect(chips.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.id)).toEqual([""]);
    const more = dom(connectionsHTML(view())).querySelector('[data-cs-chips] [data-k="conn-more"]')!;
    expect(more.classList.contains("sel")).toBe(true);
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.textContent).toBe("更多");
    expect(dom(connectionsHTML(view())).querySelector("[data-cs-chips]")!.getAttribute("aria-label")).toBe("分類");
  });

  test("a chosen category always stands in the row, in the place of the last chip", () => {
    const chosen = chipsOf({ category: "finance" });
    expect(chosen.filter((c) => !c.hidden).map((c) => c.dataset.id)).toEqual(["", "communication", "productivity", "development", "documents", "finance"]);
    expect(chosen.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.id)).toEqual(["finance"]);
    const inside = chipsOf({ category: "development" });
    expect(inside.filter((c) => c.hidden).map((c) => c.dataset.id)).toEqual(STORE_GROUPS.slice(5));
  });

  test("none is chosen while there is a search: the search is over the whole catalog", () => {
    const chips = chipsOf({ category: "documents", search: "linear" });
    expect(chips.filter((c) => c.getAttribute("aria-pressed") === "true")).toHaveLength(0);
  });

  test("fitChips hides the chips that do not fit, keeps the chosen one, and leaves 更多 to show them", () => {
    const fit = (over: Partial<ConnectionsView>): { hidden: string[]; moreHidden: boolean } => {
      const row = dom(connectionsHTML(view(over))).querySelector<HTMLElement>("[data-cs-chips]")!;
      // each chip that stands is 100 px wide, the row 650 px
      Object.defineProperty(row, "clientWidth", { get: () => 650, configurable: true });
      Object.defineProperty(row, "scrollWidth", { get: () => [...row.children].filter((el) => !(el as HTMLElement).hidden).length * 100, configurable: true });
      fitChips(row);
      return {
        hidden: [...row.querySelectorAll<HTMLElement>('[data-conn="store-group"]')].filter((c) => c.hidden).map((c) => c.dataset.id!),
        moreHidden: Boolean(row.querySelector<HTMLElement>(".cs-more")!.hidden),
      };
    };
    expect(fit({})).toEqual({ hidden: ["marketing", "sales", "finance", "media", "other"], moreHidden: false });
    // a chosen chip is never the one that goes
    expect(fit({ category: "marketing" })).toEqual({ hidden: ["documents", "sales", "finance", "media", "other"], moreHidden: false });
  });
});

describe("a chosen category", () => {
  test("is one list of all its apps, the connected too, popular ones first and then by name, without sections", () => {
    const html = connectionsHTML(view({ category: "documents" }));
    const d = dom(html);
    expect(texts(d, ".cs-card .nm")).toEqual(["Notion", "Linear", "Canva", "Sentry"]);
    expect(d.querySelectorAll(".cs-body > .cs-grid")).toHaveLength(1);
    expect(d.querySelector(".cs-body > .cs-sec")).toBeNull();
    expect(d.querySelector(".cs-body h2")).toBeNull();
    expect(namesIn(connectionsHTML(view({ category: "productivity" })))).toEqual(["Google（私人連接）", "n8n"]);
    expect(dom(connectionsHTML(view({ category: "finance" }))).querySelector(".cs-none")!.textContent).toBe("沒有符合的項目");
  });

  test("draws two dozen rows at a time and says whether there are more", () => {
    const catalog = [...CATALOG, ...many(100)]; // 104 in 檔案與文件
    expect(namesIn(connectionsHTML(view({ catalog, category: "documents" })))).toHaveLength(24);
    expect(namesIn(connectionsHTML(view({ catalog, category: "documents", shown: 96 })))).toHaveLength(96);
    expect(namesIn(connectionsHTML(view({ catalog, category: "documents", shown: 200 })))).toHaveLength(104);
    expect(moreRows(view({ catalog, category: "documents" }))).toBe(true);
    expect(moreRows(view({ catalog, category: "documents", shown: 96 }))).toBe(true);
    expect(moreRows(view({ catalog, category: "documents", shown: 200 }))).toBe(false);
    // sections are short and never scroll into more
    expect(moreRows(view({ catalog }))).toBe(false);
    expect(moreRows(view({ catalog, search: "Extra" }))).toBe(true);
  });
});

describe("the search", () => {
  const found = (search: string, over: Partial<ConnectionsView> = {}): string[] => namesIn(connectionsHTML(view({ search, ...over })));

  test("searches the whole catalog by name, publisher and summary, and lists the matches once, in one list", () => {
    const html = connectionsHTML(view({ search: "linear" }));
    expect(namesIn(html)).toEqual(["Linear"]);
    const d = dom(html);
    expect(d.querySelector(".cs-body > .cs-sec")).toBeNull();
    expect(d.querySelectorAll(".cs-body > .cs-grid")).toHaveLength(1);
    expect(found("一句話")).toEqual(["Notion", "Linear", "Canva", "Sentry"]); // by their summaries, the well-known first
    expect(found("N8N")).toEqual(["n8n"]);
  });

  test("a connected app is in the results, with its check and no button to connect", () => {
    expect(found("notion")).toEqual(["Notion"]);
    const card = cardOf("notion", { search: "notion" });
    expect(card.querySelector(".cs-state")).not.toBeNull();
    expect(card.querySelector('[data-conn="join"]')).toBeNull();
  });

  test("ignores the chosen category, and a blank search is none", () => {
    expect(found("n8n", { category: "finance" })).toEqual(["n8n"]);
    expect(found("linear", { category: "productivity" })).toEqual(["Linear"]);
    const blank = connectionsHTML(view({ search: "   ", category: "" }));
    expect(sectionsOf(blank)).toEqual(sectionsOf(connectionsHTML(view())));
  });

  test("a typo or swapped letters still finds the app by its name, after what it finds as typed", () => {
    const catalog = [service("gmail", "Gmail", { icon: "gmail" }), service("gmailer", "Mailer Gmail Tools"), ...CATALOG];
    expect(found("gamil", { catalog })).toEqual(["Gmail", "Mailer Gmail Tools"]);
    expect(found("linaer", { catalog })).toEqual(["Linear"]);
    expect(found("sentry", { catalog })).toEqual(["Sentry"]); // as typed, nothing near is added
    expect(found("360", { catalog })).toEqual([]);
  });

  test("finds the apps of the managed catalog too, and says so when nothing matches", () => {
    const composioCatalog = [service("slack", "Slack", { source: "composio" })];
    expect(found("slack", { configured: true, composioCatalog })).toEqual(["Slack"]);
    const none = dom(connectionsHTML(view({ search: "zzz" })));
    expect(none.querySelector(".cs-none")!.textContent).toBe("沒有符合的項目");
    expect(none.querySelector(".cs-none")!.getAttribute("role")).toBe("status");
    expect(none.querySelectorAll(".cs-card")).toHaveLength(0);
  });
});

describe("a row of the apps", () => {
  test("is a container with the button that opens the app's page and, beside it, the one that connects; no button is in a button", () => {
    const html = connectionsHTML(view());
    const card = cardOf("linear");
    expect([...card.children].map((c) => c.tagName)).toEqual(["BUTTON", "BUTTON"]);
    const main = card.querySelector<HTMLElement>("button.cs-main")!;
    expect(main.dataset).toMatchObject({ conn: "open-store", id: "linear", k: "cs-store:linear" });
    expect(main.getAttribute("title")).toBe("Linear的一句話");
    expect(main.querySelector(".nm")!.textContent).toBe("Linear");
    expect(main.querySelector(".cs-tile")!.getAttribute("aria-hidden")).toBe("true");
    const connect = card.querySelector<HTMLButtonElement>("button.cs-connect")!;
    expect(connect.dataset).toMatchObject({ conn: "join", id: "linear" });
    expect(connect.textContent).toBe("連結");
    expect(connect.getAttribute("aria-label")).toBe("連結 Linear");
    expect(connect.disabled).toBe(false);
    expect(html).not.toMatch(/<button(?:(?!<\/button>).)*<button/s);
    setLocale("en");
    expect(cardOf("linear").querySelector(".cs-connect")!.textContent).toBe("Connect");
    expect(cardOf("linear").querySelector(".cs-connect")!.getAttribute("aria-label")).toBe("Connect Linear");
  });

  test("a connected app stays listed with a check and no connect button; its row still opens its page", () => {
    const card = cardOf("notion");
    expect(card.querySelector(".cs-state")!.textContent).toBe("已連結");
    expect(card.querySelector(".cs-state svg")).not.toBeNull();
    expect(card.querySelector('[data-conn="join"], .cs-connect, [data-conn="cancel-login"]')).toBeNull();
    expect(card.querySelectorAll("button")).toHaveLength(1);
    expect(card.querySelector("button.cs-main")!.getAttribute("data-conn")).toBe("open-store");
    setLocale("en");
    expect(cardOf("notion").querySelector(".cs-state")!.textContent).toBe("Connected");
  });

  test("has no word about what the app needs: that is said on its page", () => {
    const catalog = [...CATALOG, service("acme", "Acme", { needs: "key" }), service("devapp", "Devapp", { needs: "own_app" })];
    for (const id of ["acme", "devapp", "n8n", "google"]) {
      const card = cardOf(id, { catalog });
      expect(card.querySelector(".need, .sub"), id).toBeNull();
      expect(card.textContent, id).not.toMatch(/金鑰|API|開發者|需要/);
      const connect = card.querySelector<HTMLButtonElement>('[data-conn="join"]')!;
      expect(connect.disabled).toBe(false);
      expect(connect.hasAttribute("title")).toBe(false);
    }
  });

  test("n8n is set up in the conversation: its row asks nothing, and a connection that is n8n, however it was named, marks it connected", () => {
    const card = cardOf("n8n");
    expect(card.querySelector('[data-conn="join"]')).not.toBeNull();
    expect(card.innerHTML).toMatch(/<span class="mono md logo-mono" style="--brand:#EA4B71">/);
    const own: ConnectionGroup = { ...custom, id: "n1", name: "Workflows", transport: "http", url: "https://n8n.example.com/mcp-server/http" };
    const connected = cardOf("n8n", { groups: [...GROUPS, own] });
    expect(connected.querySelector(".cs-state")).not.toBeNull();
    expect(connected.querySelector('[data-conn="join"]')).toBeNull();
  });

  test("a service with no bundled mark uses a plug, and known marks keep their brand colour", () => {
    const html = connectionsHTML(view());
    expect(html).toContain(ico("plug"));
    expect(html).not.toContain(">C<");
    expect(html).toMatch(/class="mono md logo-mono" style="--brand:#5E6AD2"/); // Linear
    expect(cardOf("notion").innerHTML).toMatch(/class="mono md logo-mono">/); // Notion: the colour of the text
    expect(html).not.toMatch(/class="mono[^"]*tile|background/);
  });

  test("while a login is open the row says so with a button to cancel, and the other 連結 buttons stay pressable", () => {
    const login = { target: "linear", name: "Linear" };
    const card = cardOf("linear", { login });
    expect(card.querySelector(".sub.wait")!.textContent).toBe("請在瀏覽器登入…");
    expect(card.querySelector('[data-conn="cancel-login"]')).not.toBeNull();
    expect(card.querySelector('[data-conn="join"]')).toBeNull();
    expect(card.querySelector<HTMLButtonElement>('[data-conn="cancel-login"]')!.disabled).toBe(false);
    expect(cardOf("sentry", { login }).querySelector<HTMLButtonElement>('[data-conn="join"]')!.disabled).toBe(false);
    // a managed sign-in is cancelled like any other (the core gives back the account it made)
    const catalog = [...CATALOG, service("slack", "Slack", { source: "composio" })];
    expect(cardOf("slack", { catalog, login: { target: "slack", name: "Slack" } }).querySelector<HTMLButtonElement>('[data-conn="cancel-login"]')!.disabled).toBe(false);
    expect(cardOf("slack", { catalog, login }).querySelector<HTMLButtonElement>('[data-conn="join"]')!.disabled).toBe(false);
  });

  test("an app that needs no sign-in says it is connecting, not that it waits for the browser", () => {
    const open = service("context7", "Context7", { icon: "context7", auth: "none" });
    const card = cardOf("context7", { catalog: [...CATALOG, open], login: { target: "context7", name: "Context7" } });
    expect(card.querySelector(".sub.wait")!.textContent).toBe("連線中…");
  });
});

describe("the connected apps", () => {
  const rows = (html: string): Element[] => [...dom(html).querySelectorAll(".cs-linked")];

  test("are one list behind the chip, with a back chevron: a row for each service with its mark, name, line and switch", () => {
    const html = connectedList();
    const d = dom(html);
    expect(d.querySelectorAll(".cs.cs-connected")).toHaveLength(1);
    expect(d.querySelector(".cs-apps")).toBeNull();
    const back = d.querySelector(".cs-top > button")!;
    expect(back.getAttribute("data-conn")).toBe("back");
    expect(back.getAttribute("aria-label")).toBe("返回");
    expect(d.querySelector(".cs-top-t")!.textContent).toBe("已連結");
    expect(d.querySelectorAll(".cs-body > .cs-grid")).toHaveLength(1);
    const [notion, files] = rows(html);
    expect(rows(html)).toHaveLength(2);
    expect(notion!.getAttribute("data-conn")).toBe("open");
    expect(notion!.getAttribute("data-id")).toBe("ab12");
    const main = notion!.querySelector<HTMLElement>("button.cs-main")!;
    expect(main.dataset).toMatchObject({ conn: "open", id: "ab12", k: "cs-open:ab12" });
    expect(main.querySelector(".nm")!.textContent).toBe("Notion");
    expect(main.querySelector(".ds")!.textContent).toBe("Notion的一句話");
    expect(main.querySelector(".logo-mono")).not.toBeNull();
    expect(notion!.innerHTML).toMatch(/class="tg" role="switch" aria-checked="true" aria-label="開啟 Notion" data-conn="enable" data-id="ab12"/);
    expect(notion!.querySelectorAll("button")).toHaveLength(2);
    // A server of the user's own: where it is reached, and a neutral plug.
    expect(files!.textContent).toContain("npx");
    expect(files!.querySelector(".mono.md svg.i")).not.toBeNull();
    expect(files!.querySelector(".logo-mono")).toBeNull();
    expect(html).toContain(ico("plug"));
    expect(files!.querySelector(".cs-tile")!.textContent).toBe(""); // a plug, never a letter
    const remote = rows(connectedList({ groups: [{ ...custom, transport: "http", url: "https://example.com/mcp" }] }))[0]!;
    expect(remote.querySelector(".ds")!.textContent).toBe("https://example.com/mcp");
  });

  test("is offered only when something is connected: with nothing, the screen is the one view", () => {
    const empty = dom(connectedList({ groups: [], inventory: inventoryOf([]) }));
    expect(empty.querySelector(".cs-apps")).not.toBeNull();
    expect(empty.querySelector(".cs-connected")).toBeNull();
    for (const groups of ["loading", "failed"] as const) expect(dom(connectedList({ groups })).querySelector(".cs-connected")).toBeNull();
  });

  test("the app switch is on exactly when the app is enabled, independently of tool exclusions", () => {
    const switchOf = (groups: ConnectionGroup[]): string => dom(connectedList({ groups })).querySelector(".cs-linked [role=switch]")!.getAttribute("aria-checked")!;
    expect(switchOf([{ ...notes, enabled: false, status: "disabled" }])).toBe("false");
    expect(switchOf([notes])).toBe("true");
    const allOn: ConnectionGroup = { ...notes, tools: notes.tools.map((x) => ({ ...x, enabled: true })) };
    expect(switchOf([allOn])).toBe("true");
    // Tool exclusions never create a middle state, even before a managed tool list is read.
    const managed: ConnectionGroup = { ...allOn, source: "composio", tools: [], disabled_tools: ["NOTION_DELETE"] };
    expect(switchOf([managed])).toBe("true");
    expect(connectedList()).not.toContain('aria-checked="mixed"');
  });

  test("says what is wrong with a service in its line; the way to sign in again is on its page", () => {
    const login: ConnectionGroup = { ...notes, status: "error", error: "auth" };
    expect(needsLogin(login)).toBe(true);
    expect(needsLogin({ ...login, error: "timeout" })).toBe(false);
    expect(needsLogin({ ...login, auth: "none" })).toBe(false);
    const out = connectedList({ groups: [login] });
    expect(out).toContain("需要重新登入");
    expect(out).not.toContain('data-conn="relogin"');
    expect(connectedList({ groups: [{ ...notes, status: "error", error: "timeout" }] })).toContain("連線失敗：太久沒有回應");
    expect(connectedList({ groups: [{ ...notes, status: "unchecked" }] })).toContain("還沒有讀取工具");
  });

  test("keeps the list clean: the tools and the latest actions are on each service's page, not here", () => {
    const html = connectedList();
    expect(html).not.toContain("最近的動作");
    expect(html).not.toContain("create_page");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('data-conn="server-menu"');
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
    const all = view({ groups: [notes, custom, slack, twin, empty, off], inventory, screen: "connected" });

    test("the apps that can be called now come first; the others follow under their own heading, each with its switch and its page", () => {
      const d = dom(connectionsHTML(all));
      const sections = [...d.querySelectorAll(".cs-body > .cs-sec")];
      expect(sections.map((s) => s.querySelector("h2")!.textContent)).toEqual(["應用程式", "尚未連結", "已關閉"]);
      expect(texts(sections[0]!, ".nm")).toEqual(["Notion", "Files"]);
      const later = sections[1]!, offSection = sections[2]!;
      expect(texts(later, ".nm")).toEqual(["Slack", "Notion 2", "Empty"]);
      // why each one is not one of the connected: a sign-in is waited for, a second way to an app that is counted, every tool off
      expect(later.textContent).toContain("需要重新登入");
      expect(later.textContent).toContain("與另一個連線重複");
      expect(later.textContent).toContain("工具已全部關閉");
      // what is switched off stands last under 已關閉, with its switch and the words it always had
      expect(texts(offSection, ".nm")).toEqual(["Notes"]);
      expect(offSection.textContent).toContain("npx -y notes");
      expect(offSection.innerHTML).toMatch(/aria-checked="false" aria-label="開啟 Notes"/);
      expect(later.querySelectorAll('[data-conn="enable"]')).toHaveLength(3);
      expect(offSection.querySelectorAll('.cs-linked[data-conn="open"]')).toHaveLength(1);
      // with nothing switched off there is no 已關閉
      const noOff = dom(connectionsHTML(view({ groups: [notes, custom, slack], inventory, screen: "connected" })));
      expect([...noOff.querySelectorAll(".cs-body > .cs-sec h2")].map((h) => h.textContent)).toEqual(["應用程式", "尚未連結"]);
      // and the chip has a mark for each connected app only: none for the ones that wait, failed or are off
      const chip = dom(connectionsHTML(view({ groups: [notes, custom, slack, twin, empty, off], inventory })));
      expect(chip.querySelectorAll(".cs-have .cs-mini")).toHaveLength(2);
      expect(chip.querySelector(".cs-have-t")!.textContent).toBe("2 個已連結");
      // With every app connected the list is one list and needs no heading.
      expect(dom(connectedList()).querySelector(".cs-body h2")).toBeNull();
    });

    test("while the count is not read, or cannot be, the apps are one list as before", () => {
      for (const inv of ["loading", "failed"] as const) {
        const d = dom(connectedList({ groups: [notes, slack], inventory: inv }));
        expect(d.querySelectorAll(".cs-body > .cs-grid")).toHaveLength(1);
        expect(d.body.textContent).not.toContain("尚未連結");
      }
    });

    test("an inventory that is not whole says which app it could not read, and counts none of them", () => {
      const partial = { state: "partial" as const, count: null, apps: [app("ab12", "Notion", { state: "unknown", connected: false, tools: 0 })] };
      const html = connectedList({ groups: [notes], inventory: partial });
      expect(html).toContain("無法讀取");
      expect(connectionsHTML(view({ groups: [notes], inventory: partial })).includes("0 個")).toBe(false);
      expect(dom(connectionsHTML(view({ groups: [notes], inventory: partial }))).querySelector(".cs-have-t")!.textContent).toBe("已連結");
    });

    test("the dialog holds connectors only: no skills section, no import button, no skill rows", () => {
      // Skills belong to each member and are managed in that member's own panel.
      const states = [view(), all, view({ groups: [] }), view({ search: "zzz" }), view({ category: "documents" }), view({ open: { kind: "group", id: "ab12" } }), view({ open: { kind: "app", id: "linear" } }), view({ screen: "connected" })];
      for (const state of states) {
        const html = connectionsHTML(state);
        expect(html).not.toMatch(/data-skills-section|skill-discover|skill-open|skill-enable|retry-skills|cs-skill|data-library-skill|data-dialog="skill/);
        expect(html).not.toMatch(/<h2>技能<\/h2>|技能|匯入/);
      }
      expect(connectionsHTML(view())).toContain("data-cs-body");
    });
  });
});

// Owner, 2026-11-14: 「這個 dialog 應該要可以點那個已連接應該也要可以點，然後那個 button 可以設計得大一點點，不然點不到」.
describe("a connected row and the back chevron", () => {
  const css = readFileSync(join(__dirname, "connections.css"), "utf8").replace(/\r\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
  const rule = (selector: string): string => css.split("\n").filter((line) => line.startsWith(`${selector} {`)).pop() ?? "";

  test("a row is one real button of the mark, the name and the line, with the switch beside it, and opens the page the main view's row opens", () => {
    const [notion] = [...dom(connectedList()).querySelectorAll(".cs-linked")];
    const main = notion!.querySelector<HTMLElement>("button.cs-main")!;
    expect(main.querySelector(".cs-tile")).not.toBeNull();
    expect(main.querySelector(".nm")).not.toBeNull();
    expect(main.querySelector(".ds")).not.toBeNull();
    expect(main.querySelector('[role="switch"]')).toBeNull();
    expect(notion!.querySelector(':scope > [role="switch"]')!.getAttribute("data-conn")).toBe("enable");
    // The row itself opens too, so the gap between the button and the switch is no dead place.
    expect(notion!.getAttribute("data-conn")).toBe("open");
    expect(groupPage("ab12")).toBe(appPage("notion"));
  });

  test("a row says it can be pressed: the pointer over the whole row, and a hover fill of the floating surface clear of its words, in the connected list and the main view alike", () => {
    expect(rule(".cs-linked")).toMatch(/cursor:\s*pointer/);
    expect(rule(".cs-card .btn.cs-main:hover:not(:disabled), .cs-linked .btn.cs-main:hover:not(:disabled)")).toMatch(/background:\s*var\(--float-hover\)/);
    expect(rule(".cs-card .btn.cs-main:active:not(:disabled), .cs-linked .btn.cs-main:active:not(:disabled)")).toMatch(/background:\s*var\(--pressed\)/);
    // 8 px of padding all round the words (R-UI-53), cancelled on the left by the margin so the mark stays on the content's edge.
    expect(rule(".cs-card .btn.cs-main, .cs-linked .btn.cs-main")).toMatch(/padding-inline:\s*var\(--sp-2\);\s*margin-inline:\s*calc\(var\(--sp-2\) \* -1\) 0/);
  });

  test("the back chevron is the dialog ✕'s own control: 36 px, round, bare, with an 18 px glyph", () => {
    const body = rule(".cs .btn.icon.cs-back");
    for (const property of ["width", "min-width", "height", "min-height"]) expect(body, property).toMatch(new RegExp(`[{;\\s]${property}:\\s*36px`));
    expect(body).toMatch(/border-radius:\s*var\(--r-pill\)/);
    expect(body).not.toMatch(/background|box-shadow|border:/);
    expect(rule(".cs .btn.icon.cs-back .i")).toMatch(/width:\s*18px;\s*height:\s*18px/);
    // The list's title row and an app's page carry the same button, and the one view carries none.
    for (const html of [connectedList(), groupPage("ab12"), appPage("linear")]) expect(dom(html).querySelectorAll(".cs-back")).toHaveLength(1);
    expect(dom(connectionsHTML(view())).querySelector(".cs-back")).toBeNull();
  });
});

describe("the page of a connected app", () => {
  const page = (html: string) => dom(html).querySelector(".cs.cs-page")!;

  test("takes the place of the view, with a back chevron, and is no modal dialog", () => {
    const html = groupPage("ab12");
    const d = dom(html);
    expect(d.querySelectorAll(".cs.cs-page")).toHaveLength(1);
    expect(d.querySelector(".cs-apps, .cs-connected, [data-cs-body], .cs-chips")).toBeNull();
    for (const gone of [".cs-dialog", ".cs-scrim", '[role="dialog"]', '[data-conn="close"]']) expect(d.querySelector(gone), gone).toBeNull();
    const back = d.querySelector<HTMLElement>('[data-conn="back"]')!;
    expect(back.dataset.k).toBe("cs-back");
    expect(back.getAttribute("aria-label")).toBe("返回");
    expect(back.getAttribute("title")).toBe("返回");
    // a page whose app is gone is the view alone
    const gone = dom(groupPage("nope"));
    expect(gone.querySelector(".cs-apps")).not.toBeNull();
    expect(gone.querySelector(".cs-page")).toBeNull();
    expect(dom(appPage("nope")).querySelector(".cs-page")).toBeNull();
  });

  test("the head has the mark on a white tile, the name, its state, its switch and its menu, and no button to connect", () => {
    const head = page(groupPage("ab12")).querySelector(".cs-head")!;
    expect(head.querySelector(".cs-tile.lg .logo-mono.xl")).not.toBeNull();
    const title = head.querySelector("h2.big")!;
    expect(title.textContent).toBe("Notion");
    expect(title.id).toBe("cs-page-title");
    const join = head.querySelector(".cs-join")!;
    expect(join.querySelector(".cs-state")!.textContent).toBe("已連結");
    const toggle = join.querySelector<HTMLElement>('[role="switch"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("開啟 Notion");
    expect(toggle.dataset).toMatchObject({ conn: "enable", id: "ab12", k: "cs-dlg-enable" });
    const menu = join.querySelector<HTMLElement>('[data-conn="server-menu"]')!;
    expect(menu.dataset.id).toBe("ab12");
    expect(menu.getAttribute("aria-haspopup")).toBe("menu");
    expect(menu.getAttribute("aria-label")).toBeTruthy();
    expect(menu.getAttribute("title")).toBe(menu.getAttribute("aria-label"));
    expect(join.querySelector('[data-conn="join"], .cs-connect')).toBeNull();
    expect(page(groupPage("ab12")).querySelector(".cs-desc")!.textContent).toBe("Notion的說明");
    // busy: the switch and the menu wait
    const busy = page(groupPage("ab12", { busy: new Set(["ab12"]) })).querySelector(".cs-join")!;
    expect(busy.querySelector<HTMLButtonElement>('[role="switch"]')!.disabled).toBe(true);
    expect(busy.querySelector<HTMLButtonElement>('[data-conn="server-menu"]')!.disabled).toBe(true);
  });

  test("the page of the entry of a connected app is the page of its connection", () => {
    const d = dom(appPage("notion"));
    expect(d.querySelector(".cs-join .cs-state")).not.toBeNull();
    expect(d.querySelector('.cs-join [data-k="cs-dlg-enable"]')).not.toBeNull();
    expect(d.querySelector('.cs-join [data-conn="server-menu"]')).not.toBeNull();
    expect(d.querySelector('[data-conn="join"]')).toBeNull();
    expect(d.querySelector('[data-conn="tool-list"]')).not.toBeNull();
  });

  test("has a Tools section and an Information card, and the tool count is on, of all", () => {
    const d = dom(groupPage("ab12"));
    expect(texts(d, ".cs-sec > h3")).toEqual(["工具", "資訊"]);
    expect(d.querySelector('[data-conn="tool-list"]')!.textContent).toContain("已開啟 2/3 個工具（2 個會改動、1 個只讀取）");
    expect(infoOf(groupPage("ab12"))).toEqual({
      [t("conn.info.provider")]: t("conn.info.builtIn"),
      [t("conn.info.category")]: "檔案與文件",
      [t("conn.info.signIn")]: "OAuth",
      [t("conn.server")]: "https://mcp.notion.example/mcp",
      [t("conn.toolsHeading")]: "3",
    });
    setLocale("en");
    expect(Object.keys(infoOf(groupPage("ab12")))).toEqual(["Provider", "Category", "Sign-in", "Server", "Tools"]);
    expect(texts(dom(groupPage("ab12")), ".cs-sec > h3")).toEqual(["Tools", "Information"]);
  });

  test("kind permissions are always reachable above the folded tools, with binary switches and counts", () => {
    const d = dom(groupPage("ab12"));
    const kinds = [...d.querySelectorAll(".cs-kind")];
    expect(kinds.map((k) => k.querySelector(".t")!.textContent)).toEqual(["會改動1/2", "只讀取1/1"]);
    expect(kinds.map((k) => k.querySelector(".num")!.textContent)).toEqual(["1/2", "1/1"]);
    expect(kinds.map((k) => k.querySelector("[role=switch]")!.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    expect(kinds.map((k) => (k.querySelector("[role=switch]") as HTMLElement).dataset.kind)).toEqual(["write", "read"]);
    expect(groupPage("ab12").indexOf('data-conn="kind"')).toBeLessThan(groupPage("ab12").indexOf('data-conn="tool-list"'));
    const onlyRead = dom(groupPage("cu1"));
    expect(onlyRead.querySelector<HTMLButtonElement>('[data-kind="write"]')!.disabled).toBe(true);
    expect(onlyRead.querySelector<HTMLButtonElement>('[data-kind="write"]')!.getAttribute("aria-checked")).toBe("false");
    // a server of the user's own has no entry in the catalogue; its switches are live all the same
    expect(onlyRead.querySelector<HTMLButtonElement>('[data-kind="read"]')!.disabled).toBe(false);
    for (const state of [view(), view({ open: { kind: "group", id: "ab12" } }), view({ screen: "connected" })]) {
      expect(connectionsHTML(state)).not.toContain('aria-checked="mixed"');
    }
  });

  test("its tools are one folded line, which unfolds into them under write and read headings, a switch each", () => {
    const folded = dom(groupPage("ab12"));
    expect(folded.querySelector('[data-conn="tool-list"]')!.getAttribute("aria-expanded")).toBe("false");
    expect(folded.querySelector('[data-conn="tool-list"]')!.getAttribute("data-k")).toBe("cs-count");
    expect(folded.querySelector('[data-conn="tool"]')).toBeNull();
    expect(folded.querySelector(".cs-plugin-tools")).toBeNull();
    const html = groupPage("ab12", { toolsOpen: true });
    const open = dom(html);
    expect(open.querySelector('[data-conn="tool-list"]')!.getAttribute("aria-expanded")).toBe("true");
    expect(open.querySelectorAll('[data-conn="tool"]')).toHaveLength(3);
    expect(texts(open, ".cs-plugin-tools h3")).toEqual(["會改動", "只讀取"]);
    expect(texts(open, ".tool-name")).toEqual(["Create page", "Delete page", "Search"]);
    expect(open.querySelector('.tool-name[title="search"]')).not.toBeNull(); // the raw name stays in the tooltip
    expect(html).toMatch(/aria-checked="false" aria-label="開啟工具 Delete page" data-conn="tool" data-id="ab12" data-tool="delete_page"/);
    expect(dom(groupPage("cu1", { toolsOpen: true })).querySelectorAll('[data-conn="tool"]')).toHaveLength(1);
    // no button holds another control
    expect(html).not.toMatch(/<button(?:(?!<\/button>).)*<button/s);
  });

  test("tools being read, or not to be read, say so and offer to read them again", () => {
    const loading = dom(groupPage("ab12", { groups: [{ ...notes, source: "composio", tools: [], tools_state: "loading" }, custom] }));
    expect(loading.querySelector('[role="status"]')!.textContent).toBe("讀取中…");
    expect(loading.querySelector('[data-conn="kind"]')).toBeNull();
    // tools that are known stay while they are read again, so a switch just pressed does not shrink the page from under the pointer
    const again = dom(groupPage("ab12", { groups: [{ ...notes, source: "composio", tools_state: "loading" }, custom] }));
    expect(again.querySelector('[role="status"]')).toBeNull();
    expect(again.querySelectorAll('[data-conn="kind"]').length).toBeGreaterThan(0);
    const failed = dom(groupPage("ab12", { groups: [{ ...notes, source: "composio", tools_state: "failed" }, custom] }));
    expect(failed.querySelector('.note[role="alert"] [data-conn="refresh"]')).not.toBeNull();
    expect(failed.querySelector('[data-conn="kind"]')).toBeNull();
    // and the information card does not count tools it does not have
    expect(Object.keys(infoOf(groupPage("ab12", { groups: [{ ...notes, source: "composio", tools: [], tools_state: "loading" }, custom] })))).not.toContain(t("conn.toolsHeading"));
  });

  test("the store service's primary try button is localized in a Chinese window", () => {
    expect(groupPage("ab12")).toMatch(/<button type="button" class="btn pri" data-conn="try" data-id="ab12" data-k="cs-try">試用<\/button>/);
    expect(examplePrompt(CATALOG[0])).toBe("跟Notion說一");
    setLocale("en");
    expect(groupPage("ab12")).toContain('data-k="cs-try">Try it</button>');
    expect(examplePrompt(CATALOG[0])).toBe("Tell Notion one");
    expect(examplePrompt(undefined)).toBeNull();
    expect(examplePrompt({ ...CATALOG[0]!, examples: { "zh-TW": [], en: [], ja: [] } })).toBeNull();
    // a server of the user's own has nothing to try
    expect(groupPage("cu1")).not.toContain('data-conn="try"');
  });

  test("keeps disconnect in the overflow menu and the secondary controls before Try it", () => {
    const html = groupPage("ab12");
    const acts = html.slice(html.indexOf('class="action-row cs-acts'));
    expect(html).toContain('data-conn="server-menu"');
    expect(html).not.toContain('data-conn="disconnect"');
    expect(acts.indexOf('data-conn="refresh"')).toBeLessThan(acts.indexOf('data-conn="try"'));
    expect(acts).toMatch(/class="btn sm" data-conn="relogin" data-id="ab12"[^>]*>重新登入</);
    expect(acts).toMatch(/class="btn sm" data-conn="refresh" data-id="ab12"[^>]*>重新讀取工具</);
    // a service with no login has none to do again
    expect(groupPage("cu1")).not.toContain('data-conn="relogin"');
  });

  test("a login that ran out is said at the top with its button; while it is open, every sign-in waits", () => {
    const groups = [{ ...notes, status: "error" as const, error: "auth" }, custom];
    const out = groupPage("ab12", { groups });
    expect(out).toContain("需要重新登入");
    expect(out).toMatch(/<div class="ca-alert">.*data-conn="relogin" data-id="ab12" data-k="cs-relogin-top"/);
    expect(out.match(/data-conn="relogin"/g)).toHaveLength(1);
    const waiting = groupPage("ab12", { groups, login: { target: "ab12", name: "Notion" } });
    expect(waiting).toMatch(/data-conn="relogin"[^>]*disabled[^>]*>請在瀏覽器登入…/);
  });

  test("a failure of the connection is said at the top, without a button for it", () => {
    const failed = dom(groupPage("ab12", { groups: [{ ...notes, status: "error", error: "timeout" }, custom] }));
    expect(failed.querySelector(".ca-alert .msg")!.textContent).toBe("連線失敗：太久沒有回應");
    expect(failed.querySelector(".ca-alert button")).toBeNull();
  });

  test("has that service's own latest actions, folded under a row that counts them, and the note that no content is kept", () => {
    const audit = [...AUDIT, { ...AUDIT[0]!, id: 2, server: "Files", tool: "list" }];
    const folded = groupPage("ab12", { audit });
    expect(folded).toMatch(/<button type="button" class="btn gr" data-conn="audit" aria-expanded="false" data-k="cs-audit"><span class="gt">最近的動作<em class="num">1<\/em>/);
    expect(folded).not.toContain("自動執行");
    const open = groupPage("ab12", { audit, auditOpen: true });
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain("Create page");
    expect(open).not.toContain(">List<");
    expect(open).toContain("自動執行");
    expect(open).toContain("只記錄時間、工具和結果，不記錄內容。");
    expect(groupPage("cu1")).not.toContain("最近的動作"); // none of its own
    expect(groupPage("ab12", { audit: [] })).not.toContain("最近的動作");
    expect(open).not.toMatch(/T[0-3]\b/);
  });

  test("has no levels, no review step and no word about pending tools", () => {
    for (const html of [groupPage("ab12", { toolsOpen: true }), groupPage("ab12"), connectionsHTML(view()), appPage("linear"), connectedList()]) {
      expect(html).not.toMatch(/T[0-3]\b|決定權限|先問我|按住確認|待決定|conn-tier|conn-draft|conn-all|review/);
    }
  });

  test("a server that changed its tools shows them all the same, new ones on", () => {
    const grown: ConnectionGroup = { ...notes, tools: [...notes.tools, { name: "fresh", description: "New.", enabled: true, kind: "read" }], tool_count: 4, read_count: 2, enabled_count: 3 };
    expect(groupPage("ab12", { groups: [grown] })).toContain("已開啟 3/4 個工具（2 個會改動、2 個只讀取）"); // Delete page is still off
    const html = groupPage("ab12", { groups: [grown], toolsOpen: true });
    expect(html).toMatch(/aria-checked="true" aria-label="開啟工具 Fresh"/);
    expect(html).not.toMatch(/>新<|待決定/);
  });

  test("a server of the user's own has no store words: the command and the names of its secrets, and an information card of what is known", () => {
    const d = dom(groupPage("cu1"));
    expect(d.querySelector(".cs-desc")!.textContent).toBe("自訂伺服器");
    expect(d.body.textContent).not.toContain("由 ");
    const meta = d.querySelector(".cs-meta")!;
    expect(meta.textContent).toContain("npx");
    expect(meta.textContent).toContain("API_KEY");
    expect(d.querySelector('[data-conn="tool-list"]')!.textContent).toContain("已開啟 1/1 個工具（0 個會改動、1 個只讀取）");
    // no provider, no category: it is no app of the catalogue
    expect(infoOf(groupPage("cu1"))).toEqual({ [t("conn.info.signIn")]: t("conn.info.none"), [t("conn.toolsHeading")]: "1" });
    const remote = { ...custom, transport: "http" as const, url: "https://example.com/mcp", command: "" };
    expect(infoOf(groupPage("cu1", { groups: [notes, remote] }))[t("conn.server")]).toBe("https://example.com/mcp");
  });

  test("tools not read yet say how to read them", () => {
    expect(groupPage("cu1", { groups: [{ ...custom, tools: [], tool_count: 0, status: "unchecked" }] })).toContain("按「重新讀取工具」");
  });

  test("says its account: a row for each account of a managed one, the owner's own Google, a signed-in server", () => {
    const managed: ConnectionGroup = { ...notes, source: "composio", accounts: [{ status: "ACTIVE" }, { status: "EXPIRED" }] };
    const d = dom(groupPage("ab12", { groups: [managed, custom] }));
    expect(texts(d, ".cs-acct .nm")).toEqual(["帳號 1", "帳號 2"]);
    expect(texts(d, ".cs-acct .st")).toEqual(["已連結", "已過期"]);
    expect(d.querySelectorAll(".cs-acct .dot.ok")).toHaveLength(1);
    expect(d.querySelectorAll(".cs-acct .dot.err")).toHaveLength(1);
    expect(d.querySelector('.cs-accts [data-conn="add-account"]')).not.toBeNull();
    const google: ConnectionGroup = { ...notes, id: "google", source: "google", accounts: [{ status: "ACTIVE" }] };
    expect(groupPage("google", { groups: [google] })).toContain("你的 Google 帳號");
    // never an account's name or address: the core does not give one, and the page invents none
    expect(d.body.textContent).not.toMatch(/@|\bca_/);
    // a server that is signed in to has one row; one that needs no login has none
    expect(texts(dom(groupPage("ab12", { groups: [notes] })), ".cs-acct")).toHaveLength(1);
    expect(dom(groupPage("ab12", { groups: [notes] })).querySelector(".cs-acct")!.textContent).toContain("已登入");
    expect(groupPage("cu1")).not.toContain('class="cs-acct"');
    // after it signs in again the old account may still be there: both are told, and the app is still one
    expect(groupPage("ab12", { groups: [{ ...managed, status: "error", error: "auth" }] })).toContain("需要重新登入");
  });

  test("a login error is told on the page of the app it belongs to", () => {
    const html = groupPage("ab12", { loginError: { target: "ab12", kind: "denied" } });
    expect(html).toContain("你在瀏覽器上拒絕了，所以沒有加入。");
    expect(groupPage("cu1", { loginError: { target: "ab12", kind: "denied" } })).not.toContain("拒絕");
    expect(groupPage("ab12", { dialogNotice: { text: "已重新登入 Notion", kind: "ok" } })).toContain("已重新登入 Notion");
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

describe("the page of an app that is not connected", () => {
  test("has a big mark, the name, the button that connects, things to say, what it is and its information", () => {
    const html = appPage("linear");
    const d = dom(html);
    expect(d.querySelector('[data-conn="back"]')).not.toBeNull();
    expect(d.querySelector(".cs-tile.lg .logo-mono.xl")).not.toBeNull();
    expect(d.querySelector("h2.big")!.textContent).toBe("Linear");
    const connect = d.querySelector<HTMLButtonElement>(".cs-join button.pri.cs-connect")!;
    expect(connect.dataset).toMatchObject({ conn: "join", id: "linear" });
    expect(connect.textContent).toBe("連結");
    expect(connect.disabled).toBe(false);
    expect(d.querySelector(".cs-desc")!.textContent).toBe("Linear的說明");
    expect(d.querySelector(".cs-say")!.previousElementSibling!.textContent).toBe("對拉斐爾說說看");
    expect(texts(d, ".cs-say li")).toEqual(["跟Linear說一", "跟Linear說二"]);
    // nothing of a connected app: no state, switch, menu, tools or actions
    for (const gone of [".cs-state", '[role="switch"]', '[data-conn="server-menu"]', '[data-conn="tool-list"]', ".cs-acts", ".cs-accts", ".cs-needs"]) expect(d.querySelector(gone), gone).toBeNull();
    expect(infoOf(html)).toEqual({
      [t("conn.info.provider")]: t("conn.info.builtIn"),
      [t("conn.info.category")]: "檔案與文件",
      [t("conn.info.signIn")]: "OAuth",
      [t("conn.server")]: "https://mcp.linear.example/mcp",
    });
  });

  test("says what signing in asks once, in a line, and how it signs in", () => {
    const catalog = [...CATALOG, service("acme", "Acme", { needs: "key" }), service("devapp", "Devapp", { needs: "own_app" }), service("slack", "Slack", { source: "composio", url: "" }), service("open", "Open", { auth: "none" })];
    const acme = dom(appPage("acme", { catalog }));
    expect(acme.querySelector(".cs-needs")!.textContent).toBe("Acme 要用你自己的 API 金鑰登入。");
    expect(infoOf(appPage("acme", { catalog }))[t("conn.info.signIn")]).toBe("API 金鑰");
    expect(dom(appPage("devapp", { catalog })).querySelector(".cs-needs")).toBeNull();
    expect(infoOf(appPage("devapp", { catalog }))[t("conn.info.signIn")]).toBe(t("conn.info.ownApp"));
    expect(infoOf(appPage("slack", { catalog }))[t("conn.info.provider")]).toBe("Composio");
    expect(Object.keys(infoOf(appPage("slack", { catalog }))).includes(t("conn.server"))).toBe(false);
    expect(infoOf(appPage("open", { catalog }))[t("conn.info.signIn")]).toBe(t("conn.info.none"));
    setLocale("en");
    expect(dom(appPage("acme", { catalog })).querySelector(".cs-needs")!.textContent).toBe("Acme signs in with your own API key.");
  });

  test("n8n and the owner's own Google are set up in the conversation: their pages ask nothing", () => {
    const n8n = dom(appPage("n8n"));
    expect(n8n.querySelector(".cs-needs")).toBeNull();
    expect(n8n.querySelector('[data-conn="join"]')).not.toBeNull();
    expect(infoOf(appPage("n8n"))).toMatchObject({ [t("conn.info.provider")]: "n8n", [t("conn.info.signIn")]: "API 金鑰", [t("conn.info.category")]: "生產力" });
    expect(infoOf(appPage("google"))).toMatchObject({ [t("conn.info.provider")]: "Google", [t("conn.info.signIn")]: "OAuth" });
    expect(dom(appPage("google")).querySelector(".cs-desc")!.textContent).toContain("不經過 Composio");
  });

  test("a public service has no login to wait for: it says it is connecting", () => {
    const open = service("context7", "Context7", { icon: "context7", auth: "none" });
    const login = { target: "context7", name: "Context7" };
    const page = dom(appPage("context7", { catalog: [...CATALOG, open], login }));
    expect(page.querySelector(".cs-wait")!.textContent).toBe("連線中…");
    expect(page.body.textContent).not.toContain("請在瀏覽器登入");
  });

  test("waiting for the browser it says so and has 取消; a failed login says why and the button is back", () => {
    const waiting = dom(appPage("linear", { login: { target: "linear", name: "Linear" } }));
    expect(waiting.querySelector(".cs-wait")!.textContent).toBe("請在瀏覽器登入…");
    expect(waiting.querySelector('[data-conn="cancel-login"]')!.textContent).toBe("取消");
    expect(waiting.querySelector('[data-conn="join"]')).toBeNull();
    const denied = appPage("linear", { loginError: { target: "linear", kind: "denied" } });
    expect(denied).toContain("你在瀏覽器上拒絕了，所以沒有加入。");
    expect(denied).toContain('data-conn="join"');
    expect(appPage("linear", { loginError: { target: "linear", kind: "timeout" } })).toContain("太久沒有登入");
    expect(appPage("linear", { loginError: { target: "linear", kind: "network" } })).toContain(t("conn.err.network"));
    expect(appPage("sentry", { loginError: { target: "linear", kind: "denied" } })).not.toContain("拒絕");
    // another sign-in under way: this page's button stays pressable (pressing it ends the other one)
    expect(dom(appPage("linear", { login: { target: "sentry", name: "Sentry" } })).querySelector<HTMLButtonElement>('[data-conn="join"]')!.disabled).toBe(false);
  });

  test("a code to type, while a device login waits for it, stands over the view and over the page", () => {
    const device = { catalog_id: "linear", user_code: "AB-12", verification_uri: "https://example.com/device" };
    const login = { target: "linear", name: "Linear" };
    const inView = dom(connectionsHTML(view({ login, device })));
    expect(inView.querySelector(".cs-apps > .cs-device")).not.toBeNull();
    expect(texts(inView, ".cs-code .cs-cap").join("")).toBe("AB12");
    expect(inView.querySelector('[data-conn="device-open"]')).not.toBeNull();
    expect(inView.querySelector('.cs-device [data-conn="cancel-login"]')).not.toBeNull();
  });
});

describe("the form that connects a server of the user's own", () => {
  test("takes the place of the view with a transport dropdown, multiline fields and test and save actions", () => {
    const html = connectionsHTML(view({ form: form() }));
    expect(html).toContain("新增 MCP 伺服器");
    expect(html).toContain('data-k="conn-type"');
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain("data-cs-body");
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

describe("the rules for this dialog", () => {
  // Slack waits for its sign-in (two accounts, one expired)
  const slack: ConnectionGroup = { ...notes, id: "w1", name: "Slack", source: "composio", status: "error", error: "auth", accounts: [{ status: "EXPIRED" }, { status: "ACTIVE" }] };
  const more = {
    groups: [...GROUPS, slack],
    inventory: inventoryOf([app("ab12", "Notion"), app("cu1", "Files", { tools: 1 }), app("w1", "Slack", { state: "needs_sign_in", connected: false, tools: 0 })]),
  };
  const pages = (): string[] => [
    connectionsHTML(view()),
    connectionsHTML(view(more)),
    connectedList(more),
    groupPage("w1", more),
    connectionsHTML(view({ category: "documents" })),
    connectionsHTML(view({ catalog: [...CATALOG, ...many(8)] })),
    connectionsHTML(view({ search: "lin" })),
    connectionsHTML(view({ login: { target: "linear", name: "Linear" } })),
    connectionsHTML(view({ configured: false })),
    groupPage("ab12", { confirmingDisconnect: "ab12", auditOpen: true }),
    groupPage("ab12", { toolsOpen: true }),
    groupPage("ab12", { groups: [{ ...notes, status: "error", error: "auth" }] }),
    appPage("linear", { loginError: { target: "linear", kind: "denied" } }),
    connectionsHTML(view({ form: form({ pairLines: "TOKEN=" }) })),
    appPage("notion"),
  ];

  test("everything that does something is a button or a switch with a shape, and every choice is a dropdown", () => {
    const all = pages().join("") + connectionsHTML(view({ keyOpen: true }));
    // A row of the connected list and the dimmed part around the key's dialog take a click too, each beside a real
    // button that does the same (the row's name, the dialog's ×).
    const acts = [...all.matchAll(/<(\w+)[^>]*data-conn="([\w-]+)"/g)].filter((m) => !(m[1] === "div" && ["open", "scrim"].includes(m[2]!))).map((m) => m[1]);
    expect(acts.length).toBeGreaterThan(30);
    expect(new Set(acts)).toEqual(new Set(["button"]));
    for (const tag of all.match(/<button[^>]*>/g)!) expect(tag).toMatch(/class="(btn[ "]|sel[ "]|tg|cs-have)/);
    expect(all).not.toMatch(/<a[ >]/);
    expect(all).not.toContain("<select");
    expect(all).not.toContain('type="radio"');
    expect(all).not.toContain("onclick");
  });

  test("the chips are real buttons that say whether they are chosen, not clickable text", () => {
    const chips = dom(connectionsHTML(view())).querySelectorAll('[data-cs-chips] button[data-conn="store-group"]');
    expect(chips).toHaveLength(1 + STORE_GROUPS.length);
    for (const chip of chips) expect(chip.getAttribute("aria-pressed")).toMatch(/^(true|false)$/);
  });

  test("the icon-only buttons (back, the menu of an app) are named in their label and tooltip", () => {
    for (const html of [groupPage("ab12"), groupPage("ab12", { toolsOpen: true }), appPage("linear"), connectedList()]) {
      const tags = html.match(/<button[^>]*class="btn icon[ "][^>]*>/g)!;
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) expect(tag).toMatch(/aria-label="[^"]+" title="[^"]+"/);
    }
  });

  test.each(["en", "ja"] as const)("is in one language at a time (%s)", (locale) => {
    setLocale(locale);
    const all = pages().join("");
    for (const zh of ["已安裝", "已連結", "商店", "加入", "中斷連線", "熱門", "只讀取", "會改動", "請在瀏覽器登入", "重新登入", "重新讀取工具", "最近的動作", "沒有符合", "技能", "尚未連結", "帳號", "為你推薦", "搜尋應用程式", "查看全部", "返回", "更多", "資訊"]) expect(all).not.toContain(zh);
    if (locale === "en") {
      // what the service itself says (here the fake store's own words) is the catalog's, in English
      expect(all).toContain(">Connected<");
      expect(all).toContain("2 connected");
      expect(all).toContain("Recommended for you");
      expect(all).toContain("Search apps");
      expect(all).toContain(">Connect<");
      expect(all).toContain("See all");
      expect(all).toContain("Sign in in your browser…");
      expect(all).toContain("2/3 tools on (2 write, 1 read)");
      expect(all).toContain("Tell Linear one");
      expect(all).toContain(">Try it<");
      expect(all).toContain(">Information<");
      expect(all).toContain(">Tools<");
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
      expect(all).not.toMatch(/Installed|Popular|Sign in|Contains|Recent actions|Disconnect|Private skills|Not connected|Account|Recommended|Search apps|Information/);
      expect(all).not.toContain("跟");
    }
  });
});

describe("what the dialog does", () => {
  const host = { visible: () => true, redraw: vi.fn(), tryPrompt: vi.fn() };
  const button = (conn: string, extra: Record<string, string> = {}): Element =>
    ({ closest: () => ({ dataset: { conn, ...extra } }) }) as unknown as Element;
  const key = (k: string): KeyboardEvent => {
    const e = { key: k, target: null, defaultPrevented: false, preventDefault: vi.fn(() => void (e.defaultPrevented = true)) };
    return e as unknown as KeyboardEvent;
  };
  const input = (id: string, value: string): HTMLInputElement => ({ id, value }) as HTMLInputElement;
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  /** Draws the controller's view into a document that stands for the page, until `done` is called. */
  const mounted = async (c: ReturnType<typeof createConnections>): Promise<{ document: Document; done: () => Promise<void> }> => {
    const browser = new Window();
    browser.document.body.innerHTML = connectionsHTML(c.view());
    vi.stubGlobal("document", browser.document);
    vi.stubGlobal("window", browser.window);
    vi.stubGlobal("innerWidth", 1120);
    vi.stubGlobal("innerHeight", 720);
    vi.stubGlobal("HTMLElement", browser.HTMLElement);
    return { document: browser.document as unknown as Document, done: async () => { vi.unstubAllGlobals(); await browser.happyDOM.abort(); } };
  };

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

  test("reads the services, the store, the latest actions and the core's count, and starts on the one view", async () => {
    const c = createConnections(host);
    expect(c.view().groups).toBe("loading");
    expect(c.view().inventory).toBe("loading");
    await c.load();
    expect(c.view().groups).toEqual(GROUPS);
    expect((c.view().catalog as StoreService[]).map(s => s.id)).toEqual(CATALOG.map(s => s.id));
    expect(c.view().audit).toEqual(AUDIT);
    expect(c.view().inventory).toEqual(INVENTORY);
    expect(c.view()).toMatchObject({ screen: "apps", open: null, category: "", search: "", recommendedAll: false });
    expect("tab" in c.view() || "storePage" in c.view()).toBe(false);
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

  test("with nothing connected yet it is still the one view: no chip, no list of the connected, and no switching away", async () => {
    api.toolsetsList.mockResolvedValue({ groups: [] });
    api.integrationsInventory.mockResolvedValue(inventoryOf([]));
    const c = createConnections(host);
    await c.load();
    expect(c.view().screen).toBe("apps");
    const d = dom(connectionsHTML(c.view()));
    expect(d.querySelector('[data-conn="connected"]')).toBeNull();
    expect(d.querySelector(".cs-apps")).not.toBeNull();
    // asked for anyway, the connected list is not drawn: there is nothing in it
    c.click(button("connected"));
    expect(dom(connectionsHTML(c.view())).querySelector(".cs-connected")).toBeNull();
    await c.load();
    expect(c.view().screen).toBe("connected"); // a read does not move the choice
  });

  test("read in the background at launch it decides nothing about where the dialog opens, and leaving puts it back on the one view", async () => {
    let shown = false;
    const c = createConnections({ ...host, visible: () => shown });
    await c.load(); await settle();
    expect(c.view().screen).toBe("apps");
    expect(c.view().catalog).toEqual(CATALOG);
    shown = true;
    c.click(button("connected"));
    c.click(button("open", { id: "ab12" }));
    c.click(button("back"));
    c.click(button("store-group", { id: "finance" }));
    c.click(button("recommended-all"));
    expect(c.view()).toMatchObject({ screen: "connected", category: "finance", recommendedAll: true });
    c.reset();
    expect(c.view()).toMatchObject({ screen: "apps", open: null, category: "", search: "", recommendedAll: false, shown: 24 });
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

  test("a press on a connected row (its button, its mark, name or line, or the row itself) opens the app's page, and a press on the switch only turns the app off or on", async () => {
    const c = createConnections(host);
    await c.load();
    const row = dom(connectedList()).querySelector(".cs-linked")!;
    for (const selector of [".cs-main", ".cs-main .ds", ".cs-main .nm", ".cs-main .cs-tile"]) {
      c.click(button("connected"));
      expect(c.click(row.querySelector(selector)!), selector).toBe(true);
      expect(c.view().open, selector).toEqual({ kind: "group", id: "ab12" });
      c.click(button("back"));
      expect(c.view(), selector).toMatchObject({ open: null, screen: "connected" });
    }
    expect(c.click(row)).toBe(true);
    expect(c.view().open).toEqual({ kind: "group", id: "ab12" });
    c.click(button("back"));
    expect(c.click(row.querySelector('[role="switch"]')!)).toBe(true);
    expect(c.view().open).toBeNull();
    await settle();
    expect(api.integrationsSetEnabled).toHaveBeenCalledWith("ab12", false);
  });

  test("opens the list of the connected from the chip, opens a page from a row, and steps back one view at a time", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("connected"));
    expect(c.view().screen).toBe("connected");
    c.click(button("open", { id: "ab12" }));
    expect(c.view().open).toEqual({ kind: "group", id: "ab12" });
    c.click(button("back"));
    expect(c.view()).toMatchObject({ open: null, screen: "connected" }); // to the list it was opened from
    c.click(button("back"));
    expect(c.view().screen).toBe("apps");
    host.redraw.mockClear();
    c.click(button("back")); // nothing to go back from
    expect(host.redraw).not.toHaveBeenCalled();
    c.click(button("open-store", { id: "linear" }));
    expect(c.view().open).toEqual({ kind: "app", id: "linear" });
    c.click(button("back"));
    expect(c.view()).toMatchObject({ open: null, screen: "apps" });
    // the tabs are gone
    expect(c.click(button("tab", { id: "store" }))).toBe(false);
    expect(c.click(button("manage", { id: "ab12" }))).toBe(false);
    // a row that is not there opens nothing
    c.click(button("open", { id: "nope" }));
    c.click(button("open-store", { id: "nope" }));
    expect(c.view().open).toBeNull();
  });

  test("a page whose app is gone closes when the services are read again", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("open", { id: "ab12" }));
    api.toolsetsList.mockResolvedValue({ groups: [custom] });
    await c.load();
    expect(c.view().open).toBeNull();
    c.click(button("open-store", { id: "linear" }));
    api.integrationsCatalog.mockResolvedValue({ services: [CATALOG[0]!] });
    api.connectorsStatus.mockResolvedValue({ connectors: [], composio_configured: false, google_configured: false }); // else the managed catalog offers Linear
    await c.load();
    expect(c.view().open).toBeNull();
  });

  test("the page of a store app whose connection exists is the page of that connection", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("open-store", { id: "notion" }));
    expect(c.view().open).toEqual({ kind: "app", id: "notion" });
    const d = dom(connectionsHTML(c.view()));
    expect(d.querySelector('[data-k="cs-dlg-enable"]')).not.toBeNull();
    expect(d.querySelector('[data-conn="join"]')).toBeNull();
    await settle();
    // its enable switch acts on the connection
    c.click(button("enable", { id: "ab12" })); await settle();
    expect(api.integrationsSetEnabled).toHaveBeenLastCalledWith("ab12", false);
  });

  test("an unchanged refresh of the managed catalog keeps what is drawn, while changed rows still redraw", async () => {
    const c = createConnections(host);
    await c.load();
    await settle();
    const catalog = c.view().composioCatalog;
    expect(api.connectorsCatalog).toHaveBeenCalledTimes(1); // one read: it is the first load that reads it
    host.redraw.mockClear();
    c.click(button("retry-store"));
    await settle();
    expect(api.connectorsCatalog).toHaveBeenCalledTimes(2);
    expect(c.view().composioCatalog).toEqual(catalog);
    expect(host.redraw).not.toHaveBeenCalled();
    api.connectorsCatalog.mockResolvedValueOnce({ categories: [], items: [] });
    c.click(button("retry-store"));
    await settle();
    expect(c.view().composioCatalog).toEqual([]);
    expect(host.redraw).toHaveBeenCalledTimes(1);
    // a later load does not read it again: it is there already
    await c.load();
    expect(api.connectorsCatalog).toHaveBeenCalledTimes(3);
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

  test("the page unfolds its list of tools and folds it again, and unfolds the latest actions", async () => {
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
    c.click(button("back"));
    c.click(button("open", { id: "ab12" }));
    expect(c.view()).toMatchObject({ open: { kind: "group", id: "ab12" }, toolsOpen: false, auditOpen: false });
  });

  test("Escape steps back one view at a time: the key's dialog, then the page, then the connected list, and once there is nothing it is the Settings'", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("connected"));
    c.click(button("open", { id: "ab12" }));
    c.click(button("configure-composio"));
    expect(c.view().keyOpen).toBe(true);
    const first = key("Escape");
    expect(c.key(first)).toBe(true);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(c.view()).toMatchObject({ keyOpen: false, open: { kind: "group", id: "ab12" }, screen: "connected" });
    expect(c.key(key("Escape"))).toBe(true);
    expect(c.view()).toMatchObject({ open: null, screen: "connected" });
    expect(c.key(key("Escape"))).toBe(true);
    expect(c.view().screen).toBe("apps");
    // Esc with nothing open is the panel's (it closes the settings), and an Escape that was handled already is left alone
    const last = key("Escape");
    expect(c.key(last)).toBe(false);
    expect(last.preventDefault).not.toHaveBeenCalled();
    c.click(button("open-store", { id: "linear" }));
    const handled = key("Escape");
    handled.preventDefault();
    expect(c.key(handled)).toBe(false);
    expect(c.view().open).not.toBeNull();
    expect(c.key(key("Escape"))).toBe(true);
    expect(c.view().open).toBeNull();
    expect(c.key(key("a"))).toBe(false);
  });

  test("the × of the key's dialog closes only that dialog, and leaves raw backdrop targets to shared gesture handling", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("open", { id: "ab12" }));
    c.click(button("close")); // there is no dialog: the page stays
    expect(c.view().open).not.toBeNull();
    c.click(button("configure-composio"));
    const scrim: { dataset: { conn: string }; closest?: () => unknown } = { dataset: { conn: "scrim" } };
    scrim.closest = () => scrim;
    // a click inside the dialog on no control finds the dimmed part around it, and does nothing
    expect(c.click({ closest: () => scrim } as unknown as Element)).toBe(true);
    expect(c.view().keyOpen).toBe(true);
    // A raw target cannot establish where the pointer press began.
    expect(c.click(scrim as unknown as Element)).toBe(true);
    expect(c.view().keyOpen).toBe(true);
    c.click(button("close"));
    expect(c.view().keyOpen).toBe(false);
    expect(c.view().open).not.toBeNull();
  });

  test("the search filters what is under the bar without drawing the page again", async () => {
    const c = createConnections(host);
    await c.load();
    const { document, done } = await mounted(c);
    try {
      const search = document.querySelector("#conn-search");
      const shell = document.querySelector(".cs");
      host.redraw.mockClear();
      expect(c.input(input("conn-search", "linear"))).toBe(true);
      expect(c.view().search).toBe("linear");
      expect(texts(document, ".cs-card .nm")).toEqual(["Linear"]);
      expect(document.querySelector(".cs-body .cs-sec")).toBeNull();
      expect(document.querySelector('[data-cs-chips] [aria-pressed="true"]')).toBeNull(); // no chip is chosen over a search
      expect(host.redraw).not.toHaveBeenCalled();
      expect(document.querySelector("#conn-search")).toBe(search);
      expect(document.querySelector(".cs")).toBe(shell);
      // cleared, the sections are back
      c.input(input("conn-search", ""));
      expect(document.querySelectorAll(".cs-body > .cs-sec").length).toBeGreaterThan(1);
      expect(document.querySelector('[data-cs-chips] [aria-pressed="true"]')!.getAttribute("data-id")).toBe("");
    } finally { await done(); }
  });

  test("a chip clears the search and lists its category; a search ignores the chosen chip", async () => {
    const c = createConnections(host);
    await c.load();
    const { document, done } = await mounted(c);
    try {
      const field = document.querySelector<HTMLInputElement>("#conn-search")!;
      field.value = "linear";
      c.input(field);
      expect(texts(document, ".cs-card .nm")).toEqual(["Linear"]);
      host.redraw.mockClear();
      // a chip: the search is cleared, in the box too
      c.click(document.querySelector('[data-cs-chips] [data-id="documents"]') as unknown as Element);
      expect(c.view()).toMatchObject({ category: "documents", search: "" });
      expect(field.value).toBe("");
      expect(texts(document, ".cs-card .nm")).toEqual(["Notion", "Linear", "Canva", "Sentry"]);
      expect(document.querySelector('[data-cs-chips] [aria-pressed="true"]')!.getAttribute("data-id")).toBe("documents");
      // a search over the chosen chip: the whole catalog answers
      field.value = "n8n";
      c.input(field);
      expect(texts(document, ".cs-card .nm")).toEqual(["n8n"]);
      expect(c.view().category).toBe("documents"); // the choice is remembered, only not used
      // pressing 全部 clears the search and brings back the sections
      c.click(document.querySelector('[data-cs-chips] [data-id=""]') as unknown as Element);
      expect(c.view()).toMatchObject({ category: "", search: "" });
      expect(document.querySelectorAll(".cs-body > .cs-sec").length).toBeGreaterThan(1);
      expect(host.redraw).not.toHaveBeenCalled();
    } finally { await done(); }
  });

  test("choosing a category redraws only the chips and the list: the page, the search box and the focus on the chip stay", async () => {
    const c = createConnections(host);
    await c.load();
    const { document, done } = await mounted(c);
    try {
      const shell = document.querySelector(".cs");
      const search = document.querySelector("#conn-search");
      const list = document.querySelector<HTMLElement>("[data-cs-scroll]")!;
      list.scrollTop = 120;
      const chip = document.querySelector<HTMLElement>('[data-cs-chips] [data-id="documents"]')!;
      chip.focus();
      host.redraw.mockClear();
      c.click(chip as unknown as Element);
      expect(host.redraw).not.toHaveBeenCalled();
      expect(document.querySelector(".cs")).toBe(shell);
      expect(document.querySelector("#conn-search")).toBe(search);
      const chosen = document.querySelector<HTMLElement>('[data-cs-chips] [data-id="documents"]')!;
      expect(chosen.getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(chosen); // the focus stays on the chip, which was drawn again
      expect(list.scrollTop).toBe(0); // a new category starts at the top
      // pressing the chosen one again changes nothing
      const html = document.querySelector("[data-cs-body]")!.innerHTML;
      c.click(chosen as unknown as Element);
      expect(document.querySelector("[data-cs-body]")!.innerHTML).toBe(html);
    } finally { await done(); }
  });

  test("更多 lists exactly the categories that are not in the row, and choosing one lists its apps", async () => {
    const c = createConnections(host);
    await c.load();
    // not drawn: the five that stand, the rest are capped
    const menu = c.menuFor("conn-more")!;
    expect(menu.choices.map((x) => x.value)).toEqual(STORE_GROUPS.slice(5));
    expect(menu.choices.map((x) => x.label)).toEqual(["銷售與客服", "財務", "設計與媒體", "其他"]);
    expect(menu.current).toBe("");
    menu.pick("sales");
    expect(c.view().category).toBe("sales");
    // the chosen one stands in the row; the last of the standing goes to the menu
    const after = c.menuFor("conn-more")!;
    expect(after.choices.map((x) => x.value)).toEqual(["marketing", "finance", "media", "other"]);
    expect(after.current).toBe("sales");
    // drawn: what the row hid is what the menu offers
    const { document, done } = await mounted(c);
    try {
      const row = document.querySelector<HTMLElement>("[data-cs-chips]")!;
      Object.defineProperty(row, "clientWidth", { get: () => 650, configurable: true });
      Object.defineProperty(row, "scrollWidth", { get: () => [...row.children].filter((el) => !(el as HTMLElement).hidden).length * 100, configurable: true });
      c.painted();
      const hidden = [...row.querySelectorAll<HTMLElement>('[data-conn="store-group"]')].filter((chip) => chip.hidden).map((chip) => chip.dataset.id);
      expect(hidden.length).toBeGreaterThan(4);
      expect(c.menuFor("conn-more")!.choices.map((x) => x.value)).toEqual(hidden);
      expect(row.querySelector<HTMLElement>('[data-conn="store-group"][data-id="sales"]')!.hidden).toBe(false);
    } finally { await done(); }
    expect(c.menuFor("nothing")).toBeNull();
  });

  test("a long list draws its next rows when the end comes near, and not before", async () => {
    api.integrationsCatalog.mockResolvedValue({ services: [...CATALOG, ...many(100)] });
    const c = createConnections(host);
    await c.load();
    const { document, done } = await mounted(c);
    try {
      c.click(document.querySelector('[data-cs-chips] [data-id="documents"]') as unknown as Element);
      const scroll = document.querySelector<HTMLElement>("[data-cs-scroll]")!;
      const cards = (): number => document.querySelectorAll(".cs-body > .cs-grid > .cs-card").length;
      const place = (top: number): void => {
        Object.defineProperty(scroll, "scrollHeight", { get: () => 5000, configurable: true });
        Object.defineProperty(scroll, "clientHeight", { get: () => 600, configurable: true });
        Object.defineProperty(scroll, "scrollTop", { get: () => top, set: () => undefined, configurable: true });
      };
      expect(cards()).toBe(24);
      expect(c.view().shown).toBe(24);
      place(1000); c.scrolled(scroll);
      expect(cards()).toBe(24); // far from the end
      place(4300); c.scrolled(scroll);
      expect(cards()).toBe(48);
      expect(texts(document, ".cs-body > .cs-grid > .cs-card .nm").slice(22, 26)).toEqual(texts(dom(bodyHTML(view({ catalog: [...CATALOG, ...many(100)], category: "documents", shown: 200 }))), ".cs-card .nm").slice(22, 26));
      place(4300); c.scrolled(scroll);
      expect(cards()).toBe(72);
      place(4300); c.scrolled(scroll);
      expect(cards()).toBe(96);
      place(4300); c.scrolled(scroll);
      expect(cards()).toBe(104);
      place(4300); c.scrolled(scroll);
      expect(cards()).toBe(104); // nothing more to draw
      // something that scrolled and is not the list is none of its business
      c.scrolled(document.body as unknown as Element);
      expect(cards()).toBe(104);
    } finally { await done(); }
  });

  test("a page being open or the connected list being shown keep a scroll from drawing rows", async () => {
    api.integrationsCatalog.mockResolvedValue({ services: [...CATALOG, ...many(100)] });
    const c = createConnections(host);
    await c.load();
    c.click(button("store-group", { id: "documents" }));
    const grid = new Window();
    grid.document.body.innerHTML = '<div data-cs-scroll><div data-cs-body><div class="cs-grid"></div></div></div>';
    try {
      const scroll = grid.document.querySelector("[data-cs-scroll]") as unknown as HTMLElement;
      Object.defineProperty(scroll, "scrollHeight", { get: () => 5000, configurable: true });
      Object.defineProperty(scroll, "clientHeight", { get: () => 600, configurable: true });
      Object.defineProperty(scroll, "scrollTop", { get: () => 4300, configurable: true });
      vi.stubGlobal("document", grid.document);
      vi.stubGlobal("HTMLElement", grid.HTMLElement);
      c.click(button("open", { id: "ab12" }));
      c.scrolled(scroll);
      c.click(button("back"));
      c.click(button("connected"));
      c.scrolled(scroll);
      expect(grid.document.querySelectorAll(".cs-card")).toHaveLength(0);
      expect(c.view().shown).toBe(24);
      // and on the view itself it draws the next rows
      c.click(button("back"));
      c.scrolled(scroll);
      expect(grid.document.querySelectorAll(".cs-card")).toHaveLength(24);
      expect(c.view().shown).toBe(48);
    } finally { vi.unstubAllGlobals(); await grid.happyDOM.abort(); }
  });

  // Owner, 2026-11-09: 「一律全部都在對話中進行…除非真的是登入就結束 或是輸入金鑰匙就結束」.
  test("連結 on n8n, or on an app that needs a developer app, leaves for the conversation with the owner's words", async () => {
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
  test("the view offers the owner's own Google, and its 連結 leaves for the conversation where the card walks the steps", async () => {
    const c = createConnections(host);
    await c.load();
    const entry = ownGoogleEntry(null);
    expect(entry).toMatchObject({ id: "google", name: "Google（私人連接）", icon: "gmail", server_id: null });
    expect(entry.about["zh-TW"]).toContain("不經過 Composio");
    expect(namesIn(connectionsHTML(c.view()))).toContain("Google（私人連接）");
    c.click(button("join", { id: "google" }));
    expect(host.tryPrompt).toHaveBeenLastCalledWith("幫我連接我自己的 Google 帳號");
    expect(c.view().form).toBeNull();
    // Nothing is sent from here: no Composio call, no form of its own.
    expect(api.connectorsConnect).not.toHaveBeenCalled();
    expect(api.connectorsGoogleConnect).not.toHaveBeenCalled();
    // Once the private Google connection exists the row is connected.
    expect(ownGoogleEntry("google").server_id).toBe("google");
  });

  test("an app that is already connected is not joined again", async () => {
    const c = createConnections(host);
    await c.load();
    c.click(button("join", { id: "notion" }));
    expect(api.integrationsConnect).not.toHaveBeenCalled();
    expect(host.tryPrompt).not.toHaveBeenCalled();
    expect(c.view().login).toBeNull();
  });

  test("signs in to an app of the view with its 連結, and a card that was pressed reports in a toast", async () => {
    let finish!: (value: { connected: boolean; error?: string }) => void;
    api.integrationsConnect.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const c = createConnections(host);
    await c.load();
    c.click(button("join", { id: "linear" }));
    expect(api.integrationsConnect).toHaveBeenCalledWith({ catalog_id: "linear" });
    expect(c.view().login).toEqual({ target: "linear", name: "Linear" });
    c.click(button("join", { id: "linear" })); // the same app pressed while it waits starts nothing
    expect(api.integrationsConnect).toHaveBeenCalledTimes(1);
    finish({ connected: true }); await settle();
    expect(c.view().login).toBeNull();
    expect(lastToast()).toBe("已連接 Linear");
    expect(c.view().screen).toBe("apps");
  });

  test("after a sign-in from an app's page the page stays open and shows the connected state", async () => {
    api.integrationsConnect.mockResolvedValue({ connected: true });
    const c = createConnections(host);
    await c.load();
    c.click(button("open-store", { id: "linear" }));
    expect(dom(connectionsHTML(c.view())).querySelector(".cs-join .cs-connect")).not.toBeNull();
    // the core now has the connection, and the catalog says so
    const linear: ConnectionGroup = { ...notes, id: "li1", name: "Linear", catalog_id: "linear" };
    api.toolsetsList.mockResolvedValue({ groups: [...GROUPS, linear] });
    api.integrationsCatalog.mockResolvedValue({ services: CATALOG.map((s) => (s.id === "linear" ? { ...s, server_id: "li1" } : s)) });
    api.integrationsInventory.mockResolvedValue(inventoryOf([app("ab12", "Notion"), app("cu1", "Files"), app("li1", "Linear")]));
    c.click(button("join", { id: "linear" }));
    await settle();
    expect(c.view().open).toEqual({ kind: "app", id: "linear" });
    expect(c.view().dialogNotice).toEqual({ text: "已連接 Linear", kind: "ok" });
    expect(toaster.info).not.toHaveBeenCalled();
    const d = dom(connectionsHTML(c.view()));
    expect(d.querySelector(".cs-join .cs-state")).not.toBeNull();
    expect(d.querySelector(".cs-join [role=switch]")).not.toBeNull();
    expect(d.querySelector(".cs-join .cs-connect")).toBeNull();
    expect(d.querySelector("[data-cs-notice]")!.textContent).toContain("已連接 Linear");
  });

  test("a login that fails says why on the app's page, with no toast; from a row it is a toast, and a cancelled one says nothing", async () => {
    const c = createConnections(host);
    await c.load();
    api.integrationsConnect.mockResolvedValueOnce({ connected: false, error: "denied" });
    c.click(button("open-store", { id: "linear" }));
    c.click(button("join", { id: "linear" }));
    await settle();
    expect(c.view().loginError).toEqual({ target: "linear", kind: "denied" });
    expect(c.view().login).toBeNull();
    expect(toaster.info).not.toHaveBeenCalled();
    expect(connectionsHTML(c.view())).toContain("你在瀏覽器上拒絕了，所以沒有加入。");
    // pressed again the failure goes at once; a refusal that is none of the core's words is a plain error
    api.integrationsConnect.mockRejectedValueOnce(new Error("boom"));
    c.click(button("join", { id: "linear" }));
    expect(c.view().loginError).toBeNull();
    await settle();
    expect(c.view().loginError).toEqual({ target: "linear", kind: "error" });
    c.click(button("back"));
    // from a row the page is not there to say it: a toast does
    api.integrationsConnect.mockResolvedValueOnce({ connected: false, error: "network" });
    c.click(button("join", { id: "sentry" }));
    await settle();
    expect(lastToast()).toBe(t("plugins.connectFailed"));
    vi.mocked(toaster.info).mockClear();
    // a sign-in left until it ran out is no error the owner needs a toast for
    api.integrationsConnect.mockResolvedValueOnce({ connected: false, error: "timeout" });
    c.click(button("join", { id: "sentry" }));
    await settle();
    expect(toaster.info).not.toHaveBeenCalled();
    api.integrationsConnect.mockResolvedValueOnce({ connected: false, error: "cancelled" });
    c.click(button("join", { id: "sentry" }));
    await settle();
    expect(toaster.info).not.toHaveBeenCalled();
    expect(c.view().loginError).toBeNull();
  });

  test("cancels a login that is under way, from the row or from the page", async () => {
    api.integrationsConnect.mockReturnValue(new Promise(() => undefined));
    const c = createConnections(host);
    await c.load();
    c.click(button("cancel-login"));
    expect(api.integrationsConnectCancel).toHaveBeenCalledTimes(1); // the core is told whenever it is asked
    c.click(button("join", { id: "linear" }));
    expect(dom(connectionsHTML(c.view())).querySelector('.cs-card [data-conn="cancel-login"]')).not.toBeNull();
    c.click(button("open-store", { id: "linear" }));
    expect(dom(connectionsHTML(c.view())).querySelector('.cs-join [data-conn="cancel-login"]')).not.toBeNull();
    c.click(button("cancel-login"));
    expect(api.integrationsConnectCancel).toHaveBeenCalledTimes(2);
    api.integrationsConnectCancel.mockRejectedValueOnce(new Error("gone"));
    c.click(button("cancel-login")); await settle();
    expect(c.view().dialogNotice?.kind).toBe("err");
    c.reset();
  });

  test("one sign-in waits at a time and holds nothing back: connecting another app ends it first, and a cancelled one says nothing", async () => {
    let finishFirst: (value: { connected: boolean; error?: string }) => void = () => undefined;
    api.integrationsConnect.mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }));
    api.integrationsConnectCancel.mockImplementation(async () => { finishFirst({ connected: false, error: "cancelled" }); return { cancelled: true }; });
    api.integrationsConnect.mockReturnValueOnce(new Promise(() => undefined)); // the second one waits for the browser as well
    const c = createConnections(host);
    await c.load();
    c.click(button("join", { id: "linear" }));
    expect(c.view().login).toEqual({ target: "linear", name: "Linear" });
    expect(dom(connectionsHTML(c.view())).querySelector<HTMLButtonElement>('[data-conn="join"][data-id="sentry"]')!.disabled).toBe(false);
    c.click(button("join", { id: "sentry" }));
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(api.integrationsConnectCancel).toHaveBeenCalledTimes(1);
    expect(api.integrationsConnect).toHaveBeenCalledTimes(2);
    expect(c.view().login).toEqual({ target: "sentry", name: "Sentry" });
    expect(c.view().loginError).toBeNull();
    expect(toaster.info).not.toHaveBeenCalled();
    // the same app pressed again while it waits starts nothing
    c.click(button("join", { id: "sentry" }));
    await settle();
    expect(api.integrationsConnect).toHaveBeenCalledTimes(2);
    c.reset();
  });

  test("a sign-in that cannot be ended starts nothing on top of it", async () => {
    api.integrationsConnect.mockReturnValue(new Promise(() => undefined));
    api.integrationsConnectCancel.mockRejectedValueOnce(new Error("gone"));
    const c = createConnections(host);
    await c.load();
    c.click(button("join", { id: "linear" }));
    c.click(button("join", { id: "sentry" }));
    await settle();
    expect(api.integrationsConnect).toHaveBeenCalledTimes(1);
    expect(c.view().login?.target).toBe("linear");
    c.reset();
  });

  describe("the accounts of an app (R-ACCT-01)", () => {
    const gmail = (accounts: { id: string; status: string; label?: string }[]) => ({
      id: "composio:gmail", kind: "composio", name: "Gmail", description: "", logo: "", status: accounts.some((a) => a.status === "ACTIVE") ? "ACTIVE" : "INITIATED", enabled: true,
      accounts, enabled_tools: [], disabled_tools: [],
    });
    const openGmail = async (accounts: { id: string; status: string; label?: string }[]) => {
      api.connectorsStatus.mockResolvedValue({ connectors: [gmail(accounts)], composio_configured: true, google_configured: false });
      api.connectorsRemoveAccount.mockResolvedValue({ connector: gmail([]) });
      api.connectorsDisconnect.mockResolvedValue({ disconnected: true });
      vi.mocked(confirmDelete).mockClear();
      const c = createConnections(host);
      await c.load();
      c.click(button("open", { id: "composio:gmail" }));
      return c;
    };
    const TWO = [{ id: "a1", status: "ACTIVE", label: "Work" }, { id: "a2", status: "ACTIVE", label: "Me" }, { id: "a3", status: "INITIATED" }];

    test("every row is a person, a name, a status and a ⋯; the 帳號名稱 button is gone", async () => {
      const c = await openGmail(TWO);
      const d = dom(connectionsHTML(c.view()));
      expect(texts(d, ".cs-acct .nm")).toEqual(["Work", "Me", "帳號 3"]);
      expect(texts(d, ".cs-acct .st")).toEqual(["已連結", "已連結", "等待登入"]);
      expect(d.querySelectorAll('.cs-acct [data-conn="account-menu"]')).toHaveLength(3);
      expect(d.querySelector('.cs-acct [data-conn="account-label"]')).toBeNull();
      expect(d.body.textContent).not.toContain("帳號名稱");
      expect(d.querySelector('.cs-accts [data-conn="add-account"]')).not.toBeNull();
      c.reset();
    });

    test("the menu has 重新命名 and then 移除 in red, and renaming is what the 帳號名稱 button did", async () => {
      const c = await openGmail(TWO);
      const { document, done } = await mounted(c);
      try {
        const more = document.querySelector<HTMLElement>('.cs-acct [data-conn="account-menu"][data-account="a2"]')!;
        expect(more.getAttribute("aria-label")).toBe("更多動作");
        c.click(more);
        const items = Array.from(document.querySelectorAll<HTMLElement>('#app-popover [role="menuitem"]'));
        expect(items.map((item) => item.textContent)).toEqual(["重新命名", "移除"]);
        expect(items.map((item) => item.classList.contains("danger"))).toEqual([false, true]);
        expect(items.map((item) => item.dataset.conn)).toEqual(["account-label", "account-remove"]);
        expect(items.every((item) => item.dataset.account === "a2" && item.dataset.id === "composio:gmail")).toBe(true);
      } finally { await done(); }
    });

    test.each(["INITIATED", "INITIALIZING", "EXPIRED", "REVOKED", "FAILED", "INACTIVE"])("a row that is %s is removed at once, with no question", async (status) => {
      const c = await openGmail([{ id: "a1", status: "ACTIVE" }, { id: "a9", status }]);
      c.click(button("account-remove", { id: "composio:gmail", account: "a9" }));
      await settle();
      expect(confirmDelete).not.toHaveBeenCalled();
      expect(api.connectorsRemoveAccount).toHaveBeenCalledWith("composio:gmail", "a9");
      c.reset();
    });

    test("a connected account asks the app's delete question first, and only a yes removes it", async () => {
      const c = await openGmail(TWO);
      vi.mocked(confirmDelete).mockResolvedValueOnce(false);
      c.click(button("account-remove", { id: "composio:gmail", account: "a2" }));
      await settle();
      expect(confirmDelete).toHaveBeenCalledWith("Me", { words: { title: "移除「Me」？", hint: "成員將無法再使用這個帳號。", action: "移除" } });
      expect(api.connectorsRemoveAccount).not.toHaveBeenCalled();
      c.click(button("account-remove", { id: "composio:gmail", account: "a1" }));
      await settle();
      expect(confirmDelete).toHaveBeenLastCalledWith("Work", expect.anything());
      expect(api.connectorsRemoveAccount).toHaveBeenCalledWith("composio:gmail", "a1");
      c.reset();
    });

    test("the last connected account is the app: removing it asks the app's own disconnect question, not another", async () => {
      const c = await openGmail([{ id: "a1", status: "ACTIVE", label: "Work" }, { id: "a3", status: "INITIATED" }]);
      const { done } = await mounted(c);
      try {
        c.click(button("account-remove", { id: "composio:gmail", account: "a1" }));
        await settle();
        expect(confirmDelete).not.toHaveBeenCalled();
        expect(api.connectorsRemoveAccount).not.toHaveBeenCalled();
        expect(c.view().confirmingDisconnect).toBe("composio:gmail"); // the app's own two presses
        c.click(button("disconnect", { id: "composio:gmail" }));
        await settle();
        expect(api.connectorsDisconnect).toHaveBeenCalledWith("composio:gmail");
      } finally { await done(); c.reset(); }
    });

    test("a failure says so in the notice and leaves the row", async () => {
      const c = await openGmail(TWO);
      api.connectorsRemoveAccount.mockRejectedValueOnce(new Error("network"));
      c.click(button("account-remove", { id: "composio:gmail", account: "a3" }));
      await settle();
      expect(c.view().dialogNotice).toMatchObject({ kind: "err" });
      expect(texts(dom(connectionsHTML(c.view())), ".cs-acct .nm")).toEqual(["Work", "Me", "帳號 3"]);
      c.reset();
    });
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

  test("a service whose login ran out signs in again from its page, which stays open", async () => {
    api.toolsetsList.mockResolvedValue({ groups: [{ ...notes, status: "error", error: "auth" }, custom] });
    api.integrationsConnect.mockResolvedValue({ connected: true, server: { id: "ab12" } });
    const c = createConnections(host);
    await c.load();
    c.click(button("open", { id: "ab12" }));
    c.click(button("relogin", { id: "ab12" }));
    expect(api.integrationsConnect).toHaveBeenCalledWith({ id: "ab12" });
    await settle();
    expect(c.view().open).toEqual({ kind: "group", id: "ab12" });
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

    test("the form opens over a page too, and drops it", async () => {
      const c = createConnections(host);
      await c.load();
      c.click(button("open", { id: "ab12" }));
      menu(c).pick("custom");
      expect(c.view()).toMatchObject({ open: null });
      expect(c.view().form).not.toBeNull();
    });

    test("the values go to the core once, the names stay, the form is dropped, and the service is on the list of the connected", async () => {
      api.integrationsAdd.mockResolvedValue({ server: { id: "new1" } });
      const c = createConnections(host);
      await c.load();
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
      expect(c.view().screen).toBe("connected");
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

  test("leaving the dialog drops the form, the page, the search, the category and a pending disconnect, but not a login that is under way", async () => {
    api.integrationsConnect.mockReturnValue(new Promise(() => undefined));
    const c = createConnections(host);
    await c.load();
    c.click(button("connected"));
    c.click(button("open", { id: "ab12" }));
    c.click(button("disconnect", { id: "ab12" }));
    c.click(button("join", { id: "linear" }));
    c.menuFor("conn-add")!.pick("custom");
    c.input(input("conn-name", "Half"));
    c.input(input("conn-pairs", "TOKEN=TOPSECRET"));
    c.input(input("conn-search", "lin"));
    c.click(button("store-group", { id: "finance" }));
    c.reset();
    expect(c.view()).toMatchObject({ screen: "apps", open: null, toolsOpen: false, auditOpen: false, form: null, confirmingDisconnect: null, search: "", category: "", keyOpen: false });
    expect(c.view().login).not.toBeNull();
    expect(JSON.stringify(c.view())).not.toContain("TOPSECRET");
  });

  test("ignores a click that is none of its own", () => {
    const c = createConnections(host);
    expect(c.click({ closest: () => null } as unknown as Element)).toBe(false);
    expect(c.click(button("nothing-of-ours"))).toBe(false);
  });
});

test("unknown connections use a plug at both sizes without exposing the name as markup or initials", () => {
  for (const size of ["md", "xl"] as const) {
    for (const name of ["Files", "筆記", "<img src=x onerror=alert(1)>", ""]) {
      expect(iconHTML(name, null, size)).toBe(`<span class="mono ${size}" aria-hidden="true">${ico("plug")}</span>`);
    }
  }
});
