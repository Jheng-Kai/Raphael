// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";
import { accountMenuHTML, forgetUsageReadings, openAccountMenu, resetsIn, usageSubmenuHTML } from "./account-menu";
import type { ChatGptStatus, Status } from "./types";
import { closeMenu } from "./ui";
import type { CliAllowances } from "./usage-analytics-types";
import { usageBlocks, type UsageBlock } from "./usage-blocks";

afterEach(() => { closeMenu(); document.body.replaceChildren(); setLocale("zh-TW"); vi.useRealTimers(); forgetUsageReadings(); });

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const DAY = 86_400_000;
const allowances = (): CliAllowances => ({ brains: [
  { id: "claude", name: "Claude Code", source: "live", windows: [{ period: "fiveHour", remaining_percent: 70, resets_at: (NOW + 3 * 3_600_000) / 1000 }] },
  { id: "codex", name: "Codex", source: "live", windows: [
    { period: "weekly", remaining_percent: 4, resets_at: (NOW + 6 * DAY) / 1000 },
    { period: "fiveHour", remaining_percent: null, resets_at: null },
  ] },
] });

const block = (patch: Partial<UsageBlock>): UsageBlock => ({ id: "codex", name: "Codex 每週", state: "percent", used: 96, value: "已使用 96%", resetsAt: null, ...patch });
const status = (patch: Partial<Status["openrouter"]> = {}): Status => ({ openrouter: { state: "ok", latency_ms: 90, checked_at_ms: NOW, error: null, key: null,
  usage: { daily: 0, weekly: 0, monthly: 3.21, total: 9, limit: null, limit_remaining: null }, ...patch }, spend: { month_usd: 1.24, today_usd: 0, limit_usd: 20, forecast_usd: 2, daily: [] }, last: null });

test("each subscription gives its window with the most used, in the reading's order, and a provider with no number still has its block", () => {
  const claudeLive: CliAllowances = { brains: [{ id: "claude", name: "Claude Code", source: "live", windows: [{ period: "fiveHour", remaining_percent: 70, resets_at: (NOW + 3 * 3_600_000) / 1000 }, { period: "weekly", remaining_percent: 3, resets_at: (NOW + 3 * DAY) / 1000 }] }] };
  const read = (reading: CliAllowances | null) => usageBlocks({ allowances: reading, chatgpt: null, status: null }, NOW);
  expect(read(allowances()).map(({ name, used, resetsAt }) => ({ name, used, resetsAt }))).toEqual([
    { name: "Claude 5 小時", used: 30, resetsAt: (NOW + 3 * 3_600_000) / 1000 },
    { name: "Codex 每週", used: 96, resetsAt: (NOW + 6 * DAY) / 1000 },
  ]);
  expect(read(claudeLive).map(({ name, used }) => ({ name, used }))).toEqual([{ name: "Claude 每週", used: 97 }]);
  expect(read(null)).toEqual([]);
  expect(read({ brains: [{ id: "codex", name: "Codex", windows: [] }] }).map(({ name, state }) => ({ name, state }))).toEqual([{ name: "Codex", state: "unreadable" }]);
  // Claude's last report named a window whose reset has passed: the provider stays, saying 已重置, with no stale number.
  const stale: CliAllowances = { brains: [{ id: "claude", name: "Claude Code", source: "reported", windows: [{ period: "weekly", remaining_percent: 1, resets_at: (NOW - DAY) / 1000 }] }] };
  expect(read(stale).map(({ name, state, value }) => ({ name, state, value }))).toEqual([{ name: "Claude 每週", state: "reset", value: "已重置" }]);
  expect(read({ brains: [stale.brains[0]!, allowances().brains[1]!] }).map(row => row.name)).toEqual(["Claude 每週", "Codex 每週"]);
});

