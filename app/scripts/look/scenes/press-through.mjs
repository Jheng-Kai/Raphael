import { scene, click, wait, check, member, rightClick } from "./steps.mjs";

// R-UI-121 (owner, 2026-11-11): a press outside what is open closes it and is delivered to what was pressed, in the same press.
// Each scene presses once, with the real mouse, on a control that is not part of what is open; the check then finds both halves done.
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
  scene("press-through-delete-dialog", "With the delete question open over the window, one press on another member in the sidebar behind its scrim abandons the question and opens that member", [
    column, click('.mb-col [data-member-more="2"]'), click('#app-popover [data-pick="delete"]'), wait(".mb-dialog"),
    click('.mb-col [data-member="1"]'), check("press-through-delete-dialog")]),
  scene("press-through-model-menu", "With the composer's model menu open, one press on the header's conversation button closes it and opens the details", [
    // From 1440 px wide the details stand open by default, and the header button then closes them; the press is meant to open them.
    member(1), { action: "close-details-if-open" }, click(".composer .cmp-model .mp-trigger"), wait(".cb-menu .cb-now"), click(".conversation-trigger"), check("press-through-model-menu")]),
];
