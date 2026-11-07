// What the Calendar page and Home's calendar draw alike: one chip, one time format, one colour for each source and one
// way of saying what Google is. An own event is ink on the page; a routine takes the colour of its member's slime; a
// Google event is an outline with Google's mark.
import { formatClock } from "./format";
import type { GoogleCalendarState, HomeItem } from "./home-types";
import { t } from "./i18n";
import { faceHTML, RAPHAEL_ID, scheduleText } from "./members";
import { dateKey, localDay, shiftDay } from "./schedule-picker";
import { occurrences } from "./automation-calendar";
import { iconHTML } from "./service-mark";
import { RAPHAEL_COLOR, slimeColorOf } from "./slime";
import type { Routine, RoutineRun } from "./types";
import { btn, esc, ico, iconButton } from "./ui";
import "./calendar-view.css";

export type EntryKind = "own" | "routine" | "event";
export type CalendarPerson = { id: number; name: string; avatar?: string | null };

/** One thing on the calendar, whichever source it comes from. `end` is exclusive; an all-day entry runs midnight to midnight. */
export interface CalendarEntry {
  id: string;
  kind: EntryKind;
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  /** The row of the rail that shows or hides it. */
  source: string;
  /** Who runs a routine, or the member who added an own event; none when the owner added it. */
  member?: CalendarPerson;
  notes?: string;
  eventId?: number;
  routine?: Routine;
  run?: RoutineRun;
  rhythm?: boolean;
  timing?: string;
  runs?: { at: number; run?: RoutineRun }[];
}

export function isRhythm(schedule: Routine["schedule"]): boolean {
  if (schedule?.kind !== "every" || (schedule.minutes ?? (schedule.hours ?? 1) * 60) >= 1440) return false;
  const minutes = (time: string): number => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return !schedule.from || !schedule.to || minutes(schedule.to) - minutes(schedule.from) >= (schedule.minutes ?? (schedule.hours ?? 1) * 60);
}

/** Scheduled work shares one quiet bar; only a failure or owner question interrupts the hours. */
export function routineEntries(routine: Routine, member: CalendarPerson | undefined, from: Date, to: Date, history: readonly RoutineRun[], remaining = Infinity): CalendarEntry[] {
  const runs = history.map(run => ({at:run.scheduled ?? run.started,run})).filter(o=>o.at>=from.getTime() && o.at<to.getTime());
  const upcoming = occurrences(routine,from,to,remaining).filter(o=>!runs.some(r=>r.at===o.at));
  const moments: {at:number;run?:RoutineRun}[] = [...runs,...upcoming].sort((a,b)=>a.at-b.at);
  const timed = (o: {at:number;run?:RoutineRun}): CalendarEntry => ({id:`routine:${routine.id}:${o.at}`,kind:"routine",title:routine.title,start:o.at,end:o.at+ROUTINE_DRAWN_MS,allDay:false,
    source:memberSource(routine.member_id),member,routine,run:o.run});
  if (!isRhythm(routine.schedule)) return moments.map(timed);
  const keys=[...new Set(moments.map(o=>dateKey(new Date(o.at))))];
  const bars: CalendarEntry[]=[];
  for (const key of keys) {
    const start=localDay(key).getTime(), end=shiftDay(localDay(key),1).getTime(), previous=bars[bars.length-1];
    if (previous?.end===start) previous.end=end;
    else bars.push({...timed({at:start}),id:`rhythm:${routine.id}:${key}`,end,allDay:true,rhythm:true,timing:scheduleText(routine.schedule),runs:moments});
  }
  return [...bars,...moments.filter(o=>o.run && ["error","confirm"].includes(o.run.status)).map(timed)];
}

export const OWN_SOURCE = "own";
export const GOOGLE_SOURCE = "google";
export const memberSource = (id: number): string => `member:${id}`;

const HOUR = 3_600_000;

/** A routine's occurrence has a moment and no length; it is drawn an hour long, which holds its time, title and face. */
export const ROUTINE_DRAWN_MS = HOUR;

export const googleMark = (): string => `<span class="cal-mark" aria-hidden="true">${iconHTML("Google Calendar", "googlecalendar", "md")}</span>`;

/** The colour of a chip that stands for someone: its slime's, Raphael's first blue one included (since 2026-11-07). */
export const chipColor = (member: CalendarPerson | undefined): string =>
  member ? ` style="--chip:${member.id === RAPHAEL_ID ? RAPHAEL_COLOR : slimeColorOf(member)}"` : "";

/** The time an entry shows on a chip. */
export const chipClock = (entry: { allDay: boolean; start: number }): string => (entry.allDay ? t("auto.allDay") : formatClock(entry.start));

