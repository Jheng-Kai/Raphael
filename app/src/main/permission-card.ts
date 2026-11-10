// A permission card: when a step in a typed private chat needs the owner's yes (a connection's tool that sends or
// changes something, the first use of an app on the computer, a step that sends, deletes or buys), that turn shows
// the exact action in plain words with 允許一次, 一律允許 and 拒絕. Always allow is a narrow rule for that kind of
// action only, and it is offered only where it can take effect: where one of the owner's rules asks first, that rule
// has the last word and the card has no 一律允許. A yes is for this action alone (its digest); a card whose time ran
// out, whose action changed or that was answered answers nothing.
// Every state comes from the core (`agent.permissions`). Nothing here keeps what the action was given: the card says
// it in the core's words. The question itself is the one the window already holds (the shell keeps it, `source`
// "ask"), or the card's own door for a task that went on after the computer was given back (`source` "run").

import { cardDisclosureHTML, cardHTML, cardPromptText } from "./card";
import { composioText, isComposioTool } from "./composio-result";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import { connectionMarkHTML } from "./secret-card";
import { serviceIconOf } from "./service-icons";
import type { AgentTurn, OwnerQuestion, PermissionCard } from "./types";
import { btn, esc, ico, iconBtn } from "./ui";

const plain = (key: MessageKey): string => (t as (key: MessageKey) => string)(key);

/** Whether the card still waits for the owner's answer. */
export const waitsForYes = (card: PermissionCard): boolean => card.state === "pending";

/** The card that waits for the answer to question `id`, if a turn shows one. */
export function permissionFor(turns: readonly AgentTurn[], id: string): PermissionCard | undefined {
  for (const turn of turns) {
    const card = turn.permissions?.find((item) => item.id === id && waitsForYes(item));
    if (card) return card;
  }
  return undefined;
}

/** What the card says of where its question stands: the action itself while it waits, else what became of it. */
export function permissionStateText(card: PermissionCard): string {
  switch (card.state) {
    case "pending": return isComposioTool(card.service, card.tool) ? composioText(card.summary, card.tool, "tool") : composioText(card.summary);
    case "allowed": return plain("perm.allowed");
    case "always": return plain("perm.alwaysDone");
    case "denied": return plain("perm.denied");
    case "expired": return plain("perm.expired");
    default: return plain("perm.cancelled");
  }
}

/** The destination app, or the computer when the step is on it. */
const localCard = (card: PermissionCard): boolean => card.kind === "local_access" || card.kind === "local_command";
const nameOf = (card: PermissionCard): string => card.kind === "tool" ? card.service || t("cards.connectedApps") : localCard(card) && card.service ? card.service === "Raphael" ? t("agent.title") : card.service : t("card.pcTitle");

/** The core's known administration headings describe an action; arbitrary tool questions keep the generic title. */
export function approvalCopy(text: string, name = t("agent.title")): { title: string; body: string } {
  const lead = text.split("\n")[0].trim();
  const create = /^(建立成員|Create member|メンバーを作成)$/.test(lead);
  const known = create || /^(更新成員|永久刪除成員及其所有資料|建立群組|重新命名群組|匯入成員技能|儲存成員指令|建立例行任務|更新例行任務|刪除例行任務|Update member|Permanently delete member and all its data|Create group|Rename group|Import member skills|Save member command|Create routine|Update routine|Delete routine|メンバーを更新|メンバーと全データを完全に削除|グループを作成|グループ名を変更|スキルをインポート|コマンドを保存|定期タスクを作成|定期タスクを更新|定期タスクを削除)$/.test(lead);
  return { title: create ? t("cards.createMember", {p0:name}) : known ? t("cards.actionTitle", {p0:name,p1:lead}) : t("cards.permission", {p0:name}),
    body: create ? t("cards.createMemberWhy") : known ? t("cards.actionReview") : lead };
}

/** The mark: the connection's own, bare, or the computer's icon. */
const markOf = (card: PermissionCard): string => {
  if (card.kind !== "tool") return `<span class="mono md" aria-hidden="true">${ico("monitor")}</span>`;
  const name = serviceIconOf({ name: card.service }) ? card.service : card.tool === "COMPOSIO_MULTI_EXECUTE_TOOL" ? "" : card.tool.replace(/_/g, " ");
  return connectionMarkHTML(name);
};