test("the reset is said in the nearest whole unit, in the language of the window", () => {
  expect(resetsIn((NOW + 6 * DAY) / 1000, NOW)).toBe("6 天後重置");
  expect(resetsIn((NOW + 5 * 3_600_000) / 1000, NOW)).toBe("5 小時後重置");
  expect(resetsIn((NOW + 20 * 60_000) / 1000, NOW)).toBe("20 分鐘後重置");
  expect(resetsIn((NOW - 1000) / 1000, NOW)).toBe("1 分鐘後重置");
  setLocale("en");
  expect(resetsIn((NOW + 6 * DAY) / 1000, NOW)).toBe("Resets in 6 days");
});

test("the rows are 用量 with a chevron and no number, 聽寫, 行事曆, a hairline and 設定, and with no window known 用量 has no chevron and no submenu", () => {
  const known = document.createElement("div");
  known.innerHTML = accountMenuHTML([block({}), block({ id: "claude", name: "Claude 每週", used: 97, value: "已使用 97%" })]);
  expect([...known.querySelectorAll("button")].map(row => row.dataset.account)).toEqual(["usage", "dictation", "calendar", "settings"]);
  expect(known.querySelector('[data-account="usage"]')!.getAttribute("aria-haspopup")).toBe("menu");
  expect(known.querySelector('[data-account="usage"] > svg.i')).not.toBeNull();
  expect(known.querySelector('[data-account="usage"]')!.textContent).toBe("用量");
  expect(known.querySelectorAll('.menu-sep')).toHaveLength(1);
  expect(known.querySelector(".menu-sep")!.nextElementSibling!.getAttribute("data-account")).toBe("settings");
  const none = document.createElement("div");
  none.innerHTML = accountMenuHTML([]);
  expect([...none.querySelectorAll("button")].map(row => row.dataset.account)).toEqual(["usage-settings", "dictation", "calendar", "settings"]);
  expect(none.querySelector('[data-account="usage-settings"]')!.hasAttribute("aria-haspopup")).toBe(false);
  expect(none.querySelector("button > svg.i")).toBeNull();
  // A Lucide icon on every row, and no two rows share one.
  const icons = [...known.querySelectorAll("button .ck")].map(icon => icon.innerHTML);
  expect(icons.every(Boolean) && new Set(icons).size).toBe(4);
});

test("the submenu has a block for each provider with its words, number and reset, then 管理用量", () => {
  const sub = document.createElement("div");
  sub.innerHTML = usageSubmenuHTML([
    block({ id: "claude", name: "Claude 每週", used: 97, value: "已使用 97%", resetsAt: (NOW + 3 * DAY) / 1000 }),
    block({ id: "codex", name: "Codex 5 小時", used: 24, value: "已使用 24%", resetsAt: (NOW + 5 * 3_600_000) / 1000 }),
    block({ id: "gemini", name: "Antigravity", state: "unreadable", used: undefined, value: "無法讀取" }),
    block({ id: "claude", name: "Claude 5 小時", state: "reset", used: undefined, value: "已重置" }),
    block({ id: "openrouter", name: "OpenRouter 本月", state: "spend", used: undefined, value: "US$3.21", detail: "US$16.79 剩餘" }),
  ], NOW);
  const blocks = [...sub.querySelectorAll(".account-window")];
  expect(blocks.map(row => row.querySelector(".account-window-name")!.textContent)).toEqual(["Claude 每週", "Codex 5 小時", "Antigravity", "Claude 5 小時", "OpenRouter 本月"]);
  expect(blocks.map(row => row.querySelector(".account-window-used")!.textContent)).toEqual(["已使用 97%", "已使用 24%", "無法讀取", "已重置", "US$3.21"]);
  expect(blocks.map(row => row.querySelector(".account-window-reset")?.textContent ?? null)).toEqual(["3 天後重置", "5 小時後重置", null, null, "US$16.79 剩餘"]);
  expect(blocks.map(row => (row as HTMLElement).dataset.state)).toEqual(["percent", "percent", "unreadable", "reset", "spend"]);
  expect(sub.querySelector('[data-account="manage"] .mt')!.textContent).toBe("管理用量");
  expect(sub.querySelector(".menu-sep")!.nextElementSibling).toBe(sub.querySelector('[data-account="manage"]'));
});

