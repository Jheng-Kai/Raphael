import { scene, click, wait, member, room, check } from "./steps.mjs";

// One row at the top of a conversation (owner, 2026-11-12, after Grok Bot): the header is the window's top row and the thread passes under it.
// `conversation-top-row` measures that row; these scenes put it in the states that move something in it. Every scene runs at 1120, 720 (where
// the sidebar's menu button stands at the top left) and 1920, so the narrow and the wide layouts are measured by the same ones.
const reply = '.ra .chat-message[data-reply]';
// A 150-turn conversation (thread-window.mjs), so that the thread is long enough to scroll under the row.
const long = [member(1), wait('.tn[data-id="9149"]')];
const top = check("conversation-top-row");
const wheelOverHeader = deltaY => ({ action: "wheel", selector: ".mb-chat:not([hidden]) > .mb-head", deltaY });
const headerWheel = check("conversation-top-row-wheel");

export default [
  scene("top-row-find", "The search bar opened from the header stands under the one row, the thread under the bar", [member(1), wait('.mb-head [data-act="search"]:not([hidden])'), click('.mb-head [data-act="search"]'), wait(".ra-find:not([hidden])"), top]),
  scene("top-row-details", "The details panel is open beside the conversation: the panel's own top row carries the window's buttons and the conversation's tools stand at its pane's edge", [member(1), wait(reply), { action: "open-details" }, wait(".mb-det:not([hidden])"), check("details-top-row"), top]),
  scene("top-row-room", "A group's header is the same one row, with its search and ⋯ ending short of the window's buttons", [room(1), wait(".au-room-thread .chat-message"), top]),
  scene("top-row-room-find", "A group's search bar stands under the row", [room(1), wait(".au-room-thread .chat-message"), click(".mb-head [data-room-search]"), wait(".ra-find:not([hidden])"), top]),
  // The thread read higher up passes under the row, and the wheel over the row moves it as anywhere else on the thread.
  scene("top-row-scrolled", "The thread read higher up has messages under the row, faded out, and the pill and buttons stay opaque", [...long, { action: "conversation-position", position: "up" }, check("conversation-top-row-scrolled"), top], { threadWindow: "private" }),
  scene("top-row-wheel", "A wheel turned over the header moves the thread under it", [...long, check("conversation-top-row-wheel-before"), wheelOverHeader(-240), headerWheel], { threadWindow: "private" }),
];

// The conversation scenes that stand over a header end with the same measure.
export const TOP_ROW_SCENES = new Set(["chat", "conversation-share", "details", "raphael-details", "room", "calm-thread", "page-inplace", "page-inplace-back", "page-inplace-room", "page-report", "page-report-share", "room-thread-open"]);
