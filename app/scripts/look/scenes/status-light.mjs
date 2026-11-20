import { scene, member, wait, click, hover, check } from "./steps.mjs";

// The status light at the left of a conversation's top row (status-light.ts), and the title pill beside it: no dot of its
// own, and its arrow only while the details panel is closed (the title then opens it).
const working = { action: "main-event", event: { type: "MemberActivity", member_id: 1, state: "working", label: "整理研究摘要" } };
const waiting = { action: "main-event", event: { type: "MemberActivity", member_id: 2, state: "blocked", label: "等你貼上金鑰" } };

export default [
  scene("status-light-idle", "With no member at work the light is one dim dot, and the title pill has no dot of its own", [member(1), wait('.mb-head [data-act="status"]'), check("status-light-idle")]),
  scene("status-light-list", "A member working and one waiting for the owner: the light is the warning colour and its list puts the waiting one first", [member(1), wait('.mb-head [data-act="status"]'), working, waiting, wait('.mb-head [data-act="status"][data-level="needs"]'), click('.mb-head [data-act="status"]'), wait(".menu .menu-choice"), check("status-light-list")]),
  scene("status-light-pill-open", "With the details panel open a hover on the title shows no arrow", [member(1), wait(".conversation-trigger"), { action: "open-details" }, wait(".mb-det:not([hidden])"), hover(".conversation-trigger"), check("status-light-pill-open")]),
];
