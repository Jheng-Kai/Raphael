// The cards a member shows in its conversation for what the panel no longer does: someone asking a
// bot it set up there to pair, and the template it made of itself when the owner pressed share. Their state lives in
// the core; a press answers there and the turn is drawn again from what the core says (`AgentTurn`). The bot token's
// own card is the secret card (secret-card.ts, `platform`).

import * as api from "./api";
import { cardFailure, cardHTML, waitingCloseHTML } from "./card";
import { describeError } from "./format";
import { t } from "./i18n";
import { openDialog } from "./member-dialogs";
import { type MemberTemplate, type ScanFinding, reviewNotes } from "./member-templates";
import { mountTemplateReview } from "./template-review";
import { connectionMarkHTML } from "./secret-card";
import { slimeFaceHTML } from "./slime";
import type { AgentTurn, PairingCard, TemplateCard } from "./types";
import { btn, copyButton, esc, ico, toaster } from "./ui";

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
    actions: pending ? btn(esc(t("cards.pairAllow")), "sm pri", on("pairing-allow")) : "",
    ...(pending ? { close: waitingCloseHTML(on("pairing-deny"), t("cards.pairDeny")), statusInHeading: true } : {}),
    cls: "pairing-card", attrs: ` data-pairing-card="${esc(card.id)}" data-card-state="${esc(card.state)}"`,
  });
}

function templateCardHTML(card: TemplateCard): string {
  const blocked = card.findings.some((finding) => finding.kind === "secret");
  const on = (act: string): string => ` data-act="${act}" data-template-card="${esc(card.id)}"`;
  const facts = [t("cards.templateSkills", { p0: card.counts.skills }), t("cards.templateRoutines", { p0: card.counts.routines }),
    card.connections.length ? t("cards.templateNeeds", { p0: card.connections.join("、") }) : ""].filter(Boolean);
  const view = btn(esc(t("cards.templateView")), "sm", on("template-view"));
  const keep = btn(esc(t("cards.templateSave")), card.shareable ? "sm" : "sm pri", `${on("template-save")}${blocked ? " disabled" : ""}`);
  // A shared card keeps its link (R-SHARE-01): copying it again sends nothing.
  const actions = card.share_url
    ? btn(esc(t("cards.templateCopyLink")), "sm pri", `${on("template-copy-link")} data-template-link="${esc(card.share_url)}"`) +
      btn(esc(t("cards.templateUnshare")), "sm", on("template-unshare")) + view
    : card.shareable
    ? btn(esc(t("cards.templateCopyLink")), "sm pri", `${on("template-share")}${blocked ? " disabled" : ""}`) + keep + view
    : keep + view;
  const saved = card.state === "saved";
  return cardHTML({
    title: card.name,
    // No face inside a card (R-CARD-01): the share mark stands for the member's template.
    mark: `<span class="mono md" aria-hidden="true">${ico("share")}</span>`,
    status: blocked ? "failed" : saved || card.share_url ? "done" : "ready",
    statusText: blocked ? t("cards.templateBlocked") : card.share_url ? t("cards.templateShared") : saved ? t("cards.templateSaved") : t("cards.templateReady"),
    body: card.description || undefined,
    content: `<p class="card-body template-facts">${facts.map((fact) => `<span>${esc(fact)}</span>`).join("")}</p>` +
      (card.share_url ? `<p class="card-body template-where" data-template-link-line><span class="template-path">${esc(card.share_url)}</span></p>` : ""),
    actions,
    cls: "template-card", attrs: ` data-template-card-id="${esc(card.id)}" data-card-state="${esc(card.state)}" data-template-avatar="${esc(card.avatar ?? "")}"`,
  });
}

/** The pairing, template and computer suggestion cards of a turn. */
export function chatCardsHTML(turn: AgentTurn): string {
  const suggestion = turn.computer_suggestion;
  const pending = suggestion?.state === "pending";
  const attrs = ` data-suggestion-turn="${esc(turn.id)}"`;
  const computer = suggestion ? cardHTML({
    title: t("memberComputer.suggestionTitle"), status: pending ? "waiting" : "done",
    statusText: pending ? t("cards.needsYou") : undefined, statusInHeading: true,
    content: `<p class="card-body">${esc(suggestion.reason)}</p>`,
    close: waitingCloseHTML(` data-act="computer-suggestion-dismiss"${attrs}`, t("common.close")),
    actions: pending ? btn(`<span>${esc(t(suggestion.installed ? "memberComputer.suggestionSwitch" : "memberComputer.suggestionInstall"))}</span>${ico("right")}`,
      "sm computer-suggestion-action", ` data-act="computer-suggestion-${suggestion.installed ? "switch" : "setup"}"${attrs}`) : "",
    cls: "computer-suggestion-card",
  }) : "";
  return (turn.pairings ?? []).map(pairingCardHTML).join("") + (turn.templates ?? []).map(templateCardHTML).join("") + computer;
}