function mount(read: () => Promise<CliAllowances>, side: "above" | "right" = "above", more: { chatgptStatus?: () => Promise<ChatGptStatus>; status?: () => Promise<Status> } = {}) {
  document.body.innerHTML = '<nav class="sidebar"><button type="button" class="sidebar-account" aria-label="Sam" aria-haspopup="menu" aria-expanded="false"></button></nav>';
  document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect = () => ({ left: 0, right: 88, top: 0, bottom: 900, width: 88, height: 900 } as DOMRect);
  const anchor = document.querySelector<HTMLButtonElement>(".sidebar-account")!;
  const go = vi.fn();
  anchor.addEventListener("click", () => openAccountMenu(anchor, { go, allowances: read, ...more }, side));
  return { anchor, go };
}
const flush = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const menu = (): HTMLElement | null => document.getElementById("app-popover");

test("pressing the face opens the menu with the focus on its first row, and Escape closes it and gives the focus back to the face", async () => {
  const { anchor } = mount(async () => ({ brains: [] }));
  anchor.click(); await flush();
  expect(menu()!.className).toContain("account-menu");
  expect(menu()!.getAttribute("aria-label")).toBe("Sam");
  expect(anchor.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(menu()!.querySelector("button"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect((document.activeElement as HTMLElement).dataset.account).toBe("dictation");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(anchor);
  expect(anchor.getAttribute("aria-expanded")).toBe("false");
});

test("the readings arrive: 用量 opens a submenu at its edge that names every subscription, and 管理用量 opens the settings' usage", async () => {
  const { anchor, go } = mount(async () => allowances());
  anchor.click(); await flush();
  const row = menu()!.querySelector<HTMLElement>('[data-account="usage"]')!;
  expect(row.getAttribute("aria-haspopup")).toBe("menu");
  expect(row.textContent).toBe("用量");
  row.click();
  const sub = document.getElementById("app-submenu")!;
  expect(sub).not.toBeNull();
  expect(menu()!.isConnected).toBe(true);
  expect([...sub.querySelectorAll(".account-window-name")].map(name => name.textContent)).toEqual(["Claude 5 小時", "Codex 每週"]);
  expect(document.activeElement).toBe(sub.querySelector('[data-account="manage"]'));
  sub.querySelector<HTMLElement>('[data-account="manage"]')!.click();
  expect(go).toHaveBeenCalledWith("settings", "usage");
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(anchor);
});

test("with no window known 用量 opens the settings' usage directly, and 聽寫, 行事曆 and 設定 go where the buttons they replace went", async () => {
  const { anchor, go } = mount(async () => ({ brains: [] }));
  const open = async (id: string): Promise<void> => { anchor.click(); await flush(); menu()!.querySelector<HTMLElement>(`[data-account="${id}"]`)!.click(); };
  await open("usage-settings"); expect(go).toHaveBeenLastCalledWith("settings", "usage");
  await open("dictation"); expect(go).toHaveBeenLastCalledWith("dictation");
  await open("calendar"); expect(go).toHaveBeenLastCalledWith("automations");
  await open("settings"); expect(go).toHaveBeenLastCalledWith("settings", "general");
  expect(menu()).toBeNull();
});

test("a reading that fails leaves the menu as it was, and one that brings a window corrects the row without closing the menu", async () => {
  let reading: () => Promise<CliAllowances> = async () => { throw new Error("offline"); };
  const { anchor } = mount(() => reading());
  anchor.click(); await flush();
  expect(menu()!.querySelector('[data-account="usage"]')).toBeNull();
  closeMenu();
  reading = async () => allowances();
  anchor.click(); await flush();
  expect(menu()!.querySelector('[data-account="usage"]')!.getAttribute("aria-haspopup")).toBe("menu");
  expect(document.activeElement).toBe(menu()!.querySelector("button"));
});

test("the menu stands to the right of the face on the rail and above it in the list", async () => {
  for (const side of ["above", "right"] as const) {
    const { anchor } = mount(async () => ({ brains: [] }), side);
    anchor.getBoundingClientRect = () => ({ left: 28, right: 60, top: 700, bottom: 732, width: 32, height: 32 } as DOMRect);
    anchor.click(); await flush();
    const left = parseFloat(menu()!.style.left);
    // On the rail the menu clears the whole 88 px rail (its + button too), 8 px beyond its edge.
    if (side === "right") expect(left).toBe(96); else expect(left).toBe(28);
    closeMenu();
  }
});

test("every provider the owner uses is in the submenu: Claude whose window has reset, Codex live, the ChatGPT sign-in and OpenRouter", async () => {
  const claude = { id: "claude", name: "Claude Code", source: "reported" as const, windows: [{ period: "fiveHour" as const, remaining_percent: null, resets_at: (Date.now() - 3_600_000) / 1000, status: "allowed" as const }] };
  const codex = { id: "codex", name: "Codex", source: "live" as const, windows: [{ period: "weekly" as const, remaining_percent: 35, resets_at: (Date.now() + 5 * DAY) / 1000 }] };
  const { anchor } = mount(async () => ({ brains: [codex, claude] }), "above", { chatgptStatus: async () => ({ signed_in: true, plan_scope_granted: true }), status: async () => status() });
  anchor.click(); await flush();
  menu()!.querySelector<HTMLElement>('[data-account="usage"]')!.click();
  const sub = document.getElementById("app-submenu")!;
  expect([...sub.querySelectorAll<HTMLElement>(".account-window")].map(row => `${row.dataset.provider}|${row.querySelector(".account-window-name")!.textContent}|${row.querySelector(".account-window-used")!.textContent}`)).toEqual([
    "codex|Codex 每週|已使用 65%", "claude|Claude 5 小時|已重置", "chatgpt|ChatGPT|無法讀取", "openrouter|OpenRouter 本月|US$3.21"]);
});

test("each reading lands when it arrives: a slow subscription read never holds back the ChatGPT sign-in or OpenRouter", async () => {
  let finish!: (value: CliAllowances) => void;
  const { anchor } = mount(() => new Promise<CliAllowances>(resolve => { finish = resolve; }), "above", { chatgptStatus: async () => ({ signed_in: true }), status: async () => status() });
  anchor.click(); await flush();
  expect(menu()!.querySelector('[data-account="usage"]')!.getAttribute("aria-haspopup")).toBe("menu");
  menu()!.querySelector<HTMLElement>('[data-account="usage"]')!.click();
  expect([...document.querySelectorAll(".account-window-name")].map(name => name.textContent)).toEqual(["ChatGPT", "OpenRouter 本月"]);
  finish({ brains: [] });
});

test("a reading that fails keeps what was known of that provider, and the others still correct the menu", async () => {
  const codex = { id: "codex", name: "Codex", source: "live" as const, windows: [{ period: "weekly" as const, remaining_percent: 35, resets_at: null }] };
  let up = true;
  const { anchor } = mount(async () => { if (!up) throw new Error("offline"); return { brains: [codex] }; }, "above", { chatgptStatus: async () => { if (!up) throw new Error("offline"); return { signed_in: true }; }, status: async () => status() });
  anchor.click(); await flush(); closeMenu();
  up = false;
  anchor.click(); await flush();
  menu()!.querySelector<HTMLElement>('[data-account="usage"]')!.click();
  expect([...document.querySelectorAll(".account-window-name")].map(name => name.textContent)).toEqual(["Codex 每週", "ChatGPT", "OpenRouter 本月"]);
});
