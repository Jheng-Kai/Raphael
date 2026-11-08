import "./card.css";
import { t } from "./i18n";
import { btn, esc, ico, iconBtn } from "./ui";

export type CardStatus = "waiting" | "ready" | "done" | "failed";
const CARD_PROMPTS = { key: "cards.inputWaiting", question: null, handover: "cards.answerWaiting", computer: "cards.needsYou", permission: "cards.waiting", draft: "cards.mailReady", connect: "cards.needsYou" } as const;
export const cardPromptText = (kind: keyof typeof CARD_PROMPTS): string | undefined => CARD_PROMPTS[kind] ? t(CARD_PROMPTS[kind]) : undefined;
export interface CardOptions {
  title: string;
  status: CardStatus;
  statusText?: string;
  hideStatus?: boolean;
  mark?: string;
  body?: string;
  content?: string;
  actions?: string;
  close?: string;
  cls?: string;
  attrs?: string;
}

export function cardStatusHTML(status: CardStatus, text?: string): string {
  return `<span class="card-status is-${status}" role="status"><i aria-hidden="true"></i><span data-card-status-text>${esc(text ?? t(({waiting: "cards.waiting", ready: "cards.ready", done: "cards.done", failed: "cards.failed"} as const)[status]))}</span></span>`;
}

/** The × at a card's top right that puts a failed card away (owner, 2026-11-08: a ×, never a 「關閉」 under it). */
const failedClose = (): string => iconBtn("x", t("common.close"), " data-card-failed-close", "card-close");

export function cardHTML(card: CardOptions): string {
  const actions = card.actions ?? "";
  const close = card.close ?? (card.status === "failed" ? failedClose() : "");
  return `<section class="conversation-card connector-card ${card.cls ?? ""}"${card.attrs ?? ""} role="group" aria-label="${esc(card.title)}">` +
    `<header class="card-head"><div class="card-heading">${card.mark ?? ""}<b class="card-title cc-name">${esc(card.title)}</b></div>` +
    (card.hideStatus ? "" : cardStatusHTML(card.status, card.statusText)) + close + `</header>` +
    (card.body ? `<p class="card-body cc-state">${esc(card.body)}</p>` : "") +
    (card.content ?? "") + (actions ? `<footer class="card-actions cc-actions">${actions}</footer>` : "") + `</section>`;
}

export function cardDisclosureHTML(id: string, content: string, label = t("cards.show"), openLabel?: string): string {
  if (!content.trim()) return "";
  const open = openLabel ? ` data-open-label="${esc(openLabel)}"` : "";
  return `<div class="card-disclosure">${btn(`${ico("right")}<span>${esc(label)}</span>`, "card-disclosure-toggle", ` data-card-disclosure aria-expanded="false" aria-controls="card-detail-${esc(id)}"${open}`)}<div class="card-detail" id="card-detail-${esc(id)}" hidden>${content}</div></div>`;
}

if (typeof document !== "undefined") document.addEventListener("click", event => {
  const close = (event.target as Element).closest("[data-card-failed-close]");
  if (close) { const card = close.closest<HTMLElement>(".conversation-card"); if (card) card.hidden = true; return; }
  const button = (event.target as Element).closest<HTMLButtonElement>("[data-card-disclosure]");
  const detail = button?.parentElement?.querySelector<HTMLElement>(".card-detail");
  if (!button || !detail) return;
  detail.hidden = !detail.hidden;
  button.setAttribute("aria-expanded", String(!detail.hidden));
  const label = button.querySelector("span");
  if (label) {
    button.dataset.closedLabel ??= label.textContent ?? t("cards.show");
    label.textContent = detail.hidden ? button.dataset.closedLabel : button.dataset.openLabel ?? t("cards.hide");
  }
});

export function cardFailure(card: Element | null, retry: () => void, dismiss?: () => void): boolean {
  if (!card) return false;
  let failure = card.querySelector<HTMLElement>(":scope > .card-failure");
  if (!failure) { failure = document.createElement("div"); failure.className = "card-failure"; card.append(failure); }
  const original = [...card.querySelectorAll<HTMLElement>(":scope > .card-actions")];
  original.forEach(footer => { footer.hidden = true; });
  const status = card.querySelector(".card-status");
  const prior = status?.outerHTML;
  // 重試 below what went wrong; putting it away is the × at the card's top right, not a 「關閉」 beside 重試 (owner, 2026-11-08).
  const head = card.querySelector<HTMLElement>(":scope > .card-head");
  let dismissButton = head?.querySelector<HTMLElement>("[data-card-dismiss]") ?? null;
  const clear = (): void => { failure!.remove(); dismissButton?.remove(); original.forEach(footer => { footer.hidden = false; }); if (prior) { const pill = card.querySelector(".card-status"); if (pill) pill.outerHTML = prior; } };
  if (status) status.outerHTML = cardStatusHTML("failed", t("cards.failed"));
  failure.innerHTML = `<p role="alert">${esc(t("cards.retained"))}</p><div class="card-actions">${btn(esc(t("cards.retry")), "sm pri", " data-card-retry")}</div>`;
  if (head && !dismissButton) {
    head.insertAdjacentHTML("beforeend", iconBtn("x", t("common.close"), " data-card-dismiss", "card-close"));
    dismissButton = head.querySelector<HTMLElement>("[data-card-dismiss]");
  }
  failure.querySelector("[data-card-retry]")!.addEventListener("click", () => { clear(); retry(); });
  dismissButton?.addEventListener("click", () => { clear(); dismiss?.(); }, { once: true });
  return true;
}
