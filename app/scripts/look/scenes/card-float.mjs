import { scene, member, wait, waitGone, click, check } from "./steps.mjs";

// A card waiting for the owner, read out of sight (card-float.ts): a pill at the top names it, its press stands the card
// over the thread, and 回到原位 scrolls back to where the card was born.
const away = [member(1), wait('[data-secret-card="card-key"]'), { action: "conversation-position", position: "down" }, wait(".card-float:not([hidden])")];
const fixture = { keyCard: true, keyCardLater: true };

export default [
  scene("card-float-pill", "A waiting key card read out of sight leaves one pill at the top of the conversation", [...away, check("card-float-pill")], fixture),
  scene("card-float-open", "The pill's press stands the card itself over the thread under it, where it was across and as wide as it was", [...away, click(".card-float-open"), wait(".conversation-card.is-floating"), check("card-float-open")], fixture),
  scene("card-float-back", "回到原位 scrolls back to the card where it was born, and the pill goes", [...away, click(".card-float-open"), wait(".conversation-card.is-floating"), click(".card-float-back"), waitGone(".card-float:not([hidden])"), check("card-float-back")], fixture),
];
