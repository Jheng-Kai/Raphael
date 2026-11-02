import { scene, member, room, wait, hover, click, stableClick, check, type } from "./steps.mjs";

const conversation = (name, description, variant = "clean", extra = []) => ({ ...scene(name, description, [member(1), wait('.tn[data-id="651"]'), ...extra, check(name)], { presence: variant }), motion: extra.some(step => step.action === "event-storm" && step.roster) });
export default [
  scene("presence-states-sidebar", "Distinct silhouettes in the shared sidebar", [{action: "member-column", collapsed: false}, check("presence-states-sidebar")], {presence: "states"}),
  conversation("presence-hover-action", "The header hover updates below its avatar, inside the window", "hover", [hover('.mb-head .av'), {action: "main-event", event: {type: "MemberActivity", member_id: 1, state: "searching", label: "Comparing sample sources"}}]),
  conversation("presence-sidebar-hover", "Expanded rows share the live public action hover", "hover", [{action: "member-column", collapsed: false}, hover('.side [data-member="1"] .av'), {action: "main-event", event: {type: "MemberActivity", member_id: 1, state: "searching", label: "Comparing sample sources"}}]),
  conversation("presence-rail-hover", "The collapsed rail names its member before the public action", "hover", [{action: "member-column", collapsed: false}, click('[data-sidebar="collapse"]'), {action: "member-column", collapsed: false}, hover('.side [data-member="1"] .av'), {action: "main-event", event: {type: "MemberActivity", member_id: 1, state: "searching", label: "Comparing sample sources"}}]),
  conversation("presence-blocked-stays", "Owner attention survives unchanged roster refreshes", "blocked", [{action: "event-storm", selector: ".mb-chat:not([hidden]) .ra-scroll", roster: true, wheelBy: 0, measure: {name: "blocked-presence", enforce: false}, limits: {replacedFaces: 0, longTaskMs: 600}}]),
  conversation("presence-waiting-colleague", "Dependency waiting has lidded eyes rather than an attention mark", "colleague"),
  conversation("transcript-clean", "Private bubbles leave room for the words"),
  conversation("transcript-working", "The live avatar and one line follow public progress", "working", [hover('.live-presence')]),
  conversation("transcript-hover-detail", "Work and model receipt open from message hover", "detail", [hover('[data-id="651"] [data-reply]'), stableClick('[data-id="651"] .message-work')]),
  conversation("transcript-action-long", "One long action truncates with its full words on hover", "action-long", [hover('.live-presence')]),
  conversation("transcript-action-list", "Completed work is a quiet list of sentences", "actions", [hover('[data-id="651"] [data-reply]'), stableClick('[data-id="651"] .message-work')]),
  conversation("transcript-old-list", "Old turns retain readable work and failure reasons", "old-actions", [hover('[data-id="651"] [data-reply]'), stableClick('[data-id="651"] .message-work')]),
  scene("group-live-line", "A group action sits below its working member", [room(1),wait('.au-room-thinking .live-action'),hover('.au-room-thinking .live-presence'),check("group-live-line")], {presence:"action-group"}),
  conversation("transcript-time-gap", "Centred day and time mark thirty-minute gaps", "gap"),
  conversation("event-routine-line", "A routine receipt stands in the timeline", "events"),
  conversation("event-routine-find", "Conversation find visits the receipt title without exposing transport metadata", "events", [click('.mb-chat:not([hidden]) [data-act="search"]'), type('.mb-chat:not([hidden]) .ra-find-input', 'Sample briefing'), wait('[data-id="651"] .event-line mark')]),
  conversation("event-routine-find-group", "Find reveals a selected receipt inside its collapsed group and keeps it through refresh", "collapse", [click('.mb-chat:not([hidden]) [data-act="search"]'), type('.mb-chat:not([hidden]) .ra-find-input', 'Sample briefing'), wait('[data-event-group][open] .handoff-detail mark.is-current'), {action: "event-storm", selector: ".mb-chat:not([hidden]) .ra-scroll", roster: true, wheelBy: 0, measure: {name: "event-find-presence", enforce: false}, limits: {replacedFaces: 0, longTaskMs: 600}}]),
  conversation("event-routine-spacing", "Event lines share even spacing beside bubbles, cards and other lines", "spacing"),
  conversation("event-routine-opens", "The receipt opens the routine it names", "events", [click('[data-id="651"] [data-act="open-routine"]'), wait('.au-routine-dialog')]),
  conversation("event-calendar-line", "A calendar receipt keeps the event name and date", "calendar"),
  conversation("event-calendar-opens", "A calendar receipt opens that event's detail", "calendar", [click('[data-id="651"] [data-act="open-calendar-event"]'), wait('.au-pop-detail')]),
  conversation("event-lines-collapse", "Consecutive routine receipts fold and keep their disclosure", "collapse", [click('[data-event-group] > summary'), {action: "event-storm", selector: ".mb-chat:not([hidden]) .ra-scroll", roster: true, wheelBy: 0, measure: {name: "event-presence", enforce: false}, limits: {replacedFaces: 0, longTaskMs: 600}}]),
  scene("sidebar-row-time", "Name and time retain their positions under hover", [{action: "member-column", collapsed: false}, hover('[data-member="1"]'), check("sidebar-row-time")], {presence: "clean"}),
  scene("sidebar-group-author", "The group preview names its author", [{action: "member-column", collapsed: false}, check("sidebar-group-author")], {presence: "clean"}),
];
