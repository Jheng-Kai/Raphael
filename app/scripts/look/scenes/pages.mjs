import { scene, check, click, member, room, type, wait } from "./steps.mjs";

const shown = [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#buy" }];

export default [
  scene("page-product", "A member shows an operable product page, as tall as its content, in the reply", [...shown, check("page-card")], { pageTurn: true }),
  scene("page-buy", "Page text appends to the focused draft without sending", [...shown, type('.page-agent .cmp-input', "我原本的草稿"), { action: "frame-click", selector: "#buy" }, check("page-appended")], { pageTurn: true }),
  scene("page-send", "Only the owner's send submits text placed by a page", [...shown, { action: "frame-click", selector: "#buy" }, check("page-placed"), click('.page-agent .cmp-send'), check("page-spoke")], { pageTurn: true }),
  scene("page-expand", "A page can be made larger without losing what is in it", [...shown, click('.pg-card [data-page-act="expand"]'), wait(".pg-view iframe"), check("page-expanded")], { pageTurn: true }),
  scene("page-expand-place", "An expanded page returns focus to its conversation draft", [...shown, click('.pg-card [data-page-act="expand"]'), wait(".pg-view iframe"), { action: "frame-click", selector: "#buy" }, check("page-placed")], { pageTurn: true }),
  scene("page-room-draft", "Room page text preserves the owner's draft and shows the same provenance note", [room(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#buy" }, type('.au-room-pane .cmp-input', "我原本的草稿"), { action: "frame-click", selector: "#buy" }, check("page-appended")], { pageTurn: true, roomOwnerCard: "page" }),
  scene("page-gone", "A page that cannot open says what it knows and offers another try", [member(1), wait(".pg-failed:not([hidden])"), check("page-gone")], { pageTurn: true, pageGone: true }),
];
