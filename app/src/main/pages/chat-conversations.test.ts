// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ statusGet: vi.fn(async () => ({ openrouter: { state: "ok" }, spend: { month_usd: 0, limit_usd: 10 } })), core: vi.fn(), agentHistoryList: vi.fn(), membersGreet: vi.fn(async () => ({ turn_id: 1 })), agentQuestionOpen: vi.fn(), agentAskText: vi.fn(), membersList: vi.fn(), roomsList: vi.fn(), roomMessages: vi.fn(), membersCommandsList: vi.fn(), membersRead: vi.fn(), roomSend: vi.fn(), desktopStatus: vi.fn(), desktopOpen: vi.fn(), desktopClose: vi.fn() }));
vi.mock("../api", () => api);
import { createAgent } from "./agent";
import { Cleared } from "../cleared";
import { closeMenu } from "../ui";
import { setLocale } from "../i18n";
import type { AppContext, MainEvent } from "../types";
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.clearAllMocks(); vi.useRealTimers(); });

test("the stacked member and conversation title toggles details with one state, and the header holds nothing else", async () => {
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  api.core.mockImplementation(async method => method === "conversations.list" ? { conversations: [{ id: 1, member_id: 0, is_default: 1, title: "Research" }] } : method === "background.questions.list" ? { questions: [] } : {});
  const go = vi.fn();
  const page = createAgent({ go, device: () => ({}), onEvent: () => () => {}, undo: { begin() {} }, cleared: new Cleared() } as unknown as AppContext);
  document.body.append(page.el); page.show(); await flush();
  const title = page.el.querySelector<HTMLButtonElement>(".conversation-trigger")!;
  expect(title.querySelector(".mb-pill-t")?.textContent).toBe("拉斐爾");
  expect(title.querySelector(".conversation-caption")).toBeNull();
  expect(title.querySelector("button")).toBeNull();
  expect(page.el.querySelector(".conversation-head")?.textContent).not.toContain(" / ");
  // Share sits at the right of the header: Raphael is the app's own and is never shared as a template, and nothing takes its place.
  expect([...page.el.querySelector('.mb-head .ra-tools')!.children].map(tool => (tool as HTMLElement).dataset.act)).toEqual(["share-member"]);
  expect(page.el.querySelector<HTMLElement>('[data-act="share-member"]')!.hidden).toBe(true);
  expect(page.el.querySelector('.desktop-panel')?.closest('.mb-det')).not.toBeNull();
  expect(page.el.querySelector('[data-act="clear"]')).toBeNull();
  expect(title.hasAttribute("aria-haspopup")).toBe(false);
  // The header pill's only icon is the chevron shown on hover.
  expect([...title.querySelectorAll(".i")].every(icon => icon.closest(".mb-pill-go"))).toBe(true);
  const initial = title.getAttribute("aria-expanded") === "true";
  title.click(); await flush();
  expect(title.getAttribute("aria-expanded")).toBe(String(!initial));
  if (initial) { title.click(); await flush(); }
  expect(page.el.querySelector<HTMLElement>(".mb-det")!.hidden).toBe(false);
  expect(document.querySelector("#app-popover")).toBeNull();
  page.el.querySelector<HTMLButtonElement>('[data-det="close"]')!.click(); await flush();
  expect(title.getAttribute("aria-expanded")).toBe("false");
  page.hide(); page.show(); await flush();
  expect(title.getAttribute("aria-expanded")).toBe("false");
  title.click(); await flush();
  expect(title.getAttribute("aria-expanded")).toBe("true");
  page.hide();
});

