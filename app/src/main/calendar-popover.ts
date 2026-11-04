// The small panels of the calendar: one beside the slot or the event it is about, never over the whole window. A press
// outside closes one that holds nothing typed; what was typed stays until Cancel or Escape.
import * as api from "./api";
import { googleMark, clockRange, type CalendarEntry } from "./calendar-view";
import { describeError, formatClock } from "./format";
import { isTopLayer, registerDismissal } from "./dismissals";
import { getLocale, t } from "./i18n";
import { faceHTML, routineSentenceHTML } from "./members";
import { ownerFaceHTML } from "./owner-avatar";
import { dateKey, localDay, openDatePicker } from "./schedule-picker";
import type { RoutineRun } from "./types";
import { actionRow, btn, closeMenu, esc, ico, iconButton, openMenu, sel, tg, toaster, type Choice } from "./ui";

/** An event as the editor holds it. No id: one that is being made. */
export interface EventDraft { id?: number; title: string; start: number; end: number; allDay: boolean; notes: string }

interface Panel { el: HTMLElement; close(): void }
let current: Panel | null = null;

export const panelOpen = (): boolean => current !== null;
export function closePanel(): void { current?.close(); }

/**
 * Beside the thing it is about: to its right, or its left where the right has no room, its top level with the thing's and
 * kept inside the window. Where neither side has room it lies over the thing, against the window's edge.
 */
export function besidePlacement(
  anchor: Pick<DOMRect, "left" | "right" | "top">,
  size: { width: number; height: number },
  viewport: { width: number; height: number; top: number },
): { left: number; top: number } {
  const gap = 8, right = anchor.right + gap, left = anchor.left - gap - size.width;
  const x = right + size.width <= viewport.width - gap ? right : left >= gap ? left : Math.max(gap, viewport.width - gap - size.width);
  const lowest = Math.max(viewport.top + gap, viewport.height - gap - size.height);
  return { left: x, top: Math.max(viewport.top + gap, Math.min(anchor.top, lowest)) };
}

function openPanel(rect: Pick<DOMRect, "left" | "right" | "top">, cls: string, label: string, o: { canClose?(): boolean; onClose?(): void } = {}): Panel {
  closePanel();
  closeMenu();
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const el = document.createElement("div");
  el.className = `au-pop ${cls}`;
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", label);
  el.tabIndex = -1;
  document.body.append(el);
  let open = true;
  const panel: Panel = {
    el,
    close() {
      if (!open) return;
      open = false;
      if (current === panel) current = null;
      stop();
      document.removeEventListener("keydown", onKey, true);
      closeMenu();
      el.remove();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
      o.onClose?.();
    },
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!isTopLayer(el)) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); panel.close(); }
  };
  const stop = registerDismissal(el, () => panel.close(), () => o.canClose?.() ?? true);
  document.addEventListener("keydown", onKey, true);
  current = panel;
  place(panel, rect);
  return panel;
}

function place(panel: Panel, rect: Pick<DOMRect, "left" | "right" | "top">): void {
  const top = document.getElementById("window-chrome")?.getBoundingClientRect().bottom ?? 0;
  const spot = besidePlacement(rect, { width: panel.el.offsetWidth, height: panel.el.offsetHeight }, { width: innerWidth, height: innerHeight, top });
  panel.el.style.left = `${spot.left}px`;
  panel.el.style.top = `${spot.top}px`;
}

const whenDay = (at: number | Date): string => new Date(at).toLocaleDateString(getLocale(), { month: "long", day: "numeric", weekday: "short" });
const clockOf = (at: number): string => formatClock(at);
const momentOf = (day: string, time: string): number => new Date(`${day}T${time}`).getTime();

/** Every quarter of an hour, and the time an event has if it is none of those: a member may have set it to the minute. */
function timeChoices(current: string, after = ""): Choice[] {
  const times = Array.from({ length: 96 }, (_, n) => `${String(Math.floor(n / 4)).padStart(2, "0")}:${String((n % 4) * 15).padStart(2, "0")}`);
  return [...new Set([...times, current])].filter(time => time > after || time === current).sort().map(time => ({ value: time, label: time }));
}

