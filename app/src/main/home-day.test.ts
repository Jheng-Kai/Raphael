// What Home answers (home-day.ts): the task board's words are read in one place, and a day is sorted into the few
// things that change what the owner does: now and next, what waits, today's tasks, the overdue, the routines.
import { describe, expect, test } from "vitest";
import { dayBoard, overdueGroups, readTaskTitle, type DayTask } from "./home-day";
import type { HomeActivity, HomeItem, HomeOverview } from "./home-types";

const NOW = new Date(2026, 10, 12, 10, 0).getTime();
const at = (hour: number, minute = 0): number => new Date(2026, 10, 12, hour, minute).getTime();
const dayOf = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
const item = (id: string, kind: HomeItem["kind"], title: string, start: number, more: Partial<HomeItem> = {}): HomeItem => ({
  id, kind, title, summary: "", at_ms: start, member_id: 1, name: "Ari", avatar: "", turn_id: null, conversation_id: null, routine_id: null, ...more,
});
let serial = 0;
/** A task of the board as it reaches Raphael: an all-day own event. */
const task = (title: string, more: Partial<HomeItem> = {}): HomeItem =>
  item(`own:${++serial}`, "own", title, at(0), { all_day: true, event_id: serial, member_id: -1, name: "", ...more });
const timed = (title: string, start: number, end = start + 3_600_000, more: Partial<HomeItem> = {}): HomeItem =>
  item(`own:${++serial}`, "own", title, start, { end_ms: end, event_id: serial, member_id: -1, name: "", ...more });
const activity = (today: Partial<HomeActivity["today"]> = {}): HomeActivity => ({ days: [], today: { routines_due: 0, routines_done: 0, routines_failed: 0, events: 0, questions: 0, ...today } });
const overview = (today: HomeItem[], more: Partial<HomeOverview> = {}): HomeOverview => ({
  generated_at_ms: NOW, today, reports: [], calendar: [], counts: { today: today.length, reports: 0, calendar: 0 }, activity: activity(),
  report: { openrouter: { state: "ok", latency_ms: 1, checked_at_ms: null, error: null, key: null, usage: null }, spend: { month_usd: 0, today_usd: 0, limit_usd: 20, forecast_usd: 0, daily: [] }, last: null },
  usage: { month_usd: 0, limit_usd: 20, daily: [], allowances: { brains: [] } }, dictation: { words: 0, time_saved_seconds: 0, speed_wpm: null, audio_seconds: 0, daily: [] }, ...more,
});

describe("the task board's words", () => {
  test("a title says overdue, due today or neither, with its project tag, in one place", () => {
    expect(readTaskTitle("逾期：[Filia] remote 改指向至 Jheng-Kai")).toEqual({ state: "overdue", tag: "Filia", text: "remote 改指向至 Jheng-Kai" });
    expect(readTaskTitle("今天：[Raphael] 預留 bucket")).toEqual({ state: "today", tag: "Raphael", text: "預留 bucket" });
    expect(readTaskTitle("[Notion] 今日重點")).toEqual({ state: null, tag: "Notion", text: "今日重點" });
    expect(readTaskTitle("逾期:  買高鐵票")).toEqual({ state: "overdue", tag: null, text: "買高鐵票" });
    expect(readTaskTitle("牙醫回診")).toEqual({ state: null, tag: null, text: "牙醫回診" });
    // Full-width brackets and colon, as an input method writes them; a title that is only its words keeps them.
    expect(readTaskTitle("逾期：［Filia］ 整理")).toEqual({ state: "overdue", tag: "Filia", text: "整理" });
    expect(readTaskTitle("逾期：").text).toBe("逾期：");
    // A word in the middle of a title is not the board's.
    expect(readTaskTitle("提醒：逾期：不算")).toEqual({ state: null, tag: null, text: "提醒：逾期：不算" });
  });

  test("the overdue are grouped by project, the biggest first, the rest and the untagged as one group", () => {
    const tasks = (tags: (string | null)[]): DayTask[] => tags.map(tag => ({ item: task("x"), text: "x", tag, mark: "overdue" }));
    expect(overdueGroups(tasks(["Filia", "Raphael", "Filia", null, "Notion"]))).toEqual([
      { tag: "Filia", count: 2 }, { tag: "Notion", count: 1 }, { tag: "Raphael", count: 1 }, { tag: null, count: 1 }]);
    expect(overdueGroups(tasks(["A", "B", "C", "D", "E", "A"]))).toEqual([{ tag: "A", count: 2 }, { tag: "B", count: 1 }, { tag: "C", count: 1 }, { tag: null, count: 2 }]);
    expect(overdueGroups([])).toEqual([]);
  });
});

