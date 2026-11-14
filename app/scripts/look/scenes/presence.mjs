import { scene, member, room, wait, hover, click, stableClick, check, type, drag } from "./steps.mjs";

const conversation = (name, description, variant = "clean", extra = []) => ({ ...scene(name, description, [member(1), wait('.tn[data-id="651"]'),
  ...extra, check(name)], { presence: variant }), motion: extra.some(step => step.action === "event-storm" && step.roster) });
export default [
  scene("presence-states-sidebar", "Distinct silhouettes in the shared sidebar", [{action: "member-column", collapsed: false}, check("presence-states-sidebar")], {presence: "states"}),
  conversation("presence-hover-action", "The header hover updates below its avatar, inside the window", "hover", [hover('.mb-head .av'), {action: "main-event", event: {type: "MemberActivity", member_id: 1, state: "searching", label: "Comparing sample sources"}}]),
  conversation("presence-sidebar-hover", "Expanded rows share the live public action hover", "hover", [{action: "member-column", collapsed: false}, hover('.side [data-member="1"] .av'), {action: "main-event", event: {type: "MemberActivity", member_id: 1, state: "searching", label: "Comparing sample sources"}}]),
  conversation("presence-rail-hover", "The collapsed rail names its member before the public action", "hover", [{action: "member-column", collapsed: false}, drag('.side-edge', -240, { wide: true }), {action: "member-column", collapsed: false}, hover('.side [data-member="1"] .av'), {action: "main-event", event: {type: "MemberActivity", member_id: 1, state: "searching", label: "Comparing sample sources"}}]),
  conversation("presence-blocked-stays", "Owner attention survives unchanged roster refreshes", "blocked", [{action: "event-storm", selector: ".mb-chat:not([hidden]) .ra-scroll", roster: true, wheelBy: 0, measure: {name: "blocked-presence", enforce: false}, limits: {replacedFaces: 0, longTaskMs: 600}}]),
  conversation("presence-waiting-colleague", "Dependency waiting has lidded eyes rather than an attention mark", "colleague"),
  conversation("transcript-clean", "Private bubbles leave room for the words"),
  scene("slime-one-working", "One member shows one working slime: a task line with words wins over the face of a task that waits (owner, 2026-11-14)", [member(1), wait('.thread .live-presence .live-action'), check("slime-one-working")], { running: true, runningMember: 1, oneSlime: true }),
  conversation("transcript-working", "The live avatar and one line follow public progress", "working", [hover('.live-presence')]),
  conversation("transcript-action-long", "One long action truncates with its full words on hover", "action-long", [hover('.live-presence')]),
  scene("group-live-line", "A group action sits below its working member", [room(1),wait('.au-room-thinking .live-action'),hover('.au-room-thinking .live-presence'),check("group-live-line")], {presence:"action-group"}),
  conversation("transcript-time-gap", "Hour gaps within one day add no separator", "gap"),
  conversation("event-routine-line", "A routine receipt stays in collapsed reply detail", "events"),
  conversation("event-routine-find", "Conversation find visits the receipt title without exposing transport metadata", "events", [click('.mb-chat:not([hidden]) [data-act="search"]'), type('.mb-chat:not([hidden]) .ra-find-input', 'Sample briefing'), wait('[data-id="651"] .event-line mark')]),
  conversation("event-routine-find-group", "Find reveals a selected receipt inside its collapsed group and keeps it through refresh", "collapse", [click('.mb-chat:not([hidden]) [data-act="search"]'), type('.mb-chat:not([hidden]) .ra-find-input', 'Sample briefing'), wait('[data-event-group][open] .handoff-detail mark.is-current'), {action: "event-storm", selector: ".mb-chat:not([hidden]) .ra-scroll", roster: true, wheelBy: 0, measure: {name: "event-find-presence", enforce: false}, limits: {replacedFaces: 0, longTaskMs: 600}}]),
  conversation("event-routine-spacing", "Receipts add no vertical gaps between replies or media cards", "spacing"),
  conversation("event-calendar-line", "A calendar receipt keeps the event name and date", "calendar"),
  scene("sidebar-row-time", "A row shows the name and one line with no time, and its overflow appears under the pointer", [{action: "member-column", collapsed: false}, hover('[data-member="1"]'), check("sidebar-row-time")], {presence: "clean"}),
  scene("sidebar-group-author", "The group preview names its author", [{action: "member-column", collapsed: false}, check("sidebar-group-author")], {presence: "clean"}),
];