/** Allow once first, then the available alternatives. */
function actionHTML(card: PermissionCard, answerable: boolean): string {
  if (!waitsForYes(card)) return "";
  const on = (act: string): string => ` data-act="${act}" data-card="${esc(card.id)}" data-source="${esc(card.source)}"${answerable ? "" : " disabled"}`;
  return btn(esc(t(card.kind === "local_command" ? "local.allow" : "perm.once")), "sm pri", on("perm-once")) +
    (card.always ? btn(esc(t("perm.always")), "sm", on("perm-always")) : "") +
    btn(esc(t(localCard(card) ? card.kind === "local_access" ? "local.deny" : "local.skip" : "perm.deny")), "sm", on("perm-deny")) +
    (card.kind === "local_access" ? btn(esc(t("local.never")), "sm card-quiet", on("perm-never")) : "");
}

/**
 * One card. `answerable` is false while the window holds no question to answer it with (an `ask` card whose
 * question has not come yet, or is being answered): the buttons are there and cannot be pressed.
 */
export function permissionCardHTML(card: PermissionCard, answerable = true, memberName?: string): string {
  if (isComposioTool(card.service, card.tool)) card = { ...card, summary: composioText(card.summary, card.tool, "tool") };
  const waiting = waitsForYes(card);
  const actor = memberName || (localCard(card) ? nameOf(card) : t("agent.title"));
  const payment = card.kind === "tool" && card.tool === "fill_card";
  const body = waiting ? payment ? card.summary : localCard(card) ? t(card.kind === "local_access" ? "local.consent" : "cards.localReview") : card.reason || undefined : undefined;
  let title = t("cards.useApp", { p0: actor, p1: nameOf(card) });
  if (localCard(card)) title = t("cards.localCommand", { p0: actor });
  else if (card.message) title = /^GMAIL_/i.test(card.tool) || /gmail/i.test(card.service)
    ? t("cards.sendEmail", { p0: actor }) : t("cards.sendAppMessage", { p0: actor, p1: nameOf(card) });
  const labels = { workspace: "cards.workspace", to: "mail.to", cc: "mail.cc", subject: "mail.subject", thread: "cards.thread" } as const;
  const message = card.message ? Object.entries(labels).map(([key, label]) => {
    const value = card.message?.[key as keyof typeof labels];
    return value ? `<div class="card-field"><span>${esc(t(label))}</span><span>${esc(value)}</span></div>` : "";
  }).join("") + `<p class="card-body">${esc(card.message.body)}</p>` : "";
  const details = `<div class="card-well">${!waiting ? `<p class="card-body">${esc(permissionStateText(card))}</p>` : ""}${card.message ? message : localCard(card) ? `<pre class="local-command">${esc(card.summary)}</pre>${card.reason ? `<p class="card-body">${esc(card.reason)}</p>` : ""}` : `<div class="card-field"><span>${esc(nameOf(card))}</span><span>${esc(card.summary)}</span></div>`}</div>` +
    (localCard(card) && waiting ? iconBtn("gear", t("local.manage"), ' data-act="local-settings"') : "");
  return cardHTML({
    title, mark: markOf(card),
    status: waiting ? "waiting" : card.state === "allowed" || card.state === "always" ? "done" : "ready",
    statusText: waiting ? cardPromptText("permission") : t(({ allowed: "cards.allowed", always: "cards.always", denied: "cards.denied", expired: "cards.expired", cancelled: "cards.cancelled", pending: "cards.waiting" } as const)[card.state]),
    body,
    // A command that waits is shown itself, not behind a disclosure: the owner allows what they can read. Once answered it folds away with the rest.
    content: waiting && localCard(card) ? details : !waiting || card.message || !body?.includes(card.summary) ? cardDisclosureHTML(card.id, details) : "",
    actions: actionHTML(card, answerable), cls: "permission-card",
    attrs: ` data-permission-card="${esc(card.id)}" data-card-state="${esc(card.state)}" data-source="${esc(card.source)}" data-kind="${esc(card.kind)}" data-digest="${esc(card.digest)}"`,
  });
}

/** The cards a turn shows, below what it said. `answerable` says whether the window can answer a question by its id now. */
export function permissionCardsHTML(turn: AgentTurn, answerable: (id: string) => boolean = () => true, settled = false, memberName?: string): string {
  return (turn.permissions ?? []).filter((card) => waitsForYes(card) !== settled).map((card) => permissionCardHTML(card, card.source === "run" || answerable(card.id), memberName)).join("");
}

