import { scene, click, wait, check } from "./steps.mjs";

const listening = { action: "main-event", event: { type: "Dictation", phase: "listening", agent: true, member_id: 0 } };
const recording = '.composer[data-task-state="recording"]';
// Raphael's quick conversation, where a question spoken at the key belongs (as chat.mjs opens it).
const quick = [{ action: "open-details" }, click('[data-conversation-open="4"]'), wait('.tn[data-id="90"]'), click('.mb-det [data-det="close"]'), wait('.conversation-trigger[aria-expanded="false"]')];

// A conversation nobody has written in yet, with the details closed as it is when the owner speaks.
const fresh = [{ action: "open-details" }, click(".mb-det [data-conversation-new]"), wait(".page-agent:not([hidden]) .ra-empty:not([hidden])"), click('.mb-det [data-det="close"]'), wait('.conversation-trigger[aria-expanded="false"]')];

export default [
  scene("new-conversation-recording", "Speaking into a new conversation keeps the empty page steady", [...fresh, listening, wait(recording)]),
  scene("new-conversation-hearing", "What was said into a new conversation waits where its message will land", [...fresh, click(".cmp-voice"), wait('[data-key="hearing"]'), check("thread-clear-of-fade")], { ownerVoice: "pending" }),
  scene("composer-voice-recording", "While the owner speaks the composer's one button is the send glyph, and Stop is not there yet",
    [check("composer-voice-idle"), listening, wait(recording), check("composer-voice-recording")]),
  scene("composer-voice-sent", "Pressing it sends what was said, and only then does the same button become Stop",
    [...quick, check("composer-voice-idle"), listening, wait(recording), check("composer-voice-recording"), click(".cmp-voice"), wait('.composer[data-task-state="ack"]'), check("composer-voice-sent")], { ownerVoice: "pending" }),
];
