import { scene, click, wait, check, member, rightClick, settings, wide } from "./steps.mjs";

// A page open in the conversation's place runs in a frame of another origin: a press inside it never reaches the app's own document.
const pageOpen = [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#hide" }, click(".pg-card .pg-body"), wait(".pgv-frame-box iframe")];

// R-UI-121 (owner, 2026-11-11): a press outside a menu or popover closes it and is delivered to what was pressed, in the same press; a press outside a dialog
// with a scrim only closes it and is spent (owner, 2026-11-13: 「如果點 dialog 外面就是把 dialog 關掉就好，不用可以直接點到後面的東西」).
// Each scene presses once, with the real mouse, on a control that is not part of what is open; the check then finds what the press did.
const column = { action: "member-column", collapsed: false };
const details = [member(1), { action: "open-details" }, wait(".mb-det:not([hidden])")];
const rowMenu = [column, rightClick('.mb-col [data-member-item="2"]'), wait("#app-popover")];

export default [
  scene("press-through-avatar-picker", "With the avatar picker open on a member's face, one press on another member in the sidebar closes it and opens that member", [
    ...details, click('.mb-panel-identity [data-det="avatar"]'), wait(".mb-avpop"), click('.mb-col [data-member="2"]'), check("press-through-avatar-picker")]),
  scene("press-through-row-menu", "With a sidebar row's menu open, one press on another row opens that row", [
    ...rowMenu, click('.mb-col [data-member="1"]'), check("press-through-row-menu")]),
  scene("press-through-right-click", "With a row's menu open, a right click on another row closes it and opens that row's menu", [
    ...rowMenu, rightClick('.mb-col [data-member-item="1"]'), check("press-through-right-click")]),
  // A dialog's scrim closes it and is spent: the member behind it is neither opened nor focused, and nothing was deleted.
  scene("press-through-delete-dialog", "With the delete question open over the window, one press on another member in the sidebar behind its scrim abandons the question and nothing else: that member is not opened", [
    column, click('.mb-col [data-member-more="2"]'), click('#app-popover [data-pick="delete"]'), wait(".mb-dialog"),
    click('.mb-col [data-member="1"]'), check("press-through-scrim-delete")]),
  scene("press-through-scrim-settings", "With Settings open, one press on the sidebar's search behind its scrim closes Settings and opens no search card", [
    column, ...settings("general"), wide(click('[data-col="search"]')), check("press-through-scrim-settings")]),
  scene("press-through-scrim-connect-apps", "With 連結應用程式 open, one press on the sidebar's search behind its scrim closes it and opens no search card", [
    column, ...settings("connections"), wide(click('[data-col="search"]')), check("press-through-scrim-connect-apps")]),
  scene("press-through-scrim-member-maker", "With 新增成員 open, one press on a member behind its scrim closes it, makes nobody and opens nobody", [
    column, click('[data-col="add"]'), click('#app-popover [data-pick="member"]'), wait(".cr-dialog"), click('.mb-col [data-member="1"]'), check("press-through-scrim-member-maker")]),
  scene("press-through-scrim-model-chooser", "With the model chooser open over Settings, one press on a tab of Settings behind its scrim closes only the chooser and presses no tab", [
    ...settings("models"), click('.modal-scrim [data-model-picker="answer"] .mp-trigger'), wait(".model-chooser .mc-row"), click('.modal-scrim [data-pane="general"]'), check("press-through-scrim-model-chooser")]),
  scene("press-through-model-menu", "With the composer's model menu open, one press on the header's conversation button closes it and opens the details", [
    // From 1440 px wide the details stand open by default, and the header button then closes them; the press is meant to open them.
    member(1), { action: "close-details-if-open" }, click(".composer .cmp-model .mp-trigger"), wait(".cb-menu .cb-now"), click(".conversation-trigger"), check("press-through-model-menu")]),
  scene("press-through-page-frame", "With the composer's model card open over a page in the conversation's place, one press inside the page closes the card and the page keeps the press", [
    ...pageOpen, click(".composer .cmp-model .mp-trigger"), wait(".cb-menu .cb-now"), { action: "frame-click", selector: "h1" }, check("press-through-page-frame")], { pageTurn: true, pageNews: "only" }),
];
