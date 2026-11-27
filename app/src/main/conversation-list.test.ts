// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const core = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ core }));
import { clearConversation, newestConversation, relativeTime, type ConversationInfo } from "./conversation-list";
import { closeMenu } from "./ui";

afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.clearAllMocks(); });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test("a window opens the member's one conversation, or the newest where a database still holds more", () => {
  const rows = [{ id: 3, updated_at_ms: 100 }, { id: 1, is_default: 1, updated_at_ms: 10 }] as ConversationInfo[];
  expect(newestConversation(rows)?.id).toBe(3);
  expect(newestConversation([rows[1]!])?.id).toBe(1);
  expect(newestConversation([{ id: 5, updated_at_ms: 7 }, { id: 4, is_default: 1, updated_at_ms: 7 }] as ConversationInfo[])?.id).toBe(4);
  expect(newestConversation([])).toBeUndefined();
  expect(rows.map(row => row.id)).toEqual([3, 1]);
});

test("times read as just now, minutes, hours and days", () => {
  const now = Date.UTC(2026, 10, 27, 12);
  expect(relativeTime(now - 10_000, now)).toBe("剛剛");
  expect(relativeTime(now - 5 * 60_000, now)).toBe("5 分鐘前");
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 小時前");
  expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2 天前");
});

test("a conversation is cleared only after the shared red confirmation, and every window of the member reads it again", async () => {
  core.mockResolvedValue({});
  const changed = vi.fn();
  window.addEventListener("conversations-changed", changed);
  try {
    const cleared = clearConversation(0, 9, "拉斐爾");
    await flush();
    expect(document.querySelector(".mb-confirm h2")?.textContent).toBe("清除「拉斐爾」的紀錄？");
    expect(document.querySelector('[data-dlg="delete"]')?.textContent).toBe("清除對話");
    expect(core).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-dlg="delete"]')!.click();
    expect(await cleared).toBe(true);
    expect(core).toHaveBeenCalledExactlyOnceWith("conversations.clear", { id: 9 });
    expect(core).not.toHaveBeenCalledWith("conversations.delete", expect.anything());
    expect((changed.mock.calls[0]![0] as CustomEvent<number>).detail).toBe(0);
  } finally { window.removeEventListener("conversations-changed", changed); }
});

test("no to the confirmation clears nothing and tells nobody", async () => {
  const changed = vi.fn();
  window.addEventListener("conversations-changed", changed);
  try {
    const cleared = clearConversation(0, 9, "拉斐爾");
    await flush();
    document.querySelector<HTMLButtonElement>('[data-dlg="cancel"]')!.click();
    expect(await cleared).toBe(false);
    expect(core).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  } finally { window.removeEventListener("conversations-changed", changed); }
});
