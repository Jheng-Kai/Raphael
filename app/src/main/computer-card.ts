// A computer card: when the computer task in a chat reaches a sign-in, a password or a payment, that turn shows
// the owner's turn at the computer. The task is paused and the computer is theirs: Raphael asks it for nothing
// until they press 我完成了, which gives it back once; 停止 ends the task for good. The card names the window to
// use (the app, never a title) and why it is theirs. A form that still needs the owner can ask again.
// Every state comes from the core (`computer.handback`). Nothing here keeps what was on the screen or typed.

import { cardHTML, cardPromptText, waitingCloseHTML } from "./card";
import { t } from "./i18n";
import type { AgentTurn, ComputerCard } from "./types";
import { btn, esc, ico } from "./ui";

/** Why Chrome could not choose the certificate by itself, as the core says it on the card (a code, never words): what happened
 *  in one sentence, then the window the owner chooses in and the button that ends the step (R-COMP-CERT-02). */
export function certificateNoteText(note: string | null | undefined, window: string, done: string): string | undefined {
  if (note === "certificate_refused") return t("memberComputer.certificateRefused", { p0: window, p1: done });
  if (note === "certificate_unmatched") return t("memberComputer.certificateUnmatched", { p0: window, p1: done });
  return undefined;
}

/** Why it is the owner's, naming the window to use. */
function reasonText(reason: string, window: string): string {
  switch (reason) {
    case "sign_in": return t("card.pcSignIn", { p0: window });
    case "password": return t("card.pcPassword", { p0: window });
    case "payment": return t("card.pcPayment", { p0: window });
    case "two_factor": return t("memberComputer.verification", { p0: window });
    case "certificate": return t("memberComputer.certificate", { p0: window, p1: t("card.pcDone") });
    case "captcha": return t("card.pcCaptcha", { p0: window });
    default: return t("card.pcOther", { p0: window });
  }
}

/** The window to use: the app's name, or the computer itself when the task had looked at no window. */
const windowOf = (card: ComputerCard): string => card.app || t("card.pcTitle");

/** What the card says of where the owner's turn stands. */
export function computerStateText(card: ComputerCard): string {
  const certificate = card.reason === "certificate" ? certificateNoteText(card.note, windowOf(card), t("card.pcDone")) : undefined;
  return certificate ?? (card.browser && card.note && card.note !== "still" ? card.note : reasonText(card.reason, windowOf(card)));
}

export function computerCardHTML(card: ComputerCard): string {
  if (card.state !== "control") return "";
  const on = (act: string): string => ` data-act="${act}" data-card="${esc(card.id)}"`;
  return cardHTML({ title: t("card.pcTitle"), status: "waiting", statusText: cardPromptText("computer"), body: computerStateText(card),
    content: `<div class="card-computer-screen" data-card-screen><button type="button" class="btn"${on("card-takeover")} aria-label="${esc(t("cards.takeover"))}">${ico("monitor")}</button></div>` +
      (card.note === "still" ? `<p class="card-body">${esc(t("card.pcStill"))}</p>` : ""),
    actions: btn(esc(t("cards.takeover")), "sm pri", on("card-takeover")) + btn(esc(t("card.pcDone")), "sm", on("card-done")), cls: "computer-card",
    close: waitingCloseHTML(on("card-stop"), t("cards.skip")), statusInHeading: true,
    attrs: ` data-computer-card="${esc(card.id)}" data-card-state="control"${card.note ? ` data-card-note="${esc(card.note)}"` : ""}`,
  });
}

/** The cards of the owner's turn at the computer a turn handed over, below what it said. */
export function computerCardsHTML(turn: AgentTurn): string {
  return (turn.computers ?? []).map(computerCardHTML).join("");
}

