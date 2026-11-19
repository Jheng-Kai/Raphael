// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({ core: vi.fn() }));
vi.mock("./api", () => api);
const open = vi.hoisted(() => ({ room: vi.fn(), member: vi.fn() }));
vi.mock("./group-chats", () => ({ openGroupChat: open.room }));
vi.mock("./team-navigation", () => ({ openMemberThread: open.member }));
import { setLocale } from "./i18n";
import { mountQuestionReminder } from "./question-reminder";
import type { AppContext, MainEvent } from "./types";

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
let events: ((event: MainEvent) => void)[] = [];
const moved = async (): Promise<void> => {
  vi.useFakeTimers();
  events.forEach(handler => handler({ type: "WorkerChanged", task_id: 1, state: "waiting", running: true }));
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  await flush();
};
const waiting = (...items: object[]): void => { api.core.mockResolvedValue({ waiting: items }); };
const memberFace = vi.fn((id: number, size: number) => `<span class="av" data-member-face="${id}" data-face-size="${size}" aria-hidden="true"></span>`);
const toasts = (): Element[] => [...document.querySelectorAll(".toast")];

beforeEach(async () => {
  document.body.innerHTML = "";
  events = [];
  vi.clearAllMocks();
  setLocale("zh-TW");
  waiting();
  mountQuestionReminder({ onEvent: (handler: (event: MainEvent) => void) => events.push(handler) } as unknown as AppContext, memberFace);
  await flush();
});

test("says once who waits, with a way there, unless it is on screen", async () => {
  waiting({ id: "a", member_id: 3, member_name: "小森", room_id: 7 });
  await moved();
  expect(toasts()).toHaveLength(1);
  expect(toasts()[0].textContent).toContain("小森 等你回答");
  await moved();
  expect(toasts()).toHaveLength(1);
  const buttons = toasts()[0].querySelectorAll<HTMLButtonElement>("button");
  expect(buttons).toHaveLength(1);
  expect(buttons[0].getAttribute("aria-label")).toBe("小森 等你回答");
  expect(buttons[0].querySelector('[data-member-face="3"][data-face-size="22"]')).not.toBeNull();
  expect(buttons[0].lastElementChild?.matches("svg[aria-hidden=true]")).toBe(true);
  expect(buttons[0].dataset.questionRoom).toBe("7");
  buttons[0].click();
  expect(open.room).toHaveBeenCalledWith(7);
  expect(toasts()).toHaveLength(0);
});

test("a member's question opens that member", async () => {
  waiting({ id: "b", member_id: 3, member_name: "小森", room_id: null });
  await moved();
  toasts()[0].querySelector<HTMLElement>("[data-question-member]")!.click();
  expect(open.member).toHaveBeenCalledWith(expect.anything(), 3);
});

test("what was waiting when the app opened is in the sidebar, not a toast", async () => {
  document.body.innerHTML = "";
  events = [];
  waiting({ id: "old", member_id: 3, member_name: "小森", room_id: null });
  mountQuestionReminder({ onEvent: (handler: (event: MainEvent) => void) => events.push(handler) } as unknown as AppContext, memberFace);
  await flush();
  expect(toasts()).toHaveLength(0);
});
