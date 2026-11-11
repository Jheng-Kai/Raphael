import { scene, click, wait, check, focus, hover, key, member, rightClick, watchOpens, pressOpener } from "./steps.mjs";

// R-UI-124 (owner, 2026-11-11): the control that opened a menu, popover, picker, card or dialog is its toggle. Each scene opens a
// thing once from its control, then presses that same control again with the real mouse; the check finds it closed, closed for good,
// and opened exactly once (the page's own mutations are counted as they happen, so a close followed by an opening is seen).
const column = { action: "member-column", collapsed: false };
const details = [member(1), { action: "open-details" }, wait(".mb-det:not([hidden])")];
const reply = ".ra .chat-message[data-reply]";

/** Opens `thing` from `opener`, presses `opener` again, and checks. `over`: where that press lands (a scrim over the control, or the control). */
const toggle = (name, description, before, opener, opened, thing, options = {}) => scene(`opener-toggle-${name}`, description, [
  ...before,
  watchOpens(thing, { gone: options.gone ?? thing, over: options.over ?? "control", ...(options.attribute ? { attribute: options.attribute } : {}) }),
  click(opener), wait(opened), pressOpener(opener), check(`opener-toggle-${name}`),
], options.fixture);

export default [
  // A scrim dialog: the press arrives on the scrim over the sidebar and used to be handed to 「連接應用程式」, which opened it again.
  toggle("connect-apps", "With 「連接應用程式」 open, a press on the sidebar's 「連接應用程式」 behind the scrim closes it and does not open it again", [],
    "#nav .sidebar-apps", '.modal-scrim[data-standalone="connections"] .modal-body .cs', ":root[data-window-modal]", { over: "scrim", attribute: "data-window-modal" }),
  toggle("settings", "With Settings open, a press on the account button behind the scrim closes it and does not open it again", [],
    '#nav [data-go="settings"]', ".modal-scrim [data-pane]", ":root[data-window-modal]", { over: "scrim", attribute: "data-window-modal" }),
  // A page's card is no opener of this kind any more: its page stands in the thread's place with no scrim over the card (R-PAGE-03).
  // Menus and popovers beside their opener.
  toggle("add-menu", "The sidebar's + opens its menu and a second press on the + closes it", [column],
    '.mb-col [data-col="add"]', "#app-popover", "#app-popover"),
  // 新增成員 is a dialog over the dimmed window: the press lands on the scrim over the + and closes it (the dialog registers with the shared dismissal).
  scene("opener-toggle-member-maker", "With 新增成員 open, a press on the sidebar's + behind the scrim closes it and does not open the menu or the dialog again",
    [column, watchOpens(".cr-dialog", { gone: ".cr-dialog", over: "scrim" }), click('.mb-col [data-col="add"]'), click('#app-popover [data-pick="member"]'), wait(".cr-dialog"), pressOpener('.mb-col [data-col="add"]'), check("opener-toggle-member-maker")]),
  toggle("search-card", "The sidebar's search button opens the search card and a second press closes it", [column],
    '.mb-col [data-col="search"]', ".side-search", ".side-search"),
  toggle("model-menu", "The composer's model button opens its card and a second press closes it", [member(1)],
    ".composer .cmp-model .mp-trigger", ".cb-menu .cb-now", ".cb-menu"),
  toggle("permission-menu", "The composer's permission button opens its card and a second press closes it", [member(1)],
    ".composer .cmp-mode", ".cb-menu .cb-modes", ".cb-menu"),
  toggle("slime-picker", "The face button in a member's details opens the slime picker and a second press closes it", details,
    '.mb-panel-identity [data-det="avatar"]', ".mb-avpop", ".mb-avpop"),
  toggle("message-menu", "A reply's ⋯ opens its menu and a second press on the ⋯ closes it", [hover(reply)],
    `${reply} [data-act="more-message"]`, "#app-popover", "#app-popover"),
  toggle("reaction-bar", "A reply's react button opens the five reactions and a second press on it closes them", [hover(reply)],
    `${reply} [data-act="react-message"]`, "#app-popover.reaction-bar", "#app-popover"),
  // The picker was opened from inside the bar, whose own button is the opener once the bar has gone.
  scene("opener-toggle-emoji-picker", "A reply's react button opens the bar, the bar's + opens every emoji, and a press on the react button closes the picker",
    [hover(reply), watchOpens("#app-popover.emoji-picker", { gone: "#app-popover" }), click(`${reply} [data-act="react-message"]`), click('#app-popover [data-quick="+"]'),
      wait("#app-popover.emoji-picker .emoji-cell"), pressOpener(`${reply} [data-act="react-message"]`), check("opener-toggle-emoji-picker")]),
  // The header's button is no layer: its panel closes itself, and a drawer's scrim must not hand the press back to it.
  scene("opener-toggle-details", "The header's conversation button opens the details and a second press on it closes them",
    [member(1), { action: "close-details-if-open" }, watchOpens(".mb-det:not([hidden])", { gone: ".mb-det:not([hidden])" }), click(".conversation-trigger"),
      wait(".mb-det:not([hidden])"), pressOpener(".conversation-trigger"), check("opener-toggle-details")]),
  // A right click opens a row's menu; the row is not its opener, so a left press on that row closes the menu and opens the row (R-UI-121).
  scene("opener-toggle-row-menu", "With a row's menu open from a right click, a left press on the same row closes it and opens that row",
    [column, watchOpens("#app-popover"), rightClick('.mb-col [data-member-item="2"]'), wait("#app-popover"), click('.mb-col [data-member="2"]'), check("opener-toggle-row-menu")]),
  scene("opener-toggle-row-again", "A second right click on the same row closes its menu and opens it again where the pointer is",
    [column, watchOpens("#app-popover"), rightClick('.mb-col [data-member-item="2"]'), wait("#app-popover"), rightClick('.mb-col [data-member-item="2"]'), check("opener-toggle-row-again")]),
  // Enter and Space on the opener while its menu is open (focus put there, as a screen reader or Shift+Tab would): close, and stay closed.
  scene("opener-toggle-keyboard", "Enter and Space on a + that has its menu open close the menu and do not open it again",
    [column, watchOpens("#app-popover"), focus('.mb-col [data-col="add"]'), key("Enter"), wait("#app-popover"), focus('.mb-col [data-col="add"]'), key("Enter"),
      key("Space"), wait("#app-popover"), focus('.mb-col [data-col="add"]'), key("Space"), check("opener-toggle-keyboard")]),
];
