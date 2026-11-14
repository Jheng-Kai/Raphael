// Settings › 模型與用量 › 用量: what each subscription has left, one card
// each, above the rows of what was spent (settings-view.ts). No periods, charts, breakdowns or exports.
// Mount it in the page's slot and destroy it when the page leaves.

import "./usage-analytics.css";
import { CHATGPT_USAGE_URL, CLIS } from "./cli-brains";
import { describeError } from "./format";
import { getLocale, onLocaleChange, t } from "./i18n";
import { noticeHTML } from "./missing";
import { providerMark } from "./provider-marks";
import type { ChatGptStatus, Status } from "./types";
import { btn, esc, patchHTML, toaster } from "./ui";
import type { CliAllowances } from "./usage-analytics-types";
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

/** One card per subscription brain: each window's share left as a bar, and when it resets. */
export function allowanceCardsHTML(allowance: CliAllowances, now = Date.now()): string {
  return allowance.brains.map((brain) => {
    const cli = CLIS.find((c) => c.id === brain.id), name = subscriptionName(brain.id, brain.name);
    const quota = allowance.quotas?.find((q) => q.provider === brain.id);
    const reported = brain.source === "reported";
    // A number from the last run says when it was read, on its own line; a live one needs no word.
    return `<article class="run-subscription"><header><h4>${providerMark(cli?.mark ?? brain.id)}${esc(name)}</h4></header>` +
      (quota ? `<p class="run-quota"><strong>${t("runs.exhausted")}</strong><small>${quota.reset_at_ms ? `${t("runs.resets")} ${esc(time(quota.reset_at_ms))}` : t("runs.resetUnknown")}</small></p>` : "") +
      (!brain.windows.length ? `<p class="run-allowance-unavailable">${t("missing.allowanceUnknown")}</p>` : brain.windows.map((w) => {
        // A number a run reported before the window reset is no longer true: the window says it has reset, with no stale number or bar.
        const state = windowState(brain.source, w, now), over = state.kind === "reset";
        const known = state.kind === "percent";
        const remaining = Math.min(100, Math.max(0, w.remaining_percent ?? 0));
        return `<div class="run-window"><span>${t(PERIODS[w.period])}</span>` +
          (over ? `<strong>${t("account.reset")}</strong>` : known ? `<strong>${remaining}% ${t("runs.remaining")}</strong>` : `<span>${t("runs.allowancePercentUnknown")}</span>`) +
          (w.status && !over ? `<small>${t(w.status === "allowed" ? "runs.allowanceAllowed" : w.status === "allowed_warning" ? "runs.allowanceWarning" : "runs.exhausted")}</small>` : "") +
          (known ? `<div class="run-bar-track" role="progressbar" aria-label="${esc(name)} ${esc(t(PERIODS[w.period]))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${remaining}"><i style="width:${remaining}%"></i></div>` : "") +
          (w.resets_at && !over ? `<small>${t("runs.resets")} ${esc(time(w.resets_at * 1000))}</small>` : "") +
          (reported && w.updated_at_ms ? `<small>${t("runs.allowanceUpdated", { time: time(w.updated_at_ms) })}</small>` : "") +
          (over ? `<small>${t("runs.allowanceExpired")}</small>` : "") + `</div>`;
      }).join("")) + `</article>`;
  }).join("");
}

/** OpenRouter has no window to show: its card says this month's use of the key, and what is left of the key's limit, from the same reading as the menu's. */
const openRouterHTML = (status: Status | null): string => {
  const block = openRouterBlock(status);
  if (!block) return "";
  return `<article class="run-subscription" data-allowance="openrouter"><header><h4>${providerMark("openrouter")}OpenRouter</h4></header>` +
    (block.state === "spend"
      ? `<div class="run-window"><span>${esc(t("account.thisMonth"))}</span><strong class="num">${esc(block.value)}</strong>${block.detail ? `<small>${esc(block.detail)}</small>` : ""}</div>`
      : `<p class="run-allowance-unavailable">${esc(block.value)}</p>`) + `</article>`;
};

/** ChatGPT keeps its plan's numbers on its own page: the card has the button to read them there. */
const chatgptHTML = (): string =>
  `<article class="run-subscription" data-allowance="chatgpt"><header><h4>${providerMark("openai")}ChatGPT</h4>${btn(esc(t("brains.manageUsage")), "", ' data-run-act="chatgpt-usage"')}</header>` +
  `<p class="run-allowance-unavailable">${t("runs.chatgptAllowance")}</p></article>`;

const mounted = new WeakMap<HTMLElement, UsageAnalyticsMount>();

export function mountUsageAnalytics(host: HTMLElement, api: UsageAnalyticsApi): UsageAnalyticsMount {
  mounted.get(host)?.destroy();
  const root = document.createElement("section");
  root.className = "usage-analytics run-allowance";
  host.replaceChildren(root);
  let allowance: CliAllowances = { brains: [] }, failed = false, chatgpt = false, openrouter: Status | null = null, busy = true, disposed = false, revision = 0;

  function render(): void {
    if (disposed) return;
    const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.runAct : undefined;
    const cards = failed ? noticeHTML("allowance", "models") : allowanceCardsHTML(allowance) + (chatgpt ? chatgptHTML() : "") + openRouterHTML(openrouter);
    // With no subscription signed in there is nothing to show here, and the rows of what was spent stand alone.
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
    chatgpt = chatgptSignedIn(account);
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
