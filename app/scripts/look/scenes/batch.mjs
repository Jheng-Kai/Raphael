import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scene, member, room, wait, waitGone, click, type, key, check, hover } from "./steps.mjs";
import { png } from "../media-fixture.mjs";

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, "../fixture.json"), "utf8"));

const turn = (member_id, extra = {}) => ({ id: 801 + member_id, member_id, conversation_id: member_id ? 11 : 1,
  session_id: "look-batch", created_at_ms: 1792807154000, question: "請整理這份資料。", route: "answer", source: "app",
  prefix: "", text: "好的。", status: "done", cost_usd: 0, steps: [], attachments: [],
  messages: [{seq: 1, kind: "reply", text: "好的。", at_ms: 1792807160000}], ...extra });
// A picture asked for, a message sent while the member worked on it (the core's owner_input row), and the work going on
// after it: the picture it made and the reply that answers that message.
const drawn = { id: `${"c".repeat(32)}.png`, name: "chart.png", mime: "image/png", size: 1727 };
const steered = [
  turn(1, { question: "請把開放日的公告做成一張海報。", text: "海報做好了，照你說的改用生成圖片。", messages: [
    {seq: 1, kind: "progress", text: "先排版面。", at_ms: 1792807156000},
    {seq: 2, kind: "media", text: JSON.stringify({attachment: drawn}), at_ms: 1792807170000},
    {seq: 3, kind: "reply", text: "海報做好了，照你說的改用生成圖片。", at_ms: 1792807172000}] }),
  turn(1, { id: 810, session_id: "look-steer", route: "owner_input", question: "生成一張圖片就好，不用自己排。", text: "", messages: [], created_at_ms: 1792807160000 }),
];
// Work still going in the background, the owner's next request answered meanwhile, then a message the core handed to that
// older work (issue 231): its answer comes after the message, so it stands under the message, below the turn in between.
const olderWork = [
  turn(1, { question: "把桌面上 4 號和 5 號的筆記連截圖一起放進 Notion。", text: "", status: "running", messages: [
    {seq: 1, kind: "reply", text: "好，我先把截圖一張張上傳。", at_ms: 1792807156000},
    {seq: 2, kind: "reply", text: "4 號和 5 號的筆記已經建好，截圖也上傳完了。我先檢查哪裡重複，再把 11 號補進去。", at_ms: 1792807200000}] }),
  turn(1, { id: 805, session_id: "look-between", created_at_ms: 1792807170000, question: "每天 18:00 幫我問學習群組今天做了什麼。",
    text: "每天 18:00 的詢問設好了。", messages: [{seq: 1, kind: "reply", text: "每天 18:00 的詢問設好了。", at_ms: 1792807180000}] }),
  turn(1, { id: 811, session_id: "look-older-steer", route: "owner_input", question: "等一下，你重複了，11 號也可以放進去。", text: "", messages: [], created_at_ms: 1792807190000 }),
];
// A colleague's question that came while the member worked on the computer: the work's start above the exchange line, the
// work going on under it (its live line while it runs, its answer once it is over).
const asked = { id: 812, session_id: "look-mid-exchange", member_id: 1, peer_id: 2, conversation_id: 11, scope: "exchange",
  created_at_ms: 1792807170000, question: "網站測試有什麼發現了嗎？", route: "exchange", source: "member", prefix: "",
  text: "首頁可以打開，其他頁面還在檢查。", detail: null, status: "done", cost_usd: 0, messages: [], steps: [], attachments: [] };
