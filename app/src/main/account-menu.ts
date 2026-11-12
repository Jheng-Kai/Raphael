// The account menu (R-SIDE-02, owner 2026-11-12, after Grok Bot's): the owner's face at the foot of the sidebar opens it above
// the face, left edges together; on the rail it opens to the right of the face. 用量 shows the tightest subscription window the
// app knows and opens a submenu at its right edge (the window, when it resets, 管理用量); 聽寫, 行事曆 (the calendar, on today in a
// fresh session, R-CAL-04) and, after a hairline, 設定 follow. The numbers come from `usage.allowances` through the existing API and nowhere else.

import { getLocale, t } from "./i18n";
import type { AppContext } from "./types";
import { closeMenu, esc, ico, openPopover, placeMenu } from "./ui";
import { PERIODS, subscriptionName } from "./usage-analytics";
import type { CliAllowances } from "./usage-analytics-types";

/** The window of a subscription that has the least left. */
export interface UsageWindow {
  /** The subscription and its window, `Codex 每週`. */
  name: string;
  /** Percent of the window that is used, 0 to 100. */
  used: number;
  /** When it resets, in seconds since the epoch, if the subscription says. */
  resetsAt: number | null;
}

/**
 * The window with the most used, among the windows that give a percentage. A number reported by an earlier run whose reset
 * has passed is no longer true and is left out, as the usage card says it is.
 */
export function tightestWindow(allowances: CliAllowances | null, now = Date.now()): UsageWindow | null {
  let found: UsageWindow | null = null;
  for (const brain of allowances?.brains ?? []) {
    for (const span of brain.windows) {
      const left = span.remaining_percent;
      if (typeof left !== "number" || !Number.isFinite(left)) continue;
      if (brain.source === "reported" && span.resets_at && span.resets_at * 1000 <= now) continue;
      const used = Math.min(100, Math.max(0, Math.round(100 - left)));
      if (!found || used > found.used) found = { name: `${subscriptionName(brain.id, brain.name)} ${t(PERIODS[span.period])}`, used, resetsAt: span.resets_at };
    }
  }
  return found;
}

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** `in 6 days`, `in 5 hours`, `in 20 minutes`: the nearest whole unit, in the window's language. */
export function resetsIn(resetsAt: number, now = Date.now()): string {
  const left = Math.max(0, resetsAt * 1000 - now);
  const [value, unit] = left >= 36 * HOUR ? [Math.round(left / DAY), "day"] as const : left >= 90 * MINUTE ? [Math.round(left / HOUR), "hour"] as const : [Math.max(1, Math.round(left / MINUTE)), "minute"] as const;
  return t("account.resets", { p0: new Intl.RelativeTimeFormat(getLocale(), { numeric: "always", style: "long" }).format(value, unit) });
}

const usedWords = (span: UsageWindow): string => t("overview.used", { p0: span.used });

/** The rows of the menu. A window that is known gives 用量 its number and a submenu; with none it opens the settings itself. */
export function accountMenuHTML(span: UsageWindow | null): string {
  const row = (id: string, icon: Parameters<typeof ico>[0], words: string, trail = "", extra = ""): string =>
    `<button type="button" role="menuitem" tabindex="-1" data-account="${id}"${extra}><span class="ck">${ico(icon)}</span><span class="mt">${esc(words)}</span>${trail}</button>`;
  const usage = span
    ? row("usage", "gauge", t("models.usage"), `<span class="account-used num">${esc(usedWords(span))}</span>${ico("right")}`, ' aria-haspopup="menu" aria-expanded="false"')
    : row("usage-settings", "gauge", t("models.usage"));
  return usage + row("dictation", "mic", t("nav.dictation")) + row("calendar", "calendar", t("overview.calendar")) +
    `<div class="menu-sep" role="separator"></div>` + row("settings", "gear", t("nav.settings"));
}

