// @vitest-environment happy-dom
// Settings › 用量: only what each subscription has left, one card each.
import { afterEach, expect, it, vi } from "vitest";
import { setLocale } from "./i18n";
import { mountUsageAnalytics, type UsageAnalyticsApi } from "./usage-analytics";

afterEach(() => { document.body.replaceChildren(); setLocale("zh-TW"); });
const mount = async (api: UsageAnalyticsApi) => {
  const host = document.createElement("div"); document.body.append(host);
  const view = mountUsageAnalytics(host, api); await view.ready;
  return { host, view };
};

it("has no periods, charts, breakdowns, tiles or export: only the allowance cards", async () => {
  const { host, view } = await mount({ usageAllowances: vi.fn().mockResolvedValue({ brains: [{ id: "codex", name: "Codex", source: "live", windows: [{ period: "weekly", remaining_percent: 89, resets_at: 1792900000 }] }] }) });
  expect(host.querySelectorAll(".run-subscription")).toHaveLength(1);
  expect(host.querySelector("svg.ua-chart, .ua-chart, .run-tiles, .run-bill, .run-groups, table, [data-run-act=\"export\"], [data-run-act=\"period\"], [data-range]")).toBeNull();
  expect(host.querySelector('[role="progressbar"]')!.getAttribute("aria-valuenow")).toBe("89");
  view.destroy(); expect(host.childElementCount).toBe(0);
});

it("with no subscription signed in the section stands aside, leaving the rows of what was spent alone", async () => {
  const { host, view } = await mount({ usageAllowances: vi.fn().mockResolvedValue({ brains: [] }) });
  expect(host.querySelector<HTMLElement>(".usage-analytics")!.hidden).toBe(true);
  view.destroy();
});

it("shows recorded subscription exhaustion and reset beside live Codex allowances", async () => {
  const { host, view } = await mount({ usageAllowances: vi.fn().mockResolvedValue({ brains: [{ id: "codex", name: "Codex CLI", windows: [{ period: "fiveHour", remaining_percent: 76, resets_at: 1792800000 }] }, { id: "claude", name: "Claude", windows: [] }, { id: "gemini", name: "Antigravity", windows: [] }], quotas: [{ provider: "claude", reset_at_ms: 1792800000000 }, { provider: "gemini", reset_at_ms: null }] }) });
  const text = host.querySelector(".run-allowance")!.textContent;
  expect(text).toContain("76%"); expect(text).toContain("Claude"); expect(text).toContain("Antigravity");
  expect(text).toContain("額度已用完"); expect(text).toContain("重設時間未提供");
  view.destroy();
});

it("renders and refreshes all allowance sources with maker marks and honest unknown percentages", async () => {
  const usageAllowances = vi.fn().mockResolvedValue({ brains: [
    { id: "codex", name: "Codex", source: "live", windows: [{ period: "fiveHour", remaining_percent: 76, resets_at: 1792900000 }] },
    { id: "claude", name: "Claude", source: "reported", windows: [
      { period: "fiveHour", remaining_percent: 17, resets_at: Math.round(Date.now() / 1000) + 3600, status: "allowed_warning", updated_at_ms: 1792800000000 },
      { period: "weekly", remaining_percent: null, resets_at: 1, status: "allowed", updated_at_ms: 1792800000000 },
    ] },
    { id: "gemini", name: "Antigravity", source: "unavailable", windows: [] },
  ], quotas: [{ provider: "gemini", reset_at_ms: null }] });
  const { host, view } = await mount({ usageAllowances });
  const section = host.querySelector(".run-allowance")!;
  expect(section.querySelectorAll(".run-subscription")).toHaveLength(3);
  expect(section.querySelectorAll("h4 .mono")).toHaveLength(3);
  expect(section.textContent).toContain("更新於");
  expect(section.textContent).toContain("尚未取得這個帳號的剩餘額度");
  expect(section.textContent).toContain("接近額度上限");
  expect(section.textContent).not.toContain("null%");
  expect(section.querySelectorAll('[role="progressbar"]')).toHaveLength(2);
  // A window whose reset has passed says 已重置 and keeps no number or status of the run that reported it.
  expect(section.textContent).toContain("此回報的重設時間已過");
  expect(section.textContent).toContain("已重置");
  expect(section.textContent).not.toContain("可使用");
  usageAllowances.mockResolvedValueOnce({ brains: [{ id: "claude", name: "Claude", source: "reported", windows: [{ period: "fiveHour", remaining_percent: 12, resets_at: null, status: "allowed_warning", updated_at_ms: 1792800060000 }] }] });
  void view.refresh().catch(() => {});
  await vi.waitFor(() => expect(host.querySelector(".run-allowance")!.textContent).toContain("12%"));
  expect(host.querySelectorAll(".run-subscription")).toHaveLength(1);
  expect(host.querySelector(".run-subscription header")!.textContent).toBe("Claude");
  setLocale("en"); expect(host.querySelector(".run-allowance")!.textContent).toContain("Updated");
  setLocale("ja"); expect(host.querySelector(".run-allowance")!.textContent).toContain("更新日時");
  view.destroy();
});

