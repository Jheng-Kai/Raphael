// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";
import { quotaWarningText, warnQuota, type QuotaWarning } from "./quota-warning";

// 2026-10-24 10:00 in Taipei, the look fixture's clock.
const NOW = 1_792_807_200_000;
const codex: QuotaWarning = { type: "QuotaWarning", provider: "codex", period: "fiveHour", remaining_percent: 8, resets_at: NOW / 1000 + 3 * 3600 + 900 };
const hiddenWindow = (): Document & { hidden: boolean } => Object.assign(new EventTarget(), { hidden: true }) as unknown as Document & { hidden: boolean };
const shown = (): string[] => [...document.querySelectorAll(".toast .quota-warning")].map((toast) => toast.textContent ?? "");

afterEach(() => {
  setLocale("zh-TW");
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe("a subscription window nine-tenths used", () => {
  test("says which subscription, what is left and when it resets, in the window's language", () => {
    expect(quotaWarningText(codex, NOW)).toBe("Codex（5 小時）額度只剩 8%，13:15 重設");
    const weekly: QuotaWarning = { type: "QuotaWarning", provider: "claude", period: "weeklyOpus", remaining_percent: 7.5, resets_at: NOW / 1000 + 3 * 86400 - 7200 };
    expect(quotaWarningText(weekly, NOW)).toBe("Claude（每週 · Opus）額度只剩 8%，10/27 08:00 重設");
    setLocale("en");
    expect(quotaWarningText(codex, NOW)).toBe("Codex (5 hours) has only 8% left, resets 13:15");
    setLocale("tr");
    expect(quotaWarningText({ ...codex, resets_at: undefined }, NOW)).toBe("Codex (5 saat): yalnızca %8 kaldı");
  });

  test("a visible window shows one toast at once, redraws it in a new language and lets it go", () => {
    vi.useFakeTimers({ now: NOW });
    warnQuota(codex);
    expect(shown()).toEqual(["Codex（5 小時）額度只剩 8%，13:15 重設"]);
    expect(document.querySelector(".toast .quota-warning")?.getAttribute("role")).toBe("status");
    setLocale("ja");
    expect(shown()).toEqual(["Codex（5 時間）の残りは 8%、13:15 にリセット"]);
    vi.advanceTimersByTime(12_000);
    expect(document.querySelector(".toast")).toBeNull();
  });

  test("a hidden window keeps the notice until the owner is back, and shows it once", () => {
    vi.useFakeTimers({ now: NOW });
    const away = hiddenWindow();
    warnQuota(codex, away);
    away.dispatchEvent(new Event("visibilitychange"));
    expect(shown()).toEqual([]);
    away.hidden = false;
    away.dispatchEvent(new Event("visibilitychange"));
    away.dispatchEvent(new Event("visibilitychange"));
    expect(shown()).toEqual(["Codex（5 小時）額度只剩 8%，13:15 重設"]);
  });

  test("a window that reset while no one looked needs no word", () => {
    vi.useFakeTimers({ now: NOW });
    const away = hiddenWindow();
    warnQuota(codex, away);
    vi.setSystemTime(codex.resets_at! * 1000);
    away.hidden = false;
    away.dispatchEvent(new Event("visibilitychange"));
    expect(document.querySelector(".toast")).toBeNull();
  });
});
