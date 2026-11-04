import { scene, check, click, member, wait } from "./steps.mjs";

const shown = [member(1), wait('.pg-body[data-state="ready"] iframe'), { action: "frame-wait", selector: "#buy" }];

export default [
  scene("page-product", "A member shows an operable product page, as tall as its content, in the reply", [...shown, check("page-card")], { pageTurn: true }),
  scene("page-buy", "A press inside the page becomes the owner's next message", [...shown, { action: "frame-click", selector: "#buy" }, check("page-spoke")], { pageTurn: true }),
  scene("page-expand", "A page can be made larger without losing what is in it", [...shown, click('.pg-card [data-page-act="expand"]'), wait(".pg-view iframe"), check("page-expanded")], { pageTurn: true }),
  scene("page-gone", "A page that cannot open says what it knows and offers another try", [member(1), wait(".pg-failed:not([hidden])"), check("page-gone")], { pageTurn: true, pageGone: true }),
];
