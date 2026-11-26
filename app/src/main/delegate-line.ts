import { eventLineHTML, NAME } from "./event-line";
import { t } from "./i18n";
import type { MessageKey } from "./i18n/zh-TW";
import type { DelegateView } from "./types";
import { esc, ico } from "./ui";

/** The states of a sub-worker that are not over. */
const LIVE = ["queued", "running", "waiting"];

/** The words of one sub-worker's state: the ones a hand-off to a colleague uses (`handoff.*`), never a code. */
function stateWords(task: DelegateView): string {
  if (task.waiting_owner) return t("handoff.groupWaiting");
  const key: MessageKey = task.state === "queued" ? "handoff.queued" : LIVE.includes(task.state) ? "handoff.running"
    : task.state === "done" ? "handoff.done" : task.state === "cancelled" || task.state === "interrupted" ? "handoff.cancelled" : "handoff.failed";
  return t(key);
}

/** The quiet state at the end of the line: nothing once every sub-worker is done and nobody waits for the owner. */
function groupState(tasks: readonly DelegateView[]): string {
  if (tasks.some(task => task.waiting_owner)) return t("handoff.groupWaiting");
  if (tasks.some(task => LIVE.includes(task.state))) return t("handoff.groupActive");
  return tasks.some(task => task.state !== "done") ? t("handoff.groupUnfinished") : "";
}

function childHTML(task: DelegateView): string {
  const steps = task.tool_calls === 1 ? t("delegate.stepsOne") : t("delegate.steps", { p0: task.tool_calls });
  const meta = [task.model_name, task.tool_calls ? steps : "", stateWords(task)].filter(Boolean).map(esc).join(" · ");
  return `<div class="delegate-child timeline-event" data-timeline-event="delegate:${task.task_id}" data-state="${esc(task.state)}">` +
    `<span class="delegate-goal">${esc(task.title || task.goal)}</span><span class="delegate-meta">${meta}</span>` +
    (task.result ? `<p class="delegate-result">${esc(task.result)}</p>` : "") + `</div>`;
}

/**
 * The sub-workers a member started in a turn (`delegate_task`, R-DELEGATE-03), as one centred line like the exchanges with
 * colleagues: 「啟動了 3 個子工作者」 and one quiet state. Its words open to one row for each: what it was asked, the model it
 * runs on, its steps and its state, and what it says when it is done. They are tasks of this member, not other people, so no face.
 */
export function delegateGroupHTML(tasks: readonly DelegateView[]): string {
  if (!tasks.length) return "";
  const count = t(tasks.length === 1 ? "delegate.countOne" : "delegate.count", { p0: tasks.length });
  const turn = tasks[0]!.source_turn_id;
  return `<details class="handoff-event event-group delegate-group" data-event-group="delegate:${turn}" data-delegate-group="${turn}">` +
    `<summary>${eventLineHTML(t("delegate.started", { p0: NAME }), ico("steps"), count, groupState(tasks))}</summary>` +
    `<div class="handoff-detail delegate-detail">${tasks.map(childHTML).join("")}</div></details>`;
}
