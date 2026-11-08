import { eventPeopleHTML } from "./event-line";
import { getLocale, t } from "./i18n";
import { peerCount, peerKey, peerStateWords } from "./peer-chat";
import type { HandoffView } from "./types";
import { esc } from "./ui";

export interface HandoffLine { task: HandoffView; face: string; name?: string }

/**
 * What a turn sent colleagues, in one line: 「與 X 的 2 則訊息」 (the colleagues' faces and names, three at most and
 * a count of the others), and the state while one is unfinished. It is a button: the conversation it counts opens in
 * place of the thread (peer-chat.ts). Task numbers, or the colleague's record for a question with no task, stay in
 * `data-handoff-group` and `data-handoff` for the code; the owner never reads them.
 */
export function handoffGroupHTML(lines: readonly HandoffLine[]): string {
  if (!lines.length) return "";
  const unique = [...new Map(lines.map(line => [line.task.member_id, line])).values()];
  const people = unique.slice(0, 3).map(line => ({ name: line.name || line.task.member_name, face: line.face }));
  const slots = people.map((_, i) => `\u0000${i}\u0000`);
  if (unique.length > 3) slots.push(t("handoff.groupOthers", { p0: unique.length - 3 }));
  const names = new Intl.ListFormat(getLocale(), { style: "long", type: "conjunction" }).format(slots);
  const tasks = lines.map(line => line.task);
  const count = peerCount(tasks);
  const single = lines.length === 1 ? lines[0]!.task : null;
  const waiting = tasks.some(task => task.waiting_owner);
  const active = tasks.some(task => ["queued", "running", "waiting"].includes(task.state));
  const unfinished = tasks.some(task => !["queued", "running", "waiting", "done"].includes(task.state));
  const state = single ? (single.state === "done" && !single.waiting_owner ? "" : peerStateWords(single))
    : waiting ? t("handoff.groupWaiting") : unfinished ? t("handoff.groupUnfinished") : active ? t("handoff.groupActive") : "";
  const key = peerKey(tasks[0]!);
  return `<button type="button" class="btn event-open handoff-event" data-act="peer-chat" data-handoff-group="${key}"` +
    (single ? ` data-handoff="${key}" data-state="${esc(single.state)}"` : "") + ` data-peer-keys="${tasks.map(peerKey).join(" ")}">` +
    eventPeopleHTML(t(count === 1 ? "handoff.groupOne" : "handoff.group", { p0: count, p1: names }), people, state) + `</button>`;
}
