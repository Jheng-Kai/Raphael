// What Home answers: what to do now, and what must not be missed today (owner, 2026-11-12). This reads the core's
// `home.overview` and sorts today into the few things that change what he does: the timed things now and next, what
// waits for his decision, today's tasks, what is overdue, and the routines in one line. It is a projection only: nothing
// here is written back.
//
// The task board reaches Raphael as all-day calendar items whose titles carry the board's own words: 「逾期：」 for a
// task past its date, 「今天：」 for one due today, and a project tag in square brackets ([Filia]). The event itself
// carries no due date or priority, so those words are the only record of them; they are read in `readTaskTitle`, and
// nowhere else. If the core ever sends a real field, only that function changes.
import type { HomeItem, HomeOverview } from "./home-types";

/** The timed things shown, the rows of each list, and the groups the overdue block names (the rest are one group). */
export const MOMENT_ROWS = 3, WAITING_ROWS = 5, TODO_ROWS = 5, OVERDUE_ROWS = 3, OVERDUE_GROUPS = 3;
const HOUR = 3_600_000, MINUTE = 60_000;

const OVERDUE_WORD = /^逾期\s*[:：]\s*/, TODAY_WORD = /^今天\s*[:：]\s*/;
const TAG = /^[[［]([^\]］]{1,24})[\]］]\s*/;

export interface TaskTitle {
  /** Past its date, due today, or neither (a plain all-day item). */
  state: "overdue" | "today" | null;
  /** The project tag without its brackets, or null. */
  tag: string | null;
  /** The title without the state word and the tag. */
  text: string;
}

/** A title as the task board writes it: 「逾期：[Filia] remote 改指向」 is overdue, tagged Filia, and reads 「remote 改指向」. */
export function readTaskTitle(title: string): TaskTitle {
  let rest = title.trim(), state: TaskTitle["state"] = null, tag: string | null = null;
  const word = OVERDUE_WORD.exec(rest) ?? TODAY_WORD.exec(rest);
  if (word) { state = OVERDUE_WORD.test(word[0]) ? "overdue" : "today"; rest = rest.slice(word[0].length); }
  const bracket = TAG.exec(rest);
  if (bracket) { tag = bracket[1]!.trim() || null; rest = rest.slice(bracket[0].length); }
  return { state, tag, text: rest.trim() || title.trim() };
}

export interface DayTask { item: HomeItem; text: string; tag: string | null; mark: TaskTitle["state"] }
export interface DayMoment extends DayTask {
  /** Happening now, or still to come in `minutes` (rounded up, at least 1). */
  when: "now" | "next";
  minutes: number;
}
export interface DayGroup { tag: string | null; count: number }
export interface DayRoutines {
  /** Done and due today, from the core's activity; null without it. */
  done: number | null;
  due: number | null;
  /** The runs that failed today, the next run still to come, and the member the line shows a face for. */
  failed: HomeItem[];
  next: HomeItem | null;
}
export interface DayBoard {
  moments: DayMoment[];
  /** What waits for his decision, newest first: the rows shown and the rest. */
  waiting: { rows: HomeItem[]; more: HomeItem[] };
  /** Today's tasks: the rows shown, how many there are in all, and how many the rows leave out. */
  todo: { rows: DayTask[]; total: number; more: number };
  /** The overdue: how many in all, the groups the block names (the rest are one group) and the rows that lead. */
  overdue: { total: number; groups: DayGroup[]; rows: DayTask[] };
  routines: DayRoutines | null;
}

/** Every item of today that is not a question: the core's `today`, else the day out of the calendar's items. */
export function todayItems(data: HomeOverview, dayOf: (at: number) => string): HomeItem[] {
  const today = dayOf(data.generated_at_ms);
  return data.activity ? data.today.filter(item => item.kind !== "question")
    : (data.calendar_items ?? data.calendar).filter(item => dayOf(item.at_ms) === today);
}

const taskOf = (item: HomeItem): DayTask => { const { state, tag, text } = readTaskTitle(item.title); return { item, text, tag, mark: state }; };
/** The store's order: an own event made earlier is older; a connected one has no id and goes after. Then by title. */
const sinceOf = (item: HomeItem): number => item.event_id ?? Number.MAX_SAFE_INTEGER;
const bySince = (a: DayTask, b: DayTask): number => sinceOf(a.item) - sinceOf(b.item) || a.item.at_ms - b.item.at_ms || a.text.localeCompare(b.text);

/** Count the overdue by project tag, the biggest first; beyond `OVERDUE_GROUPS` the rest and the untagged are one group (tag null). */
export function overdueGroups(tasks: DayTask[]): DayGroup[] {
  const counts = new Map<string, number>();
  let loose = 0;
  for (const { tag } of tasks) tag === null ? loose++ : counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const named = [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  const shown: DayGroup[] = named.slice(0, OVERDUE_GROUPS);
  const rest = named.slice(OVERDUE_GROUPS).reduce((sum, group) => sum + group.count, 0) + loose;
  return rest ? [...shown, { tag: null, count: rest }] : shown;
}

export function dayBoard(data: HomeOverview, dayOf: (at: number) => string): DayBoard {
  const now = data.generated_at_ms;
  const items = todayItems(data, dayOf);
  const moments: DayMoment[] = [], todo: DayTask[] = [], overdue: DayTask[] = [];
  for (const item of items) {
    if (item.kind !== "event" && item.kind !== "own") continue;
    const task = taskOf(item);
    if (!item.all_day) {
      // A timed thing is in 現在 / 接下來 while it is on or to come, and only there. Once it is over it is gone, unless it
      // was an overdue task: that one is still owed.
      const end = item.end_ms !== undefined && item.end_ms > item.at_ms ? item.end_ms : item.at_ms + HOUR;
      if (end > now) moments.push({ ...task, when: item.at_ms <= now ? "now" : "next", minutes: Math.max(1, Math.ceil((item.at_ms - now) / MINUTE)) });
      else if (task.mark === "overdue") overdue.push(task);
      continue;
    }
    (task.mark === "overdue" ? overdue : todo).push(task);
  }
  moments.sort((a, b) => Number(b.when === "now") - Number(a.when === "now") || a.item.at_ms - b.item.at_ms);
  // Plain all-day items (a trip, a deadline) say what kind of day it is, so they lead; then the day's tasks, oldest first.
  todo.sort((a, b) => Number(a.mark === "today") - Number(b.mark === "today") || bySince(a, b));
  overdue.sort(bySince);

  const questions = data.today.filter(item => item.kind === "question").sort((a, b) => b.at_ms - a.at_ms);
  const runs = items.filter(item => item.kind === "routine" && !item.rhythm);
  const today = data.activity?.today;
  const routines: DayRoutines | null = (today?.routines_due ?? 0) > 0 || items.some(item => item.kind === "routine")
    ? { done: today ? today.routines_done : null, due: today ? today.routines_due : null,
        failed: runs.filter(item => item.run_status === "error").sort((a, b) => a.at_ms - b.at_ms),
        next: runs.filter(item => !item.run_status && item.at_ms >= now).sort((a, b) => a.at_ms - b.at_ms)[0] ?? null }
    : null;
  return {
    moments: moments.slice(0, MOMENT_ROWS),
    waiting: { rows: questions.slice(0, WAITING_ROWS), more: questions.slice(WAITING_ROWS) },
    todo: { rows: todo.slice(0, TODO_ROWS), total: todo.length, more: Math.max(0, todo.length - TODO_ROWS) },
    overdue: { total: overdue.length, groups: overdueGroups(overdue), rows: overdue.slice(0, OVERDUE_ROWS) },
    routines,
  };
}
