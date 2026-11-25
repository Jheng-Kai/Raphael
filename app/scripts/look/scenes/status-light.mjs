import { scene, member, wait, waitGone, click, hover, check, key } from "./steps.mjs";

// The status light at the left of a conversation's top row (status-light.ts), and the title pill beside it: no dot of its
// own, and its arrow only while the details panel is closed (the title then opens it).
const working = { action: "main-event", event: { type: "MemberActivity", member_id: 1, state: "working", label: "整理研究摘要" } };
const waiting = { action: "main-event", event: { type: "MemberActivity", member_id: 2, state: "blocked", label: "等你貼上金鑰" } };

export default [
  scene("status-light-idle", "With no member at work the light is one dim dot, and the title pill has no dot of its own", [member(1), wait('.mb-head [data-act="status"]'), check("status-light-idle")]),
  // The owner, 2026-11-25: with nobody at work the list says so in its heading alone, with no line under it.
  scene("status-light-idle-open", "Opened with nobody at work, the list is its heading 「沒有人在工作」 alone, with no line under it", [member(1), wait('.mb-head [data-act="status"]'), click('.mb-head [data-act="status"]'), wait(".menu .menu-head"), check("menu-head-alone")], { noNews: true }),
  scene("status-light-list", "Waiting for the owner comes first, finished next, and working last", [member(1), wait('.mb-head [data-act="status"]'), working, waiting, wait('.mb-head [data-act="status"][data-level="needs"]'), click('.mb-head [data-act="status"]'), wait(".menu .menu-choice"), check("status-light-list")], { sidebarLights: { 3: "done" } }),
  scene("status-light-dot", "News in the list puts a small dot at the icon's top right, the warning colour for one waiting for the owner", [member(1), wait('.mb-head [data-act="status"]'), working, waiting, wait('.mb-head [data-act="status"][data-dot="needs"]'), check("status-light-dot")]),
  scene("status-light-seen", "Two finished conversations keep the dot until both are opened", [
    member(1), wait('.mb-head [data-act="status"][data-dot="done"]'), click('.mb-head [data-act="status"]'),
    wait('.menu .menu-choice[data-value="2"]'), check("status-light-seen"),
    click('.menu .menu-choice[data-value="2"]'), waitGone(".menu"), wait('.mb-head [data-act="status"][data-dot="done"]'),
    click('.mb-head [data-act="status"]'), wait('.menu .menu-choice[data-value="3"]'), check("status-light-remaining"),
    key("Escape"), member(3), waitGone('.mb-head [data-act="status"][data-dot]'),
    member(1), click('.mb-head [data-act="status"]'), check("status-light-cleared"),
  ], { sidebarLights: { 2: "done", 3: "done" }, statusThreads: true }),
  scene("status-light-pill-open", "With the details panel open a hover on the title shows no arrow", [member(1), wait(".conversation-trigger"), { action: "open-details" }, wait(".mb-det:not([hidden])"), hover(".conversation-trigger"), check("status-light-pill-open")]),
];
