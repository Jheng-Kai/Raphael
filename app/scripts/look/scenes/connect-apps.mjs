import { scene, click, wait, check, type, scroll, settings, hover, focus, key, pressAt } from "./steps.mjs";

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
const pressRows = [
  pressAt(`${NOTION} .ds`, 0.5, 0.5, ".cs-page .cs-head"), check("connect-app-from-row"), ...backToList,
  pressAt(`${NOTION} .cs-tile`, 0.5, 0.5, ".cs-page .cs-head"), ...backToList,
  pressAt(`${NOTION} .nm`, 0.5, 0.5, ".cs-page .cs-head"), ...backToList,
  pressAt(NOTION, 0.8, 0.5, ".cs-page .cs-head"), ...backToList,
  pressAt(NOTION, 0.5, 0.97, ".cs-page .cs-head"), ...backToList,
  focus(`${NOTION} .cs-main`), key("Enter"), wait(".cs-page .cs-head"), check("connect-app-from-row"), ...backToList,
];
const connectedRowScenes = [
  scene("connect-apps-connected-rows", "Every part of a connected row but its switch opens the app's page; the switch only turns the app off and on; a row under the pointer has the hover fill", [
    ...linked, ...pressRows,
    click(`${NOTION} [role="switch"]`), click(`${NOTION} [role="switch"]`), hover(".cs-linked:nth-child(2) .cs-main"), check("connected-rows"),
  ]),
  scene("connect-app-from-row", "The app's page opened from a row of the connected list is the page the main view's row opens, with the larger back chevron on the ✕'s line", [
    ...linked, pressAt(`${NOTION} .ds`, 0.5, 0.5, ".cs-page .cs-head"), check("connect-app-from-row"), check("connect-back"),
  ]),
];

export default [
  scene("connect-apps", "One view: the title and the chip of the connected apps, the search, the chips of the categories, then 為你推薦 and a section for each category of six apps", [...open, check("connect-apps-view"), check("float-surface")]),
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
];
