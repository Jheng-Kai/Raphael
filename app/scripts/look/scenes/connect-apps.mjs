import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scene, click, wait, check, type, scroll, settings, hover, focus, key, pressAt, pressThrough } from "./steps.mjs";

// 連結應用程式 as Grok Bot's Connect Apps (R-APPS-01, R-APPS-02): one view, a chip of the connected apps, a search, a row of chips, the apps
// in sections; an app's page in the dialog's place. The colour rule for everything that floats (R-FLOAT-01) is checked in the pictures of
// its consumers (`float-surface`, appended in index.mjs) and here on the dialog and its menu.
const open = [...settings("connections"), wait(".cs-card")];
const linked = [...settings("connections"), click('[data-conn="connected"]'), wait(".cs-linked")];

// Every one-colour and coloured mark of `service-icons.ts` (SERVICE_ICONS), as a row of the apps on its tile (R-APPS-01).
const MARKS = ["notion", "github", "googledrive", "gmail", "googlecalendar", "linear", "figma", "spotify", "discord", "slack", "todoist", "obsidian", "atlassian", "cloudflare",
  "sentry", "stripe", "n8n", "zapier", "paypal", "webflow", "wix", "netlify", "neon", "prisma", "airtable", "calendly", "posthog", "postman", "sanity", "bitly", "telegram",
  "openrouter", "brave", "searxng"];

// A row of the connected list opens the app's page when it is pressed anywhere but on its switch (owner, 2026-11-14): the description, the
// mark, the name, the empty part of the row and the keyboard each open it, the switch only turns the app on and off, and a row under the
// pointer says it can be pressed. Every press is a real mouse press at a point of the row.
const NOTION = '.cs-linked[data-id="composio:notion"]';
const BACK = '[data-conn="back"]';
const backToList = [click(BACK), wait(".cs-linked")];
const backToMain = [click(BACK), wait(".cs-card")];
const pressRows = [
  pressAt(`${NOTION} .ds`, 0.5, 0.5, ".cs-page .cs-head"), check("connect-app-from-row"), ...backToList,
  pressAt(`${NOTION} .cs-tile`, 0.5, 0.5, ".cs-page .cs-head"), ...backToList,
  pressAt(`${NOTION} .nm`, 0.5, 0.5, ".cs-page .cs-head"), ...backToList,
  pressAt(NOTION, 0.8, 0.5, ".cs-page .cs-head"), ...backToList,
  pressAt(NOTION, 0.5, 0.97, ".cs-page .cs-head"), ...backToList,
  focus(`${NOTION} .cs-main`), key("Enter"), wait(".cs-page .cs-head"), check("connect-app-from-row"), ...backToList,
];

// The owner's own list (his picture, 2026-11-14): Composio's Gmail, Google Calendar and Google Drive, a server of his own named Mobbin MCP,
// Notion, Hugging Face and GitHub from the built-in catalog, every one on and under no heading. Every part of every row is pressed, with a real
// mouse press, on the way he goes: the sidebar's 連結應用程式, the chip, the list (R-APPS-01).
const base = JSON.parse(readFileSync(resolve(import.meta.dirname, "../fixture.json"), "utf8"));
const composio = (slug, name, description, tools) => ({ id: `composio:${slug}`, kind: "composio", name, description, logo: "", status: "ACTIVE", enabled: true,
  enabled_tools: tools.map((tool) => tool.slug), disabled_tools: [], accounts: [{ id: `ca_${slug}`, status: "ACTIVE" }] });
const tool = (slug, name, kind) => ({ slug, name, description: name, kind, enabled: true });
const builtin = (id, name, over) => ({ ...structuredClone(base.servers[1]), id, name, enabled: true, status: "ready", error: null, auth: "oauth", catalog_id: id,
  transport: "http", url: `https://${id}.example.test/mcp`, headers: [], ...over });
