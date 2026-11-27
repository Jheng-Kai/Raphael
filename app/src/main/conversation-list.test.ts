// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { newestConversation, relativeTime, type ConversationInfo } from "./conversation-list";
import { closeMenu } from "./ui";

afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.clearAllMocks(); });

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