/** The inside of a chip: its time and title, then who it is about. */
type ChipEntry = Pick<CalendarEntry, "kind" | "title" | "allDay" | "start" | "member" | "rhythm" | "timing"> & {run?: Pick<RoutineRun,"status">};
export const isRunException = (entry: Pick<ChipEntry,"run">): boolean => !!entry.run && ["error","confirm"].includes(entry.run.status);
/** The mark of a run that failed or waits for the owner; nothing for any other. */
export const runMarkHTML = (entry: Pick<ChipEntry,"run">): string => entry.run && isRunException(entry)
  ? `<span class="cal-run-mark" data-status="${entry.run.status}" aria-label="${esc(t(entry.run.status === "error" ? "auto.error" : "auto.waiting"))}">${ico(entry.run.status === "error" ? "x" : "info")}</span>` : "";
export function chipBody(entry: ChipEntry, o: { clock?: boolean; face?: number; timing?: boolean } = {}): string {
  const time = o.clock === false || entry.rhythm ? "" : `<time>${esc(chipClock(entry))}</time>`;
  const lead = entry.kind === "event" ? googleMark() : entry.member && o.face ? faceHTML(entry.member, o.face) : "";
  const status = runMarkHTML(entry);
  const copy = `<span class="cal-chip-copy">${time}<b>${esc(entry.title)}</b>${entry.rhythm && entry.timing && o.timing !== false ? `<small>&#160;${esc(entry.timing)}</small>` : ""}</span>`;
  return entry.rhythm ? `${lead}${copy}` : `${copy}${status}${lead}`;
}

/** The one chip of the calendar, on the page and on Home. `cls` and `attrs` place it. */
export function chipHTML(entry: ChipEntry, cls = "", attrs = "", o: { clock?: boolean; face?: number; timing?: boolean } = {}): string {
  const style = entry.kind === "routine" || entry.kind === "own" ? chipColor(entry.member) : "";
  return btn(chipBody(entry, o), `cal-chip is-${entry.kind}${entry.rhythm ? " is-rhythm" : ""}${cls ? ` ${cls}` : ""}`, `${style}${attrs}`);
}

/** Its time from start to end, as a popover says it. */
export function clockRange(entry: Pick<CalendarEntry, "start" | "end" | "allDay" | "kind">): string {
  if (entry.allDay) return t("auto.allDay");
  return entry.kind === "routine" ? formatClock(entry.start) : `${formatClock(entry.start)} – ${formatClock(entry.end)}`;
}

/** An entry of Home's projection: an own event, or a connected one. */
export function entryOfItem(item: HomeItem): CalendarEntry {
  const allDay = item.all_day === true;
  const end = item.end_ms ?? item.at_ms + (allDay ? 24 * HOUR : HOUR);
  if (item.kind === "own") {
    const member = item.added_by === null || item.added_by === undefined || !item.name ? undefined : { id: item.added_by, name: item.name, avatar: item.avatar };
    return { id: item.id, kind: "own", title: item.title, start: item.at_ms, end, allDay, source: OWN_SOURCE, member, notes: item.notes ?? "", eventId: item.event_id };
  }
  return { id: item.id, kind: "event", title: item.title, start: item.at_ms, end, allDay, source: GOOGLE_SOURCE };
}

/** Whether it belongs in the row above the hours: all day, or a day long and more. */
export const isAllDayRow = (entry: CalendarEntry): boolean => entry.allDay || entry.end - entry.start >= 24 * HOUR;

/** The local dates an entry touches, the first and the last. */
export function entryDays(entry: Pick<CalendarEntry, "start" | "end">): { first: string; last: string } {
  return { first: dateKey(new Date(entry.start)), last: dateKey(new Date(Math.max(entry.end - 1, entry.start))) };
}

export interface Segment { entry: CalendarEntry; start: number; end: number; lane: number; lanes: number }

/**
 * The part of each timed entry on one day, with its place across the day: entries that overlap stand side by side, and a
 * group of overlaps shares its width evenly. `shortest` is how long an entry is drawn at the least, so that two short
 * ones that would touch on screen stand apart too.
 */
export function dayLayout(entries: readonly CalendarEntry[], day: Date, shortest = 30 * 60_000): Segment[] {
  const from = day.getTime(), to = shiftDay(day, 1).getTime();
  const parts = entries
    .filter(entry => !isAllDayRow(entry) && entry.start < to && Math.max(entry.end, entry.start + 1) > from)
    .map(entry => ({ entry, start: Math.max(entry.start, from), end: Math.min(entry.end, to), lane: 0, lanes: 1 }))
    .sort((a, b) => a.start - b.start || b.end - a.end || a.entry.id.localeCompare(b.entry.id));
  let group: Segment[] = [], ends: number[] = [], groupEnd = -Infinity;
  const close = (): void => { for (const part of group) part.lanes = ends.length; group = []; ends = []; };
  for (const part of parts) {
    if (group.length && part.start >= groupEnd) { close(); groupEnd = -Infinity; }
    const drawnEnd = Math.max(part.end, part.start + shortest);
    let lane = ends.findIndex(end => end <= part.start);
    if (lane < 0) { lane = ends.length; ends.push(drawnEnd); } else ends[lane] = drawnEnd;
    part.lane = lane;
    group.push(part);
    groupEnd = Math.max(groupEnd, drawnEnd);
  }
  close();
  return parts;
}

