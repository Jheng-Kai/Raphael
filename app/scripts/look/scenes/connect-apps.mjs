import { scene, click, wait, check, type, scroll, settings } from "./steps.mjs";

// 連結應用程式 as Grok Bot's Connect Apps (R-APPS-01, R-APPS-02): one view, a chip of the connected apps, a search, a row of chips, the apps
// in sections; an app's page in the dialog's place. The colour rule for everything that floats (R-FLOAT-01) is checked in the pictures of
// its consumers (`float-surface`, appended in index.mjs) and here on the dialog and its menu.
const open = [...settings("connections"), wait(".cs-card")];
const linked = [...settings("connections"), click('[data-conn="connected"]'), wait(".cs-linked")];

export default [
  scene("connect-apps", "One view: the title and the chip of the connected apps, the search, the chips of the categories, then 為你推薦 and a section for each category of six apps", [...open, check("connect-apps-view"), check("float-surface")]),
  scene("connect-apps-scrolled", "The list scrolls under the title, the search and the chips, which stay put", [...open, scroll(".cs-sec:last-of-type .cs-card:last-child"), check("connect-apps-scrolled")]),
  scene("connect-apps-category", "A chip lists all the apps of its category in one list, the chosen chip a light fill with dark words", [...open, click('[data-conn="store-group"][data-id="productivity"]'), wait(".cs-card"), check("connect-apps-category")]),
  scene("connect-apps-more", "更多 opens a menu of the categories that are not in the row, on the floating surface", [...open, click('[data-k="conn-more"]'), wait("#app-popover"), check("connect-apps-more"), check("float-surface")]),
  scene("connect-apps-search", "A search over the whole catalog replaces the sections with its results", [...open, type("#conn-search", "git"), wait(".cs-card"), check("connect-apps-search")]),
  scene("connect-apps-connected", "The chip opens the list of the connected apps in the same dialog, behind a back chevron", [...linked, check("connect-apps-connected")]),
  scene("connect-app-oauth", "An app that signs in with OAuth: its page has the mark on a tile, the name, a white 連結 and a card of information", [...open, click('[data-conn="open-store"][data-id="gmail"]'), wait(".cs-page"), check("connect-app-oauth")]),
  scene("connect-app-key", "An app that asks for an API key: its page says how it signs in, once, and 連結 opens the form for the key", [...open, click('[data-conn="open-store"][data-id="acme-ledger"]'), wait(".cs-page .cs-needs"), check("connect-app-key")]),
  scene("connect-app-connected", "A connected app's page shows its connected state, its switch and its ⋯ in the place of 連結, and its tools in a card", [...linked, click('[data-conn="open"][data-id="composio:notion"]'), wait(".cs-page .cs-tools"), check("connect-app-connected")]),
];
