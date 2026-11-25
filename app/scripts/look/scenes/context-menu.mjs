import { scene, click, wait, waitGone, check, scroll, member, rightClick, settings } from "./steps.mjs";

// R-UI-44: a right click anywhere on a row opens the menu of its ⋯, at the pointer. Each scene presses the real right button,
// checks that the menu is the one a click on the ⋯ opens (it closes on the way), and presses again so that the picture shows it.
const column = { action: "member-column", collapsed: false };
const rightClicked = (target, steps = []) => [...steps, rightClick(target), wait("#app-popover"), check("context-menu"), rightClick(target), wait("#app-popover")];
const details = [member(1), { action: "open-details" }];
const keyed = [{ action: "focus", selector: '.mb-col [data-member="2"]' }, { action: "key", key: "F10", shift: true }, wait("#app-popover")];

// R-UI-56: what destroys waits in a ⋯. Its press closes the menu and asks in the red dialog and destroys nothing; only the dialog's red button does it.
const item = '#app-popover [data-pick]';
const asked = more => [click(more), wait(item), check("confirm-menu-label"), click(item), wait(".mb-delete"), check("confirm-menu-asks")];
const confirmed = more => [...asked(more), click('.mb-delete [data-dlg="delete"]'), waitGone(".mb-delete")];
const paired = { messaging: { connected: true, enabled: true, running: true, error: null, bot: { username: "raph_bot" }, allowed: [{ user_id: "42", name: "小晴" }], pending: [] } };
// Raphael's Telegram is in its panel.
const raphaelBots = [member(0), { action: "open-details" }, wait('.mb-panel-suggest [data-msg-kind="telegram"] [data-msg="expand"]')];
const pairedUser = [...raphaelBots, click('[data-msg="expand"]'), wait('[data-msg="user-menu"]'), click('[data-msg="user-menu"]'), wait('#app-popover [data-pick="remove"]')];

export default [
  scene("context-menu-member", "A right click on a member's row opens the menu of its ⋯ at the pointer", rightClicked('.mb-col [data-member-item="2"]', [column])),
  scene("context-menu-conversation", "A right click on one of Raphael's conversations in its details opens its rename and delete menu", rightClicked(".mb-det .conversation-row:has([data-conversation-more])", [member(0), { action: "open-details" }])),
  scene("context-menu-routine", "A direct routine row opens it to read without another menu", [...details, click(".mb-det .mb-rt"), wait(".rv-dialog"), check("level-routine")]),
  scene("context-menu-connection", "A right click on a custom server's header opens the menu of its ⋯: test, edit and delete", rightClicked(".cs-page .cs-head", [
    ...settings("connections"), click('[data-conn="connected"]'), click('[data-conn="open"][data-id="notes"]'), wait(".cs-page .cs-head"),
  ])),
  scene("context-menu-message", "A right click on Raphael's answer opens the menu of its ⋯", rightClicked(".ra .chat-message[data-reply]")),
  scene("context-menu-key", "Shift+F10 on a focused member row opens the menu of its ⋯ under that button", [column, ...keyed, check("context-menu-key"), ...keyed]),
  scene("messaging-paired-aligned", "A paired person's face and name start on the bot's left edge, not set in", [...raphaelBots, click('[data-msg="expand"]'), wait('[data-msg="user-menu"]'), check("messaging-paired-aligned")], paired),
  scene("messaging-user-menu", "Removing a person from Telegram waits in their row's ⋯", pairedUser, paired),
  scene("messaging-user-removed", "移除 in the ⋯ takes the person off the list", [...pairedUser, click('#app-popover [data-pick="remove"]'), waitGone('[data-msg="user-menu"]'), check("messaging-user-removed")], paired),
];
