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

/** One line of a breakdown (`usage.analytics`, core brain/usage.py): the top five by the period's total, then `__other__`. */
export interface UsageSeries { key: string; label: string; values: number[]; total: number; share: number }
export interface UsageBreakdown { total: number; series: UsageSeries[] }
export type UsageRange = "7d" | "30d";
/** What `usage.analytics` answers for a period, a value per local day of `days`. Costs come from the spend ledger only. */
export interface UsageAnalytics {
  range: UsageRange;
  days: string[];
  cost_by: { purpose: UsageBreakdown; model: UsageBreakdown; provider: UsageBreakdown };
  members: { id: number; name: string; role: string; turns: number; cost_usd: number; share: number; models: { model: string; turns: number; cost_usd: number | null }[] }[];
  tools: UsageBreakdown;
  messages_by: { model: UsageBreakdown; source: UsageBreakdown };
}
