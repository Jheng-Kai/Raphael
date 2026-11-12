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
/** What the core's `home.overview` gives: the calendar's projection (own events, routine runs, the connected Google calendar), which
 * is all the window reads from it since Home was removed (2026-11-12). */
export interface HomeOverview {
  generated_at_ms: number;
  today: HomeItem[];
  reports: HomeItem[];
  calendar: HomeItem[];
  calendar_days?: string[];
  calendar_events?: HomeItem[];
  calendar_google?: GoogleCalendarState;
  calendar_items?: HomeItem[];
  calendar_counts?: Record<string, number>;
  counts: { today: number; reports: number; calendar: number };
}
