import { scene, check, click, focus, frameExpect, frameScroll, key, lookCall, member, room, scroll, type, wait } from "./steps.mjs";

const shown = [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#buy" }];
// A page in a card is only a preview (inert): the owner presses the card and the page opens in the conversation's place, where it
// works (owner, 2026-11-11: a page replaces the conversation like Grok Bot's, with no dialog; the arrow at the header's top left goes back).
const larger = [click(".pg-card .pg-body"), wait(".pgv-frame-box iframe")];
const back = click('.mb-head [data-page-back]');
const news = [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#hide" }];
const newsFixture = { pageTurn: true, pageNews: "only" };
const roomShown = [room(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#buy" }];
const report = [member(1), wait(".pg-link"), click(".pg-link"), wait(".pgv:not([hidden]) .rp-team-draw")];
const share = [click(".mb-head .ra-tools > [data-page-act]"), wait(".toast")];
const draft = "還沒送出的草稿";

export default [
  scene("page-product", "A member shows a product page as a card: its title row and the top of the page, clipped, nothing in it to press", [...shown, check("page-card")], { pageTurn: true }),
  scene("page-buy", "Page text appends to the focused draft without sending", [...shown, type('.page-agent .cmp-input', "我原本的草稿"), ...larger, { action: "frame-click", selector: "#buy" }, wait(".page-agent .cmp-page-note"), check("page-appended")], { pageTurn: true }),
  scene("page-composer-grows", "Lines typed under a thread whose last item is a card grow the composer, and the thread stays at its bottom", [...shown, check("composer-grows-before"), type('.page-agent .cmp-input', "這是一段很長的草稿，一直寫到換好幾行為止。".repeat(14)), { action: "wait-scroll-end", selector: ".mb-chat .ra-scroll" }, check("composer-grows-keeps-bottom")], { pageTurn: true }),
  scene("page-send", "Only the owner's send submits text placed by a page", [...shown, ...larger, { action: "frame-click", selector: "#buy" }, wait(".page-agent .cmp-page-note"), check("page-placed"), click('.page-agent .cmp-send'), check("page-spoke")], { pageTurn: true }),
  scene("page-expand", "Pressing the card opens the page in the conversation's place, the same frame, with no dialog", [...shown, ...larger, check("page-expanded")], { pageTurn: true }),
  scene("page-expand-place", "An open page places text in the composer under it and stays open", [...shown, ...larger, { action: "frame-click", selector: "#buy" }, wait(".page-agent .cmp-page-note"), check("page-placed")], { pageTurn: true }),
  scene("page-room-draft", "Room page text preserves the owner's draft and shows the same provenance note", [...roomShown, type('.au-room-pane .cmp-input', "我原本的草稿"), ...larger, { action: "frame-click", selector: "#buy" }, check("page-appended")], { pageTurn: true, roomOwnerCard: "page" }),
  // A page far taller than its card (owner, 2026-11-11): the card shows only its top, in a conversation and in a room, two of them in one thread, and a press opens it whole.
  scene("page-collapsed", "A page much taller than its card shows only its top under the title, faded at the cut, and the thread stays short", [...news, check("page-collapsed")], newsFixture),
  scene("page-collapsed-room", "The same card in a room: the same height, the same fade", [room(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#hide" }, check("page-collapsed")], { ...newsFixture, roomOwnerCard: "result" }),
  scene("page-collapsed-two", "Two pages in one thread are two cards of the same height, and the thread still reads as a conversation", [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#buy" }, check("page-collapsed-two")], { pageTurn: true, pageNews: "both" }),
  scene("page-collapsed-press", "Pressing the preview opens the whole page in the conversation's place, scrolling and operable", [...news, check("page-collapsed"), ...larger, check("page-opened-whole")], newsFixture),
  scene("page-collapsed-key", "The card is one control: Tab reaches it and Enter opens the whole page", [...news, focus(".pg-card .pg-body"), key("Enter"), wait(".pgv-frame-box iframe"), check("page-opened-whole")], newsFixture),
  scene("page-gone", "A page that cannot open says what it knows and offers another try", [member(1), wait(".pg-failed:not([hidden])"), check("page-gone")], { pageTurn: true, pageGone: true }),
  // A page replaces the conversation (owner, 2026-11-11; R-PAGE-01, R-PAGE-02): the thread's place, the arrow at the header's top left, the composer below.
  scene("page-inplace", "A tall HTML page open in the conversation's place: its title, the round back arrow at the header's top left, the composer below, no dialog", [...news, ...larger, check("page-inplace")], newsFixture),
  scene("page-inplace-back", "The arrow brings back the thread read higher up exactly where it was, the card holding the same frame, nothing reloaded", [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#hide" }, { ...scroll(".pg-card"), block: "center" }, wait(".pg-card .pg-more"), { ...scroll(".pg-card"), block: "center" }, check("page-inplace-before"), ...larger, frameScroll(300), back, check("page-inplace-kept")], { ...newsFixture, longThread: true }),
  scene("page-inplace-esc", "Escape goes back to the conversation and leaves the draft in the composer as it was", [...news, type('.page-agent .cmp-input', draft), ...larger, key("Escape"), check("page-inplace-escaped")], newsFixture),
  scene("page-inplace-update", "The member changes the page while it is open: it updates where the owner was reading, nothing closes or blinks, the conversation keeps one card", [...news, ...larger, frameScroll(300), frameExpect("", 40), check("page-watch"), lookCall("updatePage", "page-news"), frameExpect("練習問題（已更新）", 40), check("page-inplace-updated")], newsFixture),
  scene("page-inplace-working", "While the member works on a change asked for under the open page, its working line shows under the page and the page stays", [...news, ...larger, type('.page-agent .cmp-input', "把最後一題改成問今天的新聞"), click('.page-agent .cmp-send'), wait(".pgv-status .live-action"), check("page-inplace-working")], { ...newsFixture, pageAsk: true }),
  scene("page-inplace-reply", "A change asked for under the open page goes to the member with the page named; its working line shows under the page, then the first words of its reply", [...news, ...larger, type('.page-agent .cmp-input', "把最後一題改成問今天的新聞"), click('.page-agent .cmp-send'), wait(".pgv-status .live-action"), check("page-inplace-working"), lookCall("updatePage", "page-news"), lookCall("answerPageAsk", "好了，最後一題改成問今天的新聞，其他沒有動。"), wait(".pgv-status .pgv-reply"), check("page-inplace-answered")], { ...newsFixture, pageAsk: true }),
  scene("page-inplace-room", "A room's page opens in the room's place the same way: its arrow at the header's top left, the room's composer below", [...roomShown, ...larger, check("page-inplace")], { pageTurn: true, roomOwnerCard: "page" }),
  scene("page-inplace-room-update", "A page changed while open in a room updates in place and the room keeps one card", [...roomShown, ...larger, check("page-watch"), lookCall("updatePage", "page-product"), frameExpect("NT$ 990", 0), check("page-inplace-updated")], { pageTurn: true, roomOwnerCard: "page" }),
  // A report (report-page.ts) opens in the same place, and goes back by the same arrow: a link card in the reply, the composer below.
  scene("page-report-card", "A member's report is a link card in its reply: its icon, its title and 「頁面」, no frame", [member(1), wait(".pg-link"), check("page-report-card")], { reportTurn: true }),
  scene("page-report", "The link card opens the report in the conversation's place, with its date, its contents and the composer below", [...report, check("page-report-open")], { reportTurn: true }),
  scene("page-report-team", "The contents take the owner to the team: boxes in each member's colour joined by labelled arrows", [...report, click('.rp-toc [data-report-goto="rp-s2"]'), check("page-report-team")], { reportTurn: true }),
  scene("page-report-tab", "A tab over the table shows only its group's rows", [...report, { ...scroll(".rp-table-box"), block: "center" }, click('.rp-table-box [data-report-tab="g1"]'), check("page-report-tab")], { reportTurn: true }),
  scene("page-report-close", "The header's arrow brings the thread back where it was, with the link card in sight", [...report, back, check("page-report-closed")], { reportTurn: true }),
  // Share (owner, 2026-11-10: 存成檔案): the report saved as one HTML file, and that file opened on its own, as a browser opens it.
  scene("page-report-share", "Share saves the report as a file and says where it went, and the report stays open", [...report, ...share, check("page-report-shared")], { reportTurn: true }),
  { ...scene("page-report-file", "The saved file opened on its own: the same page in its reader's theme, with nothing of the app", [...report, ...share, { action: "saved-file" }, check("page-report-file")], { reportTurn: true }), file: true },
  { ...scene("page-report-file-team", "The file's contents take its reader to the team, drawn for the width it is read at", [...report, ...share, { action: "saved-file" }, click('.rp-toc a[href="#rp-s2"]'), check("page-report-file-team")], { reportTurn: true }), file: true },
];