export interface EditorOptions {
  /** The time or the day was changed: what stands in the grid for it follows. */
  onChange?(draft: EventDraft): void;
  onTitle?(title: string): void;
  /** The core has it. The panel closes when this is done, so that what it draws takes the placeholder's place. */
  onSaved(): void | Promise<void>;
  onClose?(): void;
  /** Make it a routine instead: only for something new. */
  onRoutine?(draft: EventDraft): void;
}

/** The one form of an event: for one being made, from a slot or 建立, and for one being changed. */
export function openEventEditor(rect: Pick<DOMRect, "left" | "right" | "top">, draft: EventDraft, o: EditorOptions): Panel {
  let title = draft.title, notes = draft.notes, allDay = draft.allDay, saving = false;
  let startDay = dateKey(new Date(draft.start)), startTime = clockOf(draft.start);
  // An all-day event is over at the midnight after its last date; the form shows that date.
  let endDay = dateKey(new Date(draft.allDay ? Math.max(draft.end - 1, draft.start) : draft.end)), endTime = clockOf(draft.end);
  const first = { title, notes };
  const editing = (): boolean => title !== first.title || notes !== first.notes;
  const asDraft = (): EventDraft => ({
    ...(draft.id ? { id: draft.id } : {}), title, notes, allDay,
    start: allDay ? localDay(startDay).getTime() : momentOf(startDay, startTime),
    end: allDay ? new Date(localDay(endDay).getFullYear(), localDay(endDay).getMonth(), localDay(endDay).getDate() + 1).getTime() : momentOf(endDay, endTime),
  });
  let panel: Panel;
  const dayButton = (name: string, day: string, label: string): string => btn(esc(whenDay(localDay(day))), "", ` data-pop="${name}" aria-label="${esc(label)}" aria-haspopup="dialog"`);
  const body = (): string =>
    `<input class="mb-fin au-title" id="cal-title" maxlength="120" placeholder="${esc(t("cal.title"))}" aria-label="${esc(t("cal.title"))}" value="${esc(title)}">` +
    `<div class="au-pop-when${allDay ? " is-all-day" : ""}"><span>${esc(t("auto.starts"))}</span>${dayButton("start-day", startDay, t("auto.starts"))}` +
    (allDay ? "" : sel(timeChoices(startTime), startTime, t("auto.starts"), ' data-pop="start-time"')) +
    `<span>${esc(t("cal.ends"))}</span>${dayButton("end-day", endDay, t("cal.ends"))}` +
    (allDay ? "" : sel(timeChoices(endTime, startDay === endDay ? startTime : ""), endTime, t("cal.ends"), ' data-pop="end-time"')) + `</div>` +
    `<label class="au-pop-allday"><span>${esc(t("auto.allDay"))}</span>${tg(allDay, t("auto.allDay"), ' data-pop="all-day"')}</label>` +
    `<textarea class="mb-fin mb-ta" id="cal-notes" rows="2" maxlength="2000" placeholder="${esc(t("cal.notes"))}" aria-label="${esc(t("cal.notes"))}">${esc(notes)}</textarea>` +
    actionRow({
      secondary: (o.onRoutine ? btn(ico("repeat") + esc(t("cal.asRoutine")), "au-pop-routine", ' data-pop="routine"') : "") + btn(esc(t("common.cancel")), "", ' data-pop="cancel"'),
      primary: { label: esc(t("members.save")), attrs: ' data-pop="save"' },
    });
  const read = (): void => {
    title = panel.el.querySelector<HTMLInputElement>("#cal-title")?.value ?? title;
    notes = panel.el.querySelector<HTMLTextAreaElement>("#cal-notes")?.value ?? notes;
  };
  const redraw = (focus = ""): void => {
    panel.el.innerHTML = body();
    place(panel, rect);
    o.onChange?.(asDraft());
    if (focus) panel.el.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
  };
  /** A new start moves the event: it keeps how long it lasts. */
  const moveStart = (day: string, time: string): void => {
    const length = momentOf(endDay, endTime) - momentOf(startDay, startTime);
    const days = (localDay(endDay).getTime() - localDay(startDay).getTime());
    startDay = day; startTime = time;
    if (allDay) { const last = new Date(localDay(day).getTime() + days + 3_600_000); endDay = dateKey(last); return; }
    const end = new Date(momentOf(day, time) + length);
    endDay = dateKey(end); endTime = clockOf(end.getTime());
  };
  const save = async (): Promise<void> => {
    if (saving) return;
    read();
    if (!title.trim()) { toaster.info(t("cal.needsTitle")); panel.el.querySelector<HTMLElement>("#cal-title")?.focus(); return; }
    const next = asDraft();
    if (allDay ? endDay < startDay : next.end <= next.start) { toaster.info(t("cal.needsEnd")); return; }
    saving = true;
    const fields: api.CalendarFields = allDay
      ? { title: title.trim(), start: startDay, end: endDay, all_day: true, notes }
      : { title: title.trim(), start: new Date(next.start).toISOString(), end: new Date(next.end).toISOString(), all_day: false, notes };
    try {
      if (draft.id) await api.calendarUpdate(draft.id, fields); else await api.calendarAdd(fields);
      await o.onSaved();
      panel.close();
    } catch (error) { toaster.info(describeError(error)); }
    finally { saving = false; }
  };
  panel = openPanel(rect, "au-pop-editor", t(draft.id ? "cal.edit" : "auto.create"), { canClose: () => { read(); return !saving && !editing(); }, onClose: o.onClose });
  panel.el.innerHTML = body();
  place(panel, rect);
  panel.el.addEventListener("input", e => {
    if ((e.target as Element).matches("#cal-title")) { read(); o.onTitle?.(title); }
  });
  panel.el.addEventListener("keydown", e => {
    if (e.key === "Enter" && (e.target as Element).matches("#cal-title") && !e.isComposing) { e.preventDefault(); void save(); }
  });
  panel.el.addEventListener("click", e => {
    const target = (e.target as Element).closest<HTMLElement>("[data-pop]");
    if (!target) return;
    read();
    const act = target.dataset.pop;
    if (act === "save") void save();
    else if (act === "cancel") panel.close();
    else if (act === "routine") { const next = asDraft(); panel.close(); o.onRoutine?.(next); }
    else if (act === "all-day") {
      e.preventDefault();
      allDay = !allDay;
      if (!allDay && startDay === endDay && startTime >= endTime) { startTime = "09:00"; endTime = "10:00"; }
      redraw('[data-pop="all-day"]');
    }
    else if (act === "start-day") openDatePicker(target, startDay, key => { moveStart(key, startTime); redraw('[data-pop="start-day"]'); });
    else if (act === "end-day") openDatePicker(target, endDay, key => { endDay = key < startDay ? startDay : key; if (!allDay && endDay === startDay && endTime <= startTime) endTime = clockOf(momentOf(startDay, startTime) + 3_600_000); redraw('[data-pop="end-day"]'); });
    else if (act === "start-time") openMenu(target, timeChoices(startTime), startTime, value => { moveStart(startDay, value); redraw('[data-pop="start-time"]'); });
    else if (act === "end-time") openMenu(target, timeChoices(endTime, startDay === endDay ? startTime : ""), endTime, value => { endTime = value; redraw('[data-pop="end-time"]'); });
  });
  panel.el.querySelector<HTMLElement>("#cal-title")?.focus({ preventScroll: true });
  return panel;
}

