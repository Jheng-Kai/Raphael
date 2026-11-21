// Settings › 用量 › 概覽 › 方案額度: what each subscription has left, one card each, under this month's spending
// (settings-view.ts). A card names the service and, at its right, the account or the plan; each window it reports has its
// name, when it resets and what is left, over a bar. OpenRouter's card is its key's limit; a service whose balance cannot be
// read says so, ChatGPT with the button to its own usage page. Its charts are 用量 › 分析's (usage-analysis.ts), not here.
// Mount it in the page's slot and destroy it when the page leaves.

import "./usage-analytics.css";
import { CHATGPT_USAGE_URL, CLIS } from "./cli-brains";
import { describeError, formatUsd } from "./format";
import { getLocale, onLocaleChange, t } from "./i18n";
import { noticeHTML } from "./missing";
import { providerMark } from "./provider-marks";
import type { ChatGptStatus, Status } from "./types";
import { btn, esc, patchHTML, toaster } from "./ui";
import type { CliAllowanceWindow, CliAllowances } from "./usage-analytics-types";
import { chatgptSignedIn, openRouterBlock, PERIODS, subscriptionName, windowState } from "./usage-blocks";

export type { CliAllowances } from "./usage-analytics-types";
// What each provider's reading means is decided once, in usage-blocks.ts, for this card and the account menu alike.
export { PERIODS, subscriptionName };
export interface UsageAnalyticsApi {
  usageAllowances(): Promise<CliAllowances>;
  chatgptStatus?(): Promise<ChatGptStatus>;
  /** OpenRouter's own reading of the key (`status.get`); without it the card has none for OpenRouter. */
  statusGet?(): Promise<Status>;
  openExternalUrl?(url: string): Promise<void>;
}
export interface UsageAnalyticsMount {
  /** The first reading has come back (a failure renders in the view). */
  ready: Promise<void>;
  /** Reads again without a loading state; only a change redraws. Rejects when the reading failed. */
  refresh(): Promise<void>;
  destroy(): void;
}

const time = (ms: number): string => new Date(ms).toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** The name of a window on its card: 5 小時額度, 每週額度. */
const WINDOW_NAMES = { fiveHour: "usage.fiveHour", weekly: "usage.weekly", weeklyOpus: "usage.weeklyOpus", weeklySonnet: "usage.weeklySonnet" } as const;

