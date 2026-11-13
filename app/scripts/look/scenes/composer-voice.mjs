import { scene, click, wait, check, member, paste, type } from "./steps.mjs";

const listening = { action: "main-event", event: { type: "Dictation", phase: "listening", agent: true, member_id: 0 } };
const recording = '.composer[data-task-state="recording"]';
// Raphael's quick conversation, where a question spoken at the key belongs (as chat.mjs opens it).
const quick = [{ action: "open-details" }, click('[data-conversation-open="4"]'), wait('.tn[data-id="90"]'), click('.mb-det [data-det="close"]'), wait('.conversation-trigger[aria-expanded="false"]')];

export default [
  scene("empty-conversation-recording", "Speaking into an empty conversation keeps the empty page steady", [listening, wait(recording)], { turns: [] }),
  scene("empty-conversation-hearing", "What was said into an empty conversation waits where its message will land", [click(".cmp-voice"), wait('[data-key="hearing"]'), check("thread-clear-of-fade")], { ownerVoice: "pending", turns: [] }),
  scene("composer-voice-recording", "While the owner speaks the composer's one button is the send glyph, and Stop is not there yet",
    [check("composer-voice-idle"), listening, wait(recording), check("composer-voice-recording")]),
  scene("composer-voice-sent", "Pressing it sends what was said, and only then does the same button become Stop",
    [...quick, check("composer-voice-idle"), listening, wait(recording), check("composer-voice-recording"), click(".cmp-voice"), wait('.composer[data-task-state="ack"]'), check("composer-voice-sent")], { ownerVoice: "pending" }),
  // One press sends everything: the recording, the picture and the typed words (owner, 2026-11-14), in Raphael's quick conversation and in a member's.
  ...[["quick", 0, quick], ["member", 1, [member(1)]]].map(([name, id, open]) => scene(`composer-voice-attachment-${name}`, "A picture and words in the composer go out with the recording in one press",
    [...open, paste(".composer textarea", { image: "clipboard.png" }), wait(".composer .cmp-chip img.cmp-thumb"), type(".composer textarea", "Look at this picture"),
      { action: "main-event", event: { type: "Dictation", phase: "listening", agent: true, member_id: id } }, wait(recording), click(".cmp-voice"), wait('.composer[data-task-state="ack"]'), check("composer-voice-attachment")], { ownerVoice: "pending" })),
];
