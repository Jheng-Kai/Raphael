// Calendar math follows each saved zone, including its offset at each occurrence.
import type { Routine } from "./types";
import { dateKey, localDay, shiftDay } from "./schedule-picker";
import { zonedParts, zonedTime } from "./timezones";
export interface Occurrence { routine: Routine; at: number; }
export function occurrences(routine: Routine, from: Date, to: Date, remaining = Infinity): Occurrence[] {
  if (!routine.schedule || !routine.enabled || routine.next_run === null || remaining <= 0) return [];
  const s = routine.schedule, result: Occurrence[] = [];
  let used = 0;
  const add = (at: number): void => {
    if (!Number.isFinite(at)) return;
    const day = s.timezone ? zonedParts(at, s.timezone).date : dateKey(new Date(at));
    if ((!s.start_date || day >= s.start_date) && (!s.until || day <= s.until) && used < remaining) {
      used++;
      if (at >= from.getTime() && at < to.getTime()) result.push({ routine, at });
    }
  };
  if (s.kind === "once") { add(zonedTime(s.start_date!, s.time, s.timezone)); return result; }
  if (s.kind === "every") {
    if (s.from && s.to) {
      const first = Number.isFinite(remaining) ? new Date(routine.next_run) : from;
      const firstMinute = Number(s.from.slice(0, 2)) * 60 + Number(s.from.slice(3));
      const lastMinute = Number(s.to.slice(0, 2)) * 60 + Number(s.to.slice(3));
      for (let day = localDay(s.timezone ? zonedParts(first.getTime(), s.timezone).date : dateKey(first)); dateKey(day) <= (s.timezone ? zonedParts(to.getTime(), s.timezone).date : dateKey(to)) && used < remaining; day = shiftDay(day, 1)) {
        for (let minute = firstMinute; minute <= lastMinute && used < remaining; minute += (s.minutes ?? (s.hours ?? 1) * 60)) {
          const at = zonedTime(dateKey(day), `${String(Math.floor(minute/60)).padStart(2,"0")}:${String(minute%60).padStart(2,"0")}`, s.timezone);
          if (at >= routine.next_run) add(at);
        }
      }
      return result;
    }
    const step = (s.minutes ?? (s.hours ?? 1) * 60) * 60000, anchor = routine.next_run;
    const offset = Math.max(0, Math.ceil((from.getTime() - anchor) / step));
    used = offset;
    for (let at = anchor + offset * step; at < to.getTime() && used < remaining; at += step) add(at);
    return result;
  }
  const first = Number.isFinite(remaining) ? new Date(routine.next_run) : from;
  for (let day = localDay(s.timezone ? zonedParts(first.getTime(), s.timezone).date : dateKey(first)); dateKey(day) <= (s.timezone ? zonedParts(to.getTime(), s.timezone).date : dateKey(to)) && used < remaining; day = shiftDay(day, 1)) {
    if (s.kind === "weekdays" && [0, 6].includes(day.getDay())) continue;
    if (s.kind === "weekly" && !s.days.includes(day.getDay())) continue;
    if (s.kind === "monthly" && day.getDate() !== Math.min(s.day, new Date(day.getFullYear(), day.getMonth()+1, 0).getDate())) continue;
    const at = zonedTime(dateKey(day), s.time, s.timezone);
    if (at >= routine.next_run) add(at);
  }
  return result;
}
