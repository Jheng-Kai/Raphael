// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const core = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ core }));
import { mountConversationList, newestConversation, type ConversationInfo } from "./conversation-list";
import { closeMenu } from "./ui";
import { installContextMenus } from "./context-menu";

afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.clearAllMocks(); });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const RAPHAEL = [
  { id: 2, member_id: 0, title: "Project", is_default: 1, kind: "standard", updated_at_ms: Date.now() },
  { id: 9, member_id: 0, title: "", kind: "quick", updated_at_ms: 1 },
];

test("a window opens the one conversation, and the quick one only when nothing else is there", () => {
  const rows = [{id:3,kind:'quick',updated_at_ms:100},{id:1,kind:'standard',is_default:1,updated_at_ms:10}] as ConversationInfo[];
  expect(newestConversation(rows)?.id).toBe(1);
  expect(newestConversation([rows[0]!])?.id).toBe(3);
  expect(newestConversation([])).toBeUndefined();
  expect(rows.map(row=>row.id)).toEqual([3,1]);
});

test("Raphael's panel has two rows, his conversation and quick questions, with no search, new or rename", async () => {
  core.mockResolvedValue({ conversations: RAPHAEL });
  const host = document.createElement("div"); document.body.append(host);
  const onOpen = vi.fn();
  let current = 2;
  const list = mountConversationList(host, { memberId: 0, onOpen, current: () => current }); await flush();
  const rows = [...host.querySelectorAll<HTMLButtonElement>("[data-conversation-open]")];
  expect(rows.map(row => [row.dataset.conversationOpen, row.querySelector("span")!.textContent, row.getAttribute("aria-current")]))
    .toEqual([["2", "主要對話", "true"], ["9", "快速提問", "false"]]);
  expect(host.querySelector("input, [data-conversation-new]")).toBeNull();
  expect(rows[0]!.closest(".conversation-row")!.querySelector("[data-conversation-more]")).toBeNull();
  rows[1]!.click(); expect(onOpen).toHaveBeenCalledWith(9);
  current = 9; window.dispatchEvent(new CustomEvent("conversation-opened", { detail: 0 }));
  expect(host.querySelector('[data-conversation-open="9"]')!.getAttribute("aria-current")).toBe("true");
  list.destroy();
});

test("quick history clears only after the shared confirmation and keeps its row; right click offers the same", async () => {
  core.mockResolvedValue({ conversations: RAPHAEL });
  const host = document.createElement("div"); document.body.append(host);
  const list = mountConversationList(host, { memberId: 0, onOpen() {} }); await flush();
  const stop = installContextMenus(document);
  try {
    const quick = host.querySelector('[data-conversation-open="9"]')!;
    quick.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 2, clientX: 10, clientY: 10 }));
    quick.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 10, clientY: 10 }));
    expect([...document.querySelectorAll<HTMLElement>("#app-popover [data-pick]")].map(item => item.dataset.pick)).toEqual(["clear"]);
    closeMenu();
    host.querySelector<HTMLButtonElement>('[data-conversation-more="9"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-pick="clear"]')!.click();
    expect(document.querySelector(".mb-confirm h2")?.textContent).toBe("清除「快速提問」的紀錄？");
    expect(core).not.toHaveBeenCalledWith("conversations.clear", expect.anything());
    document.querySelector<HTMLButtonElement>('[data-dlg="delete"]')!.click(); await flush();
    expect(core).toHaveBeenCalledWith("conversations.clear", { id: 9 });
    expect(core).not.toHaveBeenCalledWith("conversations.delete", expect.anything());
    expect(host.querySelector('[data-conversation-open="9"]')).not.toBeNull();
  } finally { stop(); list.destroy(); }
});
