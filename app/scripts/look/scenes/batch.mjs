import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scene, member, room, wait, waitGone, click, type, key, check, hover } from "./steps.mjs";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "../fixture.json"), "utf8"));

const turn = (member_id, extra = {}) => ({ id: 801 + member_id, member_id, conversation_id: member_id ? 11 : 1,
  session_id: "look-batch", created_at_ms: 1792807154000, question: "請整理這份資料。", route: "answer", source: "app",
  prefix: "", text: "好的。", status: "done", cost_usd: 0, steps: [], attachments: [],
  messages: [{seq: 1, kind: "reply", text: "好的。", at_ms: 1792807160000}], ...extra });
export default [
  scene("owner-addition", "An owner addition appears immediately beside continuing work and Stop", [member(1), type('.cmp-input', "也請保留原始檔案。"), key("Enter"), wait('.tn[data-id="901"] .owner-message'), waitGone('.tn[data-id="901"] .ra-face'), wait('.composer[data-task-state="running"]')],
    {running: true, runningMember: 1, ownerAddition: true}),
  scene("composer-send-while-working", "Words in the field make the slot Send while work runs; message after message goes out at once and nothing stops", [member(1), wait('.composer[data-task-state="running"]'), check("composer-slot-stop"), type('.cmp-input', "第一則補充"), check("composer-slot-send"), click('.cmp-send'), wait('.tn[data-id="901"] .owner-message'), check("composer-slot-stop"), type('.cmp-input', "第二則補充"), key("Enter"), wait('.tn[data-id="902"] .owner-message'), type('.cmp-input', "第三則補充"), key("Enter"), wait('.tn[data-id="903"] .owner-message'), check("composer-slot-stop"), check("owner-additions-in-order")],
    {running: true, runningMember: 1, ownerAddition: true}),
  scene("composer-queued", "Queued bubbles retain sent order, real withdraw controls and one live presence below the newest", [member(1), type('.cmp-input', "第二個範例請求"), key("Enter"), wait('.tn[data-id="901"] .queued-mark'), type('.cmp-input', "第三個範例請求"), key("Enter"), wait('.tn[data-id="902"] .queued-mark'), check("composer-queued")],
    {running: "fresh", runningMember: 1, queuedOwner: true}),
  scene("composer-queued-withdraw", "Withdrawing one queued bubble keeps the running work and returns the words", [member(1), type('.cmp-input', "第二個範例請求"), key("Enter"), wait('.tn[data-id="901"] .queued-mark'), click('.tn[data-id="901"] [data-act="more-message"]'), click('#app-popover [data-pick="cancel"]'), waitGone('.tn[data-id="901"]'), check("composer-queued-withdraw")],
    {running: "fresh", runningMember: 1, queuedOwner: true}),
  scene("composer-queued-stop", "Stop cancels the running turn and returns queued words after the existing draft", [member(1), type('.cmp-input', "第二個範例請求"), key("Enter"), wait('.tn[data-id="901"] .queued-mark'), type('.cmp-input', "第三個範例請求"), key("Enter"), wait('.tn[data-id="902"] .queued-mark'), type('.cmp-input', "目前草稿"), key("Escape"), key("Escape"), waitGone('.queued-mark'), check("composer-queued-stop")],
    {running: "fresh", runningMember: 1, queuedOwner: true}),
  scene("room-send-while-working", "A room clears sent words immediately and sends the next request in order", [room(1), wait('.au-room-thinking'), type('#room-message', "第一個範例請求"), key("Enter"), type('#room-message', "第二個範例請求"), key("Enter"), wait('.au-room-pane .chat-message'), check("room-send-while-working")], {roomThinking:true}),
  scene("composer-stop-armed-with-words", "Escape with words in the field still shows the Stop it arms, and the words stay", [member(1), wait('.composer[data-task-state="running"]'), type('.cmp-input', "還沒寫完"), key("Escape"), check("composer-slot-armed")],
    {running: true, runningMember: 1, ownerAddition: true}),
  scene("link-chips", "A reply's links are chips in its words, the site's mark then its name, and the page's preview shows under the pointer", [member(1), wait('.thread a.link-chip[data-link-state]'), check("link-chips"), hover('.thread .chat-message[data-reply] a.link-chip[data-link-title]'), wait('.link-hover'), check("link-hover")],
    {turns: [turn(1, {attachments: [], text: "開好了", messages: [{seq: 1, kind: "reply", text: "開好了 http://127.0.0.1:5173/ https://example.com/a", at_ms: 1792807160000}]})]}),
  scene("dialog-caption-confirm", "A small dialog dims the caption too, and the window buttons still answer", [{action: "member-column", collapsed: false}, click('.mb-col [data-member-more="0"]'), click('#app-popover [data-pick="primary"]'), wait(".mb-dialog.mb-primary-picker"), check("dialog-caption")]),
  scene("owner-bubble-member", "The owner's bubble in a member's conversation wears that member's colour", [member(1), wait('.owner-message .bubble'), check("owner-bubble-tinted")], {turns: [turn(1), turn(0)]}),
  scene("owner-bubble-other-member", "Another member's conversation has its own colour", [member(2), wait('.owner-message .bubble'), check("owner-bubble-tinted")],
    {turns: [turn(2, {conversation_id: 12})], conversations: [...fixture.conversations, {...fixture.conversations.find(item => item.id === 11), id: 12, member_id: 2}]}),
  scene("owner-bubble-light-character", "A light character keeps its colour and takes dark words", [member(1), wait('.owner-message .bubble'), check("owner-bubble-dark-words")],
    {turns: [turn(1)], members: fixture.members.map(item => item.id === 1 ? {...item, avatar: "slime:testarossa"} : item)}),
  scene("owner-bubble-long", "A long tinted bubble keeps its link and expand control readable", [member(1), wait('.owner-message .bubble'), check("owner-bubble-tinted")], {turns: [turn(1, {question: `請看這個連結 https://example.com/a\n${"這是一段很長的需求說明，要確定展開按鈕和連結在角色顏色上都看得清楚。".repeat(14)}`})]}),
  scene("owner-bubble-chief", "Raphael's own conversation wears his blue like any member's", [member(0), wait('.owner-message .bubble'), check("owner-bubble-tinted")], {turns: [turn(1), turn(0)]}),
  scene("owner-bubble-room", "A group talks to everyone, so its bubbles stay neutral", [member(1), room(1), wait('.au-room-pane .owner-message .bubble, .au-room-pane .bubble'), check("owner-bubble-neutral")]),
];
