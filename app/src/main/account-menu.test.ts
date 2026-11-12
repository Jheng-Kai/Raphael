// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { setLocale } from "./i18n";
import { accountMenuHTML, openAccountMenu, resetsIn, tightestWindow, usageSubmenuHTML } from "./account-menu";
import { closeMenu } from "./ui";
import type { CliAllowances } from "./usage-analytics-types";

afterEach(() => { closeMenu(); document.body.replaceChildren(); setLocale("zh-TW"); vi.useRealTimers(); });

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const DAY = 86_400_000;
const allowances = (): CliAllowances => ({ brains: [
  { id: "claude", name: "Claude Code", source: "live", windows: [{ period: "fiveHour", remaining_percent: 70, resets_at: (NOW + 3 * 3_600_000) / 1000 }] },
  { id: "codex", name: "Codex", source: "live", windows: [
    { period: "weekly", remaining_percent: 4, resets_at: (NOW + 6 * DAY) / 1000 },
    { period: "fiveHour", remaining_percent: null, resets_at: null },
  ] },
] });

test("the tightest window is the one with the most used, and a window with no percentage or a reported one that has reset counts for nothing", () => {
  expect(tightestWindow(allowances(), NOW)).toEqual({ name: "Codex 每週", used: 96, resetsAt: (NOW + 6 * DAY) / 1000 });
  expect(tightestWindow(null, NOW)).toBeNull();
  expect(tightestWindow({ brains: [{ id: "codex", name: "Codex", windows: [] }] }, NOW)).toBeNull();
  const stale: CliAllowances = { brains: [{ id: "codex", name: "Codex", source: "reported", windows: [{ period: "weekly", remaining_percent: 1, resets_at: (NOW - DAY) / 1000 }] }] };
  expect(tightestWindow(stale, NOW)).toBeNull();
});

test("the reset is said in the nearest whole unit, in the language of the window", () => {
  expect(resetsIn((NOW + 6 * DAY) / 1000, NOW)).toBe("6 天後重置");
  expect(resetsIn((NOW + 5 * 3_600_000) / 1000, NOW)).toBe("5 小時後重置");
  expect(resetsIn((NOW + 20 * 60_000) / 1000, NOW)).toBe("20 分鐘後重置");
  expect(resetsIn((NOW - 1000) / 1000, NOW)).toBe("1 分鐘後重置");
  setLocale("en");
  expect(resetsIn((NOW + 6 * DAY) / 1000, NOW)).toBe("Resets in 6 days");
});

test("the rows are 用量 with its number and a chevron, 聽寫, 行事曆, a hairline and 設定, and with no window known 用量 has no number and no submenu", () => {
  const known = document.createElement("div");
  known.innerHTML = accountMenuHTML({ name: "Codex 每週", used: 96, resetsAt: null });
  expect([...known.querySelectorAll("button")].map(row => row.dataset.account)).toEqual(["usage", "dictation", "calendar", "settings"]);
  expect(known.querySelector('[data-account="usage"]')!.getAttribute("aria-haspopup")).toBe("menu");
  expect(known.querySelector(".account-used")!.textContent).toBe("已使用 96%");
  expect(known.querySelectorAll('.menu-sep')).toHaveLength(1);
  expect(known.querySelector(".menu-sep")!.nextElementSibling!.getAttribute("data-account")).toBe("settings");
  const none = document.createElement("div");
  none.innerHTML = accountMenuHTML(null);
  expect([...none.querySelectorAll("button")].map(row => row.dataset.account)).toEqual(["usage-settings", "dictation", "calendar", "settings"]);
  expect(none.querySelector('[data-account="usage-settings"]')!.hasAttribute("aria-haspopup")).toBe(false);
  expect(none.querySelector(".account-used")).toBeNull();
  // A Lucide icon on every row, and no two rows share one.
  const icons = [...known.querySelectorAll("button .ck")].map(icon => icon.innerHTML);
  expect(icons.every(Boolean) && new Set(icons).size).toBe(4);
});

test("the submenu names the window, its number and when it resets, then 管理用量", () => {
  const sub = document.createElement("div");
  sub.innerHTML = usageSubmenuHTML({ name: "Codex 每週", used: 96, resetsAt: (Date.now() + 6 * DAY) / 1000 });
  expect(sub.querySelector(".account-window-name")!.textContent).toBe("Codex 每週");
  expect(sub.querySelector(".account-window-used")!.textContent).toBe("已使用 96%");
  expect(sub.querySelector(".account-window-reset")!.textContent).toBe("6 天後重置");
  expect(sub.querySelector('[data-account="manage"] .mt')!.textContent).toBe("管理用量");
  sub.innerHTML = usageSubmenuHTML({ name: "Codex 每週", used: 5, resetsAt: null });
  expect(sub.querySelector(".account-window-reset")).toBeNull();
});

function mount(read: () => Promise<CliAllowances>, side: "above" | "right" = "above") {
  document.body.innerHTML = '<nav class="sidebar"><button type="button" class="sidebar-account" aria-label="Sam" aria-haspopup="menu" aria-expanded="false"></button></nav>';
  document.querySelector<HTMLElement>(".sidebar")!.getBoundingClientRect = () => ({ left: 0, right: 88, top: 0, bottom: 900, width: 88, height: 900 } as DOMRect);
  const anchor = document.querySelector<HTMLButtonElement>(".sidebar-account")!;
  const go = vi.fn();
  anchor.addEventListener("click", () => openAccountMenu(anchor, { go, allowances: read }, side));
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

test("the number arrives with the reading: 用量 opens a submenu at its edge, and 管理用量 opens the settings' usage", async () => {
  const { anchor, go } = mount(async () => allowances());
  anchor.click(); await flush();
  const row = menu()!.querySelector<HTMLElement>('[data-account="usage"]')!;
  expect(row.getAttribute("aria-haspopup")).toBe("menu");
  expect(row.querySelector(".account-used")!.textContent).toMatch(/^已使用 \d+%$/);
  row.click();
  const sub = document.getElementById("app-submenu")!;
  expect(sub).not.toBeNull();
  expect(menu()!.isConnected).toBe(true);
  expect(sub.querySelector(".account-window-name")!.textContent).toBe("Codex 每週");
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

test("a reading that fails leaves the menu as it was, and one that changes the number corrects the row without closing the menu", async () => {
  let reading: () => Promise<CliAllowances> = async () => { throw new Error("offline"); };
  const { anchor } = mount(() => reading());
  anchor.click(); await flush();
  expect(menu()!.querySelector(".account-used")).toBeNull();
  closeMenu();
  reading = async () => allowances();
  anchor.click(); await flush();
  expect(menu()!.querySelector(".account-used")!.textContent).toBe("已使用 96%");
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
