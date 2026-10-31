export const stableClick = (selector, then = []) => ({ action: "stable-click", selector, then });
export const click = selector => ({ action: "click", selector });
export const hover = selector => ({ action: "hover", selector });
export const type = (selector, text) => ({ action: "type", selector, text });
export const wait = selector => ({ action: "wait", selector });
export const waitGone = selector => ({ action: "wait-gone", selector });
export const check = name => ({ action: "check", name });
export const key = value => ({ action: "key", key: value });
// What an input method hands the page, in order: `{ compose }` is a composition in progress, `{ commit }` the text it finishes with.
export const ime = (selector, sequence) => ({ action: "ime", selector, sequence });
export const scroll = selector => ({ action: "scroll", selector });
export const waitScrollEnd = selector => ({ action: "wait-scroll-end", selector });
export const rightClick = selector => ({ action: "right-click", selector });
export const page = name => click(name === "agent" ? ".mb-chief" : `#nav [data-go="${name}"]`);
export const settings = pane => [page("settings"), wait(".modal-scrim [data-pane]"), check("settings-shell"), click(`.modal-scrim [data-pane="${pane}"]`), wait(`.modal-scrim [data-pane="${pane}"][aria-current="page"]`)];
export const scene = (name, description, steps = [], fixture = {}) => ({ name, description, steps, fixture });

// The compact member/room picker exposes the same destinations as the wide sidebar.
export const member = id => ({ action: "member", id });
export const room = id => ({ action: "room", id });
export const newRoom = () => ({ action: "new-room" });
export const search = text => ({ action: "search", text });