export interface Bar { entry: CalendarEntry; column: number; span: number; row: number; startsBefore: boolean; endsAfter: boolean }

/**
 * The all-day row: each entry a bar across the days it covers, in the first row where it fits. What does not fit in
 * `rows` rows is counted per day in `more`.
 */
export function allDayBars(entries: readonly CalendarEntry[], days: readonly Date[], rows = 3): { bars: Bar[]; more: number[]; used: number } {
  const keys = days.map(dateKey), first = keys[0]!, last = keys[keys.length - 1]!;
  const shown = entries.filter(isAllDayRow).filter(entry => { const { first: a, last: b } = entryDays(entry); return a <= last && b >= first; });
  const span = (entry: CalendarEntry): [number, number, boolean, boolean] => {
    const { first: a, last: b } = entryDays(entry);
    const from = a < first ? 0 : keys.indexOf(a), to = b > last ? keys.length - 1 : keys.indexOf(b);
    return [from, to, a < first, b > last];
  };
  const ordered = [...shown].sort((a, b) => Number(!!a.rhythm) - Number(!!b.rhythm) || span(a)[0] - span(b)[0] || span(b)[1] - span(a)[1] || a.start - b.start || a.id.localeCompare(b.id));
  const taken: number[][] = [];
  const bars: Bar[] = [], more = keys.map(() => 0);
  for (const entry of ordered) {
    const [from, to, startsBefore, endsAfter] = span(entry);
    let row = taken.findIndex(ends => ends.every((end, index) => index % 2 === 1 || end > to || ends[index + 1]! < from));
    if (row < 0) { row = taken.length; taken.push([]); }
    if (row >= rows) { for (let n = from; n <= to; n++) more[n]!++; continue; }
    taken[row]!.push(from, to);
    bars.push({ entry, column: from, span: to - from + 1, row, startsBefore, endsAfter });
  }
  return { bars, more, used: Math.min(rows, taken.length) };
}

/** The entries of one day of a month's grid, the all-day ones first. */
export function monthEntries(entries: readonly CalendarEntry[], key: string): CalendarEntry[] {
  return entries.filter(entry => { const { first, last } = entryDays(entry); return first <= key && last >= key; })
    .sort((a, b) => Number(isAllDayRow(b)) - Number(isAllDayRow(a)) || Number(!!a.rhythm) - Number(!!b.rhythm) || a.start - b.start || a.id.localeCompare(b.id));
}

// ---------- what the calendar says of Google ----------

const OFFER_KEY = "raphael.calendar.googleOffer";

/** The owner closed the offer to connect: it is not made again, here or on Home. */
export function offerDismissed(state: GoogleCalendarState): boolean {
  try { return localStorage.getItem(`${OFFER_KEY}.${state}`) === "dismissed"; } catch { return false; }
}
export function dismissOffer(state: GoogleCalendarState): void {
  try { localStorage.setItem(`${OFFER_KEY}.${state}`, "dismissed"); } catch { /* It comes back next time; nothing is lost. */ }
}

/**
 * One quiet line that keeps "not connected" and "could not read it" from reading as an empty calendar, with the place to
 * go. Not being connected is offered once: closed, it is never made again, and `wordsAfter` leaves its bare words where
 * the list of sources stands. A read that failed stays until it works, and says where to check.
 */
export function googleNoticeHTML(state: GoogleCalendarState | undefined, o: { go: string; dismiss: string; wordsAfter?: boolean }): string {
  if (!state || state === "connected") return "";
  const failed = state === "unreadable";
  const words = t(failed ? "cal.googleFailed" : "cal.googleOff");
  const closed = !failed && offerDismissed(state);
  if (closed && !o.wordsAfter) return "";
  const action = closed ? "" : btn(esc(t(state === "not_connected" ? "cal.googleConnect" : "cal.googleCheck")), "sm", ` ${o.go}`);
  const close = closed || failed ? "" : iconButton("x", t("common.close"), ` ${o.dismiss}="${state}"`, "cal-notice-close");
  return `<div class="cal-notice is-${state}${closed ? " is-closed" : ""}" role="${failed ? "status" : "note"}">${googleMark()}<span class="cal-notice-words">${esc(words)}</span>${action}${close}</div>`;
}
