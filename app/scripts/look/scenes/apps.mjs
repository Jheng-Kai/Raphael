import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scene, click, wait, waitGone, check, key } from "./steps.mjs";

// Settings > Connections owns the app inventory and its connected count.
// Every scene uses the real account footer and Settings entry.
const base = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixture.json"), "utf8"));
const open = [click("#nav .sidebar-apps"), wait('.modal-scrim[data-standalone="connections"] .modal-body .cs'), check("settings-shell")];

const tool = (slug, name, kind, description) => ({ slug, name, description, kind, enabled: true });
const notionTools = [
  tool("NOTION_SEARCH", "搜尋頁面", "read", "在工作區搜尋筆記與資料庫"),
  tool("NOTION_FETCH_PAGE", "讀取頁面", "read", "讀取一個頁面的內容"),
  tool("NOTION_LIST_DATABASES", "列出資料庫", "read", "查看工作區裡的資料庫"),
  tool("NOTION_QUERY_DATABASE", "查詢資料庫", "read", "依條件找出資料庫裡的列"),
  tool("NOTION_LIST_USERS", "列出成員", "read", "查看工作區的成員"),
  tool("NOTION_FETCH_COMMENTS", "讀取留言", "read", "讀取頁面上的留言"),
  tool("NOTION_CREATE_PAGE", "建立頁面", "write", "在指定的位置新增頁面"),
  tool("NOTION_UPDATE_PAGE", "更新頁面", "write", "修改頁面的內容與屬性"),
  tool("NOTION_ADD_COMMENT", "新增留言", "write", "在頁面上留言"),
];
const connector = (id, over) => ({ id, kind: "composio", name: "", description: "", logo: "", status: "ACTIVE", enabled: true, enabled_tools: [], disabled_tools: [], accounts: [{ id: `ca_${id}`, status: "ACTIVE" }], ...over });
const notion = over => connector("composio:notion", { name: "Notion", description: "搜尋筆記、整理頁面與專案資料", enabled_tools: notionTools.map(item => item.slug), ...over });
const google = { ...base.managedConnectors.find(item => item.id === "google"), accounts: [{ id: "me", status: "ACTIVE" }] };
// The owner's case (10/27): a server of many tools, some of them off.
const manyTools = (id, name, count, off) => {
  const writes = Math.ceil(count / 3);
  return { ...base.servers[1], id, name, enabled: true, status: "ready", auth: "oauth", url: `https://${id}.example.test/mcp`, headers: [],
    tool_count: count, enabled_count: count - off, write_count: writes, read_count: count - writes,
    tools: Array.from({ length: count }, (_, i) => ({ name: `${id}_tool_${i + 1}`, description: `${name} 的第 ${i + 1} 個工具`, enabled: i >= off, kind: i < writes ? "write" : "read" })) };
};
const github = manyTools("github", "GitHub", 46, 18);
// The accounts card of an app (R-ACCT-01): the owner's connected one, a sign-in begun a minute ago, and one that waited too long (the core gives it back).
const accountsPage = [...open, click('[data-conn="connected"]'), click('[data-conn="open"][data-id="composio:gmail"]'), wait(".cs-accts")];
const gmailAccounts = ({ second = false } = {}) => connector("composio:gmail", { name: "Gmail", description: "搜尋郵件、撰寫草稿與回覆", enabled_tools: ["GMAIL_FETCH_EMAILS", "GMAIL_CREATE_DRAFT"],
  accounts: [{ id: "ca_jack", status: "ACTIVE", label: "Jack" },
    ...(second ? [{ id: "ca_me", status: "ACTIVE", label: "工作信箱" }] : [{ id: "ca_wait", status: "INITIATED" }, { id: "ca_old", status: "INITIATED", stale: true }])] });
const appSwitch = state => wait(`[data-conn="enable"][data-id="github"][aria-checked="${state}"]`);

const skillDoc = (name, description, body) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
const weekly = skillDoc("weekly-summary", "每週五整理本週的研究重點，用三段話寫成摘要", "# 每週摘要\n\n1. 先寫結論，一句話。\n2. 列出三個重點，每個重點附上來源。\n3. 最後寫下下週要做的事。\n");
const skills = [
  { id: 7, member_id: 1, name: "weekly-summary", description: "每週五整理本週的研究重點，用三段話寫成摘要", enabled: true, source: "github:owner/research-skills", text: weekly },
  { id: 8, member_id: 1, name: "source-check", description: "引用資料前先核對來源與日期", enabled: true, source: "owner/research-skills" },
  { id: 9, member_id: 2, name: "meeting-notes", description: "會議結束後整理決議與負責人", enabled: false, source: "owner/team-skills" },
];