/** The submenu of 用量: the window, its number, when it resets, and the way to the settings' usage. */
export function usageSubmenuHTML(span: UsageWindow): string {
  return `<div class="account-window"><span class="account-window-name">${esc(span.name)}</span><span class="account-window-used num">${esc(usedWords(span))}</span>` +
    (span.resetsAt ? `<span class="account-window-reset">${esc(resetsIn(span.resetsAt))}</span>` : "") + `</div>` +
    `<div class="menu-sep" role="separator"></div>` +
    `<button type="button" role="menuitem" tabindex="-1" data-account="manage"><span class="mt">${esc(t("brains.manageUsage"))}</span></button>`;
}

export interface AccountMenuHost extends Pick<AppContext, "go"> {
  /** `usage.allowances`, as the settings' usage card reads it. */
  allowances(): Promise<CliAllowances>;
}

/** What the last reading said, so that the menu opens with a number at once and the next reading only corrects it. */
let known: CliAllowances | null = null;

/**
 * Opens the account menu at `anchor` (above it on a list, beside it on the rail). The face that opened it is its toggle
 * (dismissals.ts, R-UI-124); the menu closes itself on a pick, a press outside or Escape, and the face gets the focus back.
 */
export function openAccountMenu(anchor: HTMLElement, host: AccountMenuHost, side: "above" | "right"): void {
  let shown = tightestWindow(known);
  // On the rail the menu stands beside the whole rail, never over its other buttons: its place is the rail's right edge at the face's height.
  const rail = anchor.closest<HTMLElement>(".sidebar");
  const railRect = (): DOMRect => { const face = anchor.getBoundingClientRect(), bar = rail?.getBoundingClientRect() ?? face; return new DOMRect(bar.left, face.top, bar.right - bar.left, face.height); };
  const root = openPopover(anchor, accountMenuHTML(shown), { className: "menu account-menu", role: "menu", label: anchor.getAttribute("aria-label") ?? undefined, placement: side === "right" ? "right" : "start", ...(side === "right" ? { anchorRect: railRect } : {}) });
  const leave = (go: () => void): void => { closeMenu(); anchor.focus({ preventScroll: true }); go(); };
  root.addEventListener("click", event => {
    const item = (event.target as Element).closest<HTMLElement>("[data-account]");
    if (!item) return;
    const id = item.dataset.account;
    if (id === "usage" && shown) {
      const sub = openPopover(item, usageSubmenuHTML(shown), { className: "menu menu-submenu account-usage", role: "menu", label: item.textContent?.trim() || undefined, placement: "beside" });
      sub.addEventListener("click", press => {
        if ((press.target as Element).closest('[data-account="manage"]')) leave(() => host.go("settings", "usage"));
      });
      sub.querySelector<HTMLElement>("button")?.focus();
    }
    else if (id === "dictation") leave(() => host.go("dictation"));
    // No date: a dated link would open the day view and forget the view the owner chose (R-CAL-04); the calendar starts on today in a fresh session.
    else if (id === "calendar") leave(() => host.go("automations"));
    else if (id === "settings") leave(() => host.go("settings", "general"));
    else if (id === "usage-settings") leave(() => host.go("settings", "usage"));
  });
  root.querySelector<HTMLElement>("button")?.focus();
  // The reading is asked for at each opening, as the settings do; a number that changed corrects the row and the menu stays open.
  void host.allowances().then(next => {
    known = next;
    if (!root.isConnected || document.getElementById("app-submenu")) return;
    const fresh = tightestWindow(next);
    if (JSON.stringify(fresh) === JSON.stringify(shown)) return;
    // The rows keep their places, so the focus stays on the same place of the menu.
    const at = [...root.querySelectorAll("button")].indexOf(document.activeElement as HTMLButtonElement);
    shown = fresh;
    root.innerHTML = accountMenuHTML(fresh);
    if (at >= 0) root.querySelectorAll("button")[at]?.focus({ preventScroll: true });
    placeMenu();
  }, () => { /* The row keeps what it showed: a failed reading says nothing here, the settings' card says it. */ });
}
