// The cards a member shows in its conversation for what the panel no longer does (owner, 2026-11-07): someone asking a
// bot it set up there to pair, and the template it made of itself when the owner pressed share. Their state lives in
// the core; a press answers there and the turn is drawn again from what the core says (`AgentTurn`). The bot token's
// own card is the secret card (secret-card.ts, `platform`).

import * as api from "./api";
import { cardFailure, cardHTML } from "./card";
import { describeError } from "./format";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { type MemberTemplate, type ScanFinding, reviewNotes } from "./member-templates";
import { mountTemplateReview } from "./template-review";
import { connectionMarkHTML } from "./secret-card";
import { slimeFaceHTML } from "./slime";
import type { AgentTurn, PairingCard, TemplateCard } from "./types";
import { btn, esc, ico, toaster } from "./ui";

const PLATFORM = { telegram: "Telegram", slack: "Slack", discord: "Discord" } as const;
/** Where each bot is made: fixed here, never taken from a card (commands.rs allows only these). */
export const BOT_SETUP_URLS = { telegram: "https://t.me/BotFather", slack: "https://api.slack.com/apps", discord: "https://discord.com/developers/applications" } as const;

function pairingCardHTML(card: PairingCard): string {
  const name = PLATFORM[card.platform];
  const pending = card.state === "pending";
  const on = (act: string): string => ` data-act="${act}" data-pairing="${esc(card.id)}"`;
  return cardHTML({
    title: t("cards.pairTitle", { p0: name }),
    mark: connectionMarkHTML(name),
    status: pending ? "waiting" : card.state === "approved" ? "done" : "failed",
    statusText: pending ? t("cards.needsYou") : card.state === "approved" ? t("cards.pairAllowed") : card.state === "rejected" ? t("cards.pairRejected") : t("card.expired"),
    body: t("cards.pairBody", { p0: card.who || t("msg.tg.someone"), p1: name }),
    content: `<p class="card-body pair-code"><span class="code">${esc(card.code)}</span></p>`,
    // A card's primary action comes first, as on every card of the conversation.
    actions: pending ? btn(esc(t("cards.pairAllow")), "sm pri", on("pairing-allow")) + btn(esc(t("cards.pairDeny")), "sm", on("pairing-deny")) : "",
    cls: "pairing-card", attrs: ` data-pairing-card="${esc(card.id)}" data-card-state="${esc(card.state)}"`,
  });
}

function templateCardHTML(card: TemplateCard): string {
  const blocked = card.findings.some((finding) => finding.kind === "secret");
  const on = (act: string): string => ` data-act="${act}" data-template-card="${esc(card.id)}"`;
  const facts = [t("cards.templateSkills", { p0: card.counts.skills }), t("cards.templateRoutines", { p0: card.counts.routines }),
    card.connections.length ? t("cards.templateNeeds", { p0: card.connections.join("、") }) : ""].filter(Boolean);
  const actions = card.state === "published" && card.url
    ? btn(esc(t("cards.templateOpen")), "sm pri", `${on("template-open")} data-template-url="${esc(card.url)}"`) + btn(esc(t("cards.templateView")), "sm", on("template-view"))
    : btn(esc(t("cards.templatePublish")), "sm pri", `${on("template-publish")}${blocked ? " disabled" : ""}`) +
      btn(esc(t("cards.templateSave")), "sm", `${on("template-save")}${blocked ? " disabled" : ""}`) + btn(esc(t("cards.templateView")), "sm", on("template-view"));
  return cardHTML({
    title: card.name,
    // No face inside a card (R-CARD-01): the share mark stands for the member's template.
    mark: `<span class="mono md" aria-hidden="true">${ico("share")}</span>`,
    status: blocked ? "failed" : card.state === "draft" ? "ready" : "done",
    statusText: blocked ? t("cards.templateBlocked") : card.state === "published" ? t("cards.templatePublished") : card.state === "saved" ? t("cards.templateSaved") : t("cards.templateReady"),
    body: card.description || undefined,
    content: `<p class="card-body template-facts">${facts.map((fact) => `<span>${esc(fact)}</span>`).join("")}</p>`,
    actions,
    cls: "template-card", attrs: ` data-template-card-id="${esc(card.id)}" data-card-state="${esc(card.state)}" data-template-avatar="${esc(card.avatar ?? "")}"`,
  });
}

