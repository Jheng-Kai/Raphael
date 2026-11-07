import { scene, member, wait, check, click } from "./steps.mjs";

const open = [member(1), wait('.thread-new')];
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
  scene("thread-new-divider-remount", "The unread boundary returns in its original place after its window was unmounted", [...open, check("thread-new-divider"),
    wait('.mb-chat .conversation-latest:not([hidden])'), click('.mb-chat .conversation-latest'), {action:"wait-scroll-end",selector:'.mb-chat .ra-scroll'}, check("thread-new-divider-bottom"),
    {action:"thread-window-earlier",expected:45}, {action:"thread-window-earlier",expected:61}, wait('.thread-new'), check("thread-new-divider-restored")], {unreadDivider:"long"}),
];
