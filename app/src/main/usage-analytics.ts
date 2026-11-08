// Settings › 模型與用量 › 用量, as plain as Grok Bot's (owner, 2026-11-06): what each subscription has left, one card
// each, above the rows of what was spent (settings-view.ts). No periods, charts, breakdowns or exports.
// Mount it in the page's slot and destroy it when the page leaves.

import "./usage-analytics.css";
import { CHATGPT_USAGE_URL, CLIS } from "./cli-brains";
import { describeError } from "./format";
import { getLocale, onLocaleChange, t } from "./i18n";
import { noticeHTML } from "./missing";
import { providerMark } from "./provider-marks";
import type { ChatGptStatus } from "./types";
import { btn, esc, patchHTML, toaster } from "./ui";
import type { CliAllowances } from "./usage-analytics-types";

export type { CliAllowances } from "./usage-analytics-types";
export interface UsageAnalyticsApi {
  usageAllowances(): Promise<CliAllowances>;
  chatgptStatus?(): Promise<ChatGptStatus>;
  openExternalUrl?(url: string): Promise<void>;
}
export interface UsageAnalyticsMount {
  /** The first reading has come back (a failure renders in the view). */
  ready: Promise<void>;
  /** Reads again without a loading state; only a change redraws. Rejects when the reading failed. */
  refresh(): Promise<void>;
  destroy(): void;
}

const PERIODS = { fiveHour: "runs.fiveHour", weekly: "runs.weekly", weeklyOpus: "runs.weeklyOpus", weeklySonnet: "runs.weeklySonnet" } as const;
const time = (ms: number): string => new Date(ms).toLocaleString(getLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** One card per subscription brain: each window's share left as a bar, and when it resets. */
export function allowanceCardsHTML(allowance: CliAllowances): string {
  return allowance.brains.map((brain) => {
    const cli = CLIS.find((c) => c.id === brain.id), name = brain.id === "claude" ? "Claude" : cli?.name ?? brain.name;
    const quota = allowance.quotas?.find((q) => q.provider === brain.id);
    const reported = brain.source === "reported";
    // A number from the last run says when it was read, on its own line; a live one needs no word.
    return `<article class="run-subscription"><header><h4>${providerMark(cli?.mark ?? brain.id)}${esc(name)}</h4></header>` +
      (quota ? `<p class="run-quota"><strong>${t("runs.exhausted")}</strong><small>${quota.reset_at_ms ? `${t("runs.resets")} ${esc(time(quota.reset_at_ms))}` : t("runs.resetUnknown")}</small></p>` : "") +
      (!brain.windows.length ? `<p class="run-allowance-unavailable">${t("missing.allowanceUnknown")}</p>` : brain.windows.map((w) => {
        const known = typeof w.remaining_percent === "number" && Number.isFinite(w.remaining_percent);
        const remaining = Math.min(100, Math.max(0, w.remaining_percent ?? 0));
        return `<div class="run-window"><span>${t(PERIODS[w.period])}</span>` +
          (known ? `<strong>${remaining}% ${t("runs.remaining")}</strong>` : `<span>${t("runs.allowancePercentUnknown")}</span>`) +
          (w.status ? `<small>${t(w.status === "allowed" ? "runs.allowanceAllowed" : w.status === "allowed_warning" ? "runs.allowanceWarning" : "runs.exhausted")}</small>` : "") +
          (known ? `<div class="run-bar-track" role="progressbar" aria-label="${esc(name)} ${esc(t(PERIODS[w.period]))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${remaining}"><i style="width:${remaining}%"></i></div>` : "") +
          (w.resets_at ? `<small>${t("runs.resets")} ${esc(time(w.resets_at * 1000))}</small>` : "") +
          (reported && w.updated_at_ms ? `<small>${t("runs.allowanceUpdated", { time: time(w.updated_at_ms) })}</small>` : "") +
          (reported && w.resets_at && w.resets_at * 1000 <= Date.now() ? `<small>${t("runs.allowanceExpired")}</small>` : "") + `</div>`;
      }).join("")) + `</article>`;
  }).join("");
}

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
  let allowance: CliAllowances = { brains: [] }, failed = false, chatgpt = false, busy = true, disposed = false, revision = 0;

  function render(): void {
    if (disposed) return;
    const focused = root.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.runAct : undefined;
    const cards = failed ? noticeHTML("allowance", "models") : allowanceCardsHTML(allowance) + (chatgpt ? chatgptHTML() : "");
    // With no subscription signed in there is nothing to show here, and the rows of what was spent stand alone.
    root.hidden = !busy && !cards;
    root.setAttribute("aria-busy", String(busy));
    root.setAttribute("aria-label", t("runs.allowance"));
    // No refresh of its own: the one at the top of 模型與用量 reads this too (owner, 2026-11-08: 「為甚麼會有兩個 icon」).
    patchHTML(root, `<header><h2 tabindex="-1">${t("runs.allowance")}</h2></header>${cards}`);
    if (focused) root.querySelector<HTMLElement>(`[data-run-act="${focused}"]`)?.focus({ preventScroll: true });
  }

  async function read(quiet: boolean): Promise<void> {
    const current = ++revision, before = JSON.stringify([allowance, failed, chatgpt]);
    busy = !quiet;
    if (!quiet) render();
    let next = allowance, broke = false;
    try { next = await api.usageAllowances(); } catch { broke = true; }
    const account = await api.chatgptStatus?.().catch(() => null);
    if (disposed || current !== revision) return;
    allowance = next; failed = broke;
    chatgpt = !!account?.signed_in && account.plan_scope_granted !== false;
    busy = false;
    if (!quiet || JSON.stringify([allowance, failed, chatgpt]) !== before) render();
    // The page's one refresh says when a reading failed; the first reading shows its failure in the view.
    if (quiet && broke) throw new Error("allowance");
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
