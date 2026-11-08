import type { Status } from "./types";
import type { CliAllowances } from "./usage-analytics-types";
import type { RoutineSchedule } from "./types";

export interface HomeItem {
  id: string;
  kind: "question" | "report" | "routine" | "event" | "own";
  title: string;
  summary: string;
  at_ms: number;
  member_id: number;
  name: string;
  avatar: string;
  turn_id: number | null;
  conversation_id: number | null;
  routine_id: number | null;
  all_day?: boolean;
  /** When it is over, for an entry that has a length: an own event, a connected one. */
  end_ms?: number;
  /** An own event's id in the store, its notes and the member who added it (null: the owner). */
  event_id?: number;
  notes?: string;
  added_by?: number | null;
  rhythm?: boolean;
  rhythm_schedule?: RoutineSchedule;
  run_status?: string;
}
/** What the calendar can say of Google: not connected and could-not-read are never taken for an empty calendar. */
export type GoogleCalendarState = "connected" | "not_connected" | "unreadable";
/** A short paragraph Raphael's own model writes once a day; pending while it is written, unavailable without a model. */
export interface HomeNarrative {
  narrative: string | null;
  state: "pending" | "ready" | "unavailable";
  reason: string | null;
  model: string | null;
  generated_at_ms?: number;
}
export interface HomeWorkCounts { work: number; routines: number; messages: number }
export interface HomeDoneItem { id: string; kind: "work" | "routines" | "messages"; title: string; at_ms: number; turn_id: number | null; source: string | null }
export interface HomeYesterday extends HomeNarrative {
  date: string;
  start_ms: number;
  end_ms: number;
  members: { member_id: number; name: string; items: HomeDoneItem[]; counts: HomeWorkCounts }[];
  counts: HomeWorkCounts;
}
/** Work still open today, beside the calendar's items: a task or an owner turn that has not finished. */
export interface HomeUnfinished { id: string; kind: "unfinished"; member_id: number; title: string; state: string; at_ms: number }
export interface HomeTodayPlan extends HomeNarrative {
  date: string;
  items: (HomeItem | HomeUnfinished)[];
  calendar_google?: GoogleCalendarState;
}
/** One thing the offline self-check looked at: a key, a model, a connected app, memory. */
export interface HomeCheck { id: string; name?: string; label_key: string; status: "ok" | "warn" | "error"; detail: string | null; detail_key: string | null }
/** A member as Home tells it: its state, what it does now or did last, its next routine and what waits for the owner. */
export interface HomeMember {
  id: number;
  name: string;
  avatar?: string;
  hidden?: boolean;
  state?: string;
  current_or_last: string;
  next_routine: { id: number; title: string; at_ms: number } | null;
  waiting_for_owner: HomeItem[];
}
/** One local day of finished work as Home charts it: the owner's work, routines run well and not, messages handled, and
 * work that failed, was interrupted or hit a limit. Each piece is counted once, on the day it ended. */
export interface HomeActivityDay { date: string; work: number; routines_ok: number; routines_failed: number; messages: number; failed: number }
/** Home's charts: the last fourteen days, oldest first and today last, and today's routines, events and questions. */
export interface HomeActivity {
  days: HomeActivityDay[];
  today: { routines_due: number; routines_done: number; routines_failed: number; events: number; questions: number };
}
export interface HomeOverview {
  generated_at_ms: number;
  report: Status;
  today: HomeItem[];
  reports: HomeItem[];
  calendar: HomeItem[];
  calendar_days?: string[];
  calendar_events?: HomeItem[];
  calendar_google?: GoogleCalendarState;
  calendar_items?: HomeItem[];
  calendar_counts?: Record<string, number>;
  counts: { today: number; reports: number; calendar: number };
  usage: { month_usd: number; limit_usd: number; daily: number[]; allowances: CliAllowances };
  dictation: { words: number; time_saved_seconds: number; speed_wpm: number | null; audio_seconds: number; daily: number[] };
  yesterday?: HomeYesterday;
  today_plan?: HomeTodayPlan;
  health?: { checks: HomeCheck[]; reason: string | null };
  members?: HomeMember[];
  activity?: HomeActivity;
}