/** The template card's snapshot, reviewed as the export review shows a recipe. */
async function viewTemplate(id: string, avatar = ""): Promise<void> {
  const { template, findings = [] } = await api.core<{ template: MemberTemplate; findings?: ScanFinding[] }>("members.template_card", { id });
  const face = avatar ? slimeFaceHTML({ id: -1, avatar }, 64) : "";
  // The review offers sharing when the card can create a link.
  const card = document.querySelector<HTMLElement>(`[data-template-card-id="${CSS.escape(id)}"]`);
  const share = card?.querySelector<HTMLButtonElement>('[data-act="template-share"]:not(:disabled)');
  const dialog = openDialog({ title: t("store.review"), cls: "template-preview template-card-review", body: "",
    actions: share ? { primary: { label: esc(t("cards.templateCopyLink")), attrs: ' data-dlg="share"' } } : {},
    onAct(action) {
      if (action === "share") share?.click();
      dialog.close();
    } });
  mountTemplateReview(dialog, template, { face, notes: reviewNotes(findings) });
}

/** A press on one of these cards; true when it was one of theirs. */
export function chatCardAction(act: HTMLElement, askDockerSetup?: () => void): boolean {
  const kind = act.dataset.act ?? "";
  const pairing = act.dataset.pairing, template = act.dataset.templateCard;
  const card = act.closest<HTMLElement>(".conversation-card");
  const busy = (on: boolean): void => { for (const button of card?.querySelectorAll<HTMLButtonElement>(".card-actions button") ?? []) button.disabled = on; };
  const run = (work: () => Promise<unknown>): void => {
    busy(true);
    void work().catch((error) => { if (!cardFailure(card, () => run(work))) toaster.info(describeError(error)); }).finally(() => busy(false));
  };
  if (kind === "computer-suggestion-switch" || kind === "computer-suggestion-setup" || kind === "computer-suggestion-dismiss") {
    const action = kind.slice("computer-suggestion-".length);
    const button = act as HTMLButtonElement;
    if (button.disabled) return true;
    const change = async (): Promise<void> => {
      const turn = Number(act.dataset.suggestionTurn);
      button.disabled = true;
      try {
        if ((await api.core<{ setup?: boolean }>("agent.computer_suggestion", { turn_id: turn, action })).setup) askDockerSetup?.();
      } catch (error) {
        if (!cardFailure(card, () => { void change(); }, undefined, t("memberComputer.switchFailed"))) toaster.info(describeError(error));
      } finally { button.disabled = false; }
    };
    void change();
    return true;
  }
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
    // The card says saved only once the owner's dialog wrote a file: a cancelled dialog leaves it as it was.
    run(async () => {
      const { text } = await api.core<{ text: string }>("members.template_card_export", { id: template });
      if ((await api.memberTemplateFile("save", text)) === null) return;
      await api.core("members.template_card_export", { id: template, saved: true });
    });
    return true;
  }
  if (kind === "template-copy-link") {
    void copyButton(act, act.dataset.templateLink ?? "");
    return true;
  }
  if (kind === "template-share") {
    // The link is copied only once the service has made it; a failure leaves the card as it was and says so. The card is
    // drawn again with its link, so the toast, not the pressed button, says it is on the clipboard.
    busy(true);
    void api.core<{ share_url: string }>("members.template_card_share", { id: template })
      .then(async ({ share_url }) => { if (await copyButton(act, share_url)) toaster.info(t("cards.templateLinkCopied")); },
        () => toaster.info(t("cards.templateLinkFailed")))
      .finally(() => busy(false));
    return true;
  }
  if (kind === "template-unshare") {
    busy(true);
    void api.core("members.template_card_unshare", { id: template }).catch(() => toaster.info(t("cards.templateUnshareFailed"))).finally(() => busy(false));
    return true;
  }
  return false;
}
