import { scene, check, click, member, room, scroll, type, wait } from "./steps.mjs";

const shown = [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#buy" }];
const report = [member(1), wait(".pg-link"), click(".pg-link"), wait(".rp-view:not([hidden]) .rp-team-draw")];
const share = [click(".rp-view [data-report-act=share]"), wait(".toast")];

export default [
  scene("page-product", "A member shows an operable product page, as tall as its content, in the reply", [...shown, check("page-card")], { pageTurn: true }),
  scene("page-buy", "Page text appends to the focused draft without sending", [...shown, type('.page-agent .cmp-input', "我原本的草稿"), { action: "frame-click", selector: "#buy" }, { action: "wait-scroll-end", selector: ".mb-chat .ra-scroll" }, check("page-appended")], { pageTurn: true }),
  scene("page-composer-grows", "Lines typed under a thread whose last item is a card grow the composer, and the thread stays at its bottom", [...shown, check("composer-grows-before"), type('.page-agent .cmp-input', "這是一段很長的草稿，一直寫到換好幾行為止。".repeat(14)), { action: "wait-scroll-end", selector: ".mb-chat .ra-scroll" }, check("composer-grows-keeps-bottom")], { pageTurn: true }),
  scene("page-send", "Only the owner's send submits text placed by a page", [...shown, { action: "frame-click", selector: "#buy" }, { action: "wait-scroll-end", selector: ".mb-chat .ra-scroll" }, check("page-placed"), click('.page-agent .cmp-send'), check("page-spoke")], { pageTurn: true }),
  scene("page-expand", "A page can be made larger without losing what is in it", [...shown, click('.pg-card [data-page-act="expand"]'), wait(".pg-view iframe"), check("page-expanded")], { pageTurn: true }),
  scene("page-expand-place", "An expanded page returns focus to its conversation draft", [...shown, click('.pg-card [data-page-act="expand"]'), wait(".pg-view iframe"), { action: "frame-click", selector: "#buy" }, { action: "wait-scroll-end", selector: ".mb-chat .ra-scroll" }, check("page-placed")], { pageTurn: true }),
  scene("page-room-draft", "Room page text preserves the owner's draft and shows the same provenance note", [room(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#buy" }, type('.au-room-pane .cmp-input', "我原本的草稿"), { action: "frame-click", selector: "#buy" }, check("page-appended")], { pageTurn: true, roomOwnerCard: "page" }),
  scene("page-gone", "A page that cannot open says what it knows and offers another try", [member(1), wait(".pg-failed:not([hidden])"), check("page-gone")], { pageTurn: true, pageGone: true }),
  // A report (report-page.ts): a link card in the reply that opens the page in the thread's place, the composer below.
  scene("page-report-card", "A member's report is a link card in its reply: its icon, its title and 「頁面」, no frame", [member(1), wait(".pg-link"), check("page-report-card")], { reportTurn: true }),
  scene("page-report", "The link card opens the report over the conversation, with its date, its contents and the composer below", [...report, check("page-report-open")], { reportTurn: true }),
  scene("page-report-team", "The contents take the owner to the team: boxes in each member's colour joined by labelled arrows", [...report, click('.rp-toc [data-report-goto="rp-s2"]'), check("page-report-team")], { reportTurn: true }),
  scene("page-report-tab", "A tab over the table shows only its group's rows", [...report, { ...scroll(".rp-table-box"), block: "center" }, click('.rp-table-box [data-report-tab="g1"]'), check("page-report-tab")], { reportTurn: true }),
  scene("page-report-close", "The × brings the thread back where it was, with the link card in sight", [...report, click(".rp-view [data-report-act=close]"), check("page-report-closed")], { reportTurn: true }),
  // Share (owner, 2026-11-10: 存成檔案): the report saved as one HTML file, and that file opened on its own, as a browser opens it.
  scene("page-report-share", "Share saves the report as a file and says where it went, and the report stays open", [...report, ...share, check("page-report-shared")], { reportTurn: true }),
  { ...scene("page-report-file", "The saved file opened on its own: the same page in its reader's theme, with nothing of the app", [...report, ...share, { action: "saved-file" }, check("page-report-file")], { reportTurn: true }), file: true },
  { ...scene("page-report-file-team", "The file's contents take its reader to the team, drawn for the width it is read at", [...report, ...share, { action: "saved-file" }, click('.rp-toc a[href="#rp-s2"]'), check("page-report-file-team")], { reportTurn: true }), file: true },
];
