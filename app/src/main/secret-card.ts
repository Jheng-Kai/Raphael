// A secret card: when a task in a chat needs a key that a connection declares and has none of, that turn
// shows the connection's card. The owner types the key into its masked field and saves it: it goes from the
// window straight to the core's vault (`integrations.card_save`) and nowhere else, and the task then resumes
// once. "Saved" and "resumed" are different things, and the card says which: a saved key whose task did not
// continue offers Try again, which resumes without asking for the key again.
// Every state comes from the core (`connectors.secret_cards`). Nothing here keeps what was typed: the field is
// read when Save is pressed and emptied at once, and a card drawn again takes the characters from the old
// field to the new one (`carryTyped`) so that a redraw does not cost what the owner was typing.

import { cardDisclosureHTML, cardHTML, cardPromptText } from "./card";
import { NAME, eventLineHTML } from "./event-line";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { SERVICE_ICONS, type MonoIconId, brandStyle, hasLogo, serviceIconOf, serviceIconSVG, serviceLogoHTML } from "./service-icons";
import type { AgentTurn, SecretCard } from "./types";
import { btn, esc, ico } from "./ui";

const FAILURES: Record<string, MessageKey> = {
  invalid: "card.keyInvalid",
  too_long: "card.keyTooLong",
  vault: "card.keyVault",
  gone: "card.keyGone",
};

const plain = (key: MessageKey): string => (t as (key: MessageKey) => string)(key);

/** The connection's mark: its own, bare, when its name says which program it is, else the generic plug (a line's icon, with `inline`). */
export function connectionMarkHTML(name: string, inline = false): string {
  const id = serviceIconOf({ name });
  if (id && hasLogo(id)) return `<span class="mono md logo-art">${serviceLogoHTML(id)}</span>`;
  if (id && id in SERVICE_ICONS) {
    const mono = id as MonoIconId;
    return `<span class="mono md logo-mono"${brandStyle(mono)}>${serviceIconSVG(mono)}</span>`;
  }
  return inline ? ico("plug") : `<span class="mono md" aria-hidden="true">${ico("plug")}</span>`;
}

/** Whether the card still waits for the owner to type the key. */
const typing = (card: SecretCard): boolean => card.state === "pending" || (card.state === "failed" && card.error !== "gone");

/** What the card says of where its key stands (the secret's own name while it waits). */
export function secretStateText(card: SecretCard): string {
  switch (card.state) {
    case "pending": return card.login ? t("card.loginHint") : card.secret;
    case "failed": return plain(FAILURES[card.error ?? ""] ?? "card.keyVault");
    case "saved": return plain(card.error ? "card.keyNotResumed" : "card.keySaved");
    case "resuming": return plain("card.keyResuming");
    case "resumed": return plain("card.keyResumed");
    case "expired": return plain("card.expired");
    default: return plain("card.stopped");
  }
}

/** The field and Save (or Try again), for the states that have an action. */
function actionHTML(card: SecretCard): string {
  const on = (act: string): string => ` data-act="${act}" data-card="${esc(card.id)}"`;
  if (typing(card)) {
    // A bot's token is named in the window's language; a connection's secret keeps its own declared name.
    const label = card.platform ? `${card.name} ${t("msg.tg.token")}` : `${card.name} ${card.secret}`;
    if (card.login) return `<div class="sc-form sc-login"><label><span>${esc(t("card.loginUser"))}</span><span class="field sc-field"><input data-login-user="${esc(card.id)}" autocomplete="off" spellcheck="false"></span></label>` +
      `<label><span>${esc(t("card.loginPassword"))}</span><span class="field sc-field">${ico("lock")}<input type="password" data-secret-input="${esc(card.id)}" autocomplete="off" spellcheck="false" autocapitalize="off"></span></label>` +
      btn(esc(t("card.keySave")), "sm pri", `${on("card-save")} disabled`) + `</div>`;
    return `<div class="sc-form"><label class="field sc-field">${ico("lock")}` +
      `<input type="password" data-secret-input="${esc(card.id)}" placeholder="${esc(card.login ? t("card.loginPassword") : card.platform ? t("msg.tg.tokenHint") : t("card.keyField"))}" aria-label="${esc(label)}" ` +
      `autocomplete="off" spellcheck="false" autocapitalize="off"></label>` +
      btn(esc(t("card.keySave")), "sm pri", `${on("card-save")} disabled`) + `</div>`;
  }
  if (card.state === "saved" && card.error) return btn(esc(t("card.retry")), "sm pri", on("card-resume"));
  return "";
}

