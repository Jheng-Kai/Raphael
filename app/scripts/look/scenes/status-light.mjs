import { scene, member, wait, click, hover, check } from "./steps.mjs";

// The status light at the left of a conversation's top row (status-light.ts), and the title pill beside it: no dot of its
// own, and its arrow only while the details panel is closed (the title then opens it).
const working = { action: "main-event", event: { type: "MemberActivity", member_id: 1, state: "working", label: "整理研究摘要" } };
const waiting = { action: "main-event", event: { type: "MemberActivity", member_id: 2, state: "blocked", label: "等你貼上金鑰" } };

export default [
  scene("status-light-idle", "With no member at work the light is one dim dot, and the title pill has no dot of its own", [member(1), wait('.mb-head [data-act="status"]'), check("status-light-idle")]),
  scene("status-light-list", "Waiting for the owner comes first, finished next, and working last", [member(1), wait('.mb-head [data-act="status"]'), working, waiting, wait('.mb-head [data-act="status"][data-level="needs"]'), click('.mb-head [data-act="status"]'), wait(".menu .menu-choice"), check("status-light-list")], { sidebarLights: { 3: "done" } }),
  scene("status-light-dot", "News in the list puts a small dot at the icon's top right, the warning colour for one waiting for the owner", [member(1), wait('.mb-head [data-act="status"]'), working, waiting, wait('.mb-head [data-act="status"][data-dot="needs"]'), check("status-light-dot")]),
  scene("status-light-seen", "Opening the list clears the icon's dot until something new comes", [member(1), wait('.mb-head [data-act="status"]'), working, waiting, wait('.mb-head [data-act="status"][data-dot="needs"]'), click('.mb-head [data-act="status"]'), wait(".menu .menu-choice"), { action: "key", key: "Escape" }, check("status-light-seen")]),
  scene("status-light-pill-open", "With the details panel open a hover on the title shows no arrow", [member(1), wait(".conversation-trigger"), { action: "open-details" }, wait(".mb-det:not([hidden])"), hover(".conversation-trigger"), check("status-light-pill-open")]),
];
