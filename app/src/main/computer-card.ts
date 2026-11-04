// A computer card: when the computer task in a chat reaches a sign-in, a password or a payment, that turn shows
// the owner's turn at the computer. The task is paused and the computer is theirs: Raphael asks it for nothing
// until they press 我完成了, which gives it back once; 停止 ends the task for good. The card names the window to
// use (the app, never a title) and why it is theirs. When the form is still there after 我完成了 the card says
// so and the computer stays theirs; when the task ends after they gave it back it resumes once, as a turn that
// opens with one centred line.
// Every state comes from the core (`computer.handback`). Nothing here keeps what was on the screen or typed.

import { cardDisclosureHTML, cardHTML, cardPromptText } from "./card";
import { NAME, eventLineHTML } from "./event-line";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import type { AgentTurn, ComputerCard } from "./types";
import { btn, esc, ico } from "./ui";

const plain = (key: MessageKey): string => (t as (key: MessageKey) => string)(key);

/** Why it is the owner's, naming the window to use. */
function reasonText(reason: string, window: string): string {
  switch (reason) {
    case "sign_in": return t("card.pcSignIn", { p0: window });
    case "password": return t("card.pcPassword", { p0: window });
    case "payment": return t("card.pcPayment", { p0: window });
    case "captcha": return t("card.pcCaptcha", { p0: window });
    default: return t("card.pcOther", { p0: window });
  }
}

/** The window to use: the app's name, or the computer itself when the task had looked at no window. */
const windowOf = (card: ComputerCard): string => card.app || t("card.pcTitle");

/** What the card says of where the owner's turn stands. */
export function computerStateText(card: ComputerCard): string {
  switch (card.state) {
    case "control": return reasonText(card.reason, windowOf(card));
    case "returning": return plain("card.pcReturning");
    case "done": return plain("card.pcFinished");
    case "expired": return plain("card.expired");
    case "failed": return plain("card.pcInterrupted");
    default: return plain("card.stopped");
  }
}

/** The card's actions: 我完成了 and 停止 while the computer is the owner's, 停止 while the task checks. */
function actionHTML(card: ComputerCard): string {
  const on = (act: string): string => ` data-act="${act}" data-card="${esc(card.id)}"`;
  if (card.state === "control") return btn(esc(t("cards.takeover")), "sm pri", on("card-takeover")) + btn(esc(t("card.pcDone")), "sm", on("card-done")) + btn(esc(t("cards.skip")), "sm card-quiet", on("card-stop"));
  if (card.state === "returning") return btn(esc(t("card.pcStop")), "sm", on("card-stop"));
  return "";
}

export function computerCardHTML(card: ComputerCard): string {
  const active = card.state === "control";
  return cardHTML({ title: t("card.pcTitle"), status: active || card.state === "returning" ? "waiting" : card.state === "failed" ? "failed" : "done",
    statusText: active || card.state === "returning" ? cardPromptText("computer") : card.state === "failed" ? t("cards.failed") : t("cards.done"), body: active ? computerStateText(card) : undefined,
    content: active ? `<div class="card-computer-screen" data-card-screen><button type="button" class="btn" data-act="card-takeover" data-card="${esc(card.id)}" aria-label="${esc(t("cards.takeover"))}">${ico("monitor")}</button></div>` +
      (card.note === "still" ? `<p class="card-body">${esc(t("card.pcStill"))}</p>` : "") : cardDisclosureHTML(card.id, `<p class="card-body">${esc(computerStateText(card))}</p><p class="card-body">${esc(reasonText(card.reason, windowOf(card)))}</p>`),
    actions: actionHTML(card), cls: "computer-card", attrs: ` data-computer-card="${esc(card.id)}" data-card-state="${esc(card.state)}"${card.note ? ` data-card-note="${esc(card.note)}"` : ""}`,
  });
}

/** The cards of the owner's turn at the computer a turn handed over, below what it said. */
export function computerCardsHTML(turn: AgentTurn): string {
  return (turn.computers ?? []).map(computerCardHTML).join("");
}

/** The centred line a task resumed after the owner gave the computer back opens with, in place of the owner's words it carries on. */
export function computerResumedLineHTML(turn: AgentTurn): string {
  if (!(turn.resumed_computers ?? []).length) return "";
  return `<div class="conversation-event-line" data-resumed="${esc(turn.id)}">` +
    eventLineHTML(t("card.pcResumedLine", { p0: NAME }), ico("monitor"), t("card.pcTitle")) + `</div>`;
}
