import { visibilityGate, windowVisible } from "../window-visibility";
// The app's own calendar, modelled on Google Calendar: the month, what it shows and 建立 in a rail on the left; a day, week
// or month on the right. Own events are made and changed here by click and drag; routines and Google events are read
// here and say where they come from. A routine is made or changed by its member in the conversation (owner, 2026-11-09:
// 「這邊的所有設定都只能透過 Agent 完成 但是我們看的到內容」): a routine opens to read, and 例行任務 at a time puts the
// owner's words for it in the member's composer.
import * as api from "../api";
import { closePanel, openEventDetail, openEventEditor, panelOpen, type EventDraft } from "../calendar-popover";
import { allDayBars, chipClock, chipColor, chipHTML, dayLayout, dismissOffer, entryOfItem, fittedRange, googleMark, googleNoticeHTML, GOOGLE_SOURCE, isAllDayRow, isRunException, memberSource, monthEntries, OWN_SOURCE, routineEntries, type CalendarEntry, type Segment } from "../calendar-view";
import { describeError, formatClock, formatDate } from "../format";
import { getLocale, onLocaleChange, t } from "../i18n";
import { dayName, faceHTML, primaryFirst, primaryIdOf } from "../members";
import { openMemberThread } from "../team-navigation";
import { openRoutineView } from "../routine-view";
import { dateKey, localDay, monthDays, monthGrid, monthLabel, shiftDay } from "../schedule-picker";
import type { AppContext, Member, Page, Routine, RoutineRun } from "../types";
import type { GoogleCalendarState, HomeItem } from "../home-types";
import { btn, closeMenu, esc, ico, iconButton, openConfirmMenu, openMenu, openPopover, sel, tg, toaster } from "../ui";
import "../members.css";
import "../automations.css";

export const runStatus = (status: string): string => t(status === "skipped" ? "auto.skipped" : status === "running" || status === "confirm" ? "auto.running" : status === "done" ? "auto.done" : "auto.error");

type Period = "day" | "week" | "month";
const HIDDEN_KEY = "raphael.calendar.hidden";
const VIEW_KEY = "raphael.calendar.view";
const MINUTE = 60_000;
const SNAP = 15;
/** Below this page width the rail is a drawer. Week columns use the grid's actual width. */
const NARROW = 760;
const MIN_WEEK_WIDTH = 520;
const DRAG_PX = 4;

type Drag =
  | { kind: "new"; key: string; col: HTMLElement; anchor: number; from: number; to: number; moved: boolean; x0: number; y0: number; ghost: HTMLElement | null }
  | { kind: "move"; entry: CalendarEntry; wrap: HTMLElement; col: HTMLElement; grab: number; top: number; delta: number; moved: boolean; x0: number; y0: number }
  | { kind: "resize"; entry: CalendarEntry; wrap: HTMLElement; col: HTMLElement; end: number; moved: boolean }
  | { kind: "shift"; entry: CalendarEntry; wrap: HTMLElement; from: string; to: string; moved: boolean; x0: number; y0: number }
  | { kind: "stretch"; entry: CalendarEntry; wrap: HTMLElement; column: number; to: string; moved: boolean };

