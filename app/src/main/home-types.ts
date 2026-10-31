import type { Status } from "./types";
import type { CliAllowances } from "./run-analytics-types";

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
}
/** What the calendar can say of Google: not connected and could-not-read are never taken for an empty calendar. */
export type GoogleCalendarState = "connected" | "not_connected" | "unreadable" | "members_only";
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
}