/**
 * A bot token a member asked for in its conversation: where to make the bot, then the same masked
 * field; the core checks the token and connects the member's own bot (`connect_messaging`).
 */
const SLACK_SCOPES = ["im:read", "im:history", "chat:write", "files:read", "files:write"] as const;
function botCardHTML(card: SecretCard & { platform: "telegram" | "slack" | "discord" }): string {
  const active = typing(card);
  const failed = card.state === "failed" ? plain(card.error === "offline" ? "cards.botOffline" : card.error === "invalid" ? "cards.botInvalid" : (FAILURES[card.error ?? ""] ?? "card.keyVault")) : "";
  const make = btn(`<span>${esc(t(card.platform === "telegram" ? "cards.botFather" : "msg.createBot"))}</span>${ico("link")}`, "sm", ` data-act="bot-link" data-platform="${card.platform}"`);
  return cardHTML({ title: active ? t("cards.botTitle", { p0: card.name }) : card.name, mark: connectionMarkHTML(card.name),
    status: card.state === "failed" ? "failed" : active || card.state === "resuming" ? "waiting" : "done",
    statusText: active ? cardPromptText("key") : card.state === "resuming" ? t("cards.needsYou") : t("cards.done"),
    body: active ? failed || plain(card.platform === "telegram" ? "cards.botHowTelegram" : card.platform === "slack" ? "cards.botHowSlack" : "cards.botHowDiscord") : undefined,
    // Slack's scopes are names to copy, set apart as code beside the words.
    content: active ? (card.platform === "slack" ? `<p class="card-body bot-scopes">${SLACK_SCOPES.map((scope) => `<code>${scope}</code>`).join(" ")}</p>` : "") + `<div class="card-actions-inline">${make}</div>` + actionHTML(card) + `<p class="card-shield">${ico("lock")}<span>${esc(t("cards.vault"))}</span></p>` : "",
    cls: "secret-card bot-card", attrs: ` data-secret-card="${esc(card.id)}" data-card-state="${esc(card.state)}" data-platform="${card.platform}"${card.error ? ` data-card-error="${esc(card.error)}"` : ""}`,
  });
}

export function secretCardHTML(card: SecretCard): string {
  if (card.platform) return botCardHTML(card as SecretCard & { platform: "telegram" | "slack" | "discord" });
  const active = typing(card), action = actionHTML(card);
  return cardHTML({ title: active ? t("cards.connect", { p0: card.name }) : card.name, mark: connectionMarkHTML(card.name),
    status: card.state === "failed" || card.error ? "failed" : active || card.state === "resuming" ? "waiting" : "done",
    statusText: active ? cardPromptText("key") : card.error ? t("cards.failed") : card.state === "resuming" ? t("cards.needsYou") : t("cards.done"),
    body: active ? card.state === "failed" ? secretStateText(card) : t("cards.keyWhy") : card.error ? secretStateText(card) : undefined,
    content: active ? action + `<p class="card-shield">${ico("lock")}<span>${esc(t("cards.vault"))}</span></p>` + cardDisclosureHTML(`key-${card.id}`, `<div class="card-well card-body" data-secret-guide="${esc(card.name)}">${esc(card.login ? t("card.loginHint") : card.secret)}</div>`, t("setup.where")) : card.error ? "" : cardDisclosureHTML(`key-${card.id}`, `<p class="card-body">${esc(secretStateText(card))}</p>`),
    actions: active ? undefined : action,
    cls: "secret-card", attrs: ` data-secret-card="${esc(card.id)}" data-card-state="${esc(card.state)}"${card.error ? ` data-card-error="${esc(card.error)}"` : ""}`,
  });
}

/** The cards of the keys a turn waits for, below what it said. */
export function secretCardsHTML(turn: AgentTurn): string {
  return (turn.secrets ?? []).map(secretCardHTML).join("");
}

