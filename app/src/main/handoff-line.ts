import { eventLineHTML, eventPeopleHTML, NAME, type EventPerson } from "./event-line";
import { getLocale, t } from "./i18n";
import { ownWork, peerCount, peerKey, peerStateWords } from "./peer-chat";
import type { HandoffView } from "./types";
import { esc } from "./ui";

export interface HandoffLine { task: HandoffView; face: string; name?: string }

/** The quiet state at a line's end: nothing once every exchange it counts is done and nobody waits for the owner. */
function linesState(tasks: readonly HandoffView[]): string {
  if (tasks.length === 1) return tasks[0]!.state === "done" && !tasks[0]!.waiting_owner ? "" : peerStateWords(tasks[0]!);
  if (tasks.some(task => task.waiting_owner)) return t("handoff.groupWaiting");
  if (tasks.some(task => !["queued", "running", "waiting", "done"].includes(task.state))) return t("handoff.groupUnfinished");
  return tasks.some(task => ["queued", "running", "waiting"].includes(task.state)) ? t("handoff.groupActive") : "";
}

/** The attributes the code reads on a line that opens the conversation `tasks` count (peer-chat.ts). */
function peerAttrs(tasks: readonly HandoffView[]): string {
  const key = peerKey(tasks[0]!);
  return ` data-act="peer-chat" data-handoff-group="${key}"` + (tasks.length === 1 ? ` data-handoff="${key}" data-state="${esc(tasks[0]!.state)}"` : "") +
    ` data-peer-keys="${tasks.map(peerKey).join(" ")}"`;
}

/**
 * What a turn sent colleagues, as Grok Bot's line: 「與 X 的 2 則訊息」 (the colleagues' faces and names, three at most and
 * a count of the others), and the state while one is unfinished. It is a button: the conversation it counts opens in
 * place of the thread (peer-chat.ts). Task numbers, or the colleague's record for a question with no task, stay in
 * `data-handoff-group` and `data-handoff` for the code; the owner never reads them. Work the member handed to itself is
 * not a message to anyone: it goes on in this same conversation, so it has no line here.
 */
export function handoffGroupHTML(all: readonly HandoffLine[]): string {
  const lines = all.filter(line => !ownWork(line.task));
  if (!lines.length) return "";
  const unique = [...new Map(lines.map(line => [line.task.member_id, line])).values()];
  const people = unique.slice(0, 3).map(line => ({ name: line.name || line.task.member_name, face: line.face }));
  const slots = people.map((_, i) => `\u0000${i}\u0000`);
  if (unique.length > 3) slots.push(t("handoff.groupOthers", { p0: unique.length - 3 }));
  const names = new Intl.ListFormat(getLocale(), { style: "long", type: "conjunction" }).format(slots);
  const tasks = lines.map(line => line.task);
  const count = peerCount(tasks);
  return `<button type="button" class="btn event-open handoff-event"${peerAttrs(tasks)}>` +
    eventPeopleHTML(t(count === 1 ? "handoff.groupOne" : "handoff.group", { p0: count, p1: names }), people, linesState(tasks)) + `</button>`;
}

/** Which line of a group chat a hand-off joins: one per pair of members in a row, and each piece of own work alone. */
export const handoffRun = (task: HandoffView): string => ownWork(task) ? `own:${peerKey(task)}` : `${task.from_member_id}:${task.member_id}`;

/**
 * A run of a group chat's hand-offs (`handoffRun`) as one centred line. The room takes nobody's side, so a line between
 * two members names both, 「A 和 B 之間的 2 則訊息」, and opens their conversation (peer-chat.ts). A member's own work has
 * no colleague on the other side: 「A 的私人工作」 opens that work in the member's own conversation, as the report card
 * that replaces it once the work is done does (room-meeting.ts).
 */
export function roomHandoffHTML(tasks: readonly HandoffView[], person: (id: number, fallback: string) => EventPerson): string {
  const first = tasks[0];
  if (!first) return "";
  if (ownWork(first)) {
    const worker = person(first.member_id, first.member_name);
    return `<button type="button" class="btn event-open handoff-event own-work-event" data-room-act="private-work" data-member="${first.member_id}"` +
      ` data-turn="${first.work_turn_id}" data-handoff="${peerKey(first)}" data-state="${esc(first.state)}">` +
      eventLineHTML(t("handoff.ownWork", { p0: NAME }), worker.face, worker.name, linesState([first])) + `</button>`;
  }
  const people = [person(first.from_member_id, ""), person(first.member_id, first.member_name)];
  const names = new Intl.ListFormat(getLocale(), { style: "long", type: "conjunction" }).format(people.map((_, i) => `\u0000${i}\u0000`));
  const count = peerCount(tasks);
  return `<button type="button" class="btn event-open handoff-event"${peerAttrs(tasks)}>` +
    eventPeopleHTML(t(count === 1 ? "handoff.betweenOne" : "handoff.between", { p0: count, p1: names }), people, linesState(tasks)) + `</button>`;
}
