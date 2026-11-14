// The account menu (R-SIDE-02, owner 2026-11-12, after Grok Bot's): the owner's face at the foot of the sidebar opens it above
// the face, left edges together; on the rail it opens to the right of the face. 用量 opens, on a chevron alone, what the app knows of each
// provider the owner uses: a submenu at its right edge, one block for each (Claude, Codex, Antigravity, the ChatGPT sign-in, OpenRouter:
// its tightest window and number, or what is truthfully known instead; no reset time, owner 2026-11-14) and 管理用量. The row itself carries no number:
// one provider's figure under the bare word would read as everyone's. 聽寫, 行事曆 (the calendar, on today in a fresh session, R-CAL-04)
// and, after a hairline, 設定 follow. What each reading means is decided in usage-blocks.ts, which Settings' usage cards use as well.

import { t } from "./i18n";
import type { AppContext, ChatGptStatus, Status } from "./types";
import { closeMenu, esc, ico, openPopover, placeMenu } from "./ui";
import type { CliAllowances } from "./usage-analytics-types";
import { usageBlocks, type UsageBlock } from "./usage-blocks";

/** The rows of the menu. With a provider known 用量 has a chevron and a submenu; with none it opens the settings itself. */
export function accountMenuHTML(blocks: UsageBlock[]): string {
  const row = (id: string, icon: Parameters<typeof ico>[0], words: string, trail = "", extra = ""): string =>
    `<button type="button" role="menuitem" tabindex="-1" data-account="${id}"${extra}><span class="ck">${ico(icon)}</span><span class="mt">${esc(words)}</span>${trail}</button>`;
  const usage = blocks.length
    ? row("usage", "gauge", t("models.usage"), ico("right"), ' aria-haspopup="menu" aria-expanded="false"')
    : row("usage-settings", "gauge", t("models.usage"));
  return usage + row("dictation", "mic", t("nav.dictation")) + row("calendar", "calendar", t("overview.calendar")) +
    `<div class="menu-sep" role="separator"></div>` + row("settings", "gear", t("nav.settings"));
}

/** The submenu of 用量: each provider's block (name, words at the right, and OpenRouter's balance under them), then the way to the
 *  settings' usage. No reset time: the owner (2026-11-14) wants none in this small box; Settings' usage cards keep it. */
export function usageSubmenuHTML(blocks: UsageBlock[]): string {
  return blocks.map(block => `<div class="account-window" data-menu-row data-provider="${esc(block.id)}" data-state="${block.state}"><span class="account-window-name">${esc(block.name)}</span><span class="account-window-used num">${esc(block.value)}</span>` +
    (block.detail ? `<span class="account-window-reset">${esc(block.detail)}</span>` : "") + `</div>`).join("") +
    `<div class="menu-sep" role="separator"></div>` +
    `<button type="button" role="menuitem" tabindex="-1" data-account="manage"><span class="mt">${esc(t("brains.manageUsage"))}</span></button>`;
}

export interface AccountMenuHost extends Pick<AppContext, "go"> {
  /** `usage.allowances`, as the settings' usage card reads it. */
  allowances(): Promise<CliAllowances>;
  /** `chatgpt.status`: whether the ChatGPT sign-in is one of the providers. */
  chatgptStatus?(): Promise<ChatGptStatus>;
  /** `status.get`: OpenRouter's own reading of the key. */
  status?(): Promise<Status>;
}

/** What the last readings said, so that the menu opens with its blocks at once and the next readings only correct them. */
const known: { allowances: CliAllowances | null; chatgpt: ChatGptStatus | null; status: Status | null } = { allowances: null, chatgpt: null, status: null };
const blocksNow = (): UsageBlock[] => usageBlocks(known);
/** Forgets the last readings, as a fresh start would (for the tests). */
export function forgetUsageReadings(): void { known.allowances = null; known.chatgpt = null; known.status = null; }

/**
 * Opens the account menu at `anchor` (above it on a list, beside it on the rail). The face that opened it is its toggle
 * (dismissals.ts, R-UI-124); the menu closes itself on a pick, a press outside or Escape, and the face gets the focus back.
 */
export function openAccountMenu(anchor: HTMLElement, host: AccountMenuHost, side: "above" | "right"): void {
  let shown = blocksNow();
  // On the rail the menu stands beside the whole rail, never over its other buttons: its place is the rail's right edge at the face's height.
  const rail = anchor.closest<HTMLElement>(".sidebar");
  const railRect = (): DOMRect => { const face = anchor.getBoundingClientRect(), bar = rail?.getBoundingClientRect() ?? face; return new DOMRect(bar.left, face.top, bar.right - bar.left, face.height); };
  const root = openPopover(anchor, accountMenuHTML(shown), { className: "menu account-menu", role: "menu", label: anchor.getAttribute("aria-label") ?? undefined, placement: side === "right" ? "right" : "start", ...(side === "right" ? { anchorRect: railRect } : {}) });
  const leave = (go: () => void): void => { closeMenu(); anchor.focus({ preventScroll: true }); go(); };
  root.addEventListener("click", event => {
    const item = (event.target as Element).closest<HTMLElement>("[data-account]");
    if (!item) return;
    const id = item.dataset.account;
    if (id === "usage" && shown.length) {
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
  // Each reading is asked for at each opening, as the settings do, and lands when it arrives: a slow one (Codex's app-server) never holds back the others.
  // A number that changed corrects the row and the menu stays open; a reading that fails changes nothing (the settings' card says it).
  const correct = (): void => {
    if (!root.isConnected || document.getElementById("app-submenu")) return;
    const fresh = blocksNow();
    if (JSON.stringify(fresh) === JSON.stringify(shown)) return;
    // The rows keep their places, so the focus stays on the same place of the menu.
    const at = [...root.querySelectorAll("button")].indexOf(document.activeElement as HTMLButtonElement);
    shown = fresh;
    root.innerHTML = accountMenuHTML(fresh);
    if (at >= 0) root.querySelectorAll("button")[at]?.focus({ preventScroll: true });
    placeMenu();
  };
  const read = <K extends keyof typeof known>(key: K, ask: (() => Promise<NonNullable<(typeof known)[K]>>) | undefined): void => {
    if (!ask) return;
    void ask().then(next => { known[key] = next; correct(); }, () => { /* keeps what was known */ });
  };
  read("allowances", host.allowances);
  read("chatgpt", host.chatgptStatus);
  read("status", host.status);
}