it("ChatGPT sits with the other subscriptions once signed in, and its button opens its usage page", async () => {
  const chatgptStatus = vi.fn().mockResolvedValue({ signed_in: true, plan_scope_granted: true }), openExternalUrl = vi.fn().mockResolvedValue(undefined);
  const { host, view } = await mount({ usageAllowances: vi.fn().mockResolvedValue({ brains: [{ id: "codex", name: "Codex", windows: [] }] }), chatgptStatus, openExternalUrl });
  const card = host.querySelector('.run-allowance [data-allowance="chatgpt"]')!;
  expect(card.classList.contains("run-subscription")).toBe(true);
  card.querySelector<HTMLButtonElement>('[data-run-act="chatgpt-usage"]')!.click();
  expect(openExternalUrl).toHaveBeenCalledWith("https://chatgpt.com/settings/usage");
  for (const answer of [{ signed_in: false }, { signed_in: true, plan_scope_granted: false }]) {
    chatgptStatus.mockResolvedValueOnce(answer);
    void view.refresh().catch(() => {});
    await vi.waitFor(() => expect(host.querySelector('[data-allowance="chatgpt"]')).toBeNull());
    void view.refresh().catch(() => {});
    await vi.waitFor(() => expect(host.querySelector('[data-allowance="chatgpt"]')).not.toBeNull());
  }
  view.destroy();
});

it("a quiet reading that fails leaves the cards as they are, without a notice, and says so to its caller only", async () => {
  const usageAllowances = vi.fn().mockResolvedValueOnce({ brains: [{ id: "codex", name: "Codex", source: "live", windows: [{ period: "weekly", remaining_percent: 89, resets_at: 1792900000 }] }] });
  const { host, view } = await mount({ usageAllowances });
  const root = host.querySelector(".usage-analytics")!, before = root.innerHTML, card = root.querySelector(".run-subscription");
  const touched: MutationRecord[] = [];
  const watch = new MutationObserver(records => touched.push(...records));
  watch.observe(root, { attributes: true, childList: true, characterData: true, subtree: true });
  usageAllowances.mockRejectedValueOnce(new Error("offline"));
  await expect(view.refresh()).rejects.toThrow("allowance");
  await Promise.resolve();
  watch.disconnect();
  expect(touched).toEqual([]);
  expect(root.innerHTML).toBe(before);
  expect(root.querySelector(".run-subscription")).toBe(card);
  expect(root.getAttribute("aria-busy")).toBe("false");
  view.destroy();
});

it("a failed reading says so, a quiet refresh that changes nothing touches nothing, and nothing lands after destroy", async () => {
  const usageAllowances = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ brains: [{ id: "codex", name: "Codex", windows: [] }] });
  const { host, view } = await mount({ usageAllowances });
  expect(host.querySelector(".run-subscription")).toBeNull();
  expect(host.querySelector(".usage-analytics")!.textContent!.trim()).not.toBe("");
  await view.refresh();
  const card = host.querySelector(".run-subscription");
  expect(card).not.toBeNull();
  await view.refresh();
  expect(host.querySelector(".run-subscription")).toBe(card);
  let finish!: (value: unknown) => void;
  usageAllowances.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const late = view.refresh();
  view.destroy();
  finish({ brains: [] }); await late;
  expect(host.childElementCount).toBe(0);
});

it("OpenRouter has its card, from the key's own reading, and says so when that cannot be read", async () => {
  const key = (usage: unknown, state = "ok") => ({ openrouter: { state, latency_ms: 1, checked_at_ms: 1, error: null, key: null, usage }, spend: { month_usd: 1, today_usd: 0, limit_usd: 20, forecast_usd: 1, daily: [] }, last: null });
  const statusGet = vi.fn().mockResolvedValue(key({ daily: 0, weekly: 0, monthly: 3.21, total: 9, limit: 20, limit_remaining: 16.79 }));
  const { host, view } = await mount({ usageAllowances: vi.fn().mockResolvedValue({ brains: [] }), statusGet });
  const card = host.querySelector('.run-allowance [data-allowance="openrouter"]')!;
  expect(card.classList.contains("run-subscription")).toBe(true);
  expect(card.textContent).toContain("OpenRouter"); expect(card.textContent).toContain("本月"); expect(card.textContent).toContain("US$3.21"); expect(card.textContent).toContain("US$16.79 剩餘");
  expect(host.querySelector<HTMLElement>(".usage-analytics")!.hidden).toBe(false);
  statusGet.mockResolvedValueOnce(key({ daily: null, weekly: null, monthly: null, total: null, limit: null, limit_remaining: null }));
  await view.refresh();
  expect(host.querySelector('[data-allowance="openrouter"]')!.textContent).toContain("無法讀取");
  // A failed read keeps the card as it was; no key at all removes it.
  statusGet.mockRejectedValueOnce(new Error("offline"));
  await view.refresh();
  expect(host.querySelector('[data-allowance="openrouter"]')!.textContent).toContain("無法讀取");
  statusGet.mockResolvedValueOnce(key(null, "no_key"));
  await view.refresh();
  expect(host.querySelector('[data-allowance="openrouter"]')).toBeNull();
  view.destroy();
});
