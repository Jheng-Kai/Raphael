// What the Calendar page and Home's calendar draw alike: one chip, one time format, one colour for each source and one
// way of saying what Google is. An own event is ink on the page; a routine takes the colour of its member's slime; a
// Google event is an outline with Google's mark.
import { formatClock } from "./format";
import type { GoogleCalendarState, HomeItem } from "./home-types";
import { t } from "./i18n";
import { faceHTML, RAPHAEL_ID } from "./members";
import { dateKey, shiftDay } from "./schedule-picker";
import { iconHTML } from "./service-mark";
import { slimeColorOf } from "./slime";
import type { Routine, RoutineRun } from "./types";
import { btn, esc, iconButton } from "./ui";
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
}

export const OWN_SOURCE = "own";
export const GOOGLE_SOURCE = "google";
export const memberSource = (id: number): string => `member:${id}`;

const HOUR = 3_600_000;

/** A routine's occurrence has a moment and no length; it is drawn an hour long, which holds its time, title and face. */
export const ROUTINE_DRAWN_MS = HOUR;

export const googleMark = (): string => `<span class="cal-mark" aria-hidden="true">${iconHTML("Google Calendar", "googlecalendar", "md")}</span>`;

/** The colour of a chip that stands for someone. Raphael has his emblem and no slime: his chips stay neutral. */
export const chipColor = (member: CalendarPerson | undefined): string =>
  member && member.id !== RAPHAEL_ID ? ` style="--chip:${slimeColorOf(member)}"` : "";

/** The time an entry shows on a chip. */
export const chipClock = (entry: { allDay: boolean; start: number }): string => (entry.allDay ? t("auto.allDay") : formatClock(entry.start));

/** The inside of a chip: its time and title, then who it is about. */
export function chipBody(entry: Pick<CalendarEntry, "kind" | "title" | "allDay" | "start" | "member">, o: { clock?: boolean; face?: number } = {}): string {
  const time = o.clock === false ? "" : `<time>${esc(chipClock(entry))}</time>`;
  const lead = entry.kind === "event" ? googleMark() : entry.member && o.face ? faceHTML(entry.member, o.face) : "";
  return `<span class="cal-chip-copy">${time}<b>${esc(entry.title)}</b></span>${lead}`;
}

/** The one chip of the calendar, on the page and on Home. `cls` and `attrs` place it. */
export function chipHTML(entry: Pick<CalendarEntry, "kind" | "title" | "allDay" | "start" | "member">, cls = "", attrs = "", o: { clock?: boolean; face?: number } = {}): string {
  const style = entry.kind === "routine" || entry.kind === "own" ? chipColor(entry.member) : "";
  return btn(chipBody(entry, o), `cal-chip is-${entry.kind}${cls ? ` ${cls}` : ""}`, `${style}${attrs}`);
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
  const ordered = [...shown].sort((a, b) => span(a)[0] - span(b)[0] || span(b)[1] - span(a)[1] || a.start - b.start || a.id.localeCompare(b.id));
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
    .sort((a, b) => Number(isAllDayRow(b)) - Number(isAllDayRow(a)) || a.start - b.start || a.id.localeCompare(b.id));
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
  const words = t(failed ? "cal.googleFailed" : state === "members_only" ? "cal.googleMembersOnly" : "cal.googleOff");
  const closed = !failed && offerDismissed(state);
  if (closed && !o.wordsAfter) return "";
  const action = closed ? "" : btn(esc(t(state === "not_connected" ? "cal.googleConnect" : "cal.googleCheck")), "sm", ` ${o.go}`);
  const close = closed || failed ? "" : iconButton("x", t("common.close"), ` ${o.dismiss}="${state}"`, "cal-notice-close");
  return `<div class="cal-notice is-${state}${closed ? " is-closed" : ""}" role="${failed ? "status" : "note"}">${googleMark()}<span class="cal-notice-words">${esc(words)}</span>${action}${close}</div>`;
}