const midWork = (done) => [
  turn(1, { question: "請測試新網站的每一頁能不能正常打開。", text: done ? "測試完了，三個頁面都能正常打開。" : "", status: done ? "done" : "running", messages: [
    {seq: 1, kind: "reply", text: "好，我先在電腦上打開網站的資料夾。", at_ms: 1792807156000},
    {seq: 2, kind: "progress", text: "正在電腦上執行 cd", at_ms: 1792807185000},
    ...done ? [{seq: 3, kind: "reply", text: "測試完了，三個頁面都能正常打開。", at_ms: 1792807200000}] : []] }),
  asked,
];
const sendNowOrder = [
  turn(1, { id: 2072, question: "請測試新網站的每一頁。", status: "confirm", text: "", messages: [
    { seq: 1, kind: "reply", text: "我已經打開網站。", at_ms: 1792807156000 },
    { seq: 2, kind: "reply", text: "我會實測整頁。", at_ms: 1792807287000 },
  ], permissions: [{ id: "look-unapproved", source: "ask", kind: "tool", service: "GitHub", tool: "create_issue",
    summary: "建立測試紀錄。", reason: null, digest: "look-unapproved", always: false, state: "pending", expires_at_ms: 1792807400000 }] }),
  turn(1, { id: 2073, session_id: "look-send-now", created_at_ms: 1792807230000, question: "也請測試手機版。", status: "queued", text: "", messages: [] }),
];
export default [
  scene("owner-addition", "An owner addition appears immediately beside continuing work and Stop", [member(1), type('.cmp-input', "也請保留原始檔案。"), key("Enter"), wait('.tn[data-id="901"] .owner-message'), waitGone('.tn[data-id="901"] .ra-face'), wait('.composer[data-task-state="running"]')],
    {running: true, runningMember: 1, ownerAddition: true}),
  scene("owner-addition-answered", "A message sent while the work ran stands where it was sent, with what the work made after it and the reply below it", [member(1), wait('.tn[data-after="810"] img[data-attachment][src]'), check("owner-addition-in-place")],
    {turns: steered, generatedFile: drawn, generatedData: png}),
  scene("owner-addition-older-work", "A message taken by older work still under way stands last, with that work's answer under it, below the turn in between", [member(1), wait('.tn[data-after="811"] .chat-message[data-reply]'), check("owner-addition-older-work")],
    {turns: olderWork}),
  scene("exchange-mid-work", "A colleague's question that came while the member worked stands above the work's live line, under what the work said before it", [member(1), wait('.tn[data-after="812"] .live-presence'), check("exchange-mid-work")],
    {turns: midWork(false)}),
  scene("exchange-mid-work-answered", "Once that work is over, the answer it gave after the colleague's question stands under the exchange line", [member(1), wait('.tn[data-after="812"] .chat-message[data-reply]'), check("exchange-mid-work-answered")],
    {turns: midWork(true)}),
  scene("composer-send-while-working", "Words in the field make the slot Send while work runs; message after message goes out at once and nothing stops", [member(1), wait('.composer[data-task-state="running"]'), check("composer-slot-stop"), type('.cmp-input', "第一則補充"), check("composer-slot-send"), click('.cmp-send'), wait('.tn[data-id="901"] .owner-message'), check("composer-slot-stop"), type('.cmp-input', "第二則補充"), key("Enter"), wait('.tn[data-id="902"] .owner-message'), type('.cmp-input', "第三則補充"), key("Enter"), wait('.tn[data-id="903"] .owner-message'), check("composer-slot-stop"), check("owner-additions-in-order")],
    {running: true, runningMember: 1, ownerAddition: true}),
  scene("composer-queued", "Queued bubbles retain sent order, real withdraw controls and one live presence below the newest", [member(1), type('.cmp-input', "第二個範例請求"), key("Enter"), wait('.tn[data-id="901"] .queued-send-now'), type('.cmp-input', "第三個範例請求"), key("Enter"), wait('.tn[data-id="902"] .queued-send-now'), check("composer-queued")],
    {running: "fresh", runningMember: 1, queuedOwner: true}),
  scene("composer-queued-withdraw", "Withdrawing one queued bubble keeps the running work and returns the words", [member(1), type('.cmp-input', "第二個範例請求"), key("Enter"), wait('.tn[data-id="901"] .queued-send-now'), click('.tn[data-id="901"] .bubble [data-act="cancel-message"]'), waitGone('.tn[data-id="901"]'), check("composer-queued-withdraw")],
    {running: "fresh", runningMember: 1, queuedOwner: true}),
  scene("composer-queued-sendnow", "Send Now lets the queued message take over without withdrawing anything", [member(1), type('.cmp-input', "第二個範例請求"), key("Enter"), wait('.tn[data-id="901"] .queued-send-now'), click('.tn[data-id="901"] [data-act="send-now"]'), waitGone('.tn[data-id="901"] .queued-send-now'), check("composer-queued-sendnow")],
    {running: "fresh", runningMember: 1, queuedOwner: true}),
  scene("owner-sendnow-order", "Send Now puts the owner's message above the earlier work's later words and its own answer below them", [
    member(1), wait('.tn[data-id="2073"] .queued-send-now'), click('.tn[data-id="2073"] [data-act="send-now"]'),
    wait('.tn[data-id="2072"][data-after="2073"] [data-reply]'), wait('.tn[data-id="2073"] [data-reply]'), check("owner-sendnow-order"),
  ], { turns: sendNowOrder, sendNowAnswer: "手機版測試通過。" }),
  scene("composer-queued-sendnow-menu", "A queued bubble contains 取消 and 立即送出, with neither repeated in its menu", [member(1), type('.cmp-input', "第二個範例請求"), key("Enter"), wait('.tn[data-id="901"] .queued-send-now'), click('.tn[data-id="901"] [data-act="more-message"]'), wait('#app-popover [data-pick="copy"]'), check("composer-queued-sendnow-menu")],
    {running: "fresh", runningMember: 1, queuedOwner: true}),
  scene("composer-queued-stop", "Stop cancels the running turn and returns queued words after the existing draft", [member(1), type('.cmp-input', "第二個範例請求"), key("Enter"), wait('.tn[data-id="901"] .queued-send-now'), type('.cmp-input', "第三個範例請求"), key("Enter"), wait('.tn[data-id="902"] .queued-send-now'), type('.cmp-input', "目前草稿"), key("Escape"), key("Escape"), waitGone('.queued-send-now'), check("composer-queued-stop")],
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
    {turns: [turn(1)], members: fixture.members.map(item => item.id === 1 ? {...item, avatar: "slime:bowtie-pearl"} : item)}),
  scene("owner-bubble-long", "A long tinted bubble keeps its link and expand control readable", [member(1), wait('.owner-message .bubble'), check("owner-bubble-tinted")], {turns: [turn(1, {question: `請看這個連結 https://example.com/a\n${"這是一段很長的需求說明，要確定展開按鈕和連結在角色顏色上都看得清楚。".repeat(14)}`})]}),
  scene("owner-bubble-chief", "Raphael's own conversation wears its blue like any member's", [member(0), wait('.owner-message .bubble'), check("owner-bubble-tinted")], {turns: [turn(1), turn(0)]}),
  scene("owner-bubble-room", "A group talks to everyone, so its bubbles stay neutral", [member(1), room(1), wait('.au-room-pane .owner-message .bubble, .au-room-pane .bubble'), check("owner-bubble-neutral")]),
];
