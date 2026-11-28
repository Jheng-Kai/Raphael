import { scene, click, hover, check, wait, waitGone, key, focus, accountMenu, drag, wide } from "./steps.mjs";

// The app opens on Raphael's conversation, and the sidebar's foot is one row (R-SIDE-01): the owner's face and the
// 連結應用程式 pill on one row. The face opens the account menu (用量 with its submenu, 聽寫, 行事曆, 設定); on the rail the pill is an icon
// button and the face stands under it. Every scene runs at all three widths: the list at 1120 and 1920, the rail at 720.
const marks = { appsInventory: { state: "complete", count: 3, apps: ["GitHub", "Notion", "Slack"].map((name, i) => ({ id: `sample-${i}`, name, connected: true, enabled: true, state: "ready", tools: 1, last_used_at: 3 - i })) } };
/** The apps connected, the one named last the most recently used (the pill lists them in that order). */
const pillApps = (...names) => ({ appsInventory: { state: "complete", count: names.length, apps: names.map((name, i) => ({ id: `sample-${i}`, name, connected: true, enabled: true, state: "ready", tools: 1, last_used_at: i + 1 })) } });
const tight = { allowanceTight: true };
/** The menu, once the subscription reading has given the 用量 row its chevron. */
const menuWithNumber = [accountMenu(), wait('#app-popover.account-menu [data-account="usage"]')];

