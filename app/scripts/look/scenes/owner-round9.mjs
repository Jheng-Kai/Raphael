import { scene, wait, check, click, scroll, member, room, key } from "./steps.mjs";

const owner = '.tn[data-id="1"] .owner-message';
const reply = '.tn[data-id="2"] .ra .chat-message[data-reply]';
export default [
  scene("long-owner", "A numbered owner workflow has one faded preview and no inner scroll", [wait(`${owner} .bubble`), scroll(owner), check("message-no-inner-scroll"), check("message-preview")], { longOwner: true }),
  scene("long-owner-expanded", "The owner's workflow expands in place and collapses again", [wait(`${owner} .bubble`), scroll(owner), click(`${owner} [data-act="expand-message"]`), check("message-expanded"), click(`${owner} [data-act="expand-message"]`), check("message-preview"), click(`${owner} [data-act="expand-message"]`), check("message-expanded")], { longOwner: true }),
  scene("long-member-reply", "A long member reply stays fully readable", [member(1), wait(reply), scroll(reply), check("message-no-inner-scroll"), check("reply-full")], { longReply: true }),

  scene("reply-envelope", "An older stored CLI envelope renders only its words", [wait('.tn[data-id="1"] .ra .message-text'), check("message-no-raw-envelope")], { rawReplyEnvelope: true }),
  scene("long-room-messages", "Only owner messages collapse in rooms", [
    room(1), wait('.au-room-message [data-expandable]'), check("message-preview"), check("message-no-inner-scroll"),
    click('.au-room-message .owner-message [data-act="expand-message"]'), check("message-expanded"), key("Enter"), check("message-preview"),
    check("reply-full"), check("message-no-inner-scroll"),
  ], { longRoomMessages: true }),
  {
    ...scene("overlay-working-cancel", "The ordinary orb has no Stop and retains two-Escape cancellation", [
      { action: "advance-time", ms: 800 }, check("overlay-working-no-stop"), key("Escape"), key("Escape"), check("cancel-overlay-result"),
    ], { overlayEvents: [{ type: "settings", px: 120, language: "zh-TW" }, { type: "show", mode: "listening" }, { type: "mode", mode: "thinking" }] }),
    entry: "overlay.html",
  },
];