/** The pairing and template cards of a turn, below what it said. */
export function chatCardsHTML(turn: AgentTurn): string {
  return (turn.pairings ?? []).map(pairingCardHTML).join("") + (turn.templates ?? []).map(templateCardHTML).join("");
}

/** The template card's snapshot, reviewed as the export review shows a recipe. */
async function viewTemplate(id: string, avatar = ""): Promise<void> {
  const { template, findings = [] } = await api.core<{ template: MemberTemplate; findings?: ScanFinding[] }>("members.template_card", { id });
  const face = avatar ? slimeFaceHTML({ id: -1, avatar }, 64) : "";
  // As Grok Bot's: the review's foot is the card's own next step, 發佈 while it is a draft, else 關閉 (owner, 2026-11-08).
  const card = document.querySelector<HTMLElement>(`[data-template-card-id="${CSS.escape(id)}"]`);
  const publish = card?.querySelector<HTMLButtonElement>('[data-act="template-publish"]:not(:disabled)') ?? null;
  const dialog = openDialog({ title: t("store.review"), cls: "template-preview template-card-review", body: "",
    actions: { primary: publish ? { label: esc(publish.textContent?.trim() || t("store.publish")), attrs: ' data-dlg="publish"' } : { label: esc(t("common.close")), attrs: ' data-dlg="close"' } },
    onAct(action) {
      if (action === "publish") publish?.click();
      dialog.close();
    } });
  mountTemplateReview(dialog, template, { face, notes: reviewNotes(findings) });
}

/** A press on one of these cards; true when it was one of theirs. */
export function chatCardAction(act: HTMLElement): boolean {
  const kind = act.dataset.act ?? "";
  const pairing = act.dataset.pairing, template = act.dataset.templateCard;
  const card = act.closest<HTMLElement>(".conversation-card");
  const busy = (on: boolean): void => { for (const button of card?.querySelectorAll<HTMLButtonElement>(".card-actions button") ?? []) button.disabled = on; };
  const run = (work: () => Promise<unknown>): void => {
    busy(true);
    void work().catch((error) => { if (!cardFailure(card, () => run(work))) toaster.info(describeError(error)); }).finally(() => busy(false));
  };
  if (kind === "bot-link") {
    const platform = act.dataset.platform as keyof typeof BOT_SETUP_URLS | undefined;
    if (platform && platform in BOT_SETUP_URLS) void api.openLink(BOT_SETUP_URLS[platform]).catch((error) => toaster.info(describeError(error)));
    return true;
  }
  if ((kind === "pairing-allow" || kind === "pairing-deny") && pairing) {
    run(() => api.core("messaging.pairing.answer", { id: pairing, approve: kind === "pairing-allow" }));
    return true;
  }
  if (!template) return false;
  if (kind === "template-view") { void viewTemplate(template, card?.dataset.templateAvatar ?? "").catch((error) => toaster.info(describeError(error))); return true; }
  if (kind === "template-save") {
    run(async () => { const { text } = await api.core<{ text: string }>("members.template_card_export", { id: template }); await api.memberTemplateFile("save", text); });
    return true;
  }
  if (kind === "template-publish") {
    run(async () => { const { url } = await api.core<{ folder: string; url: string }>("members.template_card_publish", { id: template }); await api.openExternalUrl(url); });
    return true;
  }
  if (kind === "template-open") {
    run(() => api.openExternalUrl(act.dataset.templateUrl ?? ""));
    return true;
  }
  return false;
}