/** How long until a window resets, in the window's language: 4 小時 57 分, 3 天 2 小時, 12 分; a part that is none is left out (2 小時, 1 天). */
export function untilText(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return t("usage.minutes", { p0: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? t("usage.hoursMinutes", { p0: hours, p1: minutes % 60 }) : t("usage.hours", { p0: hours });
  return hours % 24 ? t("usage.daysHours", { p0: Math.floor(hours / 24), p1: hours % 24 }) : t("usage.days", { p0: hours / 24 });
}

/** A card's head: the service with its maker's mark, and at the right the account or the plan it is. */
const head = (mark: string, name: string, who: string): string =>
  `<header><h4>${providerMark(mark)}${esc(name)}</h4>${who ? `<span class="run-who">${esc(who)}</span>` : ""}</header>`;

/** A meter of a card: its name, a line with when it resets (or what was used) and what is left, and the bar of what is left. */
const meterHTML = (o: { name: string; when: string; left: string; percent: number | null; label: string; notes?: string[] }): string =>
  `<div class="run-window"><span class="run-window-name">${esc(o.name)}</span>` +
  `<div class="run-window-line"><span>${esc(o.when)}</span>${o.left ? `<strong class="num">${esc(o.left)}</strong>` : ""}</div>` +
  (o.percent !== null ? `<div class="run-bar-track" role="progressbar" aria-label="${esc(o.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${o.percent}"><i style="width:${o.percent}%"></i></div>` : "") +
  (o.notes ?? []).map((note) => `<small>${esc(note)}</small>`).join("") + `</div>`;

/** One window of a subscription: when it resets and what it has left, or that it has reset, with no stale number or bar. */
function windowHTML(name: string, source: string | undefined, w: CliAllowanceWindow, now: number): string {
  const state = windowState(source, w, now), over = state.kind === "reset";
  const remaining = Math.min(100, Math.max(0, Math.round(w.remaining_percent ?? 0)));
  const status = w.status && !over ? t(w.status === "allowed" ? "runs.allowanceAllowed" : w.status === "allowed_warning" ? "runs.allowanceWarning" : "runs.exhausted") : "";
  return meterHTML({
    name: t(WINDOW_NAMES[w.period]),
    when: over ? t("runs.allowanceExpired") : w.resets_at ? t("usage.resetsIn", { p0: untilText(w.resets_at * 1000 - now) }) : t("runs.resetUnknown"),
    left: over ? t("account.reset") : state.kind === "percent" ? t("usage.left", { p0: remaining }) : t("runs.allowancePercentUnknown"),
    percent: state.kind === "percent" ? remaining : null,
    label: `${name} ${t(PERIODS[w.period])}`,
    // A number from the last run says when it was read; a live one needs no word.
    notes: [status, source === "reported" && w.updated_at_ms && !over ? t("runs.allowanceUpdated", { time: time(w.updated_at_ms) }) : ""].filter(Boolean),
  });
}

/** One card per subscription brain: each window's share left as a bar, and when it resets. */
export function allowanceCardsHTML(allowance: CliAllowances, now = Date.now()): string {
  return allowance.brains.map((brain) => {
    const cli = CLIS.find((c) => c.id === brain.id), name = subscriptionName(brain.id, brain.name);
    const quota = allowance.quotas?.find((q) => q.provider === brain.id);
    return `<article class="run-subscription" data-allowance="${esc(brain.id)}">${head(cli?.mark ?? brain.id, name, t("brains.subscription"))}` +
      (quota ? `<p class="run-quota"><strong>${t("runs.exhausted")}</strong><small>${quota.reset_at_ms ? `${t("runs.resets")} ${esc(time(quota.reset_at_ms))}` : t("runs.resetUnknown")}</small></p>` : "") +
      (!brain.windows.length ? `<p class="run-allowance-unavailable">${t("missing.allowanceUnknown")}</p>` : brain.windows.map((w) => windowHTML(name, brain.source, w, now)).join("")) +
      `</article>`;
  }).join("");
}

/**
 * OpenRouter has no window: its card is its key's limit, from the same reading as the account menu's (usage-blocks.ts): what
 * this month used and what is left of the limit over a bar, or this month's use alone when the key has no limit.
 */
const openRouterHTML = (status: Status | null): string => {
  const block = openRouterBlock(status);
  if (!block) return "";
  const usage = status?.openrouter?.usage, limit = usage?.limit, left = usage?.limit_remaining;
  const capped = typeof limit === "number" && limit > 0 && typeof left === "number" && Number.isFinite(left);
  return `<article class="run-subscription" data-allowance="openrouter">${head("openrouter", "OpenRouter", t("providers.apiKey"))}` +
    (block.state === "spend"
      ? meterHTML({
        name: t("usage.keyLimit"),
        when: capped ? t("usage.keyUsed", { p0: block.value, p1: formatUsd(limit) }) : t("usage.keyUsedOnly", { p0: block.value }),
        left: capped ? t("usage.leftUsd", { p0: formatUsd(Math.max(0, left)) }) : "",
        percent: capped ? Math.round(Math.min(100, Math.max(0, (left / limit) * 100))) : null,
        label: `OpenRouter ${t("usage.keyLimit")}`,
      })
      : `<p class="run-allowance-unavailable">${esc(block.value)}</p>`) + `</article>`;
};

/** ChatGPT keeps its plan's numbers on its own page: the card says so, with the button to read them there. */
const chatgptHTML = (email: string): string =>
  `<article class="run-subscription" data-allowance="chatgpt">${head("openai", "ChatGPT", email || t("brains.subscription"))}` +
  `<div class="run-unreadable"><p class="run-allowance-unavailable">${t("runs.chatgptAllowance")}</p>${btn(esc(t("brains.manageUsage")), "sm", ' data-run-act="chatgpt-usage"')}</div></article>`;

const mounted = new WeakMap<HTMLElement, UsageAnalyticsMount>();

export function mountUsageAnalytics(host: HTMLElement, api: UsageAnalyticsApi): UsageAnalyticsMount {
  mounted.get(host)?.destroy();
  const root = document.createElement("section");
  root.className = "usage-analytics run-allowance";
  host.replaceChildren(root);
  let allowance: CliAllowances = { brains: [] }, failed = false, chatgpt: string | null = null, openrouter: Status | null = null, busy = true, disposed = false, revision = 0;

  function render(): void {
    if (disposed) return;
    const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.runAct : undefined;
    const cards = failed ? noticeHTML("allowance", "models") : allowanceCardsHTML(allowance) + (chatgpt !== null ? chatgptHTML(chatgpt) : "") + openRouterHTML(openrouter);
    // With no subscription signed in there is nothing to show here, and this month's spending stands alone.
    root.hidden = !busy && !cards;
    root.setAttribute("aria-busy", String(busy));
    root.setAttribute("aria-label", t("runs.allowance"));
    // No refresh of its own: Settings reads this again each time it opens, unseen (settings.ts `refreshInBackground`).
    patchHTML(root, `<header><h2 tabindex="-1">${t("runs.allowance")}</h2></header>${cards}`);
    if (focused) root.querySelector<HTMLElement>(`[data-run-act="${focused}"]`)?.focus({ preventScroll: true });
  }

  async function read(quiet: boolean): Promise<void> {
    const current = ++revision, before = JSON.stringify([allowance, failed, chatgpt, openrouter]);
    busy = !quiet;
    if (!quiet) render();
    let next = allowance, broke = false;
    try { next = await api.usageAllowances(); } catch { broke = true; }
    // A quiet reading that fails leaves the page as it is (what was last known stays, with no notice over it); its caller
    // hears. Only the first reading shows its failure in the view.
    if (quiet && broke) throw new Error("allowance");
    const [account, status] = await Promise.all([api.chatgptStatus?.().catch(() => null), api.statusGet?.().catch(() => null)]);
    if (disposed || current !== revision) return;
    allowance = next; failed = broke;
    // Signed in with its plan allowed: the card names the account it is.
    chatgpt = chatgptSignedIn(account) ? account?.email ?? "" : null;
    // A failed read of the key keeps what was last known: it says nothing here.
    openrouter = status ?? openrouter;
    busy = false;
    if (!quiet || JSON.stringify([allowance, failed, chatgpt, openrouter]) !== before) render();
  }

  function clicked(event: MouseEvent): void {
    const button = (event.target as Element).closest<HTMLButtonElement>("button");
    if (!button || button.disabled) return;
    if (button.dataset.runAct === "chatgpt-usage") void api.openExternalUrl?.(CHATGPT_USAGE_URL).catch((error) => toaster.info(describeError(error)));
  }
  root.addEventListener("click", clicked);
  const stopLocale = onLocaleChange(render);
  const controller: UsageAnalyticsMount = {
    ready: read(false),
    refresh: () => read(true),
    destroy() {
      disposed = true;
      ++revision;
      stopLocale();
      root.removeEventListener("click", clicked);
      root.remove();
      if (mounted.get(host) === controller) mounted.delete(host);
    },
  };
  mounted.set(host, controller);
  return controller;
}
