// @vitest-environment happy-dom
// The 聽寫 overview's activity grid answers the pointer, not a press: a day under it says its words in the app's own tip.
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AppContext, DeviceSettings, StatsSummary } from "../types";

const period = { dictations: 4, words: 1200, audio_seconds: 300, cost_usd: 0.1 };
const stats: StatsSummary = {
  today: period, week: period, month: period, all: period, streak_days: 2, active_days: 3, longest_streak_days: 5, speed_wpm: 80, time_saved_seconds: 1800,
  by_day: [{ date: "2026-10-19", dictations: 0, words: 0 }, { date: "2026-10-20", dictations: 4, words: 1200 }, { date: "2026-10-21", dictations: 2, words: 300 }],
};

vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.0.0") }));
vi.mock("../api", () => ({ statsSummary: vi.fn(() => Promise.resolve(stats)) }));

import { setLocale } from "../i18n";
import { createDictationOverview } from "./dictation-overview";

afterEach(() => { document.body.replaceChildren(); setLocale("zh-TW"); });

const device = { dictation_keys: ["AltRight"], paste_last_keys: [], agent_keys: [], tidy_keys: [], dictation_mode: "toggle" } as unknown as DeviceSettings;
const app = { device: () => device, cleared: { on: vi.fn() }, go: vi.fn() } as unknown as AppContext;

async function opened(): Promise<HTMLElement> {
  const page = createDictationOverview(app);
  document.body.append(page.el);
  page.show();
  await vi.waitFor(() => expect(page.el.querySelector('.heat rect[data-date="2026-10-20"]')).not.toBeNull());
  return page.el;
}

describe("a day of the activity grid", () => {
  test("says its words under the pointer, outlined, and puts them away when the pointer leaves it", async () => {
    const el = await opened();
    const tip = el.querySelector<HTMLElement>(".heat-tip")!;
    const day = el.querySelector<SVGRectElement>('.heat rect[data-date="2026-10-20"]')!;
    expect(tip.hidden).toBe(true);
    day.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(tip.hidden).toBe(false);
    expect(tip.textContent).toBe("10 月 20 日：1,200 字");
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(day.classList.contains("is-picked")).toBe(true);
    // From one day to the next: the next one speaks.
    const next = el.querySelector<SVGRectElement>('.heat rect[data-date="2026-10-21"]')!;
    day.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: next }));
    next.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    expect(tip.textContent).toBe("10 月 21 日：300 字");
    expect(day.classList.contains("is-picked")).toBe(false);
    next.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: el }));
    expect(tip.hidden).toBe(true);
    expect(next.classList.contains("is-picked")).toBe(false);
  });

  test("a press adds nothing: no history opens and the words stay what the pointer showed", async () => {
    const el = await opened();
    const day = el.querySelector<SVGRectElement>('.heat rect[data-date="2026-10-20"]')!;
    day.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    day.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(el.querySelector<HTMLElement>(".heat-tip")!.hidden).toBe(false);
    expect(app.go).not.toHaveBeenCalled();
  });
});
