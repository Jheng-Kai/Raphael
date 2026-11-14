// What the app honestly knows about each provider's usage, read once for every place that shows it: the account menu's 用量 submenu
// (account-menu.ts) and Settings' usage cards (usage-analytics.ts) interpret the same readings through this file, so they cannot disagree.
// Nothing here invents a number: a window with no percentage says what it does know (its status, or that it has reset), and a provider
// whose usage cannot be read says so.

import { CLIS } from "./cli-brains";
import { formatUsd } from "./format";
import { t } from "./i18n";
import type { ChatGptStatus, Status } from "./types";
import type { CliAllowanceWindow, CliAllowances } from "./usage-analytics-types";

/** The words of each window a subscription reports. */
export const PERIODS = { fiveHour: "runs.fiveHour", weekly: "runs.weekly", weeklyOpus: "runs.weeklyOpus", weeklySonnet: "runs.weeklySonnet" } as const;

/** A subscription by the name its card has: the plan (Claude), not the program (Claude Code). */
export const subscriptionName = (id: string, fallback = id): string => id === "claude" ? "Claude" : CLIS.find((c) => c.id === id)?.name ?? fallback;

/** Whether the ChatGPT sign-in is one whose plan the app can speak of (the card and the menu both ask this). */
export const chatgptSignedIn = (account: ChatGptStatus | null | undefined): boolean => !!account?.signed_in && account.plan_scope_granted !== false;

/** What one window says right now. A number reported by an earlier run whose reset time has passed is no longer true: it is `reset`. */
export type WindowState =
  | { kind: "percent"; used: number }
  | { kind: "reset" }
  | { kind: "status"; status: NonNullable<CliAllowanceWindow["status"]> }
  | { kind: "unknown" };

export function windowState(source: string | undefined, span: CliAllowanceWindow, now = Date.now()): WindowState {
  if (source === "reported" && span.resets_at && span.resets_at * 1000 <= now) return { kind: "reset" };
  const left = span.remaining_percent;
  if (typeof left === "number" && Number.isFinite(left)) return { kind: "percent", used: Math.min(100, Math.max(0, Math.round(100 - left))) };
  if (span.status) return { kind: "status", status: span.status };
  return { kind: "unknown" };
}

/** One provider as the account menu shows it: its name (with the window it speaks of), the words at the right, and when it resets. */
export interface UsageBlock {
  id: string;
  name: string;
  state: "percent" | "reset" | "status" | "exhausted" | "spend" | "unreadable";
  /** Percent used, for `percent`. */
  used?: number;
  /** The words at the right of the name. */
  value: string;
  /** When the window resets, in seconds since the epoch, if the provider says. */
  resetsAt: number | null;
  /** A quiet second line when there is no reset to say. */
  detail?: string;
}

const STATUS_WORDS = { allowed: "runs.allowanceAllowed", allowed_warning: "runs.allowanceWarning", rejected: "runs.exhausted" } as const;

/** Which window speaks for the provider: a blocked one, then the most used, then a warning, then what is allowed, then one that has reset. */
function standing(state: WindowState): number {
  if (state.kind === "status" && state.status === "rejected") return 1000;
  if (state.kind === "percent") return 100 + state.used;
  if (state.kind === "status") return state.status === "allowed_warning" ? 50 : 40;
  return state.kind === "reset" ? 10 : 0;
}

/** A subscription of the CLI reading: its tightest window, or what is truthfully known when there is none. */
function subscriptionBlock(brain: CliAllowances["brains"][number], quotas: CliAllowances["quotas"], now: number): UsageBlock {
  const who = subscriptionName(brain.id, brain.name);
  let best: { span: CliAllowanceWindow; state: WindowState } | null = null;
  for (const span of brain.windows) {
    const state = windowState(brain.source, span, now);
    if (state.kind !== "unknown" && (!best || standing(state) > standing(best.state))) best = { span, state };
  }
  const named = best ? `${who} ${t(PERIODS[best.span.period])}` : who;
  // A recorded exhaustion speaks only where no number says otherwise (one whose reset time was never told lingers until a turn clears it).
  const quota = quotas?.find((q) => q.provider === brain.id);
  if (quota && (!best || best.state.kind !== "percent")) return { id: brain.id, name: who, state: "exhausted", value: t("runs.exhausted"), resetsAt: quota.reset_at_ms ? quota.reset_at_ms / 1000 : null };
  if (!best) return { id: brain.id, name: who, state: "unreadable", value: t("account.unreadable"), resetsAt: null };
  const { state, span } = best;
  if (state.kind === "percent") return { id: brain.id, name: named, state: "percent", used: state.used, value: t("overview.used", { p0: state.used }), resetsAt: span.resets_at };
  // A window that has reset says so and keeps no stale number; what comes next is for the next turn to report.
  if (state.kind === "reset") return { id: brain.id, name: named, state: "reset", value: t("account.reset"), resetsAt: null };
  if (state.kind === "status") return { id: brain.id, name: named, state: "status", value: t(STATUS_WORDS[state.status]), resetsAt: span.resets_at };
  return { id: brain.id, name: who, state: "unreadable", value: t("account.unreadable"), resetsAt: null };
}

/** OpenRouter has no window: its own reading of this month's use of the key, and what is left of the key's limit when it has one. */
export function openRouterBlock(status: Status | null | undefined): UsageBlock | null {
  const key = status?.openrouter;
  if (!key || key.state === "no_key") return null;
  const monthly = key.usage?.monthly;
  if (typeof monthly === "number" && Number.isFinite(monthly) && !(key.state === "error" && key.error === "auth")) {
    const left = key.usage?.limit_remaining;
    return { id: "openrouter", name: `OpenRouter ${t("account.thisMonth")}`, state: "spend", value: formatUsd(monthly), resetsAt: null,
      ...(typeof left === "number" && Number.isFinite(left) ? { detail: `${formatUsd(left)} ${t("runs.remaining")}` } : {}) };
  }
  // The key has not been asked yet: there is nothing to say, as nothing yet is not a failure to read.
  if (key.state === "unknown") return null;
  return { id: "openrouter", name: "OpenRouter", state: "unreadable", value: t("account.unreadable"), resetsAt: null };
}

export interface UsageReadings {
  allowances: CliAllowances | null;
  chatgpt: ChatGptStatus | null;
  status: Status | null;
}

/**
 * A block for every provider the owner uses, in a stable order: the subscriptions in the reading's order, the ChatGPT sign-in, then OpenRouter.
 * A provider whose usage cannot be read keeps its block, saying so, as Settings' cards keep theirs.
 */
export function usageBlocks(readings: UsageReadings, now = Date.now()): UsageBlock[] {
  const blocks = (readings.allowances?.brains ?? []).map((brain) => subscriptionBlock(brain, readings.allowances?.quotas, now));
  if (chatgptSignedIn(readings.chatgpt)) blocks.push({ id: "chatgpt", name: "ChatGPT", state: "unreadable", value: t("account.unreadable"), resetsAt: null });
  const openRouter = openRouterBlock(readings.status);
  if (openRouter) blocks.push(openRouter);
  return blocks;
}
