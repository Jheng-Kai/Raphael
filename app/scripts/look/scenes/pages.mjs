import { scene, check, click, focus, frameCheck, frameExpect, frameScroll, hover, key, lookCall, member, room, scroll, type, wait } from "./steps.mjs";

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
const dashboardLink = '.pg-link[data-page="page-dashboard"]', dashboardFixture = { dashboardTurn: true };
const dashboard = [member(0), wait(dashboardLink), click(dashboardLink), wait(".pgv:not([hidden]) .rs-tiles")];
// A document-style report (owner, 2026-11-14, after Grok Bot's Tokyo list), and an HTML page that writes no style of its own (R-PAGE-06).
const document_ = [member(1), wait(".pg-link"), click(".pg-link"), wait(".pgv:not([hidden]) .rp-table")];
const documentFixture = { documentTurn: true };
const dropdown = "[data-report-filter]";
const pick = value => click(`.menu .menu-choice[data-value="${value}"]`);
const baseOpen = [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "table" }, click(".pg-card .pg-body"), wait(".pgv-frame-box iframe"), { action: "frame-wait", selector: ".kpis" }];
const baseFixture = { baseTurn: true, pageBase: true };

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
  // The owner speaks with a page open (voice-mode.ts, page-view.css): the thread is hidden under the page, so Raphael's flyer stays in front of it, while he speaks and while his words are heard, and leaves with them.
  ...[["listening", "While the owner speaks over an open page, Raphael stands in front of the page, above the composer, and the page stays operable under him"],
    ["hearing", "The recording is over and the words are being heard: Raphael stays in front of the page, turning, until they are in"],
    ["gone", "When the words are in or the dictation ends, Raphael is gone from in front of the page and the composer is at rest"]].map(([phase, words], at) => scene(`voice-over-page-${phase}`, words, [
    ...news, ...larger, { action: "press-voice" }, wait(".ra-stage.is-page > .ra-flyer canvas.ra-flyer-emblem"), { action: "emit", events: [{ type: "VoiceLevel", value: 0.6 }], wait: 900 },
    ...(at === 0 ? [check("voice-over-page-listening")] : [click(".page-agent .composer .cmp-voice"), wait('.page-agent .composer[data-task-state="ack"]'), { action: "emit", events: [], wait: 700 }, check("voice-over-page-hearing")]),
    ...(at === 2 ? [{ action: "emit", events: [{ type: "Dictation", phase: "cancelled", agent: true, member_id: 1 }], wait: 900 }, check("voice-over-page-gone")] : [])],
    { ...newsFixture, ownerVoice: "pending", emblem: true })),
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
  // Raphael's daily overview (owner, 2026-11-14: the old home becomes the page a 07:00 routine sends; every kind of chart, as
  // clean as Grok Bot's): figures, weather, schedule, projects by status and owner, investments, members, on one report.
  scene("page-dashboard-card", "The 07:00 routine's turn in Raphael's conversation: a few words of what it did, then the overview's link card", [member(0), wait(dashboardLink), check("page-dashboard-card")], dashboardFixture),
  scene("page-dashboard", "The overview opens in the conversation's place: tiles of today's figures, then charts side by side where the page is wide", [...dashboard, check("page-dashboard")], dashboardFixture),
  scene("page-dashboard-projects", "Projects by status and owner as stacked columns with their totals; pointing at one shows who has how many", [...dashboard, { ...scroll('[data-report-chart="5"]'), block: "center" }, hover('[data-report-chart="5"] .rc-band[data-i="2"]'), wait(".rc-tip"), check("page-dashboard-projects")], dashboardFixture),
  scene("page-dashboard-lines", "Investments as lines from one start, with a gap on a closed day; pointing shows each line's value on that day", [...dashboard, { ...scroll('[data-report-chart="6"]'), block: "center" }, hover('[data-report-chart="6"] .rc-plot'), wait(".rc-tip"), check("page-dashboard-lines")], dashboardFixture),
  scene("page-dashboard-lower", "The lower half: a ring of parts beside its names and shares, bars across, and the members' routines", [...dashboard, { ...scroll('[data-report-chart="8"]'), block: "center" }, check("page-dashboard-lower")], dashboardFixture),
  // A document, as Grok Bot's pages are (owner, 2026-11-14: 「你也可以看到 grokBots 跟我們實質性的差距…他們內部的 page，我覺得他們做得非常的好」): a large
  // title and one line of summary, a box that lists the sections, a note with an icon, a dropdown and tabs over a wide table with figures
  // at the right and a column of links.
  scene("page-document", "A document-style report: a large title, a one-line summary, a boxed list of its sections, a note, then a table with a dropdown, tabs, figures at the right and links", [...document_, check("page-document")], documentFixture),
  scene("page-document-menu", "The dropdown over the table opens its values, 全部 and each area, hanging from the dropdown", [...document_, { ...scroll(".rp-table-box"), block: "start" }, click(dropdown), wait(".menu"), check("page-document-menu")], documentFixture),
  scene("page-document-filter", "A chosen area and a tab leave only the row they share; the dropdown says the area and the tab is the one chosen", [...document_, { ...scroll(".rp-table-box"), block: "start" }, click(dropdown), wait(".menu"), pick("原宿"), click('.rp-table-box [data-report-tab="g0"]'), check("page-document-filter")], documentFixture),
  scene("page-base", "An HTML page with no style of its own is drawn by the app's base style: a 32 px title, a boxed list, a note, tiles, tabs, a lined table with figures at the right, cards, a quote and code", [...baseOpen, frameCheck("page-base"), check("page-base")], baseFixture),
  scene("page-base-table", "The same page read down to its table: tabs as quiet words with the chosen one bold, a header row, hairlines, figures at the right, links in the theme's blue", [...baseOpen, frameCheck("page-base"), frameScroll(560), check("page-base")], baseFixture),
  scene("page-base-end", "The same page read to its end: cards in a grid, a quote with its rule, code, a list and a muted line", [...baseOpen, frameCheck("page-base"), frameScroll(1800), check("page-base")], baseFixture),
  { ...scene("page-dashboard-file", "The overview saved as a file and opened on its own: the same tiles and charts, with nothing that runs", [...dashboard, ...share, { action: "saved-file" }, check("page-dashboard-file")], dashboardFixture), file: true },
];