describe("a day sorted into what he does", () => {
  test("the timed things are the one on now, then the next two, and a thing that is over is gone", () => {
    const board = dayBoard(overview([
      timed("Standup", at(8), at(8, 30)), timed("Review", at(9, 30), at(10, 30)), timed("Dentist", at(10, 35)), timed("Call", at(14)), timed("Late", at(18)),
    ]), dayOf);
    expect(board.moments.map(moment => [moment.text, moment.when, moment.minutes])).toEqual([["Review", "now", 1], ["Dentist", "next", 35], ["Call", "next", 240]]);
  });

  test("an overdue task with a time is one row in the timed things while it is on or to come, and in the overdue once it is over", () => {
    const coming = timed("逾期：[Filia] 交件", at(15)), over = timed("逾期：[Filia] 補簽", at(7), at(8));
    const board = dayBoard(overview([coming, over, task("逾期：[Raphael] 清理")]), dayOf);
    expect(board.moments.map(moment => moment.text)).toEqual(["交件"]);
    expect(board.overdue.rows.map(row => row.text).sort()).toEqual(["清理", "補簽"]);
    expect(board.todo.total).toBe(0);
  });

  test("his real day: 12 overdue, 8 due today, the Notion summary and 4 timed make 3 timed rows, 5 tasks, 3 overdue", () => {
    const today = [
      ...Array.from({ length: 12 }, (_, i) => task(`逾期：[${i % 2 ? "Filia" : "Raphael"}] 舊事 ${i}`)),
      ...Array.from({ length: 8 }, (_, i) => task(`今天：[Filia] 今日事 ${i}`)),
      task("[Notion] 今日重點"),
      timed("設計審查", at(9), at(9, 30)), timed("供應商會議", at(10, 30)), timed("牙醫回診", at(14)), timed("週會", at(16)),
    ];
    const board = dayBoard(overview(today), dayOf);
    expect(board.moments.map(moment => moment.text)).toEqual(["供應商會議", "牙醫回診", "週會"]);
    expect(board.todo).toMatchObject({ total: 9, more: 4 });
    expect(board.todo.rows).toHaveLength(5);
    // The plain item leads the day's tasks, and every row has its prefix stripped.
    expect(board.todo.rows[0]).toMatchObject({ text: "今日重點", tag: "Notion" });
    expect(board.todo.rows.every(row => !/^今天/.test(row.text))).toBe(true);
    expect(board.overdue.total).toBe(12);
    expect(board.overdue.rows).toHaveLength(3);
    expect(board.overdue.groups).toEqual([{ tag: "Filia", count: 6 }, { tag: "Raphael", count: 6 }]);
    expect(board.overdue.rows.every(row => !/^逾期/.test(row.text))).toBe(true);
    // The most overdue are the oldest in the store.
    expect(board.overdue.rows.map(row => row.item.event_id)).toEqual(today.slice(0, 3).map(row => row.event_id));
  });

  test("the overdue block shows the same rows and groups for 12 as for 40", () => {
    const make = (count: number) => dayBoard(overview(Array.from({ length: count }, (_, i) => task(`逾期：[${["A", "B", "C", "D", "E"][i % 5]}] 事 ${i}`))), dayOf).overdue;
    const few = make(12), many = make(40);
    expect(few.rows).toHaveLength(3);
    expect(many.rows).toHaveLength(3);
    expect(few.groups).toHaveLength(4);
    expect(many.groups).toHaveLength(4);
    expect(many.total).toBe(40);
  });

  test("what waits is the questions, newest first, and the rest are counted behind the last row", () => {
    const questions = Array.from({ length: 7 }, (_, i) => item(`question:${i}`, "question", `Q${i}`, NOW - i * 60_000, { turn_id: i }));
    const board = dayBoard(overview([...questions, task("今天：x")]), dayOf);
    expect(board.waiting.rows.map(row => row.title)).toEqual(["Q0", "Q1", "Q2", "Q3", "Q4"]);
    expect(board.waiting.more.map(row => row.title)).toEqual(["Q5", "Q6"]);
    expect(dayBoard(overview([]), dayOf).waiting.rows).toEqual([]);
  });

  test("the routines are one line of done of due, the failed ones and the next to run, and none when the day has none", () => {
    const run = (id: string, hour: number, more: Partial<HomeItem> = {}) => item(`routine:${id}:${hour}`, "routine", `Run ${id}`, at(hour), { routine_id: Number(id), ...more });
    const board = dayBoard(overview([run("1", 8), run("2", 9, { run_status: "error" }), run("3", 12), run("4", 15)], { activity: activity({ routines_due: 4, routines_done: 1, routines_failed: 1 }) }), dayOf);
    expect(board.routines).toMatchObject({ done: 1, due: 4 });
    expect(board.routines!.failed.map(failed => failed.title)).toEqual(["Run 2"]);
    expect(board.routines!.next?.title).toBe("Run 3");
    expect(dayBoard(overview([task("今天：x")]), dayOf).routines).toBeNull();
  });

  test("without the core's activity the day is read from the calendar's items of today", () => {
    const sample = overview([], { activity: undefined, calendar_items: [timed("Review", at(11)), timed("Tomorrow", new Date(2026, 10, 13, 9).getTime())] });
    expect(dayBoard(sample, dayOf).moments.map(moment => moment.text)).toEqual(["Review"]);
  });

  test("a quiet day, an empty day", () => {
    const quiet = dayBoard(overview([timed("Review", at(11)), timed("Call", at(15))]), dayOf);
    expect(quiet.moments).toHaveLength(2);
    expect([quiet.overdue.total, quiet.todo.total, quiet.waiting.rows.length, quiet.routines]).toEqual([0, 0, 0, null]);
    const empty = dayBoard(overview([]), dayOf);
    expect([empty.moments.length, empty.overdue.total, empty.todo.total, empty.waiting.rows.length, empty.routines]).toEqual([0, 0, 0, 0, null]);
  });
});
