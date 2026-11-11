// A routine to read, not to fill in (owner, 2026-11-09: 「這邊的所有設定都只能透過 Agent 完成 但是我們看的到內容」): its name,
// when it runs, who runs it and its instructions in the words they were saved with. A change is asked of the member in its
// conversation; the switch beside the routine in the list still turns it on or off. A dialog that only shows has no
// footer: its × closes it.
import { t } from "./i18n";
import { openDialog, type Dialog } from "./member-dialogs";
import { faceHTML, routineSentenceHTML, routineStatus } from "./members";
import type { Member, Routine } from "./types";
import { esc, st } from "./ui";

export function routineViewHTML(routine: Routine, members: readonly Member[]): string {
  const member = members.find(item => item.id === routine.member_id);
  const status = routine.when || routine.last_error ? routineStatus(routine) : "";
  // A run that did not work is said as one (owner, 2026-11-11): the view must not look as good as a routine that works.
  const failed = !!(routine.last_failed && routine.last_error);
  const part = (label: string, html: string, cls: string): string => `<section class="rv-part ${cls}"><h3>${esc(label)}</h3>${html}</section>`;
  return `<div class="rv">` +
    part(t("auto.when"), `<p>${routineSentenceHTML(routine)}</p>${status ? `<p class="rv-status${failed ? " is-failed" : ""}">${failed ? st("err", status) : esc(status)}</p>` : ""}`, "rv-when") +
    (member ? `<p class="rv-who">${faceHTML(member, 20)}<span>${esc(member.name)}</span></p>` : "") +
    part(t("members.instructions"), `<p class="rv-prompt">${esc(routine.prompt)}</p>`, "rv-instructions") +
    `</div>`;
}

export function openRoutineView(routine: Routine, members: readonly Member[]): Dialog {
  return openDialog({ title: routine.title, body: routineViewHTML(routine, members), cls: "rv-dialog", actions: {}, onAct: () => {} });
}
