import { scene, click, type, wait, waitGone, key, member, room, settings, check } from "./steps.mjs";

const palette = [click('.mb-chat:not([hidden]) .cmp-input'), { ...key("k"), ctrl: true }, wait('[data-command-palette] input')];
export default [
  scene("command-palette", "Ctrl+K opens the shared command popover while typing", [...palette]),
  scene("command-palette-filter", "Palette search retains only the matching shortcut", [...palette, type('[data-command-palette] input', "Ctrl+1"), wait('.command-results [data-command]:only-child')]),
  scene("command-palette-member", "A palette member action opens that member's conversation", [...palette, click('[data-command="person:1"]'), waitGone('[data-command-palette]'), wait('body:has([data-member="1"][aria-current="true"]) .mb-pill-t')]),
  scene("shortcut-find-chief", "Palette Find opens the chief conversation finder", [...palette, click('[data-command="find"]'), wait('.mb-chat .ra-find:not([hidden]) input')]),
  scene("shortcut-find-member", "Palette Find uses the member conversation finder", [member(1), ...palette, click('[data-command="find"]'), wait('.mb-chat .ra-find:not([hidden]) input')]),
  scene("shortcut-find-room", "Palette Find uses the room's shared conversation finder", [room(1), click('.au-room-pane .cmp-input'), { ...key("k"), ctrl: true }, wait('[data-command-palette]'), click('[data-command="find"]'), wait('.au-room-pane .ra-find:not([hidden]) input')]),
  scene("shortcut-search", "Palette Search opens the existing cross-conversation search", [...palette, click('[data-command="search"]'), wait('.conversation-search input')]),
  scene("owner-output-folder", "The owner delivery folder lives in General", [...settings("general"), wait('#owner-output-folder'), check("owner-output-folder")], { ownerOutputFolder: true }),
  scene("routine-guard-reason", "A paused scheduled routine explains the owner's long absence", [member(1), { action: "open-details" }, { action: "wait-text", selector: ".mb-rt-main", text: "30" }], { routineGuard: true }),
];