const GMAIL = [tool("GMAIL_FETCH_EMAILS", "搜尋郵件", "read"), tool("GMAIL_CREATE_DRAFT", "撰寫草稿", "write")];
const CALENDAR = [tool("GOOGLECALENDAR_EVENTS_LIST", "列出行程", "read"), tool("GOOGLECALENDAR_CREATE_EVENT", "建立行程", "write")];
const DRIVE = [tool("GOOGLEDRIVE_FIND_FILE", "查找檔案", "read"), tool("GOOGLEDRIVE_CREATE_FILE", "建立檔案", "write")];
const OWNER_LIST = {
  managedConnectors: [
    composio("gmail", "Gmail", "搜尋郵件、撰寫草稿與回覆", GMAIL),
    composio("googlecalendar", "Google Calendar", "查看與安排行程", CALENDAR),
    composio("googledrive", "Google Drive", "查找檔案、整理共用文件", DRIVE),
  ],
  servers: [
    builtin("mobbin", "Mobbin MCP", { catalog_id: null, auth: "none" }),
    builtin("notion", "Notion"),
    builtin("huggingface", "Hugging Face", { auth: "none" }),
    builtin("github", "GitHub", { auth: "device" }),
  ],
  // The core marks a service of the catalog that is added (`server_id`): the main view says 「✓ 已連結」 on its row.
  services: [...base.services.map((s) => (["notion", "github"].includes(s.id) ? { ...s, server_id: s.id } : s)),
    { ...base.services[0], id: "huggingface", name: "Hugging Face", publisher: "Hugging Face", url: "https://huggingface.co/mcp", icon: "huggingface", auth: "none", server_id: "huggingface",
    summary: { "zh-TW": "搜尋 Hugging Face 的模型、資料集與論文", en: "Search Hugging Face models, datasets and papers", ja: "Hugging Face のモデル・データセット・論文を検索" } }],
  pluginTools: { ...base.pluginTools, "composio:gmail": GMAIL, "composio:googlecalendar": CALENDAR, "composio:googledrive": DRIVE },
};
const OWNER_ROWS = [["composio:gmail", "Gmail"], ["mobbin", "Mobbin MCP"], ["notion", "Notion"], ["huggingface", "Hugging Face"], ["composio:googlecalendar", "Google Calendar"],
  ["composio:googledrive", "Google Drive"], ["github", "GitHub"]];
const rowOf = (id) => `.cs-linked[data-id="${id}"]`;
const PAGE = ".cs-page .cs-head";
// Where a finger can land on a row: the line under the name, the name, the mark, the empty end of the row before the switch, and its top edge.
const partsOf = (id, name) => [
  pressAt(`${rowOf(id)} .ds`, 0.3, 0.5, PAGE, name), pressAt(`${rowOf(id)} .nm`, 0.3, 0.5, PAGE, name), pressAt(`${rowOf(id)} .cs-tile`, 0.5, 0.5, PAGE, name),
  pressAt(`${rowOf(id)} .cs-main`, 0.98, 0.5, PAGE, name), pressAt(rowOf(id), 0.5, 0.04, PAGE, name),
];
const everyPart = OWNER_ROWS.flatMap(([id, name]) => partsOf(id, name).flatMap((press) => [press, ...backToList]));
const ownerList = [...linked, check("owner-list")];
const refreshed = { action: "emit", events: [{ type: "ConnectionsChanged" }], wait: 400 };
const ownerRowScenes = [
  scene("connected-owner-rows", "His list of seven, no heading: a real press on the line, the name, the mark, the empty end and the top edge of every row opens that app's page", [
    ...ownerList, ...everyPart, check("owner-list"),
  ], OWNER_LIST),
  scene("connected-owner-rows-loaded", "The same presses after the tools of every app were read once, and again after the core says the list changed", [
    ...ownerList,
    ...OWNER_ROWS.flatMap(([id, name]) => [pressAt(`${rowOf(id)} .nm`, 0.3, 0.5, PAGE, name), wait(".cs-page .cs-tools"), ...backToList]),
    refreshed, ...everyPart, check("owner-list"),
  ], OWNER_LIST),
  scene("connected-owner-rows-late", "The tools of an app are still on the way when the owner steps back and presses the next row, whichever way they end", [
    ...ownerList,
    ...OWNER_ROWS.flatMap(([id, name]) => [pressAt(`${rowOf(id)} .ds`, 0.3, 0.5, PAGE, name), ...backToList]),
    ...everyPart, check("owner-list"),
  ], { ...OWNER_LIST, toolsLate: 900 }),
  scene("connected-owner-rows-straddled", "A press that began on a row is not lost when the core says the connections changed before the button comes up (a tool call of any member says so), in the list and in the main view", [
    ...open, pressThrough(".cs-card .cs-main", 0.3, 0.5, [{ type: "ConnectionsChanged" }], PAGE), ...backToMain,
    click('[data-conn="connected"]'), wait(".cs-linked"), check("owner-list"),
    ...OWNER_ROWS.flatMap(([id, name]) => [pressThrough(`${rowOf(id)} .nm`, 0.3, 0.5, [{ type: "ConnectionsChanged" }], PAGE, name), ...backToList]),
    check("owner-list"),
  ], OWNER_LIST),
  scene("connected-owner-state-press", "「✓ 已連結」 on a row of the one view is pressable: a real press on it opens that app's page, as the rest of its row does", [
    ...open, type("#conn-search", "notion"), wait(".cs-card .cs-state"), hover(".cs-card .cs-state"), check("app-state-press"),
    pressAt(".cs-card .cs-state", 0.5, 0.5, ".cs-page .cs-head", "Notion"), check("connect-app-from-row"), check("connect-back"),
  ], OWNER_LIST),
  scene("connected-owner-rows-failed", "The tools of every app fail to load: the page still opens from each part of the row and steps back to the list", [
    ...ownerList, ...OWNER_ROWS.slice(0, 3).flatMap(([id, name]) => [pressAt(`${rowOf(id)} .nm`, 0.3, 0.5, PAGE, name), wait(".cs-page [data-conn=\"refresh\"]"), ...backToList]),
    ...everyPart, check("owner-list"),
  ], { ...OWNER_LIST, toolsFail: true }),
];
const connectedRowScenes = [
  scene("connect-apps-connected-rows", "Every part of a connected row but its switch opens the app's page; the switch only turns the app off and on; a row under the pointer has the hover fill", [
    ...linked, ...pressRows,
    click(`${NOTION} [role="switch"]`), click(`${NOTION} [role="switch"]`), hover(".cs-linked:nth-child(2) .cs-main"), check("connected-rows"),
  ]),
  scene("connect-apps-back-title", "The connected list's chevron and title are one button under the pointer (owner, 2026-11-14)", [...linked, hover(".cs-back-title"), check("connected-back-title")]),
  scene("connect-apps-back-title-press", "A press on the connected list's title goes back to the one view", [...linked, pressAt(".cs-back-title span", 0.5, 0.5, ".cs-card")]),
  scene("connect-app-from-row", "The app's page opened from a row of the connected list is the page the main view's row opens, with the larger back chevron on the ✕'s line", [
    ...linked, pressAt(`${NOTION} .ds`, 0.5, 0.5, ".cs-page .cs-head"), check("connect-app-from-row"), check("connect-back"),
  ]),
];

