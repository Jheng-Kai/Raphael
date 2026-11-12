import { scene, check, click, drag, hover, key, member, paste, room, type, wait } from "./steps.mjs";

// The composer is one row of 44 px, as Grok Bot's (owner, 2026-11-12): + , the words, the permission, the model and send on one line, 16 px
// above the window. These scenes give every state it can be in a picture and the numbers: `composer-shape:<state>` in checks.mjs.
const field = ".page-agent .mb-chat:not([hidden]) .cmp-input";
const roomField = ".au-room-pane .cmp-input";
const lines = count => Array.from({ length: count }, (_, index) => `第${index + 1}行`).join("\n");
// Empty, one line, three lines, twelve lines (the field stops at six and scrolls), one waiting file.
const drafts = (where, picture) => [
  check("composer-shape:empty"),
  type(where, "好的，我先看一下"), check("composer-shape:one-line"),
  type(where, lines(3)), check("composer-shape:grown"),
  type(where, lines(12)), check("composer-shape:long"),
  type(where, ""), paste(where, { image: "clipboard.png" }), wait(picture), check("composer-shape:files"),
];
const listening = { action: "main-event", event: { type: "Dictation", phase: "listening", agent: true, member_id: 0 } };
const rosterRefresh = { action: "main-event", event: { type: "MembersChanged" } };
const stopSlot = wait('.composer[data-task-state]:not([data-task-state="idle"]) .cmp-voice svg');
// A page much taller than its card, opened in the conversation's place (pages.mjs): the composer stays under it.
const news = [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#hide" }];
const shown = [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#buy" }];
const larger = [click(".pg-card .pg-body"), wait(".pgv-frame-box iframe")];
const commands = { commands: [{ id: 61, member_id: 0, name: "review", description: "整理研究重點", template: "Review {input}" }] };
const typedField = ".composer .cmp-input";
const pick = name => [wait("#app-popover[data-team-mentions]"), click(`#app-popover [data-value="${name}"]`)];

export default [
  scene("composer-shape", "The composer at an empty draft, one line, three lines, twelve lines and one attached file", drafts(field, ".page-agent .mb-chat:not([hidden]) .composer .cmp-chip")),
  scene("composer-shape-room", "A room's composer at the same drafts", [room(1), ...drafts(roomField, ".au-room-pane .composer .cmp-chip")]),
  scene("composer-shape-quote", "A quoted reply stands above the one row, inside the box", [hover(".ra .chat-message[data-reply]"), click('.ra .chat-message[data-reply] [data-act="reply-message"]'), wait(".cmp-quote:not([hidden]) .message-quote"), check("composer-shape:quote")]),
  scene("composer-shape-room-quote", "A room's reply to a member stands above the row the same way", [room(1), hover('[data-room-message="2"] .chat-message'), click('[data-room-message="2"] [data-room-act="reply"]'), wait(".au-room-pane .cmp-quote:not([hidden])"), check("composer-shape:quote")]),
  scene("composer-shape-page-note", "Words placed by a page stand in the field with their line above the row", [...shown, type(field, "我原本的草稿"), ...larger, { action: "frame-click", selector: "#buy" }, wait(".page-agent .cmp-page-note:not([hidden])"), check("composer-shape:page-note")], { pageTurn: true }),
  scene("composer-shape-page-open", "A page open in the thread's place keeps the one-row composer under it", [...news, ...larger, check("composer-shape:empty")], { pageTurn: true, pageNews: "only" }),
  scene("composer-shape-recording", "While the owner speaks the same row shows the send glyph in its one slot", [listening, wait('.composer[data-task-state="recording"]'), check("composer-shape:recording")]),
  scene("composer-shape-stop", "A running reply shows Stop in the same 32 px slot, on the same row", [rosterRefresh, stopSlot, check("composer-shape:stop")], { running: true }),
  scene("composer-shape-stop-armed", "The first Escape arms Stop: its hint hangs above the button and the row is unchanged", [rosterRefresh, stopSlot, key("Escape"), wait('[data-cancel-armed="true"]'), check("composer-shape:stop")], { running: true }),
  scene("composer-shape-failure", "A message that could not be sent keeps its failure line above the row, inside the box", [member(1), type(".cmp-input", "Please review the project note."), click(".cmp-send"), wait(".composer-failure [data-card-retry]"), check("composer-shape:failure")], { cardSendFailure: true }),
  scene("composer-shape-waiting", "While a question waits the field says it takes the answer, on the same row", [member(1), wait('[data-owner-question="owner-choice"]'), check("composer-shape:waiting")], { ownerQuestion: "asked" }),
  scene("composer-shape-room-waiting", "A room's composer says the same while its question waits", [room(1), wait('[data-owner-question="owner-choice"]'), check("composer-shape:waiting")], { ownerQuestion: "room", ownerQuestionShape: "multiple" }),
  scene("composer-shape-mention", "The @ menu hangs above the field and covers none of the controls", [type(typedField, "@"), wait("#app-popover[data-team-mentions]"), check("composer-shape:menu")]),
  scene("composer-shape-mention-chip", "An address is a chip in the field and the row keeps its one line", [type(typedField, "請用 @"), ...pick("Notion"), check("composer-shape:one-line")]),
  scene("composer-shape-slash", "The / menu hangs above the field the same way", [type(typedField, "/"), wait(".slash-menu"), check("composer-shape:menu")], commands),
  scene("composer-shape-panel", "With the member's panel open beside it (a 386 px composer at 1120) the model keeps its arrow alone, never a cut name, and the field keeps 200 px", [{ action: "open-details" }, check("composer-shape:one-line")]),
  scene("composer-shape-narrow", "The details panel dragged wide leaves the row narrow: the model is short, the field keeps its room, nothing wraps", [{ action: "open-details" }, drag(".page-agent .det-edge", -140), check("composer-shape:narrow"), check("panel-widest")]),
];
