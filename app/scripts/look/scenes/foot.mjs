import { scene, click, hover, check, wait, waitGone, key, focus, accountMenu, drag, wide } from "./steps.mjs";

// The app opens on Raphael's conversation, and the sidebar's foot is Grok Bot's (owner, 2026-11-12 evening, R-SIDE-01): the owner's face and the
// 連結應用程式 pill on one row. The face opens the account menu (用量 with its submenu, 聽寫, 行事曆, 設定); on the rail the pill is an icon
// button and the face stands under it. Every scene runs at all three widths: the list at 1120 and 1920, the rail at 720.
const marks = { appsInventory: { state: "complete", count: 3, apps: ["GitHub", "Notion", "Slack"].map((name, i) => ({ id: `sample-${i}`, name, connected: true, enabled: true, state: "ready", tools: 1, last_used_at: 3 - i })) } };
const tight = { allowanceTight: true };
/** The menu, once the subscription reading has given the 用量 row its chevron. */
const menuWithNumber = [accountMenu(), wait('#app-popover.account-menu [data-account="usage"]')];

export default [
  scene("start-conversation", "The app opens on Raphael's conversation, the top row of the sidebar selected, with no Home and no page button in the foot",
    [wait(".page-agent:not([hidden]) .conversation-trigger"), wait('.mb-chief[aria-current="true"]'), check("foot-rest"), check("sidebar-shell"), check("sidebar-selection")]),
  // At start-up the first view (the roster and the rooms) is answered before the model, app and settings reads start, and those never overlap (R-START-02).
  scene("start-startup-order", "At start-up the roster and the rooms are answered before the model, app and settings reads start, and those never overlap",
    [wait(".page-agent:not([hidden]) .conversation-trigger"), { action: "startup-order", firstView: ["members.list", "rooms.list"], heavy: ["models.catalog", "brains.cli"] }], { coreLatencyMs: 60 }),
  scene("foot-rest", "The foot is one row as Grok Bot's: the owner's round face and the Connections pill (36px, fully round, on its own surface), with no tooltip; on the rail the icon and the face in a column",
    [check("foot-rest"), check("sidebar-shell")], marks),
  scene("foot-account-menu", "Pressing the face opens the account menu above it (to its right on the rail): 用量 with a chevron and no number, 聽寫, 行事曆, a hairline, 設定",
    [...menuWithNumber, check("foot-account-menu")], tight),
  scene("foot-usage-submenu", "用量 opens a submenu at its right edge: a block for each of the three subscriptions (its window, its number, when it resets), a hairline and 管理用量",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), check("foot-account-menu"), check("foot-usage-submenu")], tight),
  scene("foot-usage-two", "With Claude and Codex connected, as the owner has them, the submenu lists both",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), check("foot-account-menu"), check("foot-usage-submenu")], { allowanceTwo: true }),
  scene("foot-usage-default", "With the shared fixture's allowances the submenu lists every subscription",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), check("foot-usage-submenu")], { allowanceTight: false }),
  scene("foot-usage-none", "With no subscription window known 用量 has no number and no chevron, and opens the settings' usage itself",
    [accountMenu(), wait("#app-popover.account-menu"), check("foot-account-menu"), check("foot-usage-none")], { usageEmpty: true }),
  scene("foot-usage-manage", "管理用量 opens Settings at its usage section",
    [...menuWithNumber, click('#app-popover [data-account="usage"]'), wait("#app-submenu"), click('#app-submenu [data-account="manage"]'), wait('.modal-scrim [data-models-tab="usage"][aria-selected="true"]'), waitGone("#app-popover")], tight),
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
