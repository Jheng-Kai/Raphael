// @vitest-environment happy-dom
// Raphael's one conversation: an empty page begins its guided tour once there is a model to speak with, says so when there
// is none, and the ⋯ of its header clears the conversation (and so begins the tour again).
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({
  statusGet: vi.fn(async () => ({ openrouter: { state: "ok" }, spend: { month_usd: 0, limit_usd: 10 } })), core: vi.fn(), agentHistoryList: vi.fn(),
  membersGreet: vi.fn(async () => ({ turn_id: 1 })), agentQuestionOpen: vi.fn(), agentAskText: vi.fn(), membersList: vi.fn(), membersRead: vi.fn(),
  membersPresets: vi.fn(), membersViewing: vi.fn(), membersToolChoices: vi.fn(), toolsetsList: vi.fn(), routinesList: vi.fn(), modelsCatalog: vi.fn(),
  providersList: vi.fn(), brainsCli: vi.fn(), roomsList: vi.fn(), agentVoice: vi.fn(), agentStop: vi.fn(), cancelSession: vi.fn(), workerCancel: vi.fn(),
}));
vi.mock("../api", () => api);
import { createAgent } from "./agent";
import { Cleared } from "../cleared";
import { closeMenu } from "../ui";
import { setLocale, t } from "../i18n";
import type { AppContext, MainEvent } from "../types";

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.clearAllMocks(); vi.useRealTimers(); setLocale("zh-TW"); });

let handlers: ((event: MainEvent) => void)[] = [];
const emit = (event: MainEvent): void => { for (const handler of handlers) handler(event); };
let model = "openai/gpt-6-luna";
let cleared = 0;

function mount() {
  handlers = [];
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  api.membersList.mockResolvedValue({ members: [], groups: [] });
  api.core.mockImplementation(async (method: string, params?: { id?: number }) =>
    method === "conversations.list" ? { conversations: [{ id: 1, member_id: 0, is_default: 1, title: "", kind: "standard" }] }
      : method === "settings.get" ? { settings: { agent_model: model } }
      : method === "conversations.clear" ? (cleared = params?.id ?? 0, {})
      : method === "background.questions.list" ? { questions: [] } : {});
  const page = createAgent({ go() {}, device: () => ({}), onEvent(handler: (event: MainEvent) => void) { handlers.push(handler); return () => {}; }, undo: { begin() {} }, cleared: new Cleared() } as unknown as AppContext);
  document.body.append(page.el); page.show();
  return page;
}
const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;

test("an empty Raphael page begins the tour by itself, once, and shows no greeting line", async () => {
  model = "openai/gpt-6-luna";
  const page = mount(); await flush();
  expect(api.membersGreet).toHaveBeenCalledExactlyOnceWith(0);
  expect($(".ra-hi").textContent).toBe("拉斐爾");
  expect(document.body.textContent).not.toContain("請下達指示");
  expect($<HTMLElement>(".ra-notice").hidden).toBe(true);
  // Another look at the same empty page asks no second time.
  page.hide(); page.show(); await flush();
  expect(api.membersGreet).toHaveBeenCalledTimes(1);
  page.hide();
});

test("a page with the tour already in it is not greeted again", async () => {
  model = "openai/gpt-6-luna";
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  const page = mount();
  api.agentHistoryList.mockResolvedValue({ turns: [{ id: 5, member_id: 0, conversation_id: 1, session_id: "greeting-0", source: "greeting", route: "greeting", question: "", text: "Welcome.", prefix: "", status: "done", created_at_ms: 1, messages: [] }] });
  await flush();
  expect(api.membersGreet).not.toHaveBeenCalled();
  page.hide();
});

test("with no answer model Raphael cannot speak: the empty page says so with the button that chooses one, and the tour waits for it", async () => {
  model = "";
  const page = mount(); await flush();
  expect(api.membersGreet).not.toHaveBeenCalled();
  const notice = $<HTMLElement>(".ra-notice");
  expect(notice.hidden).toBe(false);
  expect(notice.textContent).toContain(t("models.missing.answer"));
  expect(notice.querySelector('[data-model-missing="answer"]')?.textContent).toBe(t("models.choose"));
  expect($(".ra-hi").textContent).toBe("拉斐爾");
  expect(document.body.textContent).not.toContain("請下達指示");
  const opened = vi.fn();
  $(".cmp-model .mp-trigger").addEventListener("click", opened);
  notice.querySelector<HTMLButtonElement>("[data-model-missing]")!.click();
  expect(opened).toHaveBeenCalledTimes(1);
  // A model chosen (Settings or the picker) starts the tour and takes the notice away.
  model = "openai/gpt-6-luna";
  emit({ type: "SettingsChanged" } as MainEvent);
  await vi.waitFor(() => expect($<HTMLElement>(".ra-notice").hidden).toBe(true));
  expect(api.membersGreet).toHaveBeenCalledExactlyOnceWith(0);
  page.hide();
});

test("Raphael's ⋯ is the one place that clears its conversation: one red item, the red dialog, and the tour begins again", async () => {
  model = "openai/gpt-6-luna";
  vi.useFakeTimers();
  const page = mount(); await flush();
  const more = $<HTMLButtonElement>('[data-act="raphael-more"]');
  expect(more.hidden).toBe(false);
  expect(more.getAttribute("aria-label")).toBe(t("chat.more"));
  expect($<HTMLElement>('[data-act="share-member"]').hidden).toBe(true);
  more.click(); await flush();
  const items = [...document.querySelectorAll<HTMLElement>("#app-popover [data-pick]")];
  expect(items.map(item => [item.dataset.pick, item.textContent, item.classList.contains("danger")])).toEqual([["clear", "清除對話", true]]);
  items[0]!.click(); await flush();
  expect(document.querySelector(".mb-confirm h2")?.textContent).toBe("清除「拉斐爾」的紀錄？");
  expect(cleared).toBe(0);
  document.querySelector<HTMLButtonElement>('[data-dlg="cancel"]')!.click(); await flush();
  expect(cleared).toBe(0);
  more.click(); await flush();
  document.querySelector<HTMLButtonElement>('#app-popover [data-pick="clear"]')!.click(); await flush();
  document.querySelector<HTMLButtonElement>('[data-dlg="delete"]')!.click(); await flush();
  expect(api.core).toHaveBeenCalledWith("conversations.clear", { id: 1 });
  expect(cleared).toBe(1);
  // The core tells every window the conversation changed; the page, empty again, asks for the tour once more.
  emit({ type: "AgentTurn", turn_id: 0, member_id: 0 } as MainEvent);
  await vi.advanceTimersByTimeAsync(400); await flush();
  expect(api.membersGreet).toHaveBeenCalledTimes(2);
  expect(api.membersGreet).toHaveBeenLastCalledWith(0);
  page.hide();
});
