import { scene, member, wait, waitGone, click, check } from "./steps.mjs";

// A card waiting for the owner, read out of sight (card-float.ts): a pill at the top names it, its press stands the card
// over the thread, and the back arrow scrolls to where the card was born.
const away = id => [member(id), wait('[data-secret-card="card-key"]'), { action: "conversation-position", position: "down" }, wait(".card-float:not([hidden])")];
const lift = [click(".card-float-open"), wait(".conversation-card.is-floating")];
const fixture = { keyCard: true, keyCardLater: true };
const raphael = { ...fixture, keyCardMember: 0 };

export default [
  scene("card-float-pill", "A waiting key card read out of sight leaves a pill in the member's slime colour", [...away(1), check("card-float-pill")], fixture),
  scene("card-float-open", "The pill's press stands the card itself over the thread, centred under it and as wide as it was", [...away(1), ...lift, check("card-float-open")], fixture),
  scene("card-float-collapse", "The floating card's close restores the pill and keeps the card waiting", [...away(1), ...lift, click(".conversation-card.is-floating .card-head .card-close"), waitGone(".conversation-card.is-floating"), check("card-float-collapse")], fixture),
  scene("card-float-back", "The back arrow scrolls to the card where it was born, and the pill goes", [...away(1), ...lift, click(".card-float-back"), waitGone(".card-float:not([hidden])"), check("card-float-back")], fixture),
  scene("card-float-raphael-pill", "A waiting key card in Raphael's thread leaves a pill in Raphael's colour", [...away(0), check("card-float-raphael-pill")], raphael),
  scene("card-float-raphael-open", "Raphael's waiting card opens under its pill", [...away(0), ...lift, check("card-float-raphael-open")], raphael),
];
