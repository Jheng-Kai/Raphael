import { scene, click, wait, waitGone, check, scroll, member, rightClick, settings } from "./steps.mjs";

// R-UI-44: a right click anywhere on a row opens the menu of its ⋯, at the pointer. Each scene presses the real right button,
// checks that the menu is the one a click on the ⋯ opens (it closes on the way), and presses again so that the picture shows it.
const column = { action: "member-column", collapsed: false };
const rightClicked = (target, steps = []) => [...steps, rightClick(target), wait("#app-popover"), check("context-menu"), rightClick(target), wait("#app-popover")];
const details = [member(1), { action: "open-details" }];
const keyed = [{ action: "focus", selector: '.mb-col [data-member="2"]' }, { action: "key", key: "F10", shift: true }, wait("#app-popover")];

// R-UI-56: what destroys waits in a ⋯. The first press of the item asks in its place and destroys nothing; the second does it.
const item = '#app-popover [data-confirm-item]';
const asked = more => [click(more), wait(item), check("confirm-menu-label"), click(item), check("confirm-menu-asks")];
const confirmed = more => [...asked(more), click(item), waitGone("#app-popover")];
const memoryTab = [...details, click('[data-det="gear"]'),click('[data-det="tab"][data-tab="memory"]'), wait('.mb-det [data-mem-space="own"] [data-mem="section-more"]')];
const ownTitleMore = '.mb-det [data-mem-space="own"] [data-mem="section-more"]';
const ownSummaryMore = '.mb-det [data-mem-space="own"] [data-mem="summary-more"]';
const withSummary = { memorySummary: { text: "進行中：規劃週末", updated_at_ms: 1792807200000 } };
const dataMore = '[data-act="data-menu"][data-what="dictation"]';
const usageKey = [...settings("models"), click('[data-models-tab="usage"]'), wait('[data-act="key-menu"]')];
const paired = { messaging: { connected: true, enabled: true, running: true, error: null, bot: { username: "raph_bot" }, allowed: [{ user_id: "42", name: "小晴" }], pending: [] } };
const pairedUser = [...settings("messaging"), click('[data-msg="expand"]'), wait('[data-msg="user-menu"]'), click('[data-msg="user-menu"]'), wait('#app-popover [data-pick="remove"]')];

export default [
  scene("context-menu-member", "A right click on a member's row opens the menu of its ⋯ at the pointer", rightClicked('.mb-col [data-member-item="2"]', [column])),
  scene("context-menu-conversation", "A right click on a conversation in the member's details opens its rename and delete menu", rightClicked(".mb-det .conversation-row", details)),
  scene("context-menu-routine", "A direct routine row opens its editor without another menu", [...details, click(".mb-det .mb-rt"), wait(".au-routine-dialog"), check("level-routine")]),
  scene("context-menu-connection", "A right click on a custom server's header opens the menu of its ⋯: test, edit and delete", rightClicked(".cs-dlg-head", [
    ...settings("connections"), click('[data-conn="open"][data-id="notes"]'), wait(".cs-dlg-head"),
  ])),
  scene("context-menu-cli-account", "A right click on a subscription account's card opens the menu of its ⋯", rightClicked('.cli-card:has([data-cli-menu="codex"])', [
    ...settings("models"), scroll(".cli-accounts"),
  ])),
  scene("context-menu-message", "A right click on Raphael's answer opens the menu of its ⋯", rightClicked(".ra .chat-message[data-reply]")),
  scene("context-menu-key", "Shift+F10 on a focused member row opens the menu of its ⋯ under that button", [column, ...keyed, check("context-menu-key"), ...keyed]),
  scene("context-menu-memory-title", "A right click on a memory section's title opens the menu of its ⋯, which holds 全部清除", rightClicked('.mb-det [data-mem-space="own"] .mem-head', memoryTab)),
  scene("context-menu-memory-summary", "A right click on the summary's row opens the menu of its ⋯, which holds 清除", rightClicked('.mb-det [data-mem-space="own"] .mem-summary', memoryTab), withSummary),
  scene("context-menu-data", "A right click on a row of 資料 opens the menu of its ⋯, which holds its clear", rightClicked('.data-row:has([data-what="dictation"])', settings("data"))),
  scene("context-menu-api-key", "A right click on the key's row opens the menu of its ⋯, which holds 移除金鑰", rightClicked('.row-key', usageKey)),
  scene("memory-clear-menu", "全部清除 waits in the title's ⋯; its first press asks once more", [...memoryTab, ...asked(ownTitleMore)]),
  scene("memory-clear-done", "The second press of 全部清除 clears this file and leaves the other alone", [...memoryTab, ...confirmed(ownTitleMore), wait('.mb-det [data-mem-space="own"] .mem-none'), check("memory-clear-done")]),
  scene("memory-summary-menu", "The summary's 清除 waits in its row's ⋯; its first press asks once more", [...memoryTab, ...asked(ownSummaryMore)], withSummary),
  scene("memory-summary-done", "The second press clears the summary and its row goes", [...memoryTab, ...confirmed(ownSummaryMore), waitGone(".mb-det .mem-summary"), check("memory-summary-done")], withSummary),
  scene("data-clear-menu", "Clearing the dictation history waits in the row's ⋯; its first press asks once more", [...settings("data"), ...asked(dataMore)]),
  scene("data-clear-undo", "The second press starts the 10 seconds of 復原 and nothing is gone yet", [...settings("data"), ...confirmed(dataMore), check("data-clear-undo")]),
  scene("usage-key-menu", "移除金鑰 waits in the key row's ⋯; its first press asks once more", [...usageKey, ...asked('[data-act="key-menu"]')]),
  scene("usage-key-removed", "The second press removes the key and the row asks for one", [...usageKey, ...confirmed('[data-act="key-menu"]'), wait("#key-input"), check("usage-key-removed")]),
  scene("messaging-user-menu", "Removing a person from Telegram waits in their row's ⋯", pairedUser, paired),
  scene("messaging-user-removed", "移除 in the ⋯ takes the person off the list", [...pairedUser, click('#app-popover [data-pick="remove"]'), waitGone('[data-msg="user-menu"]'), check("messaging-user-removed")], paired),
];
