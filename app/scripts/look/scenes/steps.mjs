export const stableClick = (selector, then = []) => ({ action: "stable-click", selector, then });
export const click = selector => ({ action: "click", selector });
export const hover = selector => ({ action: "hover", selector });
/** A real press at a fraction (x, y) of the element, then the page `expect` names must be on screen. */
export const pressAt = (selector, x, y, expect, contains) => ({ action: "click-position", selector, x, y, expect, ...(contains ? { contains } : {}) });
// A press that the core's events straddle: the button goes down on `selector`, `events` arrive and the page draws what they bring, the button comes up.
export const pressThrough = (selector, x, y, events, expect, contains) => ({ action: "press-through", selector, x, y, events, expect, ...(contains ? { contains } : {}) });
export const hold = (selector, ms = 500) => ({ action: "hold", selector, ms });
// A press on `selector` moved `dx` px across and let go there (a pane's edge resizes it, edge-drag.ts). `wide`: only on a desktop-width window, where the list is not a drawer.
export const drag = (selector, dx, options = {}) => ({ action: "drag", selector, dx, ...options });
// A step for the full list only: the rail of faces on a narrow window has no folder headings (driver.mjs `perform`).
export const wide = step => ({ ...step, wide: true });
export const type = (selector, text) => ({ action: "type", selector, text });
// `timeout` (ms) for what the app itself waits for before it shows it (the screen's 6 s to confirm a take-over).
export const wait = (selector, timeout) => ({ action: "wait", selector, ...(timeout ? { timeout } : {}) });
export const waitGone = selector => ({ action: "wait-gone", selector });
export const codexArrives = () => ({ action: "codex-arrives" });
// A CLI's sign-in console ended: `done`, or `stopped` as when its window was closed first.
export const cliSigninEnds = (cli, outcome) => ({ action: "cli-signin-ends", cli, outcome });
export const check = name => ({ action: "check", name });
export const focus = selector => ({ action: "focus", selector });
export const key = value => ({ action: "key", key: value });
// What an input method hands the page, in order: `{ compose }` is a composition in progress, `{ commit }` the text it finishes with.
export const ime = (selector, sequence) => ({ action: "ime", selector, sequence });
// What the mock's core does while the scene waits (`window.__look[name](...args)`): `lookCall("updatePage", "page-news")`.
export const lookCall = (name, ...args) => ({ action: "look-call", name, args });
// A page open in the conversation's place: wheel over it, and what it must show once it has (frame-expect: its words, how far down it is).
export const frameScroll = deltaY => ({ action: "frame-scroll", deltaY });
export const frameExpect = (text, scrollAtLeast) => ({ action: "frame-expect", ...(text ? { text } : {}), ...(scrollAtLeast !== undefined ? { scrollAtLeast } : {}) });
export const scroll = selector => ({ action: "scroll", selector });
export const waitScrollEnd = selector => ({ action: "wait-scroll-end", selector });
export const rightClick = selector => ({ action: "right-click", selector });
// R-UI-124: count how many times a thing opens (`selector` drawn, `hidden` lifted, or `attribute` set on it), and press its opener a second time.
// `gone` is what must be absent afterwards; `over` says where that second press should land: "scrim" (a layer over the control) or "control".
export const watchOpens = (selector, options = {}) => ({ action: "watch-opens", selector, ...options });
export const pressOpener = selector => ({ action: "press-opener", selector });
// The owner's face at the sidebar's foot opens the account menu (R-SIDE-01); `item` presses one of its rows: dictation, calendar, settings, or
// usage (when no subscription window is known). The face is the same button in the list and on the rail.
export const accountMenu = item => ({ action: "account-menu", ...(item ? { item } : {}) });
// The conversation is the member's row; every other page is a row of the account menu (the calendar opens on today).
export const page = name => name === "agent" ? click(".mb-chief") : accountMenu(name === "automations" ? "calendar" : name);
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