/** Owner questions share the conversation card, with choices instead of permission controls. */
/**
 * The cards of the questions a turn's owner has settled, in the order they were asked, as a function from a time to the
 * cards due by then: the replies of a turn are drawn in turn, and before each one the cards asked before it. A card
 * whose time is not known (the core does not send it yet, see OwnerQuestion.created_at_ms) was asked before the replies it led
 * to, the way a settled permission card is; the call with `Infinity` gives the cards asked after the last reply.
 */
export function settledQuestions(turn: AgentTurn): (until: number) => string {
  const pending = (turn.owner_questions ?? []).filter(question => question.state !== "asked" && (question.kind === "ask_owner" || question.kind === "show_page"))
    .map((question, index) => ({ question, index, at: question.created_at_ms ?? -Infinity }))
    .sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? -1 : 1));
  return until => {
    const due: string[] = [];
    while (pending.length && pending[0]!.at <= until) due.push(ownerQuestionHTML(pending.shift()!.question));
    return due.join("");
  };
}

export function ownerQuestionHTML(question: OwnerQuestion): string {
  const waiting = question.state === "asked", id = esc(question.id);
  const choices = question.options.map((option, index) => btn(`<span data-choice-letter>${String.fromCharCode(65 + index)}</span><span>${esc(option)}</span>`, "question-choice", ` data-owner-option="${esc(option)}"`)).join("");
  const form = `<div class="owner-question-form">` +
    (question.kind === "show_page" ? `<div class="card-actions">${btn(esc(t("desktop.done")), "sm pri", ` data-owner-option="${esc(t("desktop.done"))}"`)}</div>` : "") +
    (choices ? `<div class="card-well question-choices">${choices}</div>` : "") +
    (question.free_text ? `<div class="question-submit"><input class="mb-fin" data-owner-answer-input="${id}" aria-label="${esc(t("cards.answer"))}" maxlength="4000" placeholder="${esc(t("cards.answer"))}">${btn(esc(t("ownerQuestion.submit")), "sm pri", ' data-owner-answer="text" disabled')}</div>` : "") +
    `<div role="alert" hidden></div></div>`;
  return cardHTML({ title: question.question, status: waiting ? "waiting" : question.state === "cancelled" ? "ready" : "done", statusText: waiting ? cardPromptText("question") : question.state === "cancelled" ? t("ownerQuestion.cancelled") : t("ownerQuestion.answered"),
    hideStatus: waiting && cardPromptText("question") === undefined,
    content: waiting ? form : question.result?.answer ? cardDisclosureHTML(question.id, `<div class="card-well card-body">${esc(question.result.answer)}</div>`) : "",
    close: waiting ? iconBtn("x", t("common.close"), ' data-owner-answer="cancel"') : "", cls: "permission-card owner-question",
    attrs: ` data-owner-question="${id}" data-owner-turn="${question.turn_id}" data-owner-kind="${esc(question.kind)}" data-owner-page="${esc(question.kind === "show_page" ? question.card_id : "")}" data-card-state="${question.state}" tabindex="0"`,
  });
}

/**
 * A question card stands at the end of the thread only while it waits for the owner (owner, 2026-11-11: 「它那個回答的卡片
 * 不是永遠都會在最下面，它會跑到下面的情況就只有我還沒有回答的時候。如果已回答的話，就會跟正常的對話一模一樣」). Once answered,
 * cancelled or expired it is part of the conversation and stands where it was asked (settledQuestions).
 * `settled` picks the cards that no longer wait (true), the ones that wait (false) or all of them (undefined).
 */
export const ownerQuestionsHTML = (turn: AgentTurn, settled?: boolean): string => (turn.owner_questions ?? [])
  .filter(question => settled === undefined || (question.state !== "asked") === settled).map(question =>
  question.kind === "ask_owner" || question.kind === "show_page" ? ownerQuestionHTML(question) :
    question.state === "asked" ? `<div class="cc-actions" data-owner-question="${esc(question.id)}">` +
      btn(esc(t("common.cancel")), "sm", ' data-owner-answer="cancel"') + `<div role="alert" hidden></div></div>` : "").join("");
