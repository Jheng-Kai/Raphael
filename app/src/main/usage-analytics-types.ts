/** What a subscription brain has left in each of its windows, as the core reads or last heard it. */
export interface CliAllowanceWindow {
  period: "fiveHour" | "weekly" | "weeklyOpus" | "weeklySonnet";
  remaining_percent: number | null; resets_at: number | null;
  status?: "allowed" | "allowed_warning" | "rejected"; updated_at_ms?: number;
}
export interface CliAllowances {
  quotas?: { provider: string; reset_at_ms: number | null }[];
  brains: { id: string; name: string; source?: "live" | "reported" | "unavailable"; windows: CliAllowanceWindow[] }[];
}