test("quota notices stay immediately above the composer and disappear at reset", async () => {
  vi.useFakeTimers(); setLocale("zh-TW");
  vi.setSystemTime(new Date("2026-10-24T14:06:00+08:00"));
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  api.core.mockImplementation(async method => method === "conversations.list" ? { conversations: [{ id: 1, member_id: 0, is_default: 1, title: "Main" }] } :
    method === "quota.list" ? { quotas: [{ provider: "codex", reset_at_ms: Date.now() + 1000 }] } :
    method === "background.questions.list" ? { questions: [] } : {});
  const page = createAgent({ go() {}, device: () => ({}), onEvent: () => () => {}, undo: { begin() {} }, cleared: new Cleared() } as unknown as AppContext);
  document.body.append(page.el); page.show(); await flush();
  const notice = page.el.querySelector<HTMLElement>(".quota-chips")!;
  expect(notice.nextElementSibling).toBe(page.el.querySelector(".composer"));
  expect(notice.textContent).toBe("Codex 額度已滿，下午 2:06 重設");
  expect(notice.hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(notice.hidden).toBe(true);
  expect(notice.textContent).toBe("");
  page.hide();
});

test("an answer's history is scoped to its conversation, quoted whole and sent with its ID, and its menu has reactions, Reply and Copy", async () => {
  api.agentQuestionOpen.mockResolvedValue(null);
  const conversations = [{ id: 1, member_id: 0, title: "Main", is_default: 1, kind: "standard" }];
  api.core.mockImplementation(async method => method === "conversations.list" ? { conversations } : method === "background.questions.list" ? { questions: [] } : {});
  api.agentHistoryList.mockImplementation(async ({ conversation_id }) => ({ turns: [{ id: conversation_id, conversation_id, member_id: 0, question: "Explain", text: "**Entire** answer\n\nSecond paragraph.", prefix: "", created_at_ms: 1000, status: "done", route: "answer", source: "app", detail: null }] }));
  const page = createAgent({ go() {}, device: () => ({}), onEvent: () => () => {}, undo: { begin() {} }, cleared: new Cleared() } as unknown as AppContext);
  document.body.append(page.el); page.show(); await flush();
  expect(api.agentHistoryList).toHaveBeenLastCalledWith(expect.objectContaining({ conversation_id: 1 }));
  page.el.querySelector<HTMLButtonElement>('.ra [data-act="reply-message"]')!.click();
  expect(page.el.querySelector(".cmp-quote .quote-text")?.textContent).toBe("Entire answer\nSecond paragraph.");
  const input = page.el.querySelector<HTMLTextAreaElement>(".cmp-input")!; input.value = "Continue"; input.dispatchEvent(new Event("input"));
  page.el.querySelector(".composer")!.dispatchEvent(new Event("submit", { cancelable: true })); await flush();
  expect(api.agentAskText).toHaveBeenCalledWith("Continue", [], 0, expect.objectContaining({ conversationId: 1, quote: expect.objectContaining({ text: "Entire answer\nSecond paragraph." }) }));
  page.el.querySelector<HTMLButtonElement>('.ra [data-act="more-message"]')!.click(); await flush();
  expect([...document.querySelectorAll<HTMLElement>('#app-popover [data-pick]')].map(item => item.dataset.pick)).toEqual(["reply", "copy", "regenerate"]);
  expect([...document.querySelectorAll<HTMLElement>('#app-popover .menu-reactions [data-lead]')].map(item => item.dataset.lead)).toEqual(["👍", "😂", "👎", "❤️", "🎉", "+"]);
  document.querySelector<HTMLButtonElement>('#app-popover [data-lead="👍"]')!.click(); await flush();
  expect(api.core).toHaveBeenCalledWith("agent.react", { member_id: 0, conversation_id: 1, turn_id: 1, message_key: "reply", emoji: "👍", active: true });
  page.el.querySelector<HTMLButtonElement>('.ra [data-act="more-message"]')!.click(); await flush();
  document.querySelector<HTMLButtonElement>('#app-popover [data-lead="+"]')!.click();
  expect(document.querySelector("#app-popover.emoji-picker")).not.toBeNull();
  // The picker reads its emoji on first use: that takes more than the default second on a busy machine.
  await vi.waitFor(() => expect(document.querySelector('#app-popover .emoji-cell[data-emoji="🚀"]')).not.toBeNull(), { timeout: 10_000 });
  document.querySelector<HTMLButtonElement>('#app-popover .emoji-cell[data-emoji="🚀"]')!.click(); await flush();
  expect(api.core).toHaveBeenCalledWith("agent.react", { member_id: 0, conversation_id: 1, turn_id: 1, message_key: "reply", emoji: "🚀", active: true });
  expect(api.core).not.toHaveBeenCalledWith("agent.speak", expect.anything());
  page.el.querySelector<HTMLButtonElement>('.owner-message [data-act="more-message"]')!.click(); await flush();
  // The owner's own message adds Edit, which no longer stands beside the bubble (R-UI-104).
  expect([...document.querySelectorAll<HTMLElement>('#app-popover [data-pick]')].map(item => item.dataset.pick)).toEqual(["reply", "copy", "edit"]);
  expect(document.querySelector('#app-popover .menu-reactions')).toBeNull();
  page.hide();
}, 30_000);

test("a question typed in Raphael's conversation names its conversation and never a destination: the quick ask is the key's", async () => {
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  api.agentAskText.mockResolvedValue(undefined);
  const conversations = [{ id: 1, member_id: 0, title: "Main", is_default: 1, kind: "standard" }];
  api.core.mockImplementation(async method => method === "conversations.list" ? { conversations } : method === "background.questions.list" ? { questions: [] } : {});
  const page = createAgent({ go() {}, device: () => ({}), onEvent: () => () => {}, undo: { begin() {} }, cleared: new Cleared() } as unknown as AppContext);
  document.body.append(page.el); page.show(); await flush();
  const ask = async (text: string) => {
    const input = page.el.querySelector<HTMLTextAreaElement>(".cmp-input")!; input.value = text; input.dispatchEvent(new Event("input"));
    page.el.querySelector(".composer")!.dispatchEvent(new Event("submit", { cancelable: true })); await flush();
  };
  await ask("First question");
  expect(api.agentAskText).toHaveBeenLastCalledWith("First question", [], 0, expect.objectContaining({ conversationId: 1 }));
  await ask("Follow-up");
  expect(api.agentAskText).toHaveBeenLastCalledWith("Follow-up", [], 0, expect.objectContaining({ conversationId: 1 }));
  expect(api.agentAskText.mock.lastCall![3]).not.toHaveProperty("destination");
  page.hide();
});

test("a question card belongs to Raphael's one conversation: another conversation's card is not shown there", async () => {
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  const conversations = [{ id: 1, member_id: 0, title: "Main", is_default: 1, kind: "standard" }];
  api.core.mockImplementation(async method => method === "conversations.list" ? { conversations } : method === "background.questions.list" ? { questions: [] } : {});
  let emit: (event: MainEvent) => void = () => {};
  const page = createAgent({ go() {}, device: () => ({}), onEvent(handler: typeof emit) { emit = handler; return () => {}; }, undo: { begin() {} }, cleared: new Cleared() } as unknown as AppContext);
  document.body.append(page.el); page.show(); await flush();
  emit({ type: "AgentQuestion", id: "q-9", member_id: 0, conversation_id: 9, text: "儲存摘要 9？", prefix: "問", tier: "T2", timeout_ms: 60_000 });
  expect(page.el.querySelector<HTMLElement>(".ask-card-host")!.hidden).toBe(true);
  emit({ type: "AgentQuestion", id: "q-1", member_id: 0, conversation_id: 1, text: "儲存摘要 1？", prefix: "問", tier: "T2", timeout_ms: 60_000 });
  expect(page.el.querySelector<HTMLElement>(".ask-card-host")!.dataset.id).toBe("q-1");
  emit({ type: "AgentQuestionClosed", id: "q-1" });
  expect(page.el.querySelector<HTMLElement>(".ask-card-host")!.hidden).toBe(true);
  page.hide();
});

test("rooms close the private desktop lease, hide the member picker and keep replies outside private conversations", async () => {
  vi.useFakeTimers();
  api.desktopStatus.mockResolvedValue({ state: "running", ready: true, control: "member" });
  api.desktopOpen.mockResolvedValue({ session: "navigation", url: "http://127.0.0.1:5000/navigation/vnc.html" });
  api.desktopClose.mockResolvedValue({});
  const people = { members: [{ id: 0, name: "Raphael", avatar: "", role: "", instructions: "", group_id: null }], groups: [] };
  const conversations = [{ id: 1, member_id: 0, title: "Main", is_default: 1 }, { id: 2, member_id: 0, title: "Research" }];
  api.membersList.mockResolvedValue(people);
  api.membersRead.mockResolvedValue({});
  api.membersCommandsList.mockResolvedValue({ commands: [] });
  api.roomsList.mockResolvedValue({ rooms: [{ id: 7, name: "Planning room", member_ids: [0] }] });
  api.roomMessages.mockResolvedValue({ messages: [{ id: 9, member_id: 0, text: "Room answer", created: 1000, turn_id: 2 }] });
  api.agentQuestionOpen.mockResolvedValue(null);
  api.core.mockImplementation(async method => method === "conversations.list" ? { conversations } : method === "background.questions.list" ? { questions: [] } : {});
  api.agentHistoryList.mockImplementation(async params => ({ turns: params.before_id || params.conversation_id === 2
    ? [{ id: 2, member_id: 0, conversation_id: 2, question: "Research", text: "Named answer", status: "done", created_at_ms: 1000, source: "app", route: "answer", prefix: "" }] : [] }));
  const page = createAgent({ go() {}, device: () => ({}), onEvent: () => () => {}, undo: { begin() {} }, cleared: new Cleared() } as unknown as AppContext);
  document.body.append(page.el); page.show(); await flush();
  if (page.el.querySelector('.conversation-trigger')!.getAttribute('aria-expanded') !== 'true') page.el.querySelector<HTMLButtonElement>('.conversation-trigger')!.click();
  await flush();
  page.el.querySelector<HTMLButtonElement>('#member-tab-computer')!.click(); await flush();
  await vi.waitFor(() => expect(page.el.querySelector('.desktop-panel iframe')).not.toBeNull(), { timeout: 5000, interval: 100 });
  window.dispatchEvent(new CustomEvent("raphael:open-room", { detail: { roomId: 7 } })); await flush();
  expect(page.el.querySelector('.desktop-panel iframe')).toBeNull();
  expect(api.desktopClose).toHaveBeenCalledWith("navigation");
  expect(page.el.querySelector<HTMLElement>(".mb-chat:not(.au-room-pane)")!.hidden).toBe(true);
  expect(page.el.querySelector<HTMLElement>(".au-room-pane")!.hidden).toBe(false);
  expect(page.el.querySelector(".au-room-pane .conversation-trigger")).toBeNull();
  expect(page.el.querySelector(".au-room-pane [data-act='reply-message']")).toBeNull();
  expect(page.el.querySelector('[data-room-act="turn"]')).toBeNull();
  expect(page.el.querySelector<HTMLElement>(".au-room-pane")!.hidden).toBe(false);
  page.hide();
});
