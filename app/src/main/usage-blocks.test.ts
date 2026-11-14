// @vitest-environment happy-dom
// What the account menu and Settings' usage cards say of each provider (R-SIDE-02, R-UI-109): one block for every provider the owner uses,
// never a stale number, and no number that was not read.
import { afterEach, expect, test } from "vitest";
import { setLocale } from "./i18n";
import type { Status } from "./types";
import type { CliAllowances } from "./usage-analytics-types";
import { openRouterBlock, usageBlocks, windowState } from "./usage-blocks";

afterEach(() => setLocale("zh-TW"));

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const DAY = 86_400_000;
const at = (ms: number): number => ms / 1000;
const key = (patch: Partial<Status["openrouter"]> = {}): Status => ({ openrouter: { state: "ok", latency_ms: 90, checked_at_ms: NOW, error: null, key: null,
  usage: { daily: 0.1, weekly: 1, monthly: 3.21, total: 9, limit: null, limit_remaining: null }, ...patch }, spend: { month_usd: 1.24, today_usd: 0, limit_usd: 20, forecast_usd: 2, daily: [] }, last: null });

/** The owner's mix on 2026-11-14: Codex read live at 65% used, Claude's last report a window that has since reset, the ChatGPT sign-in, an OpenRouter key. */
const owner = (): Parameters<typeof usageBlocks>[0] => ({
  allowances: { brains: [
    { id: "codex", name: "Codex", source: "live", windows: [{ period: "weekly", remaining_percent: 35, resets_at: at(NOW + 5 * DAY) }] },
    { id: "claude", name: "Claude Code", source: "reported", windows: [{ period: "fiveHour", remaining_percent: null, resets_at: at(NOW - 3_600_000), status: "allowed", updated_at_ms: NOW - 6 * 3_600_000 }] },
  ], quotas: [] },
  chatgpt: { signed_in: true, plan_scope_granted: true },
  status: key({ usage: { daily: 0.1, weekly: 1, monthly: 3.21, total: 9, limit: 20, limit_remaining: 16.79 } }),
});

test("every provider the owner uses has its block, in a stable order: the subscriptions as read, the ChatGPT sign-in, then OpenRouter", () => {
  const blocks = usageBlocks(owner(), NOW);
  expect(blocks.map(block => block.id)).toEqual(["codex", "claude", "chatgpt", "openrouter"]);
  expect(blocks.map(block => block.state)).toEqual(["percent", "reset", "unreadable", "spend"]);
  expect(blocks[0]).toMatchObject({ name: "Codex 每週", used: 65, value: "已使用 65%", resetsAt: at(NOW + 5 * DAY) });
  // Claude's last report named a window that has since reset: it says so and keeps no stale number.
  expect(blocks[1]).toMatchObject({ name: "Claude 5 小時", value: "已重置", resetsAt: null });
  expect(blocks[1]!.used).toBeUndefined();
  expect(blocks[2]).toMatchObject({ name: "ChatGPT", value: "無法讀取" });
  expect(blocks[3]).toMatchObject({ name: "OpenRouter 本月", value: "US$3.21", detail: "US$16.79 剩餘" });
});

test("the same readings in another language, and the same blocks again at the next reading", () => {
  setLocale("en");
  expect(usageBlocks(owner(), NOW).map(block => `${block.name}: ${block.value}`)).toEqual([
    "Codex Weekly: Used 65%", "Claude 5 hours: Reset", "ChatGPT: Can't be read", "OpenRouter This month: US$3.21"]);
  expect(JSON.stringify(usageBlocks(owner(), NOW))).toBe(JSON.stringify(usageBlocks(owner(), NOW)));
});

test("a window with no percentage says what it does know, and never a number", () => {
  const brains = (windows: CliAllowances["brains"][number]["windows"], source: "live" | "reported" = "reported"): CliAllowances => ({ brains: [{ id: "claude", name: "Claude Code", source, windows }] });
  const first = (allowances: CliAllowances) => usageBlocks({ allowances, chatgpt: null, status: null }, NOW)[0]!;
  expect(first(brains([{ period: "fiveHour", remaining_percent: null, resets_at: at(NOW + 3 * 3_600_000), status: "allowed" }]))).toMatchObject({ state: "status", value: "可使用", resetsAt: at(NOW + 3 * 3_600_000) });
  expect(first(brains([{ period: "weekly", remaining_percent: null, resets_at: at(NOW + DAY), status: "allowed_warning" }]))).toMatchObject({ state: "status", value: "接近額度上限" });
  expect(first(brains([{ period: "weekly", remaining_percent: null, resets_at: at(NOW + DAY), status: "rejected" }]))).toMatchObject({ state: "status", value: "額度已用完" });
  // A window nobody told anything about, and a subscription with no window at all, cannot be read.
  expect(first(brains([{ period: "weekly", remaining_percent: null, resets_at: null }]))).toMatchObject({ state: "unreadable", value: "無法讀取" });
  expect(first(brains([]))).toMatchObject({ state: "unreadable", name: "Claude" });
  expect(first({ brains: [{ id: "gemini", name: "Gemini CLI", source: "unavailable", windows: [] }] })).toMatchObject({ state: "unreadable", name: "Antigravity" });
});