export interface DetailOptions {
  onEdit?(): void;
  /** The ⋯ of an own event: it holds what destroys it (R-UI-56). */
  onMore?(button: HTMLElement): void;
  onOpenRoutine?(): void;
  onClose?(): void;
  runStatus?: string;
  today?: Date;
  onRun?(run: RoutineRun): void;
  onOff?(): void;
}

/** What one entry is: its time, notes, who added it or where it comes from, and what can be done with it. */
export function openEventDetail(rect: Pick<DOMRect, "left" | "right" | "top">, entry: CalendarEntry, o: DetailOptions): Panel {
  const when = entry.rhythm ? entry.timing ?? "" : entry.allDay && entry.end - entry.start > 86_400_000
    ? `${whenDay(entry.start)} – ${whenDay(entry.end - 1)}`
    : `${whenDay(entry.start)} · ${clockRange(entry)}`;
  const from = entry.kind === "own"
    ? `${entry.member ? faceHTML(entry.member, 20) : ownerFaceHTML(20)}<span>${esc(entry.member ? t("cal.addedBy", { p0: entry.member.name }) : t("cal.addedByOwner"))}</span>`
    : entry.kind === "routine"
      ? `${entry.member ? faceHTML(entry.member, 20) : ""}<span>${esc(t("cal.fromRoutine", { p0: entry.member?.name ?? "" }))}${entry.routine ? ` · ${routineSentenceHTML(entry.routine)}` : ""}</span>`
      : `${googleMark()}<span>${esc(t("cal.fromGoogle"))}</span>`;
  const panel = openPanel(rect, "au-pop-detail", entry.title, { onClose: o.onClose });
  const today = dateKey(o.today ?? new Date());
  const todayRuns = (entry.runs ?? []).filter(r=>dateKey(new Date(r.at))===today);
  const runsHTML = entry.rhythm ? `<div class="au-rhythm-runs" aria-label="${esc(t("auto.todayRuns"))}">${todayRuns.map(r=>{
    const status=r.run?.status ?? "coming", label=t(status==="done" ? "auto.done" : status==="error" ? "auto.error" : status==="confirm" ? "auto.waiting" : status==="running" ? "auto.running" : status==="skipped" ? "auto.skipped" : "auto.coming");
    const icon=status==="done" ? "check" : status==="error" ? "x" : status==="confirm" ? "info" : "clock";
    return btn(ico(icon)+`<time>${esc(formatClock(r.at))}</time>`,"sm",` data-rhythm-time="${r.at}" data-status="${status}" aria-label="${esc(formatClock(r.at)+" · "+label)}"${r.run?.turn_id ? "" : " disabled"}`);
  }).join("")}</div><p class="au-pop-time">${esc(t("auto.nextRun"))} · ${entry.routine?.next_run ? esc(whenDay(entry.routine.next_run)+" · "+formatClock(entry.routine.next_run)) : esc(t("auto.notYet"))}</p>` : "";
  panel.el.innerHTML =
    `<header class="au-pop-tools">` +
    (o.onEdit ? iconButton("pencil", t("cal.edit"), ' data-pop="edit"') : "") +
    (o.onMore ? iconButton("more", t("members.more", { p0: entry.title }), ' data-pop="more" aria-haspopup="menu" aria-expanded="false"') : "") +
    iconButton("x", t("common.close"), ' data-pop="close"') + `</header>` +
    `<h2>${esc(entry.title)}</h2>${entry.rhythm && entry.routine ? "" : `<p class="au-pop-time">${esc(when)}</p>`}` +
    (entry.notes ? `<p class="au-pop-notes">${esc(entry.notes)}</p>` : "") +
    `<p class="au-pop-from">${from}</p>` +
    runsHTML +
    (o.runStatus ? `<p class="au-pop-status">${esc(o.runStatus)}</p>` : "") +
    (o.onOpenRoutine ? `<div class="au-pop-routine-actions">${btn(`<span>${esc(t("cal.openRoutine"))}</span>`, "au-pop-open", ' data-pop="open-routine"')}${o.onOff ? btn(ico("pause")+`<span>${esc(t("auto.turnOff"))}</span>`, "", ' data-pop="off"') : ""}</div>` : "");
  place(panel, rect);
  panel.el.addEventListener("click", e => {
    const time=(e.target as Element).closest<HTMLElement>("[data-rhythm-time]");
    if (time) { const run=todayRuns.find(r=>r.at===Number(time.dataset.rhythmTime))?.run; if (run) { panel.close(); o.onRun?.(run); } return; }
    const target = (e.target as Element).closest<HTMLElement>("[data-pop]");
    if (!target) return;
    const act = target.dataset.pop;
    if (act === "close") panel.close();
    else if (act === "edit") o.onEdit?.();
    else if (act === "more") o.onMore?.(target);
    else if (act === "open-routine") { panel.close(); o.onOpenRoutine?.(); }
    else if (act === "off") { panel.close(); o.onOff?.(); }
  });
  panel.el.querySelector<HTMLElement>('[data-pop="close"]')?.focus({ preventScroll: true });
  return panel;
}
