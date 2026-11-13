import { scene, click, hover, wait, waitGone, check, key, member, scroll, settings, rightClick } from "./steps.mjs";

const column = { action: "member-column", collapsed: false };
const open = [column, click('.mb-col [data-member-more="1"]'), wait('#app-popover [data-pick="move"]')];
const hovered = [...open, hover('#app-popover [data-pick="move"]'), wait('#app-submenu'), check("submenu-placement")];
export default [
  scene("menu-wheel-closes", "A real wheel over the page closes both menu levels", [...hovered, { action: "menu-wheel" }, check("menu-scroll-closed")]),
  scene("menu-resize-closes", "Window resizing closes both frozen menu levels", [...hovered, { action: "menu-resize" }, check("menu-scroll-closed")]),
  scene("menu-hide-control", "Hide in the sidebar's menu uses its action icon without a navigation chevron", [{ action: "member-column", collapsed: false }, click('.mb-col [data-member-more="1"]'), wait('#app-popover [data-pick="hide"]'), check("menu-hide-control")]),
  scene("menu-settings-redraw", "Settings replace their keyed control without moving its open menu", [...settings("dictation"), scroll('[data-k="retention"]'),
    click('[data-k="retention"]'), wait('.menu [data-value="7"]'), { action: "menu-settings-redraw" }, check("menu-settings-redraw")]),
  // A row's own ⋯ is never drawn (R-UI-44), so the control that a press returns the menu to is one that is: a message's.
  scene("menu-pointer-return", "A real press on a message's drawn ⋯ returns a menu a right click opened at the pointer to its own control", [rightClick('.chat-message[data-reply="true"] .message-text'),
    wait('#app-popover'), click('.chat-message[data-reply="true"] [data-act="more-message"]'), check("menu-anchor-return")]),
  scene("menu-move-hover", "Hover opens beside the row and work redraws leave both menus still", [...hovered, { action: "menu-work-storm" }, check("submenu-placement")]),
  scene("menu-move-picked", "Choosing a group moves the member and closes both menus", [...hovered, click('#app-submenu [data-value="2"]'), waitGone('#app-submenu'), check("menu-move-picked")]),
  scene("menu-move-keyboard", "Right opens, Left and Escape return to the parent row", [...open, key("ArrowDown"), key("ArrowRight"), wait('#app-submenu'),
    check("submenu-placement"), key("ArrowLeft"), waitGone('#app-submenu'), key("ArrowRight"), wait('#app-submenu'), key("Escape"), waitGone('#app-submenu'),
    key("ArrowRight"), wait('#app-submenu'), check("submenu-placement")]),
  scene("menu-move-flip", "A right-click menu beside the rail opens its long-named child on the side that has room", [column, { action: "menu-edge" },
    hover('#app-popover [data-pick="move"]'), wait('#app-submenu'), check("submenu-placement"), check("submenu-flip")], { menuMoveFlip: true }),
  scene("menu-move-diagonal", "A diagonal trip over a neighbour preserves the chosen submenu", [...hovered, { action: "menu-diagonal" }, check("submenu-placement")]),
];
