export const stableClick = (selector, then = []) => ({ action: "stable-click", selector, then });
export const click = selector => ({ action: "click", selector });
export const hover = selector => ({ action: "hover", selector });
export const hold = (selector, ms = 500) => ({ action: "hold", selector, ms });
// A press on `selector` moved `dx` px across and let go there (a pane's edge resizes it, edge-drag.ts). `wide`: only on a desktop-width window, where the list is not a drawer.
export const drag = (selector, dx, options = {}) => ({ action: "drag", selector, dx, ...options });
export const type = (selector, text) => ({ action: "type", selector, text });
export const wait = selector => ({ action: "wait", selector });
export const waitGone = selector => ({ action: "wait-gone", selector });
export const codexArrives = () => ({ action: "codex-arrives" });
// A CLI's sign-in console ended: `done`, or `stopped` as when its window was closed first.
export const cliSigninEnds = (cli, outcome) => ({ action: "cli-signin-ends", cli, outcome });
export const check = name => ({ action: "check", name });
export const focus = selector => ({ action: "focus", selector });
export const key = value => ({ action: "key", key: value });
// What an input method hands the page, in order: `{ compose }` is a composition in progress, `{ commit }` the text it finishes with.
export const ime = (selector, sequence) => ({ action: "ime", selector, sequence });
export const scroll = selector => ({ action: "scroll", selector });
export const waitScrollEnd = selector => ({ action: "wait-scroll-end", selector });
export const rightClick = selector => ({ action: "right-click", selector });
export const page = name => click(name === "agent" ? ".mb-chief" : `#nav [data-go="${name}"]`);
// 連結應用程式 is no tab of Settings: its one way in is the sidebar's button, which opens it as a dialog of its own (R-UI-111).
// Appearance is a section of 一般 (the six settings tabs): its scenes open 一般 at that section. Messaging has no section
// there any more: the bots are set up in each member's panel and conversation, so no scene opens it in Settings.
const SECTION_OF = { appearance: ".appearance-settings" };
export const settings = pane => {
  if (pane === "connections") return [click("#nav .sidebar-apps"), wait(".modal-scrim[data-standalone=\"connections\"] .modal-body .cs"), check("settings-shell")];
  const tab = SECTION_OF[pane] ? "general" : pane;
  return [page("settings"), wait(".modal-scrim [data-pane]"), check("settings-shell"), click(`.modal-scrim [data-pane="${tab}"]`), wait(`.modal-scrim [data-pane="${tab}"][aria-current="page"]`),
    ...(SECTION_OF[pane] ? [scroll(`.modal-scrim ${SECTION_OF[pane]}`)] : [])];
};
export const scene = (name, description, steps = [], fixture = {}) => ({ name, description, steps, fixture });

// The compact member/room picker exposes the same destinations as the wide sidebar.
export const member = id => ({ action: "member", id });
// What the clipboard or the mouse hands the page; the events reach the real composer. `{ image }` is a file name, `{ text }` words.
export const paste = (selector, contents) => ({ action: "clipboard-paste", selector, ...contents });
export const dropFile = (selector, name, options = {}) => ({ action: "file-drop", selector, name, ...options });
export const room = id => ({ action: "room", id });
export const newRoom = () => ({ action: "new-room" });
export const search = text => ({ action: "search", text });
