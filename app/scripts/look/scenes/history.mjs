import { scene, type, wait, room, check, key, ime } from "./steps.mjs";

const field = ".composer .cmp-input";
const focus = selector => ({ action: "focus", selector });
// What the owner typed, newest first, as the core lists it (agent.history.sent): one with an address, so that a recalled line shows its chip.
const typedHistory = ["請 @小森 看一下這份報告", "整理這週的研究重點", "明天早上要帶傘嗎？"];
const draft = "還沒寫完的草稿";

export default [
  scene("composer-history-recall", "Up brings back the last thing typed (its address a chip) and Up again the one before; Down walks forward and ends on the draft",
    [type(field, draft), key("ArrowUp"), wait(".composer .cmp-field.has-mentions"), check("composer-history-recall"), key("ArrowUp"), check("composer-history-second"),
      key("ArrowUp"), key("ArrowUp"), check("composer-history-oldest"), key("ArrowDown"), key("ArrowDown"), key("ArrowDown"), check("composer-history-draft")], { typedHistory }),
  scene("composer-history-send", "A recalled line edited and sent goes out as edited, the original stays in the history, and Up finds it again",
    [focus(field), key("ArrowUp"), key("ArrowUp"), ime(field, [{ commit: "，並附上來源" }]), key("Enter"), wait(".tn.is-pending"), check("composer-history-sent"), key("ArrowUp"), key("ArrowUp"), check("composer-history-original")],
    { typedHistory, stopPending: true }),
  scene("composer-history-menu", "While a mention menu is open the arrows belong to the menu, not to the history",
    [type(field, "@"), wait("#app-popover[data-team-mentions]"), key("ArrowUp"), check("composer-history-menu")], { typedHistory }),
  scene("composer-history-room", "A room's composer walks the same history",
    [room(1), focus("#room-message"), key("ArrowUp"), check("composer-history-room")], { typedHistory }),
];