test("the window that speaks is the blocked one, then the most used, and a window that has reset speaks only when nothing current does", () => {
  const claude = (windows: CliAllowances["brains"][number]["windows"]): ReturnType<typeof usageBlocks>[number] =>
    usageBlocks({ allowances: { brains: [{ id: "claude", name: "Claude Code", source: "reported", windows }] }, chatgpt: null, status: null }, NOW)[0]!;
  const later = at(NOW + DAY), earlier = at(NOW - DAY);
  expect(claude([{ period: "fiveHour", remaining_percent: 70, resets_at: later }, { period: "weekly", remaining_percent: 3, resets_at: later }])).toMatchObject({ name: "Claude 每週", used: 97 });
  expect(claude([{ period: "fiveHour", remaining_percent: 1, resets_at: earlier }, { period: "weekly", remaining_percent: 40, resets_at: later }])).toMatchObject({ name: "Claude 每週", used: 60 });
  expect(claude([{ period: "fiveHour", remaining_percent: 1, resets_at: earlier }, { period: "weekly", remaining_percent: null, resets_at: later, status: "allowed" }])).toMatchObject({ name: "Claude 每週", state: "status" });
  expect(claude([{ period: "fiveHour", remaining_percent: 1, resets_at: earlier }, { period: "weekly", remaining_percent: 5, resets_at: earlier }])).toMatchObject({ state: "reset", value: "已重置" });
  expect(claude([{ period: "fiveHour", remaining_percent: 50, resets_at: later }, { period: "weekly", remaining_percent: null, resets_at: later, status: "rejected" }])).toMatchObject({ name: "Claude 每週", state: "status", value: "額度已用完" });
  // A live reading is current whatever its reset says.
  expect(usageBlocks({ allowances: { brains: [{ id: "codex", name: "Codex", source: "live", windows: [{ period: "weekly", remaining_percent: 10, resets_at: earlier }] }] }, chatgpt: null, status: null }, NOW)[0]).toMatchObject({ state: "percent", used: 90 });
});

test("a recorded exhaustion speaks for a subscription with no number, and gives way to a live number", () => {
  const read = (windows: CliAllowances["brains"][number]["windows"], source: "live" | "reported"): ReturnType<typeof usageBlocks>[number] =>
    usageBlocks({ allowances: { brains: [{ id: "claude", name: "Claude Code", source, windows }], quotas: [{ provider: "claude", reset_at_ms: NOW + 2 * 3_600_000 }] }, chatgpt: null, status: null }, NOW)[0]!;
  expect(read([], "reported")).toMatchObject({ state: "exhausted", value: "額度已用完", resetsAt: at(NOW + 2 * 3_600_000) });
  expect(read([{ period: "weekly", remaining_percent: null, resets_at: null, status: "allowed" }], "reported")).toMatchObject({ state: "exhausted" });
  expect(read([{ period: "weekly", remaining_percent: 30, resets_at: at(NOW + DAY) }], "live")).toMatchObject({ state: "percent", used: 70 });
});

test("the ChatGPT sign-in is a provider only while its plan is one the app speaks of", () => {
  const names = (chatgpt: Parameters<typeof usageBlocks>[0]["chatgpt"]): string[] => usageBlocks({ allowances: { brains: [] }, chatgpt, status: null }, NOW).map(block => block.name);
  expect(names({ signed_in: true })).toEqual(["ChatGPT"]);
  expect(names({ signed_in: true, plan_scope_granted: true })).toEqual(["ChatGPT"]);
  expect(names({ signed_in: true, plan_scope_granted: false })).toEqual([]);
  expect(names({ signed_in: false })).toEqual([]);
  expect(names(null)).toEqual([]);
});

test("OpenRouter says what OpenRouter reported for the key, and nothing it did not", () => {
  expect(openRouterBlock(null)).toBeNull();
  expect(openRouterBlock(key({ state: "no_key", usage: null }))).toBeNull();
  // Not asked yet is not a failure to read.
  expect(openRouterBlock(key({ state: "unknown", usage: null }))).toBeNull();
  expect(openRouterBlock(key())).toMatchObject({ state: "spend", name: "OpenRouter 本月", value: "US$3.21" });
  expect(openRouterBlock(key())!.detail).toBeUndefined();
  expect(openRouterBlock(key({ usage: { daily: null, weekly: null, monthly: null, total: null, limit: null, limit_remaining: null } }))).toMatchObject({ state: "unreadable", name: "OpenRouter" });
  expect(openRouterBlock(key({ state: "error", error: "network" }))).toMatchObject({ state: "spend", value: "US$3.21" });
  expect(openRouterBlock(key({ state: "error", error: "auth" }))).toMatchObject({ state: "unreadable" });
  expect(openRouterBlock(key({ state: "error", error: "network", usage: null }))).toMatchObject({ state: "unreadable" });
});

test("a window is judged once, for the menu and the cards alike", () => {
  expect(windowState("reported", { period: "weekly", remaining_percent: 1, resets_at: at(NOW - 1000) }, NOW)).toEqual({ kind: "reset" });
  expect(windowState("live", { period: "weekly", remaining_percent: 1, resets_at: at(NOW - 1000) }, NOW)).toEqual({ kind: "percent", used: 99 });
  expect(windowState("reported", { period: "weekly", remaining_percent: 120, resets_at: null }, NOW)).toEqual({ kind: "percent", used: 0 });
  expect(windowState(undefined, { period: "weekly", remaining_percent: null, resets_at: null }, NOW)).toEqual({ kind: "unknown" });
});
