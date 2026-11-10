// A subscription window nine-tenths used (owner, 2026-11-09, R-QUOTA-01): the core tells each window once
// (agent/quota.py) and the window says it in one toast: which subscription, what is left, when it resets. Words only:
// which model answers stays the owner's choice (R-MODEL-02). A hidden window keeps the toast until the owner is back,
// so the one notice is not spent while no one looks.

import { formatClock, formatShortDateTime } from "./format";
import { getLocale, t } from "./i18n";
import type { MainEvent } from "./types";
import { esc, toaster } from "./ui";
import { PERIODS, subscriptionName } from "./usage-analytics";

export type QuotaWarning = Extract<MainEvent, { type: "QuotaWarning" }>;

const DAY_MS = 86_400_000;

/** `Codex（5 小時）額度只剩 8%，13:15 重設`: a reset within a day as its time, a later one with its date. */
export function quotaWarningText(warning: QuotaWarning, nowMs = Date.now()): string {
  const left = new Intl.NumberFormat(getLocale(), { style: "percent", maximumFractionDigits: 0 }).format(warning.remaining_percent / 100);
  const reset = warning.resets_at ? warning.resets_at * 1000 : null;
  const when = reset === null ? "" : t("chat.quotaReset", { p0: reset - nowMs < DAY_MS ? formatClock(reset) : formatShortDateTime(reset, nowMs) });
  return t("chat.quotaLow", { p0: subscriptionName(warning.provider), p1: t(PERIODS[warning.period]), p2: left }) + when;
}

/** Shows the warning now, or when a hidden window is next seen; a window that has reset meanwhile needs no word. */
export function warnQuota(warning: QuotaWarning, doc: Document = document): void {
  const show = (): void => {
    if (doc.hidden) return;
    doc.removeEventListener("visibilitychange", show);
    if (warning.resets_at && warning.resets_at * 1000 <= Date.now()) return;
    toaster.notice(() => `<span class="quota-warning" role="status">${esc(quotaWarningText(warning))}</span>`);
  };
  if (doc.hidden) doc.addEventListener("visibilitychange", show);
  else show();
}