export default [
  { ...scene("start-newer-data", "A database from a newer Raphael offers the update from the startup screen",
    [check("start-newer-data"), click("[data-startup-update]"), wait(".startup-update-result:not([hidden])"), check("start-newer-data-current")],
    { newerDatabase: true }), ready: ".startup-failed .missing-note" },
  scene("start-conversation", "The app opens on the chief of staff's conversation, the top row of the sidebar selected, with no Home and no page button in the foot",
    [wait(".page-agent:not([hidden]) .conversation-trigger"), wait('.mb-chief[aria-current="true"]'), check("foot-rest"), check("sidebar-shell"), check("sidebar-selection")], { start: "app" }),
  // At start-up the first view (the roster and the rooms) is answered before the model, app and settings reads start, and those never overlap (R-START-02).
  scene("start-startup-order", "At start-up the roster and the rooms are answered before the model, app and settings reads start, and those never overlap",
    [wait(".page-agent:not([hidden]) .conversation-trigger"), { action: "startup-order", firstView: ["members.list", "rooms.list"], heavy: ["models.catalog", "brains.cli"] }], { coreLatencyMs: 60 }),
  scene("foot-rest", "The foot is one row: the owner's round face and the Connections pill (36px, fully round, on its own surface), with no tooltip; on the rail the icon and the face in a column",
    [check("foot-rest"), check("sidebar-shell")], marks),
  // The pill always shows three marks: the connected apps' own first, the starters that are not connected filling up the rest.
  scene("foot-starter-apps", "With no app connected yet the pill shows Gmail, Notion and Google Calendar beside its words",
    [check("foot-pill-marks-gmail,notion,googlecalendar"), check("sidebar-shell")], pillApps()),
  scene("foot-apps-one", "With Slack connected the first mark is Slack's own and the pill keeps Gmail and Notion after it",
    [check("foot-pill-marks-slack,gmail,notion"), check("sidebar-shell")], pillApps("Slack")),
  scene("foot-apps-one-starter", "With Notion, itself a starter, connected, its mark stands once at the front and Gmail and Google Calendar follow",
    [check("foot-pill-marks-notion,gmail,googlecalendar"), check("sidebar-shell")], pillApps("Notion")),
  scene("foot-apps-two", "With two apps connected the most recently used comes first and one starter fills the third",
    [check("foot-pill-marks-github,slack,gmail"), check("sidebar-shell")], pillApps("Slack", "GitHub")),
  scene("foot-apps-three", "With three apps connected all three marks are the owner's own, the most recently used first, and no starter stays",
    [check("foot-pill-marks-linear,github,slack"), check("sidebar-shell")], pillApps("Slack", "GitHub", "Linear")),
  scene("foot-account-menu", "Pressing the face opens the account menu above it (to its right on the rail): 用量 with a chevron and no number, 聽寫, 行事曆, a hairline, 設定",
    [...menuWithNumber, check("foot-account-menu")], tight),
  scene("foot-usage-submenu", "用量 opens a submenu at its right edge: a block for each of the three subscriptions and OpenRouter (its window, its number, when it resets), a hairline and 管理用量",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), check("foot-account-menu"), check("foot-usage-submenu")], tight),
  scene("foot-usage-credits", "Codex's spent five-hour window with credits left says 改用點數 and the balance, never 額度已用完",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), check("foot-usage-submenu"), check("usage-credits-menu")], { allowanceCredits: true }),
  scene("foot-usage-two", "With Claude and Codex connected, as the owner has them, the submenu lists both",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), check("foot-account-menu"), check("foot-usage-submenu")], { allowanceTwo: true }),
  scene("foot-usage-owner", "The owner's own mix (2026-11-14): Codex live at 65% used, Claude whose reported window has reset (已重置, no stale number), the ChatGPT sign-in (無法讀取) and OpenRouter's own spend: one block each, in a stable order",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), check("foot-account-menu"), check("foot-usage-owner")], { usageOwner: true }),
  scene("foot-usage-default", "With the shared fixture's allowances the submenu lists every subscription",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), check("foot-usage-submenu")], { allowanceTight: false }),
  scene("foot-usage-none", "With no subscription window known 用量 has no number and no chevron, and opens the settings' usage itself",
    [accountMenu(), wait("#app-popover.account-menu"), check("foot-account-menu"), check("foot-usage-none")], { usageEmpty: true }),
  scene("foot-usage-manage", "管理用量 opens Settings at its usage section",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), click('#app-submenu [data-account="manage"]'), wait('.modal-scrim [data-pane="usage"][aria-current="page"]'), wait('.modal-scrim [data-usage-tab="overview"][aria-selected="true"]'), waitGone("#app-popover")], tight),
  scene("foot-account-keys", "The face opens the menu from the keyboard, the arrows move through its rows, Escape closes it and returns the focus to the face",
    [focus("#nav .sidebar-account"), key("Enter"), wait("#app-popover.account-menu"), check("foot-account-focus-0"), key("ArrowDown"), check("foot-account-focus-1"), key("ArrowDown"), key("ArrowDown"), check("foot-account-focus-3"),
      key("ArrowDown"), check("foot-account-focus-0"), key("Escape"), waitGone("#app-popover"), check("foot-account-keys")], tight),
  scene("foot-usage-keys", "ArrowRight on 用量 opens its submenu with the focus on 管理用量, and Escape closes the submenu alone",
    [focus("#nav .sidebar-account"), key("Enter"), wait('#app-popover [data-account="usage"]'), key("ArrowRight"), wait("#app-submenu"), check("foot-account-focus-manage"), key("Escape"), waitGone("#app-submenu"), check("foot-account-focus-0"), key("Escape"), waitGone("#app-popover"), check("foot-account-keys")], tight),
  scene("foot-account-outside", "A press anywhere outside the menu, inside the conversation too, closes it with its submenu",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), click(".mb-chat:not([hidden]) .thread .chat-message"), waitGone("#app-popover"), check("foot-account-outside")], tight),
  scene("foot-account-dictation", "聽寫 opens the dictation page", [accountMenu("dictation"), wait(".page-dictation:not([hidden])"), check("sidebar-selection"), check("foot-rest")]),
  scene("foot-account-calendar", "行事曆 opens the calendar on today", [accountMenu("calendar"), wait(".au-page:not([hidden]) .au-day-col"), check("calendar-shell"), check("foot-rest")]),
  scene("foot-account-settings", "設定 opens Settings", [accountMenu("settings"), wait(".modal-scrim [data-pane]"), check("settings-shell")]),
  // With motion allowed (the look runs with reduced motion unless a scene says `motion`).
  { ...scene("foot-pill-hover", "Over the pill the connected apps' marks fan out like a hand of cards (3px, 8deg, lift 1.5px, 1.1 in 180ms, out 280ms); the values are named custom properties",
    [check("foot-pill-still"), hover("#nav .sidebar-apps"), { action: "settle-motion" }, check("foot-pill-hover")], marks), motion: true },
  scene("foot-pill-reduced", "Under reduced motion the pill's marks do not move under the pointer",
    [hover("#nav .sidebar-apps"), { action: "settle-motion" }, check("foot-pill-reduced")], marks),
  scene("foot-pill-narrow", "A list dragged to its narrowest keeps the pill's words whole on one line; the marks drop first",
    [drag(".side-edge", -108, { wide: true }), wide(check("sidebar-air")), check("foot-rest")], marks),
];
