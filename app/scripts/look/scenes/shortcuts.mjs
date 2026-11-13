import { scene, click, type, wait, waitGone, key, member, room, settings, check } from "./steps.mjs";

const palette = [click('.mb-chat:not([hidden]) .cmp-input'), { ...key("k"), ctrl: true }, wait('[data-command-palette] input')];
const composer = click('.mb-chat:not([hidden]) .cmp-input');
export default [
  // The composer has the focus as soon as a conversation opens: Ctrl+N, Ctrl+B and Ctrl+1..9 work from there (R-NAV-01, 2026-11-11).
  scene("shortcut-new-in-composer", "Ctrl+N opens the new member maker while the composer has the focus", [composer, { ...key("n"), ctrl: true }, wait(".cr-dialog")]),
  scene("shortcut-sidebar-in-composer", "Ctrl+B folds or opens the sidebar while the composer has the focus", [composer, { ...key("b"), ctrl: true }, wait("html[data-sidebar-collapsed], html[data-sidebar-open]")]),
  scene("shortcut-member-in-composer", "Ctrl+2 opens the second person's conversation (the chief is the first) while the composer has the focus", [composer, { ...key("2"), ctrl: true }, wait('body:has([data-member="1"][aria-current="true"]) .mb-pill-t')]),
  scene("command-palette", "Ctrl+K opens the shared command popover while typing", [...palette]),
  scene("command-palette-filter", "Palette search retains only the matching shortcut", [...palette, type('[data-command-palette] input', "Ctrl+1"), wait('.command-results [data-command]:only-child')]),
  scene("command-palette-member", "A palette member action opens that member's conversation", [...palette, click('[data-command="person:1"]'), waitGone('[data-command-palette]'), wait('body:has([data-member="1"][aria-current="true"]) .mb-pill-t')]),
  scene("shortcut-find-chief", "Palette Find opens the chief conversation finder", [...palette, click('[data-command="find"]'), wait('.mb-chat .ra-find:not([hidden]) input')]),
  scene("shortcut-find-member", "Palette Find uses the member conversation finder", [member(1), ...palette, click('[data-command="find"]'), wait('.mb-chat .ra-find:not([hidden]) input')]),
  scene("shortcut-find-room", "Palette Find uses the room's shared conversation finder", [room(1), click('.au-room-pane .cmp-input'), { ...key("k"), ctrl: true }, wait('[data-command-palette]'), click('[data-command="find"]'), wait('.au-room-pane .ra-find:not([hidden]) input')]),
  scene("shortcut-search", "Palette Search opens the existing cross-conversation search", [...palette, click('[data-command="search"]'), wait('.side-search input'), check("search-card-middle")]),
  scene("owner-output-folder", "The owner delivery folder lives in General", [...settings("general"), wait('[data-row="output-folder"] .output-name'), check("owner-output-folder")], { ownerOutputFolder: true }),
  scene("routine-guard-reason", "A paused scheduled routine explains the owner's long absence", [member(1), { action: "open-details" }, { action: "wait-text", selector: ".mb-rt-main", text: "30" }], { routineGuard: true }),
];