export default [
  scene("connect-apps-categories", "Every category chip can be focused and chosen by keyboard, and the rest are in 更多", [
    ...open, wait(".cs-card"),
    { action: "focus", selector: '[data-conn="store-group"][data-id=""]' }, check("store-group-focus"),
    ...Array.from({ length: 5 }, () => [key("Tab"), check("store-group-focus")]).flat(),
    key("Enter"), check("store-group-end"),
    click('[data-conn="store-group"][data-id="productivity"]'), check("plugins-store-category"), check("plugins-store-rows"),
  ]),
  scene("connected-apps-only", "The list of the connected holds connectors only: apps that can be called now, those that cannot with the reason; one count, and no skills section or import button even when members have skills", [
    ...open, click('[data-conn="connected"]'), wait('[data-k="cs-open:composio:notion"]'), wait('.cs-linked'), check("apps-count"), check("connectors-only"),
  ], {
    managedConnectors: [
      notion(), google,
      connector("composio:gmail", { name: "Gmail", description: "搜尋郵件、撰寫草稿與回覆", enabled_tools: ["GMAIL_FETCH_EMAILS", "GMAIL_CREATE_DRAFT"] }),
      connector("composio:slack", { name: "Slack", description: "搜尋團隊訊息、分享工作進度", status: "INITIALIZING", accounts: [{ id: "ca_slack", status: "INITIALIZING" }] }),
    ],
    servers: base.servers.slice(0, 1),
    skills,
  }),
  scene("connected-apps-unreadable", "A core that cannot list the apps: the chip says only 「已連結」 and gives no number, and the apps stay one list", [
    ...open, click('[data-conn="connected"]'), wait('[data-k="cs-open:composio:notion"]'), check("apps-unreadable"),
  ], { inventoryUnreadable: true, managedConnectors: [notion(), google], servers: base.servers.slice(0, 1), skills }),
  scene("connections-app-switch", "The app switch has two states and preserves all 18 tool exclusions when disabled and enabled", [
    ...open, click('[data-conn="connected"]'), wait('.cs-linked'), check("connections-binary"), appSwitch("true"), click('[data-conn="enable"][data-id="github"]'), appSwitch("false"),
    check("connections-binary"), click('[data-conn="enable"][data-id="github"]'), appSwitch("true"), check("app-switch-all"), check("connections-binary"),
  ], { servers: [github, ...base.servers] }),
  scene("connector-many-tools", "Bulk write and read permissions stay reachable above the folded 46-tool list", [
    ...open, click('[data-conn="connected"]'), click('[data-conn="open"][data-id="github"]'), wait('[data-conn="tool-list"][aria-expanded="false"]'), check("connections-binary"),
    click('.cs-page [data-conn="kind"][data-kind="write"]'), wait('.cs-page [data-kind="write"][aria-checked="true"]'),
    click('.cs-page [data-conn="kind"][data-kind="read"]'), wait('.cs-page [data-kind="read"][aria-checked="true"]'),
    click('.cs-page [data-conn="kind"][data-kind="write"]'), wait('.cs-page [data-kind="write"][aria-checked="false"]'),
    check("connector-folded"), check("connections-binary"), check("connections-dialog-actions"),
  ], { servers: [github, ...base.servers] }),
  scene("connector-account-tools", "A managed app's read and write switches update whole kinds and keep the per-tool list available", [
    ...open, click('[data-conn="connected"]'), click('[data-conn="open"][data-id="composio:notion"]'), wait('.cs-page [data-conn="kind"]'),
    click('.cs-page [data-conn="relogin"]'), wait('.cs-page .note[role="alert"]'), check("connector-link-refused"), check("connections-dialog-actions"),
    click('.cs-page [data-kind="write"]'), wait('.cs-page [data-kind="write"][aria-checked="false"]'), check("connections-binary"),
    click('.cs-page [data-kind="write"]'), wait('.cs-page [data-kind="write"][aria-checked="true"]'),
    click('.cs-page [data-kind="read"]'), wait('.cs-page [data-kind="read"][aria-checked="false"]'),
    click('.cs-page [data-kind="read"]'), wait('.cs-page [data-kind="read"][aria-checked="true"]'),
    click('[data-conn="tool-list"]'), wait('[data-conn="tool"][data-tool="NOTION_SEARCH"]'), wait(".cs-acct"), check("connector-tools"), check("connections-binary"), check("connections-dialog-actions"),
  ], {
    connectorLinkRefused: true,
    managedConnectors: [notion({ accounts: [{ id: "ca_work", status: "ACTIVE" }, { id: "ca_old", status: "EXPIRED" }] }), google],
    pluginTools: { ...base.pluginTools, "composio:notion": notionTools },
  }),
  // R-ACCT-01: the owner's case of 2026-11-13 (a connected account and two sign-ins that were never finished), after the core gave the old one back.
  scene("accounts-card", "An app's accounts: the connected one and the sign-in that is still young; the one that waited too long is gone. Each row has a quiet ⋯ and no 帳號名稱 button", [
    ...accountsPage, check("accounts-card"),
  ], { managedConnectors: [gmailAccounts()] }),
  scene("accounts-menu", "The ⋯ of an account row opens 重新命名 and then 移除 in red", [
    ...accountsPage, click('[data-conn="account-menu"][data-account="ca_wait"]'), wait("#app-popover"), check("accounts-menu"),
  ], { managedConnectors: [gmailAccounts()] }),
  scene("accounts-remove-ask", "Removing a connected account asks the app's one delete question: 「移除「name」？」, a sentence, 取消 and a red 移除", [
    ...accountsPage, click('[data-conn="account-menu"][data-account="ca_me"]'), click('#app-popover [data-conn="account-remove"]'), wait(".mb-delete"), check("accounts-remove-ask"),
  ], { managedConnectors: [gmailAccounts({ second: true })] }),
  scene("accounts-remove-yes", "Answering 移除 removes the connected account at the core and the row goes", [
    ...accountsPage, click('[data-conn="account-menu"][data-account="ca_me"]'), click('#app-popover [data-conn="account-remove"]'), wait(".mb-delete"),
    click('.mb-delete [data-dlg="delete"]'), waitGone('[data-account="ca_me"]'), check("accounts-removed"),
  ], { managedConnectors: [gmailAccounts({ second: true })] }),
  scene("accounts-remove-waiting", "A sign-in that is still waiting is removed at once, with no question", [
    ...accountsPage, click('[data-conn="account-menu"][data-account="ca_wait"]'), click('#app-popover [data-conn="account-remove"]'), waitGone('[data-account="ca_wait"]'), check("accounts-removed-waiting"),
  ], { managedConnectors: [gmailAccounts()] }),
  scene("accounts-remove-last", "The last connected account is the app: removing it asks the app's own disconnect question", [
    ...accountsPage, click('[data-conn="account-menu"][data-account="ca_jack"]'), click('#app-popover [data-conn="account-remove"]'), wait('.menu [data-conn="disconnect"]'), check("accounts-remove-last"),
  ], { managedConnectors: [gmailAccounts()] }),
  // The owner's case of 2026-11-13 (「然後為什麼大部分人都沒有辦法連結？」): a sign-in that waits holds no other app back and can be cancelled.
  scene("sign-in-waits", "One managed sign-in waits for the browser: its row says so and has an enabled 取消; every other 連結 stays pressable", [
    ...open, wait(".cs-card"), click('[data-conn="join"][data-id="slack"]'), wait('[data-conn="cancel-login"]'), check("sign-in-waits"),
  ], { composioConfigured: true, pluginsConnecting: true }),
  scene("sign-in-replaced", "Pressing another app's 連結 ends the waiting sign-in at the core and starts the new one; only one waits", [
    ...open, wait(".cs-card"), click('[data-conn="join"][data-id="slack"]'), wait('[data-conn="cancel-login"]'),
    click('[data-conn="join"][data-id="gmail"]'), wait('[data-conn="join"][data-id="slack"]'), check("sign-in-replaced"),
  ], { composioConfigured: true, pluginsConnecting: true }),
  scene("sign-in-cancelled", "取消 ends the waiting sign-in at the core: the row is 連結 again and nothing is said", [
    ...open, wait(".cs-card"), click('[data-conn="join"][data-id="slack"]'), wait('[data-conn="cancel-login"]'), click('[data-conn="cancel-login"]'),
    wait('[data-conn="join"][data-id="slack"]'), check("sign-in-cancelled"),
  ], { composioConfigured: true, pluginsConnecting: true }),
  scene("connector-uninstalled", "Uninstalling an app on the second press: it leaves the list, and the chip's count goes down with the connected list", [
    ...open, click('[data-conn="connected"]'), click('[data-conn="open"][data-id="composio:notion"]'), click('[data-conn="server-menu"][data-id="composio:notion"]'),
    click('.menu [data-conn="disconnect"]'), click('.menu [data-conn="disconnect"]'), waitGone('[data-k="cs-open:composio:notion"]'), wait(".toast"), check("apps-count"),
  ], {
    managedConnectors: [notion(), google, connector("composio:linear", { name: "Linear", description: "追蹤專案與團隊議題", enabled_tools: ["LINEAR_LIST_ISSUES"] })],
    pluginTools: { ...base.pluginTools, "composio:notion": notionTools },
  }),
];