export function createAutomationsPage(app: AppContext): Page {
  const el = document.createElement("section"); el.className = "au-page";
  let members: Member[] = [], routines: Routine[] = [];
  let items: HomeItem[] = [];
  let google: GoogleCalendarState | undefined;
  let runCounts = new Map<number, number>();
  let logs = new Map<number, RoutineRun[]>(), period: Period = "week", date = new Date(), mini = new Date();
  let focusedHomeItem = "", detailOnLoad = false, createOnLoad = false;
  let visible = false, awake = false, loads = 0, pending = true;
  let resetPosition = true;
  /** The range (view and first day) whose all-day band shows every item; any other range folds it again. */
  let openBand = "";
  let timer: ReturnType<typeof setInterval> | undefined;
  let tools: HTMLElement | null = null;
  let draft: EventDraft | null = null;
  let drag: Drag | null = null, drawLater = false, swallowClick = false, wasNarrow = false;
  let shown = new Map<string, CalendarEntry>();
  const hidden = new Set<string>();
  try { for (const key of JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]")) if (typeof key === "string") hidden.add(key); } catch { /* All of it shows when storage is unavailable. */ }
  try { const saved=localStorage.getItem(VIEW_KEY); if(saved==="day" || saved==="week" || saved==="month") period=saved; } catch { /* The default week remains usable without storage. */ }

  const member = (id: number): Member | undefined => members.find(m => m.id === id);
  const narrow = (): boolean => el.clientWidth > 0 && el.clientWidth <= NARROW;
  // Before the first grid exists, allow for its 216px border-box rail, margins and borders.
  const calendarWidth = (): number => el.querySelector<HTMLElement>('.au-calendar-main')?.clientWidth ||
    Math.max(0, el.clientWidth - (narrow() ? 26 : 234));
  const choosePeriod = (value: Period): void => {
    period=value;
    try { localStorage.setItem(VIEW_KEY,value); } catch { /* The choice still holds for this window. */ }
  };
  const hourHeight = (): number => parseFloat(el.style.getPropertyValue("--au-hour")) || 48;
  const bandKey = (start: Date): string => `${period}:${dateKey(start)}`;
  /** The grid's head as it stands when its all-day band is folded: the hours are sized by it, so opening the band moves them and never resizes them. */
  function foldedHeadHeight(head: HTMLElement): number {
    const band = head.querySelector<HTMLElement>(".au-all-day-row"), day = head.querySelector<HTMLElement>(".au-day-head");
    if (!head.classList.contains("is-open") || !band || !day) return head.offsetHeight;
    const style = getComputedStyle(band), pitch = parseFloat(style.gridTemplateRows.split(" ")[0]!) + parseFloat(style.rowGap);
    return day.offsetHeight + band.offsetHeight - (Number(band.dataset.rows) - Number(band.dataset.foldedRows)) * pitch + parseFloat(getComputedStyle(head).borderBottomWidth);
  }
  /** A routine is read; a new one at a day and time is asked of a member in its conversation, Raphael by default. */
  const edit = (routine?: Routine, memberId?: number, day?: string, time?: string): void => {
    if (routine) { openRoutineView(routine, members); return; }
    openMemberThread(app, memberId ?? 0, undefined, t("auto.askRoutine", { p0: day ? formatDate(day) : "", p1: time ?? "" }));
  };

  let readStamp = "";
  async function load(): Promise<void> {
    const mine = ++loads, month = dateKey(date).slice(0, 7);
    try {
      const [people, plans, home] = await Promise.all([api.membersList(getLocale()), api.routinesList(), api.homeOverview(false, month)]);
      const histories = await Promise.all(plans.routines.map(async r => [r.id, await api.routineRuns(r.id)] as const));
      if (mine !== loads || !visible) return;
      const stamp = JSON.stringify([people, plans, histories, home.calendar_events ?? home.calendar, home.calendar_google]);
      const same = stamp === readStamp && !pending;
      readStamp = stamp;
      members = primaryFirst(people.members, primaryIdOf(people)); routines = plans.routines;
      items = (home.calendar_events ?? home.calendar).filter(item => item.kind === "event" || item.kind === "own");
      google = home.calendar_google;
      logs = new Map(histories.map(([id, h]) => [id, h.runs])); runCounts = new Map(histories.map(([id, h]) => [id, h.total ?? h.runs.length])); pending = false; if (!same) draw();
      if (focusedHomeItem) {
        const target = [...el.querySelectorAll<HTMLElement>("[data-calendar-item]")].find(item => item.dataset.calendarItem === focusedHomeItem ||
          (focusedHomeItem.startsWith("rhythm:") && item.dataset.calendarItem?.startsWith(focusedHomeItem.split(":").slice(0,2).join(":")+":")));
        target?.scrollIntoView?.({ block: "center" }); target?.focus({ preventScroll: true });
        if (detailOnLoad && target && shown.has(target.dataset.calendarItem!)) { detailOnLoad = false; openDetail(target, shown.get(target.dataset.calendarItem!)!); }
      }
      if (createOnLoad) { createOnLoad = false; startCreate(null); }
      // The core's cached window serves the first paint; a month of its own is read from Google once it is there to read.
      if (home.calendar_google === "connected" || home.calendar_google === "unreadable") void refreshGoogle(mine, month);
    } catch (error) { if (mine === loads && visible) { pending = false; draw(); toaster.info(describeError(error)); } }
  }
  async function refreshGoogle(mine: number, month: string): Promise<void> {
    try {
      const home = await api.homeOverview(true, month);
      if (mine !== loads || !visible) return;
      const next = (home.calendar_events ?? home.calendar).filter(item => item.kind === "event" || item.kind === "own");
      if (JSON.stringify(next) === JSON.stringify(items) && home.calendar_google === google) return;
      items = next; google = home.calendar_google; draw();
    } catch { /* The first paint stays; the next load reads it again. */ }
  }

  function range(): { start: Date; n: number; end: Date } {
    const day = localDay(dateKey(date));
    if (period === "day") return { start: day, n: 1, end: shiftDay(day, 1) };
    if (period === "month") { const [first] = monthDays(date); return { start: first!, n: 42, end: shiftDay(first!, 42) }; }
    const width=calendarWidth();
    if (el.clientWidth > 0 && width < MIN_WEEK_WIDTH) {
      const n=Math.max(1,Math.min(3,Math.floor((width-52)/100)));
      return { start: day, n, end: shiftDay(day, n) };
    }
    const start = shiftDay(day, -((date.getDay() + 6) % 7));
    return { start, n: 7, end: shiftDay(start, 7) };
  }
  function titleOf(start: Date, end: Date): string {
    if (period === "day") return start.toLocaleDateString(getLocale(), { year: "numeric", month: "long", day: "numeric" });
    if (period === "month") return monthLabel(date);
    const last = shiftDay(end, -1);
    if (Math.round((end.getTime()-start.getTime())/86_400_000)<7) {
      const options: Intl.DateTimeFormatOptions={month:"numeric",day:"numeric",...(start.getFullYear()!==last.getFullYear()?{year:"numeric"}:{})};
      const first=start.toLocaleDateString(getLocale(),options), final=last.toLocaleDateString(getLocale(),options);
      return first===final ? first : `${first}–${final}`;
    }
    if (last.getMonth() === start.getMonth()) return monthLabel(start);
    return `${monthLabel(start)} – ${last.getFullYear() === start.getFullYear() ? last.toLocaleDateString(getLocale(), { month: "long" }) : monthLabel(last)}`;
  }

  /** Everything the calendar holds in a period, whatever the rail hides. */
  function entriesIn(start: Date, end: Date): CalendarEntry[] {
    const scheduled = routines.flatMap(r => routineEntries(r, member(r.member_id), start, end, logs.get(r.id) ?? [],
      r.schedule?.max_runs ? Math.max(0, r.schedule.max_runs - (runCounts.get(r.id) ?? 0)) : Infinity));
    const kept = items.map(entryOfItem).filter(entry => entry.start < end.getTime() && Math.max(entry.end, entry.start + 1) > start.getTime());
    return [...kept, ...scheduled];
  }

  // ---------- drawing ----------

  function toolbarHTML(start: Date, end: Date): string {
    const views: { value: Period; label: string }[] = [{ value: "day", label: t("auto.day") }, { value: "week", label: t("auto.week") }, { value: "month", label: t("auto.month") }];
    return `<header class="au-toolbar">` +
      iconButton("calendar", t("auto.tools"), ' data-au="tools" aria-haspopup="dialog"', "au-tools-toggle") +
      `<div class="au-step au-date-nav">${iconButton("left", t("auto.previous"), ' data-au="prev"')}${btn(esc(t("auto.today")), "au-today", ` data-au="today"${new Date()>=start && new Date()<end ? " disabled" : ""}`)}${iconButton("right", t("auto.following"), ' data-au="next"')}</div>` +
      `<h1>${esc(titleOf(start, end))}</h1><span class="au-spacer"></span>` +
      iconButton("plus", t("auto.create"), ' data-au="new"', "au-toolbar-new") +
      sel(views, period, t("auto.view"), ' data-au="view"') + `</header>`;
  }
  function sourceRow(key: string, label: string, lead: string, attrs = ""): string {
    return `<button type="button" class="btn au-source" role="checkbox" aria-checked="${!hidden.has(key)}" data-au="source" data-source="${esc(key)}"${attrs}>` +
      `<span class="au-check">${ico("check")}</span>${lead}<span class="au-source-name">${esc(label)}</span></button>`;
  }
  function railHTML(): string {
    const notice = googleNoticeHTML(google, { go: 'data-calendar-go="connections"', dismiss: "data-calendar-dismiss", wordsAfter: true });
    return `<aside class="au-calendar-side">` +
      btn(ico("plus") + esc(t("auto.create")), "pri au-create", ' data-au="new"') +
      `<div class="au-month-head"><b>${esc(monthLabel(mini))}</b><span class="au-step">${iconButton("left", t("auto.monthPrevious"), ' data-au="month-prev"')}${iconButton("right", t("auto.monthNext"), ' data-au="month-next"')}</span></div>${monthGrid(mini, dateKey(date), "data-mini-date")}` +
      `<h3>${esc(t("overview.calendar"))}</h3><div class="au-drag-members">` +
      sourceRow(OWN_SOURCE, t("cal.own"), `<span class="au-source-mark">${ico("calendar")}</span>`) +
      members.map(m => sourceRow(memberSource(m.id), m.name, faceHTML(m, 20), `${chipColor(m)} draggable="true" data-drag-member="${m.id}" title="${esc(t("auto.drag"))}"`)).join("") +
      (google === "connected" ? sourceRow(GOOGLE_SOURCE, t("cal.google"), googleMark()) : "") + `</div>` +
      notice +
      `<label class="au-awake" title="${esc(t("auto.keepAwake"))}"><span>${esc(t("auto.awake"))}</span>${tg(awake, t("auto.keepAwake"), ' data-au="awake"')}</label></aside>`;
  }
  const entryAttrs = (entry: CalendarEntry, label: string): string =>
    ` data-au="entry" data-entry="${esc(entry.id)}" data-calendar-item="${esc(entry.id)}" title="${esc(label)}" aria-label="${esc(label)}"${entry.run ? ` data-status="${entry.run.status}"` : ""}${focusedHomeItem === entry.id ? ' aria-current="true"' : ""}`;
  const labelOf = (entry: CalendarEntry): string =>
    [entry.kind === "routine" ? entry.member?.name : "", entry.title, entry.rhythm ? entry.timing : chipClock(entry), entry.run ? runStatus(entry.run.status) : ""].filter(Boolean).join(" · ");
  /** The ⋯ a right click on an own event presses (R-UI-44, R-UI-56). It takes no room; the popover has one to see. */
  const moreOf = (entry: CalendarEntry): string =>
    entry.kind === "own" ? iconButton("more", t("members.more", { p0: entry.title }), ` data-au="event-more" data-entry="${esc(entry.id)}" aria-haspopup="menu" aria-expanded="false"`, "au-event-more") : "";

  function barHTML(entry: CalendarEntry, column: number, span: number, row: number, startsBefore: boolean, endsAfter: boolean): string {
    const label = labelOf(entry), focused = entry.id === focusedHomeItem ? " is-home-focus" : "";
    return `<div class="au-event au-bar${startsBefore ? " starts-before" : ""}${endsAfter ? " ends-after" : ""}" data-wrap="${esc(entry.id)}" style="grid-column:${column + 2}/span ${span};grid-row:${row + 1}">` +
      chipHTML(entry, `is-line au-all-day-event${focused}`, entryAttrs(entry, label), { clock: false, face: entry.rhythm ? 20 : 0 }) + moreOf(entry) +
      (entry.kind === "own" && entry.allDay && !endsAfter ? `<i class="au-bar-edge" data-edge="right"></i>` : "") + `</div>`;
  }
  function chipOfSegment(part: Segment): string {
    const entry = part.entry, at = new Date(part.start), hours = (part.end - part.start) / 3_600_000;
    const now = Date.now(), past = entry.end <= now;
    const top = at.getHours() + at.getMinutes() / 60, drawn = Math.max(hours, 0.4), short = hours < 0.75;
    const place = `top:calc(${top} * var(--au-hour));height:calc(${drawn} * var(--au-hour) - 2px);left:calc(${part.lane * 100 / part.lanes}% + 1px);width:calc(${100 / part.lanes}% - 3px)`;
    const label = labelOf(entry), focused = entry.id === focusedHomeItem ? " is-home-focus" : "";
    const cls = entry.kind === "routine" ? `au-occurrence${entry.run && !isRunException(entry) ? " is-past" : ""}` : entry.kind === "event" ? `au-calendar-event${focused}${past ? " is-past" : ""}` : `au-own-event${focused}${past ? " is-past" : ""}`;
    const chip = chipHTML(entry, `${cls}${short ? " is-line" : ""}`, `${entryAttrs(entry, label)}${entry.run ? ` data-run="${entry.run.id}" data-status="${entry.run.status}"` : ""}`, { face: short ? 0 : 20 });
    const mark = entry.run ? `<i class="au-history-mark" data-status="${entry.run.status}"></i>` : "";
    const edge = entry.kind === "own" && part.end === entry.end ? `<i class="au-event-edge" data-edge="bottom"></i>` : "";
    return `<div class="au-event${entry.kind === "own" ? " is-movable" : ""}${period !== "day" && (part.lanes > 1 || calendarWidth()/range().n < 120) ? " is-tight" : ""}" data-wrap="${esc(entry.id)}" data-part-start="${part.start}" style="${place}">${chip}${mark}${moreOf(entry)}${edge}</div>`;
  }
  const draftTitle = (): string => draft?.title.trim() || t("cal.title");
  function draftOnDay(key: string): string {
    if (!draft || draft.allDay || dateKey(new Date(draft.start)) !== key) return "";
    const at = new Date(draft.start), hours = (draft.end - draft.start) / 3_600_000;
    return `<div class="au-event au-draft" style="top:calc(${at.getHours() + at.getMinutes() / 60} * var(--au-hour));height:calc(${Math.max(hours, 0.4)} * var(--au-hour) - 2px);left:1px;width:calc(100% - 3px)">` +
      `<span class="cal-chip btn is-own${hours < 0.75 ? " is-line" : ""}"><span class="cal-chip-copy"><time data-from="${draft.start}" data-to="${draft.end}">${esc(`${formatClock(draft.start)} – ${formatClock(draft.end)}`)}</time><b>${esc(draftTitle())}</b></span></span></div>`;
  }
  function gridHTML(start: Date, n: number, entries: CalendarEntry[]): string {
    const now = new Date(), today = dateKey(now);
    const days = Array.from({ length: n }, (_, i) => shiftDay(start, i));
    const zone = Intl.DateTimeFormat(getLocale(), { timeZoneName: "shortOffset" }).formatToParts(now).find(p => p.type === "timeZoneName")?.value ?? "";
    const folded = allDayBars(entries, days), hasMore = folded.more.some(count => count > 0);
    const open = hasMore && openBand === bandKey(start);
    const { bars, more, used } = open ? allDayBars(entries, days, Infinity) : folded;
    const extra = open || hasMore ? 1 : 0;
    const draftColumn = draft?.allDay ? days.findIndex(day => dateKey(day) === dateKey(new Date(draft!.start))) : -1;
    const draftRows = draftColumn >= 0 ? 1 : 0;
    const rows = Math.max(1, used + extra + draftRows), foldedRows = Math.max(1, folded.used + (hasMore ? 1 : 0) + draftRows);
    const toggle = open
      ? btn(esc(t("common.showLess")), "cal-more", ` data-au="all-day-toggle" aria-expanded="true" aria-controls="au-all-day-band" style="grid-column:2/-1;grid-row:${used + 1}"`)
      : more.map((count, i) => count ? btn(esc(t("overview.moreEvents", { p0: count })), "cal-more", ` data-au="all-day-toggle" data-date="${dateKey(days[i]!)}" aria-expanded="false" aria-controls="au-all-day-band" style="grid-column:${i + 2};grid-row:${used + 1}"`) : "").join("");
    const heads = days.map(day => {
      const key = dateKey(day), label = day.toLocaleDateString(getLocale(), { month: "long", day: "numeric", weekday: "long" });
      return `<div class="au-day-head${key === today ? " is-today" : ""}"${key === today ? ' aria-current="date"' : ""}><span>${esc(dayName(day.getDay()))}</span>${btn(String(day.getDate()), "au-day-num", ` data-au="open-day" data-date="${key}" aria-label="${esc(label)}"`)}</div>`;
    }).join("");
    const allDay = `<div class="au-all-day-row" id="au-all-day-band" data-rows="${rows}" data-folded-rows="${foldedRows}" style="--au-rows:${rows}"><span class="au-all-day-label">${esc(zone)}</span>` +
      days.map((day, i) => `<div class="au-all-day" data-all-day="${dateKey(day)}" style="grid-column:${i + 2}"></div>`).join("") +
      bars.map(bar => barHTML(bar.entry, bar.column, bar.span, bar.row, bar.startsBefore, bar.endsAfter)).join("") +
      toggle +
      (draftColumn >= 0 ? `<div class="au-event au-bar au-draft" style="grid-column:${draftColumn + 2};grid-row:${used + 1 + (open ? 1 : 0)}"><span class="cal-chip btn is-own is-line"><span class="cal-chip-copy"><b>${esc(draftTitle())}</b></span></span></div>` : "") + `</div>`;
    return `<div class="au-calendar-scroll"><div class="au-grid${n === 1 ? " is-one-day" : ""}" style="--au-days:${n}"><div class="au-grid-head${open ? " is-open" : ""}"><span></span>${heads}${allDay}</div>` +
      `<div class="au-hours">${Array.from({ length: 24 }, (_, h) => `<div>${h ? `<span>${String(h).padStart(2, "0")}:00</span>` : ""}</div>`).join("")}</div>` +
      days.map(day => {
        const key = dateKey(day);
        return `<div class="au-day-col" data-day="${key}">${Array.from({ length: 24 }, (_, h) => `<div class="au-slot" data-slot="${key}" data-hour="${h}"></div>`).join("")}` +
          dayLayout(entries, day).map(chipOfSegment).join("") + draftOnDay(key) +
          (key === today ? `<i class="au-now" style="top:calc(${now.getHours() + now.getMinutes() / 60} * var(--au-hour))"></i>` : "") + `</div>`;
      }).join("") + `</div></div>`;
  }
  function monthHTML(entries: CalendarEntry[]): string {
    const today = dateKey(new Date());
    const heads = [1, 2, 3, 4, 5, 6, 0].map(n => `<span class="au-month-weekday">${esc(dayName(n))}</span>`).join("");
    const cells = monthDays(date).map(day => {
      const key = dateKey(day), other = day.getMonth() !== date.getMonth();
      const label = day.toLocaleDateString(getLocale(), { month: "long", day: "numeric", weekday: "long" });
      const chips = monthEntries(entries, key).map(entry => {
        const focused = entry.id === focusedHomeItem ? " is-home-focus" : "", past = entry.end <= Date.now() && !isRunException(entry) ? " is-past" : "";
        return `<div class="au-event is-line${entry.kind === "own" ? " is-movable" : ""}" data-wrap="${esc(entry.id)}">${chipHTML(entry, `is-line${focused}${past}`, entryAttrs(entry, labelOf(entry)), { clock: !entry.allDay, face: entry.rhythm ? 16 : 0, timing: false })}${moreOf(entry)}</div>`;
      }).join("");
      const placeholder = draft && dateKey(new Date(draft.start)) === key ? `<div class="au-event is-line au-draft"><span class="cal-chip btn is-own is-line"><span class="cal-chip-copy"><b>${esc(draftTitle())}</b></span></span></div>` : "";
      return `<div class="au-month-cell${other ? " is-other" : ""}${key === today ? " is-today" : ""}" data-month-day="${key}"${key === today ? ' aria-current="date"' : ""}>${btn(String(day.getDate()), "au-day-num", ` data-au="open-day" data-date="${key}" aria-label="${esc(label)}"`)}` +
        `<div class="au-month-chips">${placeholder}${chips}${btn("", "cal-more", ` data-au="open-day" data-date="${key}" hidden`)}</div></div>`;
    }).join("");
    return `<div class="au-month-view">${heads}${cells}</div>`;
  }
  function emptyHint(): string {
    const words = t(period === "day" ? "overview.emptyDay" : period === "month" ? "cal.emptyMonth" : "cal.emptyWeek");
    return `<div class="au-empty-hint" role="status"><span>${esc(words)}</span>${btn(ico("plus") + esc(t("auto.create")), "", ' data-au="new"')}</div>`;
  }
  function draw(): void {
    if (drag) { drawLater = true; return; }
    const reopenTools = tools?.isConnected;
    if (reopenTools) closeMenu();
    const scroll = el.querySelector<HTMLElement>(".au-calendar-scroll");
    const previousHour = scroll && !resetPosition ? scroll.scrollTop / hourHeight() : null;
    const { start, n, end } = range();
    const all = entriesIn(start, end), entries = all.filter(entry => !hidden.has(entry.source));
    shown = new Map(entries.map(entry => [entry.id, entry]));
    wasNarrow = narrow();
    el.innerHTML = toolbarHTML(start, end) + (pending ? `<div class="au-empty" role="status">${esc(t("common.loading"))}</div>`
      : `<div class="au-calendar">${railHTML()}<div class="au-calendar-main">${period === "month" ? monthHTML(entries) : gridHTML(start, n, entries)}${all.length || draft ? "" : emptyHint()}</div></div>`);
    if (period === "month") fitMonth(); else { fitHours(previousHour); fitRanges(); }
    if (!pending) resetPosition = false;
    if (reopenTools) openTools();
  }
  /** As many chips as a month's cell holds; the rest are a count that opens the day. */
  function fitMonth(): void {
    for (const cell of el.querySelectorAll<HTMLElement>(".au-month-chips")) {
      const chips = [...cell.querySelectorAll<HTMLElement>(":scope > .au-event")], more = cell.querySelector<HTMLElement>(":scope > .cal-more")!;
      const room = cell.clientHeight ? Math.max(1, Math.floor((cell.clientHeight + 2) / 22)) : chips.length;
      const fits = chips.length <= room ? chips.length : Math.max(0, room - 1);
      chips.forEach((chip, index) => { chip.hidden = index >= fits; });
      more.hidden = fits === chips.length;
      if (!more.hidden) more.textContent = t("overview.moreEvents", { p0: chips.length - fits });
    }
  }
  function fitHours(previousHour: number | null = null): void {
    // Flex gives the title its width first; reveal timing only when none of it is clipped.
    for (const timing of el.querySelectorAll<HTMLElement>('.is-rhythm small')) timing.style.visibility = timing.scrollWidth <= timing.clientWidth ? "visible" : "hidden";
    const grid = el.querySelector<HTMLElement>(".au-calendar-scroll"), head = grid?.querySelector<HTMLElement>(".au-grid-head");
    if (!grid || !head || !grid.clientHeight) return;
    const room = grid.clientHeight - foldedHeadHeight(head), height = Math.max(28, Math.min(54, room / 11));
    el.style.setProperty("--au-hour", `${height}px`);
    const now = new Date(), { start, end } = range();
    const onNow = now >= start && now < end;
    const first = [...shown.values()].filter(entry => !isAllDayRow(entry)).map(entry => new Date(entry.start)).map(at => at.getHours() + at.getMinutes() / 60);
    const focus = onNow ? now.getHours() + now.getMinutes() / 60 : first.length ? Math.min(...first) : 8;
    // Near now, with what comes next below it, and never past the end of the day.
    const initial = head.classList.contains("is-open") ? 0 : Math.max(0, Math.min(24 - room / height, focus - 2.5));
    grid.scrollTop = (previousHour ?? initial) * height;
  }
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => {
    if (!visible || drag) return;
    if (narrow() !== wasNarrow || (period === "week" && el.querySelectorAll('.au-day-col').length !== range().n)) { draw(); return; }
    if (period === "month") { fitMonth(); return; }
    const grid = el.querySelector<HTMLElement>(".au-calendar-scroll");
    fitHours(grid ? grid.scrollTop / hourHeight() : null);
    fitRanges();
  }) : null;
  resize?.observe(el);
  const poll = visibilityGate(tick, () => visible);
  function tick(): void {
    if (!visible || !windowVisible()) return;
    const now = new Date(), line = el.querySelector<HTMLElement>(".au-now"), { start, end } = range();
    if (line?.closest<HTMLElement>(".au-day-col")?.dataset.day === dateKey(now)) line.style.top = `calc(${now.getHours() + now.getMinutes() / 60} * var(--au-hour))`;
    else if ((line || (now >= start && now < end)) && !panelOpen()) draw();
  }
  function openTools(): void {
    const anchor = el.querySelector<HTMLElement>('[data-au="tools"]'); if (!anchor) return;
    tools = openPopover(anchor, railHTML(), { className: "au-calendar-tools", role: "dialog", label: t("auto.tools"), onClose: () => { tools = null; } });
    tools.addEventListener("click", onClick);
    tools.addEventListener("dragstart", onDragStart);
  }

  // ---------- making and changing ----------

  function openDetail(chip: HTMLElement, entry: CalendarEntry): void {
    if (entry.run?.turn_id && entry.member) { openMemberThread(app, entry.member.id, entry.run.turn_id); return; }
    if (entry.rhythm && entry.routine) {
      const today = localDay(dateKey(new Date()));
      entry = {...entry, runs: entriesIn(today, shiftDay(today, 1)).find(item => item.rhythm && item.routine?.id === entry.routine?.id)?.runs ?? []};
    }
    const rect = chip.getBoundingClientRect();
    const own = entry.kind === "own";
    openEventDetail(rect, entry, {
      runStatus: entry.run ? runStatus(entry.run.status) : undefined,
      onEdit: own ? () => openEditor(rect, { id: entry.eventId, title: entry.title, start: entry.start, end: entry.end, allDay: entry.allDay, notes: entry.notes ?? "" }) : undefined,
      onMore: own ? button => askToDelete(button, entry) : undefined,
      onOpenRoutine: entry.routine ? () => edit(entry.routine) : undefined,
      onRun: run => { if (run.turn_id && entry.member) openMemberThread(app, entry.member.id, run.turn_id); },
      onOff: entry.rhythm && entry.routine ? () => { void api.routinesUpdate(entry.routine!.id, {enabled:false}).then(()=>load()).catch(error=>toaster.info(describeError(error))); } : undefined,
    });
  }
  function askToDelete(button: HTMLElement, entry: CalendarEntry): void {
    openConfirmMenu(button, {
      label: t("cal.delete"), ask: t("cal.deleteAsk"),
      run: () => {
        closePanel();
        items = items.filter(item => item.id !== entry.id); draw();
        void api.calendarDelete(entry.eventId!).then(() => toaster.info(t("members.deleted", { p0: entry.title })), error => { toaster.info(describeError(error)); void load(); });
      },
    });
  }
  function openEditor(rect: Pick<DOMRect, "left" | "right" | "top">, value: EventDraft): void {
    openEventEditor(rect, value, {
      onChange(next) { if (!next.id) { draft = next; draw(); } },
      onTitle(title) {
        if (draft) draft = { ...draft, title };
        const words = el.querySelector(".au-draft b"); if (words) words.textContent = draftTitle();
      },
      onSaved: () => load(),
      onClose() { if (draft) { draft = null; draw(); } },
      onRoutine: value.id ? undefined : next => edit(undefined, undefined, dateKey(new Date(next.start)), formatClock(next.start)),
    });
  }
  /** The form of a new event, for a slot of the grid or for 建立: the next hour on the day in view. */
  function startCreate(button: HTMLElement | null, value?: EventDraft): void {
    const rect = button?.getBoundingClientRect() ?? null;
    let next = value;
    if (!next) {
      const now = new Date(), onToday = dateKey(date) === dateKey(now);
      const at = onToday ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1) : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9);
      next = { title: "", start: at.getTime(), end: at.getTime() + 3_600_000, allDay: false, notes: "" };
    }
    closeTools();
    draft = next;
    draw();
    const placeholder = el.querySelector<HTMLElement>(".au-draft");
    placeholder?.scrollIntoView?.({ block: "nearest" });
    const anchor = placeholder?.getBoundingClientRect() ?? rect ?? el.getBoundingClientRect();
    openEditor(anchor, next);
  }
  const closeTools = (): void => { if (tools?.isConnected) closeMenu(); };

  function navigate(next: Date): void {
    const month = dateKey(date).slice(0, 7);
    date = next; mini = next; resetPosition = true;
    draw();
    if (dateKey(next).slice(0, 7) !== month) void load();
  }
  function onClick(e: Event): void {
    if (swallowClick) { swallowClick = false; e.stopPropagation(); return; }
    const pressed = e.target as Element;
    const target = pressed.closest<HTMLElement>("[data-au], [data-mini-date], [data-calendar-go], [data-calendar-dismiss]");
    if (!target) {
      const cell = pressed.closest<HTMLElement>("[data-month-day], [data-all-day]");
      if (cell) {
        const day = localDay(cell.dataset.monthDay ?? cell.dataset.allDay!);
        startCreate(null, { title: "", start: day.getTime(), end: shiftDay(day, 1).getTime(), allDay: true, notes: "" });
      }
      return;
    }
    if (target.dataset.miniDate) { closeTools(); const month = dateKey(date).slice(0, 7); date = localDay(target.dataset.miniDate); resetPosition = true; draw(); if (dateKey(date).slice(0, 7) !== month) void load(); return; }
    if (target.dataset.calendarGo) { closeTools(); app.go("settings", "connections"); return; }
    if (target.dataset.calendarDismiss) { dismissOffer(target.dataset.calendarDismiss as GoogleCalendarState); draw(); return; }
    const act = target.dataset.au;
    if (act === "tools") { if (tools?.isConnected) closeMenu(); else openTools(); }
    else if (act === "new") startCreate(target);
    else if (act === "entry") { const entry = shown.get(target.dataset.entry!); if (entry) openDetail(target, entry); }
    else if (act === "event-more") { const entry = shown.get(target.dataset.entry!); if (entry) askToDelete(target, entry); }
    else if (act === "open-day") {
      // A month's 「還有 N 個」 lands on a day that shows all of it: the band of the day view is already open.
      choosePeriod("day");
      if (target.classList.contains("cal-more")) openBand = `day:${target.dataset.date}`;
      navigate(localDay(target.dataset.date!));
    }
    else if (act === "all-day-toggle") {
      openBand = target.getAttribute("aria-expanded") === "true" ? "" : bandKey(range().start);
      resetPosition = true; draw();
      el.querySelector<HTMLElement>('[data-au="all-day-toggle"]')?.focus({ preventScroll: true });
    }
    else if (act === "source") {
      const key = target.dataset.source!;
      if (hidden.has(key)) hidden.delete(key); else hidden.add(key);
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden])); } catch { /* The choice holds until the window closes. */ }
      draw();
    }
    else if (act === "awake") { e.preventDefault(); (target as HTMLButtonElement).disabled = true; void api.keepAwakeSet(!awake).then(value => { awake = value; draw(); }).catch(error => { (target as HTMLButtonElement).disabled = false; toaster.info(describeError(error)); }); }
    else if (act === "view") {
      openMenu(target, [{ value: "day", label: t("auto.day") }, { value: "week", label: t("auto.week") }, { value: "month", label: t("auto.month") }], period, value => {
        choosePeriod(value as Period); resetPosition = true; draw();
        el.querySelector<HTMLElement>('[data-au="view"]')?.focus({ preventScroll: true });
      });
    }
    else if (act === "today") navigate(new Date());
    else if (act === "prev" || act === "next") {
      const way = act === "prev" ? -1 : 1;
      navigate(period === "month" ? new Date(date.getFullYear(), date.getMonth() + way, 1) : shiftDay(date, way * (period === "day" ? 1 : range().n)));
    }
    else if (act === "month-prev" || act === "month-next") { mini = new Date(mini.getFullYear(), mini.getMonth() + (act === "month-prev" ? -1 : 1), 1); draw(); }
  }
  function onDragStart(e: DragEvent): void {
    const m = (e.target as Element).closest<HTMLElement>("[data-drag-member]");
    if (m) { e.dataTransfer?.setData("application/x-raphael-member", m.dataset.dragMember!); closeTools(); }
  }

  // ---------- the pointer on the grid ----------

  const columnAt = (x: number): HTMLElement | null => {
    const columns = [...el.querySelectorAll<HTMLElement>(".au-day-col")];
    return columns.find(col => { const box = col.getBoundingClientRect(); return x >= box.left && x < box.right; })
      ?? (columns.length ? (x < columns[0]!.getBoundingClientRect().left ? columns[0]! : columns[columns.length - 1]!) : null);
  };
  const minutesAt = (col: HTMLElement, y: number): number => (y - col.getBoundingClientRect().top) / hourHeight() * 60;
  const snapped = (minutes: number): number => Math.max(0, Math.min(1440, Math.round(minutes / SNAP) * SNAP));
  const moment = (key: string, minutes: number): number => { const day = localDay(key); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, minutes).getTime(); };
  const dayCellAt = (x: number, y: number): HTMLElement | undefined =>
    [...el.querySelectorAll<HTMLElement>("[data-month-day], [data-all-day]")].find(cell => { const box = cell.getBoundingClientRect(); return x >= box.left && x < box.right && y >= box.top && y < box.bottom; });
  const dayOf = (cell: HTMLElement | undefined): string | undefined => cell?.dataset.monthDay ?? cell?.dataset.allDay;

  function changeTimes(entry: CalendarEntry, start: number, end: number): void {
    const item = items.find(value => value.id === entry.id);
    if (item) { item.at_ms = start; item.end_ms = end; }
    draw();
    const fields: api.CalendarFields = entry.allDay
      ? { start: dateKey(new Date(start)), end: dateKey(new Date(end - 1)), all_day: true }
      : { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
    void api.calendarUpdate(entry.eventId!, fields).catch(error => { toaster.info(describeError(error)); void load(); });
  }
  /**
   * The time of a new event's draft and of a chip being moved or stretched: from start to end where the chip is wide enough for it,
   * otherwise its start alone, as every other chip says it (R-UI-142). Asked of the chip as drawn, so it holds for a column of any width;
   * the whole range then stands in the draft's tooltip.
   */
  function setRange(time: HTMLElement, start: number, end: number): void {
    time.dataset.from = String(start); time.dataset.to = String(end);
    const chip = time.closest<HTMLElement>(".cal-chip");
    const { text, range, short } = fittedRange(start, end, words => {
      time.textContent = words;
      return time.scrollWidth <= time.clientWidth + 1 && !(chip && time.getBoundingClientRect().right > chip.getBoundingClientRect().right - 1);
    });
    time.textContent = text;
    if (chip?.closest(".au-draft")) { if (short) chip.title = range; else chip.removeAttribute("title"); }
  }
  const fitRanges = (): void => { for (const time of el.querySelectorAll<HTMLElement>("time[data-from]")) setRange(time, Number(time.dataset.from), Number(time.dataset.to)); };
  function ghostTime(wrap: HTMLElement, start: number, end: number): void {
    const time = wrap.querySelector<HTMLElement>("time");
    if (time) setRange(time, start, end);
  }
  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || panelOpen() || document.querySelector("#app-popover")) return;
    const pressed = e.target as Element, wrap = pressed.closest<HTMLElement>(".au-event[data-wrap]");
    const entry = wrap ? shown.get(wrap.dataset.wrap!) : undefined;
    if (wrap && entry?.kind === "own") {
      const edge = pressed.closest<HTMLElement>("[data-edge]");
      const col = wrap.closest<HTMLElement>(".au-day-col");
      if (col) {
        if (edge) drag = { kind: "resize", entry, wrap, col, end: entry.end, moved: false };
        else {
          const top = (Number(wrap.dataset.partStart) - localDay(col.dataset.day!).getTime()) / MINUTE;
          drag = { kind: "move", entry, wrap, col, grab: minutesAt(col, e.clientY) - top, top, delta: 0, moved: false, x0: e.clientX, y0: e.clientY };
        }
      } else {
        const key = dayOf(dayCellAt(e.clientX, e.clientY)) ?? dateKey(new Date(entry.start));
        drag = edge
          ? { kind: "stretch", entry, wrap, column: Number.parseInt(wrap.style.gridColumnStart, 10), to: key, moved: false }
          : { kind: "shift", entry, wrap, from: key, to: key, moved: false, x0: e.clientX, y0: e.clientY };
      }
    } else if (!wrap && !pressed.closest("button")) {
      const col = pressed.closest<HTMLElement>(".au-day-col");
      if (col) {
        const anchor = Math.min(1425, Math.floor(minutesAt(col, e.clientY) / SNAP) * SNAP);
        drag = { kind: "new", key: col.dataset.day!, col, anchor, from: anchor, to: anchor + SNAP, moved: false, x0: e.clientX, y0: e.clientY, ghost: null };
      }
    }
    if (!drag) return;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerCancel, { once: true });
  }
  function onPointerMove(e: PointerEvent): void {
    if (!drag) return;
    if (drag.kind === "new") {
      if (!drag.moved && Math.abs(e.clientY - drag.y0) < DRAG_PX) return;
      drag.moved = true;
      const at = snapped(minutesAt(drag.col, e.clientY));
      drag.from = Math.min(drag.anchor, at); drag.to = Math.max(drag.anchor + SNAP, at);
      if (!drag.ghost) {
        drag.ghost = document.createElement("div");
        drag.ghost.className = "au-event au-draft";
        drag.ghost.innerHTML = `<span class="cal-chip btn is-own"><span class="cal-chip-copy"><time></time></span></span>`;
        drag.col.append(drag.ghost);
      }
      Object.assign(drag.ghost.style, { top: `calc(${drag.from / 60} * var(--au-hour))`, height: `calc(${(drag.to - drag.from) / 60} * var(--au-hour) - 2px)`, left: "1px", width: "calc(100% - 3px)" });
      ghostTime(drag.ghost, moment(drag.key, drag.from), moment(drag.key, drag.to));
    } else if (drag.kind === "move") {
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
      drag.moved = true;
      drag.wrap.classList.add("is-dragging");
      const col = columnAt(e.clientX) ?? drag.col;
      if (drag.wrap.parentElement !== col) col.append(drag.wrap);
      const top = snapped(minutesAt(col, e.clientY) - drag.grab);
      const days = Math.round((localDay(col.dataset.day!).getTime() - localDay(drag.col.dataset.day!).getTime()) / 86_400_000);
      drag.delta = days * 1440 + top - drag.top;
      Object.assign(drag.wrap.style, { top: `calc(${top / 60} * var(--au-hour))`, left: "1px", width: "calc(100% - 3px)" });
      const start = new Date(drag.entry.start);
      ghostTime(drag.wrap, new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, start.getHours(), start.getMinutes() + top - drag.top).getTime(), new Date(start.getFullYear(), start.getMonth(), start.getDate() + days, start.getHours(), start.getMinutes() + top - drag.top + (drag.entry.end - drag.entry.start) / MINUTE).getTime());
    } else if (drag.kind === "resize") {
      drag.moved = true;
      const key = drag.col.dataset.day!;
      const start = Math.max(drag.entry.start, moment(key, 0));
      const end = Math.max(start + SNAP * MINUTE, moment(key, snapped(minutesAt(drag.col, e.clientY))));
      drag.end = end;
      drag.wrap.style.height = `calc(${(end - start) / 3_600_000} * var(--au-hour) - 2px)`;
      ghostTime(drag.wrap, drag.entry.start, end);
    } else if (drag.kind === "shift") {
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < DRAG_PX) return;
      drag.moved = true;
      drag.wrap.classList.add("is-dragging");
      const cell = dayCellAt(e.clientX, e.clientY);
      el.querySelectorAll(".is-drop").forEach(node => node.classList.remove("is-drop"));
      cell?.classList.add("is-drop");
      drag.to = dayOf(cell) ?? drag.to;
    } else {
      drag.moved = true;
      const key = dayOf(dayCellAt(e.clientX, e.clientY));
      if (key && key >= dateKey(new Date(drag.entry.start))) {
        drag.to = key;
        const cell = el.querySelector<HTMLElement>(`[data-all-day="${key}"]`);
        if (cell) drag.wrap.style.gridColumnEnd = String(Number.parseInt(cell.style.gridColumnStart, 10) + 1);
      }
    }
  }
  function endDrag(): void {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerCancel);
    el.querySelectorAll(".is-drop").forEach(node => node.classList.remove("is-drop"));
    drag = null;
  }
  function onPointerCancel(): void {
    endDrag();
    draw();
  }
  function onPointerUp(): void {
    if (!drag) return;
    const was = drag;
    endDrag();
    if (was.moved) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 50); }
    if (was.kind === "new") {
      was.ghost?.remove();
      const from = was.moved ? was.from : Math.floor(was.anchor / 30) * 30, to = was.moved ? was.to : Math.min(1440, from + 60);
      startCreate(null, { title: "", start: moment(was.key, from), end: moment(was.key, to), allDay: false, notes: "" });
    } else if (was.moved && was.kind === "move") {
      const start = new Date(was.entry.start), length = was.entry.end - was.entry.start;
      const moved = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours(), start.getMinutes() + was.delta).getTime();
      changeTimes(was.entry, moved, moved + length);
    } else if (was.moved && was.kind === "resize") changeTimes(was.entry, was.entry.start, was.end);
    else if (was.moved && was.kind === "shift") {
      const days = Math.round((localDay(was.to).getTime() - localDay(was.from).getTime()) / 86_400_000);
      if (!days) { draw(); return; }
      const shifted = (at: number): number => { const value = new Date(at); return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days, value.getHours(), value.getMinutes()).getTime(); };
      changeTimes(was.entry, shifted(was.entry.start), shifted(was.entry.end));
    } else if (was.moved && was.kind === "stretch") changeTimes(was.entry, was.entry.start, shiftDay(localDay(was.to), 1).getTime());
    if (drawLater) { drawLater = false; draw(); }
  }
  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("click", onClick);
  el.addEventListener("dragstart", onDragStart);
  el.addEventListener("dragover", e => { if ((e.target as Element).closest("[data-slot]") && e.dataTransfer?.types.includes("application/x-raphael-member")) e.preventDefault(); });
  el.addEventListener("drop", e => { const slot = (e.target as Element).closest<HTMLElement>("[data-slot]"); if (!slot) return; e.preventDefault(); const value = e.dataTransfer?.getData("application/x-raphael-member"); if (!value) return; const id = Number(value); if (members.some(m => m.id === id)) edit(undefined, id, slot.dataset.slot, `${slot.dataset.hour!.padStart(2, "0")}:00`); });
  app.onEvent(event => { if (visible && !drag && ["AgentTurn", "AgentQuestion", "AgentQuestionClosed", "RoutinesChanged", "CalendarChanged", "MembersChanged", "ConnectionsChanged", "CoreReady"].includes(event.type)) void load(); });
  onLocaleChange(() => { if (visible) { closePanel(); draw(); void load(); } });
  return {
    id: "automations", el,
    show(arg) {
      const focus = arg?.match(/^calendar:(\d{4}-\d{2}-\d{2}):(.*)$/), create = arg?.match(/^calendar-new:(\d{4}-\d{2}-\d{2})$/), week = arg?.match(/^calendar-week:(\d{4}-\d{2}-\d{2})$/);
      focusedHomeItem = focus ? decodeURIComponent(focus[2]!) : "";
      detailOnLoad = !!focus;
      createOnLoad = !!create;
      const day = focus?.[1] ?? create?.[1] ?? week?.[1] ?? arg;
      if (day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(localDay(day).getTime())) {
        date = localDay(day); mini = date; period = week ? "week" : "day"; resetPosition = true;
      }
      visible = true;
      draw(); void load();
      void api.keepAwakeGet().then(v => { awake = v; if (visible && !panelOpen()) draw(); }).catch(() => {});
      clearInterval(timer); timer = setInterval(poll.run, 60000);
    },
    hide() { visible = false; loads++; clearInterval(timer); closePanel(); if (tools?.isConnected) closeMenu(); },
  };
}