export default [
  scene("connect-apps", "One view: the title and the chip of the connected apps, the search, the chips of the categories, then 為你推薦 and a section for each category of six apps", [...open, check("connect-apps-view"), check("float-surface")]),
  scene("connect-apps-connected-hover", "A connected app's row under the pointer is one button: its hover fill runs under 「✓ 已連結」 (owner, 2026-11-14)", [...open, hover(".cs-card .cs-main:has(.cs-state)"), check("connect-apps-view")]),
  scene("connect-apps-row-hover", "A row of the main view under the pointer has the pointer and the same hover fill as a connected row, clear of its mark, name and 連結", [...open, hover(".cs-card .cs-main"), check("app-row-hover")]),
  scene("connect-apps-scrolled","The list scrolls under the title, the search and the chips, which stay put", [...open, scroll(".cs-sec:last-of-type .cs-card:last-child"), check("connect-apps-scrolled")]),
  scene("connect-apps-category", "A chip lists all the apps of its category in one list, the chosen chip a light fill with dark words", [...open, click('[data-conn="store-group"][data-id="productivity"]'), wait(".cs-card"), check("connect-apps-category")]),
  scene("connect-apps-more", "更多 opens a menu of the categories that are not in the row, on the floating surface", [...open, click('[data-k="conn-more"]'), wait("#app-popover"), check("connect-apps-more"), check("float-surface")]),
  scene("connect-apps-search", "A search over the whole catalog replaces the sections with its results", [...open, type("#conn-search", "git"), wait(".cs-card"), check("connect-apps-search")]),
  scene("connect-apps-connected", "The chip opens the list of the connected apps in the same dialog, behind a back chevron", [...linked, check("connect-apps-connected"), check("connect-back")]),
  scene("connect-app-oauth", "An app that signs in with OAuth: its page has the mark on a tile, the name, a white 連結 and a card of information", [...open, click('[data-conn="open-store"][data-id="gmail"]'), wait(".cs-page"), check("connect-app-oauth"), check("connect-back")]),
  scene("connect-app-key", "An app that asks for an API key: its page says how it signs in, once, and 連結 opens the form for the key", [...open, click('[data-conn="open-store"][data-id="acme-ledger"]'), wait(".cs-page .cs-needs"), check("connect-app-key"), check("connect-back")]),
  scene("connect-app-connected", "A connected app's page shows its connected state, its switch and its ⋯ in the place of 連結, and its tools in a card", [...linked, click('[data-conn="open"][data-id="composio:notion"]'), wait(".cs-page .cs-tools"), check("connect-app-connected"), check("connect-back")]),
  scene("connect-icons", "Every mark of the set stands on its white tile in its owner's colour: Spotify green, Discord blue, Jira blue, the near-black ones near-black", [
    ...open, type("#conn-search", "icon-mark"), wait(".cs-card"), scroll(".cs-card:last-child"), scroll(".cs-card:last-child"), check("icon-colours"),
  ], { iconMarks: MARKS }),
  ...connectedRowScenes,
  ...ownerRowScenes,
];
