import { scene, member, wait, check, click, waitScrollEnd } from "./steps.mjs";

const open = [member(1), wait('.thread-new')];
const raphael = (run, more = {}) => ({ unreadDivider: run, unreadMember: 0, rosterDelay: 500, scrollTimeline: true, ...more });
export default [
  scene("thread-new-divider", "A long unread run opens at its first unseen turn, across history pages", [...open, check("thread-new-divider")], { unreadDivider: "long" }),
  scene("thread-new-divider-short", "A short unread run after long seen history opens at the bottom", [...open, check("thread-new-divider-short")], { unreadDivider: "short", unreadSeenLong: true }),
  scene("thread-new-divider-stays", "New turns preserve the divider and every existing message", [...open, check("thread-new-divider-snapshot"),
    { action: "main-event", event: { type: "AgentTurn", turn_id: 7100, member_id: 1 } }, wait('.tn[data-id="7100"]'), check("thread-new-divider-stays")],
    { unreadDivider: "short", arrivals: [{ id: 7100, member_id: 1, conversation_id: 11, created_at_ms: 1792807200000,
      question: "", text: "Another sample note is ready.", prefix: "", route: "routine", source: "routine", status: "done", messages: [], steps: [] }] }),
  scene("thread-new-divider-return", "Leaving a read thread removes its divider on return", [...open, member(0), member(1), wait('.tn[data-id="7001"]'), check("thread-new-divider-return")], { unreadDivider: "short" }),
  scene("thread-new-divider-latest", "The latest control, centred above the composer, still reaches the newest turn", [...open, check("thread-new-divider"),
    wait('.mb-chat .conversation-latest:not([hidden])'), check("conversation-up"), click('.mb-chat .conversation-latest'), { action: "wait-scroll-end", selector: ".mb-chat .ra-scroll" }, check("thread-new-divider-bottom")], { unreadDivider: "long" }),
  // Raphael's thread is the one the owner opens first (the rail's chief, from Home), with the roster still on its way: the thread's
  // first place is its last (owner, 2026-11-11: the conversation opened and then jumped up). `scrollTimeline` keeps every place
  // the thread was seen at, frame by frame.
  scene("thread-new-divider-raphael-short", "Raphael with a late roster: a short unread run opens at the bottom, once, with the newest turn mounted and no latest button", [wait('.thread-new'), waitScrollEnd('.mb-chat .ra-scroll'), check("raphael-open-short")], raphael("short", { unreadSeenLong: true })),
  scene("thread-new-divider-raphael-medium", "Raphael with a late roster: sixteen unread turns keep the newest turn mounted, in one place", [wait('.thread-new'), check("raphael-open-medium")], raphael("medium")),
  scene("thread-new-divider-raphael-long", "Raphael with a late roster: a run longer than one viewport opens at the line without first showing the bottom", [wait('.thread-new'), check("raphael-open-long")], raphael("long")),
  scene("thread-new-divider-remount", "The unread boundary returns in its original place after its window was unmounted", [...open, check("thread-new-divider"),
    wait('.mb-chat .conversation-latest:not([hidden])'), click('.mb-chat .conversation-latest'), {action:"wait-scroll-end",selector:'.mb-chat .ra-scroll'}, check("thread-new-divider-bottom"),
    {action:"thread-window-earlier",expected:45}, {action:"thread-window-earlier",expected:61}, wait('.thread-new'), check("thread-new-divider-restored")], {unreadDivider:"long"}),
];
