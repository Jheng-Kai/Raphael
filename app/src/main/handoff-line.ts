import { NAME, eventLineHTML, eventPeopleHTML } from "./event-line";
import { getLocale, t } from "./i18n";
import { messageHTML } from "./message-content";
import { quoteHTML } from "./message-quote";
import type { HandoffView, MessageQuote } from "./types";
import { esc, ico } from "./ui";

const STATES = { queued: "handoff.queued", running: "handoff.running", waiting: "handoff.waiting", done: "handoff.done", withheld: "handoff.withheld" } as const;
const REASONS = { missing_artifact: "handoff.missingArtifact", artifact_changed: "handoff.changedArtifact", work_without_action: "handoff.noAction",
  missing_terminal: "handoff.invalidFinal", dangling_mention: "handoff.invalidFinal", cancelled: "handoff.cancelled" } as const;

export interface HandoffLine { task: HandoffView; face: string; name?: string; request?: MessageQuote }

/** The first receipt anchors a consecutive group as later receipts arrive. */
export function handoffGroupHTML(lines: readonly HandoffLine[]): string {
  const contents = lines.map(line => handoffLineHTML(line.task, line.face, line.request, line.name)).join("");
  if (lines.length < 2) return contents;
  const unique = [...new Map(lines.map(line => [line.task.member_id, line])).values()];
  const people = unique.slice(0, 3).map(line => ({ name: line.name || line.task.member_name, face: line.face }));
  const slots = people.map((_, i) => `\u0000${i}\u0000`);
  if (unique.length > 3) slots.push(t("handoff.groupOthers", { p0: unique.length - 3 }));
  const names = new Intl.ListFormat(getLocale(), { style: "long", type: "conjunction" }).format(slots);
  const waiting = lines.some(line => line.task.waiting_owner);
  const active = lines.some(line => ["queued", "running", "waiting"].includes(line.task.state));
  const unfinished = lines.some(line => !["queued", "running", "waiting", "done"].includes(line.task.state));
  const state = waiting ? t("handoff.groupWaiting") : unfinished ? t("handoff.groupUnfinished") : active ? t("handoff.groupActive") : "";
  const first = lines[0].task;
  return `<details class="handoff-event handoff-group" data-handoff-group="${first.task_id ?? `x${first.work_turn_id}`}">` +
    `<summary>${eventPeopleHTML(t("handoff.group", { p0: lines.length, p1: names }), people, state)}</summary>` +
    `<div class="handoff-detail">${contents}</div></details>`;
}

/**
 * A durable receipt or a quick question to a colleague is one centred event line (the colleague's
 * `face` and `name`, 「已轉交給 X」 or 「已詢問 X」 and the state) that opens on what was asked
 * (`request`, where the thread has it), the result and the files it produced. Task numbers, or the
 * colleague's record for a question with no task, stay in `data-handoff` for the code; the owner
 * never reads them.
 */
export function handoffLineHTML(task: HandoffView, face: string, request?: MessageQuote, name = task.member_name): string {
  const state = STATES[task.state as keyof typeof STATES] ?? "handoff.failed";
  const reason = REASONS[task.reason as keyof typeof REASONS];
  const files = task.evidence.filter(item => item.kind === "artifact" && item.uri).map(item => `<li>${ico("file")}<span>${esc(item.uri!.split("/").pop()!)}</span></li>`);
  return `<details class="handoff-event" data-handoff="${task.task_id ?? `x${task.work_turn_id}`}" data-state="${esc(task.state)}">` +
    `<summary>${eventLineHTML(t(task.mode === "consult" ? "handoff.asked" : "handoff.forwarded", { p0: NAME }), face, name, task.waiting_owner ? t("ownerQuestion.waiting", { p0: task.waiting_owner }) : t(state))}</summary>` +
    `<div class="handoff-detail">` +
    (request?.text.trim() ? quoteHTML(request) : "") +
    (reason ? `<span class="handoff-reason" role="status">${esc(t(reason))}</span>` : "") +
    (task.result ? `<div class="message-text">${messageHTML(task.result, "", true)}</div>` : "") +
    (files.length ? `<ul class="handoff-files">${files.join("")}</ul>` : "") +
    `</div></details>`;
}