/** The centred line a task resumed after its key was saved opens with, in place of the owner's words it carries on. */
export function secretResumedLineHTML(turn: AgentTurn): string {
  const names = turn.resumed_secrets ?? [];
  if (!names.length) return "";
  return `<div class="conversation-event-line" data-resumed="${esc(turn.id)}">` +
    eventLineHTML(t("card.keyResumedLine", { p0: NAME }), connectionMarkHTML(names[0], true), names.join(" · ")) + `</div>`;
}

/**
 * A card drawn again keeps what the owner was typing: the characters of each field of `before` go to the
 * field of the same card in `after`, which takes the cursor too if it had it. Call the result once `after`
 * is in the page. The characters pass from one field to the next and are kept nowhere else.
 */
export function carryTyped(before: Element, after: Element): () => void {
  for (const old of before.querySelectorAll<HTMLButtonElement>("[data-card-disclosure][aria-expanded=true]")) {
    const fresh = [...after.querySelectorAll<HTMLButtonElement>("[data-card-disclosure]")].find(button => button.getAttribute("aria-controls") === old.getAttribute("aria-controls"));
    const detail = fresh?.parentElement?.querySelector<HTMLElement>(".card-detail");
    if (fresh && detail) { fresh.setAttribute("aria-expanded", "true"); fresh.dataset.closedLabel = old.dataset.closedLabel; fresh.innerHTML = old.innerHTML; detail.hidden = false; }
  }
  const kept: { id: string; value: string; focused: boolean; start: number | null; end: number | null }[] = [];
  const focus: { field: HTMLInputElement | HTMLTextAreaElement; start: number | null; end: number | null }[] = [];
  const resized: HTMLTextAreaElement[] = [];
  for (const oldCard of before.querySelectorAll<HTMLElement>("[data-mcp-proposal]")) {
    const freshCard = [...after.querySelectorAll<HTMLElement>("[data-mcp-proposal]")].find(card =>
      card.dataset.mcpProposal === oldCard.dataset.mcpProposal && card.dataset.mcpRevision === oldCard.dataset.mcpRevision);
    if (!freshCard) continue;
    for (const old of oldCard.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-mcp-field]")) {
      const fresh = [...freshCard.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-mcp-field]")].find(field => field.dataset.mcpField === old.dataset.mcpField);
      if (!fresh || fresh.readOnly) continue;
      fresh.value = old.value;
      if (fresh instanceof HTMLTextAreaElement) resized.push(fresh);
      if (old === document.activeElement) focus.push({ field: fresh, start: old.selectionStart, end: old.selectionEnd });
    }
  }
  const fields = "input[data-secret-input], input[data-login-user], [data-owner-answer-input]";
  const identity = (input: HTMLInputElement | HTMLTextAreaElement): string => input.dataset.loginUser ? `login:${input.dataset.loginUser}` : input.dataset.secretInput ?? input.dataset.ownerAnswerInput ?? "";
  for (const old of before.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(fields)) {
    if (!old.value) continue;
    kept.push({ id: identity(old), value: old.value, focused: old === document.activeElement, start: old.selectionStart, end: old.selectionEnd });
  }
  for (const item of kept) {
    const fresh = [...after.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(fields)].find(input => identity(input) === item.id);
    if (!fresh) continue;
    fresh.value = item.value;
    const save = fresh.closest(".secret-card")?.querySelector<HTMLButtonElement>('[data-act="card-save"]');
    if (save) save.disabled = false;
    const submit = fresh.closest("[data-owner-question]")?.querySelector<HTMLButtonElement>('[data-owner-answer="text"]');
    if (submit) submit.disabled = false;
    if (fresh instanceof HTMLTextAreaElement) resized.push(fresh);
    if (item.focused) focus.push({ field: fresh, start: item.start, end: item.end });
  }
  return () => {
    for (const field of resized) { field.style.height = "auto"; field.style.height = `${field.scrollHeight}px`; }
    for (const item of focus) {
      item.field.focus({ preventScroll: true });
      if (item.start !== null && item.end !== null) item.field.setSelectionRange(item.start, item.end);
    }
  };
}
