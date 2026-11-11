import { cardHTML, cardStatusHTML } from "./card";
import { fileChipHTML } from "./message-content";
import { t } from "./i18n";
import type { HandoffView, RoomDecision, RoomMessage } from "./types";
import { btn, esc } from "./ui";

const stateLabel = (task: HandoffView): string => task.waiting_owner ? t("handoff.groupWaiting") :
  t(task.state === "done" ? "handoff.done" : task.state === "queued" ? "handoff.queued" :
    task.state === "running" ? "handoff.running" : task.state === "waiting" ? "handoff.waiting" : "handoff.failed");

/** Only public task projections enter the meeting. Cards and private steps stay in their conversation. */
export function roomBoardHTML(tasks: readonly HandoffView[], decisions: readonly RoomDecision[], face: (id: number, name: string) => string = () => ""): string {
  const latest = new Map<number, HandoffView>();
  const priority = (state: string): number => state === "running" || state === "waiting" ? 2 : state === "queued" ? 1 : 0;
  for (const task of tasks) {
    const previous = latest.get(task.member_id);
    if (!previous || priority(task.state) >= priority(previous.state)) latest.set(task.member_id,task);
  }
  const rows = [...latest.values()].map(task => `<div class="room-board-member">${face(task.member_id, task.member_name)}` +
    `<div class="room-board-stage"><b>${esc(task.member_name)}</b><span>${esc(task.title ?? "")}</span></div>` +
    cardStatusHTML(task.state === "done" ? "done" : ["queued","running","waiting"].includes(task.state) ? "waiting" : "failed", stateLabel(task)) + `</div>`).join("");
  return `<div data-room-board>${rows}` + (decisions.length ? `<div class="room-board-decisions"><b>${esc(t("rooms.decisions"))}</b>${decisions.map(decision => `<p>${esc(decision.text)}</p>`).join("")}</div>` : "") + `</div>`;
}

export function roomReportHTML(message: RoomMessage): string {
  const task = message.report;
  if (!task) return "";
  const files = task.evidence.filter(item => item.verdict === "verified" && item.kind === "artifact" && item.uri).slice(-4).map(item =>
    fileChipHTML(esc(item.uri!.split(/[\\/]/).pop()!), ` data-room-act="artifact-open" data-task="${task.task_id}" data-evidence="${item.id ?? ""}"${item.id ? "" : " disabled"}`)).join("");
  return cardHTML({ title: [task.member_name, task.title].filter(Boolean).join(" · "), status: task.state === "done" ? "done" : "failed",
    statusText: stateLabel(task), body: message.text,
    content: files ? `<div class="room-report-files">${files}</div>` : "",
    actions: btn(esc(t("rooms.privateWork")), "sm", ` data-room-act="private-work" data-member="${task.member_id}" data-turn="${task.work_turn_id}"`),
    attrs: ` data-room-report="${task.task_id}"`,
  });
}
