// The owner's own Google, set up in the conversation (`connectors/cards.py`, the app `google`): a card that says what to make in
// Google Cloud (a few numbered steps, with the scopes and the return address as text to copy), takes the Client ID and the
// Client secret in its two fields, and signs in with one press of 連接 Google. The secret goes from its masked field to the
// core in that one call (`integrations.card_connect`) and to nothing else; the core keeps it in the vault and never shows it
// again. A card whose Client ID is kept already shows no fields: its one button only signs in.
// The words are the window's; the scopes and the address come from the core (it asks for exactly those).

import { cardDisclosureHTML } from "./card";
import { t } from "./i18n";
import type { ConnectorCard } from "./types";
import { btn, copyLabel, esc, ico } from "./ui";

const STEPS = ["card.google.step1", "card.google.step2", "card.google.step3", "card.google.step4", "card.google.step5"] as const;

/** Whether the card shows the Google Cloud steps and the two fields: it waits for the owner and keeps no Client ID yet. */
export const asksGoogleClient = (card: ConnectorCard): boolean =>
  card.needs === "own_google" && ["pending", "failed", "cancelled"].includes(card.state) && !card.google?.configured;

/** Text the owner copies into Google Cloud: a read-only field with its copy button beside the name. */
function copyRow(label: string, value: string, lines: number): string {
  const field = lines > 1
    ? `<textarea class="field code" readonly rows="${lines}" spellcheck="false" aria-label="${esc(label)}">${esc(value)}</textarea>`
    : `<input class="field code" readonly spellcheck="false" aria-label="${esc(label)}" value="${esc(value)}">`;
  return `<div class="cn-copy"><div class="cn-copy-head"><span class="cn-label">${esc(label)}</span>` +
    btn(copyLabel(t("setup.copy"), true), "sm", ` data-dlg="copy" data-copy="${esc(value)}"`) + `</div>${field}</div>`;
}

const fieldHTML = (name: string, label: string, secret: boolean, first: boolean): string =>
  `<label class="cn-field"><span class="cn-label">${esc(label)}</span>` +
  `<input class="field" type="${secret ? "password" : "text"}" data-setup-field="${esc(name)}" autocomplete="${secret ? "new-password" : "off"}"` +
  ` spellcheck="false" autocapitalize="off"${first ? " data-setup-first" : ""}></label>`;

/**
 * The steps, the text to copy, the two fields and the button, in the slot the inline form mounts on
 * (`mountInlineConnectionSetup`, which reads the fields from the slot and sends them with the card's one call).
 */
export function googleSetupHTML(card: ConnectorCard): string {
  const guide = card.google;
  if (!guide) return "";
  const steps = `<ol class="cn-steps">${STEPS.map(step => `<li>${esc(t(step))}</li>`).join("")}</ol>` +
    copyRow(t("card.google.scopes"), guide.scopes.join("\n"), guide.scopes.length) + copyRow(t("card.google.redirect"), guide.redirect, 1);
  return `<div class="inline-connection-setup google-setup" data-inline-setup="${esc(card.id)}" data-toolkit="google" data-needs="own_google" data-name="${esc(card.name)}"` +
    ` data-server-fields="${esc(JSON.stringify(card.fields ?? []))}">` +
    cardDisclosureHTML(`google-${card.id}`, steps, t("setup.where"), t("setup.where"), true) +
    `<div class="cn-fields">${fieldHTML("client_id", t("card.google.clientId"), false, true)}${fieldHTML("client_secret", t("card.google.clientSecret"), true, false)}</div>` +
    `<div class="card-actions">${btn(esc(t("card.googleConnect")), "sm pri", " data-inline-submit")}</div>` +
    `<p class="card-shield">${ico("lock")}<span>${esc(t("cards.vault"))}</span></p></div>`;
}
