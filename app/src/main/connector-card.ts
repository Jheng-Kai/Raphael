// A connector card: when a task in a chat needs an app that is not connected,
// that turn shows the app's card. The owner signs in from it; the core then resumes that task once,
// as a turn of its own that opens with one centred line naming the apps it waited for.
// Every state and public catalog logo comes from the core; no authorization URL or token is kept here.

import { cardHTML, cardPromptText } from "./card";
import { NAME, eventLineHTML } from "./event-line";
import { getLocale, t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { entryIcon } from "./service-mark";
import type { AgentTurn, ConnectorCard } from "./types";
import { btn, esc, ico } from "./ui";
import { missingHTML, missingRepairHTML, missingText } from "./missing";

const FAILURES: Record<string, MessageKey> = {
  invalid_request: "conn.err.invalid_request",
  denied: "card.denied",
  timeout: "card.timeout",
  scope: "card.scope",
  state: "card.state",
  not_configured: "card.notConfigured",
  needs_composio_key: "card.needsComposioKey",
  needs_key: "card.needsKey",
  needs_own_app: "card.needsOwnApp",
  key_rejected: "card.keyRejected",
  interrupted: "card.interrupted",
  mcp_unavailable: "missing.installation",
};

/** The app asks for the owner's own key, a developer app of their own, or a server of theirs, before it can be connected. */
const asksMore = (card: ConnectorCard): boolean => card.needs === "key" || card.needs === "own_app" || card.needs === "own_server";

/**
 * The form's place in the card. A server of the owner's own (n8n) carries its fields in the card itself, as there is no
 * catalog to read them from; the member explains each in the conversation (owner, 2026-11-09).
 */
const setupSlotHTML = (card: ConnectorCard): string =>
  `<div data-inline-setup="${esc(card.id)}" data-toolkit="${esc(card.toolkit ?? card.app)}" data-needs="${esc(card.needs ?? "key")}" data-name="${esc(card.name)}"` +
  (card.needs === "own_server" ? ` data-server-fields="${esc(JSON.stringify(card.fields ?? []))}"` : "") + `></div>`;

const plain = (key: MessageKey): string => (t as (key: MessageKey) => string)(key);

/**
 * The words of a card's state line with their clauses kept whole: a line that wraps breaks where a comma is, so that
 * no word of Chinese or Japanese is split across two lines (English breaks at its spaces anyway).
 */
export function clausesHTML(text: string): string {
  if (!["zh-TW", "zh-CN", "ja"].includes(getLocale())) return esc(text);
  return text.split(/(?<=[，、])/u).map(clause => `<span class="cc-clause">${esc(clause)}</span>`).join("");
}

/** The app's bare mark: its brand path in its brand colour, or the generic plug. */
export function appMarkHTML(app: string, logo?: string): string {
  return entryIcon({ name: app, logo }, "md");
}

/** What the card says of where its sign-in stands. */
export function cardStateText(card: ConnectorCard): string {
  switch (card.state) {
    case "pending": return card.reconnect ? plain("card.expiredAuth") : card.needs === "key" ? plain("card.needsKey") : card.needs === "own_server" ? plain("store.needsOwnServer") : card.needs === "own_app" ? plain("card.needsOwnApp") : "";
    case "authorizing": return plain("card.authorizing");
    case "connected": return t(card.reconnect ? "card.reconnected" : "card.connected", { p0: card.tool_count ?? 0 });
    case "cancelled": return plain("card.cancelled");
    case "expired": return plain("card.expired");
    default: return plain(FAILURES[card.error ?? ""] ?? "card.error");
  }
}

/** The card's one action, if its state has one. */
function actionHTML(card: ConnectorCard): string {
  if (card.error === "mcp_unavailable" || card.missing) return "";
  const on = (act: string): string => ` data-act="${act}" data-card="${esc(card.id)}"`;
  // What it asks for is asked in the form, never in the chat: the key goes from that form to the core and nowhere else.
  const form = (): string => btn(esc(plain(card.needs === "own_app" ? "card.setupApp" : "card.enterKey")), "sm pri",
    `${on("card-setup")} data-toolkit="${esc(card.toolkit ?? card.app)}" data-needs="${esc(card.needs ?? "key")}" data-name="${esc(card.name)}"`);
  const connect = (label: MessageKey): string => asksMore(card) ? form() : btn(esc(plain(label)), "sm pri", on("card-connect"));
  switch (card.state) {
    case "pending": return connect(card.reconnect ? "card.reconnect" : "card.connect");
    case "authorizing": return btn(esc(plain("card.cancel")), "sm", on("card-cancel"));
    case "cancelled": return connect("card.connect");
    case "failed": return card.error === "not_configured" || card.error === "needs_composio_key"
      ? btn(esc(plain("card.openConnections")), "sm", on("card-settings"))
      : connect("card.retry");
    default: return "";
  }
}

export function connectorCardHTML(card: ConnectorCard): string {
  const state = cardStateText(card);
  const connected = card.state === "connected";
  // The card's words already say what is missing: its note is then only the repair, not the sentence again (R-UI-02).
  const note = card.missing ? (missingText(card.missing).trim() === state.trim() ? missingRepairHTML(card.missing) : missingHTML(card.missing)) : "";
  return cardHTML({
    title: asksMore(card) && ["pending", "failed", "cancelled"].includes(card.state) ? t("cards.connect", { p0: card.name }) : card.name, mark: appMarkHTML(card.app, card.logo),
    status: connected ? "done" : card.state === "failed" ? "failed" : card.state === "expired" || card.state === "cancelled" ? "ready" : "waiting",
    statusText: connected ? t("cards.connected") : card.state === "authorizing" ? t("card.authorizing") : asksMore(card) && card.state === "pending" ? cardPromptText("key") : card.state === "pending" ? cardPromptText("connect") : card.state === "expired" ? t("cards.expired") : card.state === "cancelled" ? t("cards.cancelled") : undefined,
    body: state || t("cards.connectWhy"),
    content: note + (asksMore(card) && ["pending", "failed", "cancelled"].includes(card.state) ? setupSlotHTML(card) : ""),
    actions: connected ? btn(`${ico("check")}${esc(t("cards.connected"))}`, "sm", " disabled") : actionHTML(card),
    attrs: ` data-connector="${esc(card.id)}" data-card-state="${esc(card.state)}"`,
  });
}

/** The cards a turn showed, below what it said. */
export function connectorCardsHTML(turn: AgentTurn): string {
  return (turn.connectors ?? []).map(connectorCardHTML).join("");
}

/** The brand names of the apps (`connectors/apps.py`), never translated. */
const APP_NAMES: Record<string, string> = { gmail: "Gmail", googlecalendar: "Google Calendar" };

/** The centred line a resumed task opens with, in place of the owner's words it carries on. */
export function resumedLineHTML(turn: AgentTurn): string {
  const apps = turn.resumed_apps ?? [];
  if (!apps.length) return "";
  const names = apps.map((app, index) => turn.resumed_app_names?.[index] ?? APP_NAMES[app] ?? app).join(["zh-TW", "zh-CN", "ja"].includes(getLocale()) ? "、" : ", ");
  return `<div class="conversation-event-line" data-resumed="${esc(turn.id)}">` +
    eventLineHTML(t("card.resumed", { p0: NAME }), appMarkHTML(apps[0], turn.resumed_app_logos?.[0]), names) + `</div>`;
}
