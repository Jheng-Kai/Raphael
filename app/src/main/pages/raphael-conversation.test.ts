// @vitest-environment happy-dom
// Raphael's one conversation: an empty one is the ordinary layout (the thread, empty, and the composer in the dock), begins its
// guided tour once there is a model to speak with, says so in one line above the composer when there is none, says so when the
// thread could not be read, and its header has no ⋯: no screen of its own for nothing yet (R-UI-183).
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
import type { AgentTurn, AppContext, MainEvent } from "../types";

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
afterEach(() => { closeMenu(); document.body.replaceChildren(); vi.clearAllMocks(); vi.useRealTimers(); setLocale("zh-TW"); });

let handlers: ((event: MainEvent) => void)[] = [];
const emit = (event: MainEvent): void => { for (const handler of handlers) handler(event); };
let model = "openai/gpt-6-luna";

function mount(cleared = new Cleared()) {
  handlers = [];
  api.agentQuestionOpen.mockResolvedValue(null);
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  api.membersList.mockResolvedValue({ members: [], groups: [] });
  api.core.mockImplementation(async (method: string) =>
    method === "conversations.list" ? { conversations: [{ id: 1, member_id: 0, is_default: 1, title: "", kind: "standard" }] }
      : method === "settings.get" ? { settings: { agent_model: model } }
      : method === "background.questions.list" ? { questions: [] } : {});
  const page = createAgent({ go() {}, device: () => ({}), onEvent(handler: (event: MainEvent) => void) { handlers.push(handler); return () => {}; }, undo: { begin() {} }, cleared } as unknown as AppContext);
  document.body.append(page.el); page.show();
  return page;
}
const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const answered = (id: number): AgentTurn => ({ id, member_id: 0, conversation_id: 1, session_id: `s-${id}`, source: "app", route: "answer", question: `Question ${id}`, text: `Answer ${id}`, prefix: "", status: "done", created_at_ms: id, messages: [] }) as unknown as AgentTurn;

/** An empty conversation is the ordinary layout: no screen of its own, the thread (empty) and the composer where it always is. */
function expectOrdinaryLayout(): void {
  expect(document.querySelector(".ra-empty, .ra-hero, .ra-hi, .ra-slot, .ra-notice")).toBeNull();
  expect($(".ra-scroll").hidden).toBe(false);
  expect($(".ra-dock").hidden).toBe(false);
  expect($(".ra-dock").contains($(".composer"))).toBe(true);
  expect($(".composer").hidden).toBe(false);
  expect($(".ra-scroll .thread").children).toHaveLength(0);
}

test("an empty Raphael conversation is the ordinary layout and begins the tour by itself, once", async () => {
  model = "openai/gpt-6-luna";
  const page = mount(); await flush();
  expect(api.membersGreet).toHaveBeenCalledExactlyOnceWith(0);
  expectOrdinaryLayout();
  expect(document.body.textContent).not.toContain("請下達指示");
  expect(document.querySelector(".model-chips")).toBeNull();
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

test("with no answer model Raphael cannot speak: one line above the composer says so with the button that chooses one, and the tour waits for it", async () => {
  model = "";
  const page = mount(); await flush();
  expect(api.membersGreet).not.toHaveBeenCalled();
  expectOrdinaryLayout();
  const line = $<HTMLElement>(".ra-dock > .model-chips");
  // Just above the composer, in the dock, like the quota and sign-in lines.
  expect(line.compareDocumentPosition($(".composer")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([...$(".ra-dock").children].filter(child => !(child as HTMLElement).hidden && !child.classList.contains("ra-bgq")).map(child => child.className)).toEqual(["model-chips", "composer"]);
  expect(line.textContent).toContain(t("models.missing.answer"));
  expect(line.querySelector('[data-model-missing="answer"]')?.textContent).toBe(t("models.choose"));
  expect(document.body.textContent).not.toContain("請下達指示");
  const opened = vi.fn();
  $(".cmp-model .mp-trigger").addEventListener("click", opened);
  line.querySelector<HTMLButtonElement>("[data-model-missing]")!.click();
  expect(opened).toHaveBeenCalledTimes(1);
  // A model chosen (Settings or the picker) starts the tour and takes the line away.
  model = "openai/gpt-6-luna";
  emit({ type: "SettingsChanged" } as MainEvent);
  await vi.waitFor(() => expect(document.querySelector(".model-chips")).toBeNull());
  expect(api.membersGreet).toHaveBeenCalledExactlyOnceWith(0);
  expectOrdinaryLayout();
  page.hide();
});

test("a conversation with words in it never shows the no-model line", async () => {
  model = "";
  api.agentHistoryList.mockResolvedValue({ turns: [answered(5)] });
  const page = mount();
  api.agentHistoryList.mockResolvedValue({ turns: [answered(5)] });
  await flush();
  expect(document.querySelector(".model-chips")).toBeNull();
  expect($(".thread").textContent).toContain("Answer 5");
  page.hide();
});

test("a thread that could not be read says so in one quiet line of the thread, with the composer where it always is", async () => {
  model = "openai/gpt-6-luna";
  const page = mount(); await flush();
  api.agentHistoryList.mockRejectedValue(new Error("core is starting"));
  page.hide(); page.show(); await flush();
  const line = $<HTMLElement>(".ra-scroll .ra-none");
  expect(line.hidden).toBe(false);
  expect(line.textContent).toContain(t("agent.loadFailed"));
  expectOrdinaryLayout();
  // Read again, the line goes.
  api.agentHistoryList.mockResolvedValue({ turns: [answered(5)] });
  page.hide(); page.show(); await flush();
  expect($<HTMLElement>(".ra-none").hidden).toBe(true);
  expect($(".thread").textContent).toContain("Answer 5");
  page.hide();
});

test("Raphael's header has no ⋯ and no way to clear its conversation: its right slot holds only the hidden share button", async () => {
  model = "openai/gpt-6-luna";
  const page = mount(); await flush();
  expect(document.querySelector('[data-act="raphael-more"]')).toBeNull();
  expect([...$(".mb-head .ra-tools").children].map(tool => (tool as HTMLElement).dataset.act)).toEqual(["share-member"]);
  expect($<HTMLElement>('[data-act="share-member"]').hidden).toBe(true);
  expect(document.body.textContent).not.toContain("清除對話");
  page.hide();
});

test("messages deleted until the conversation is empty leave the ordinary layout, and the tour begins again, once", async () => {
  model = "openai/gpt-6-luna";
  vi.useFakeTimers();
  let rows = [answered(6), answered(5)];
  const page = mount();
  api.agentHistoryList.mockImplementation(async (query: { after_id?: number; turn_ids?: number[] }) => query.after_id === undefined ? { turns: rows }
    : { turns: rows.filter(row => row.id > query.after_id!), delta: true, removed_ids: (query.turn_ids ?? []).filter(id => !rows.some(row => row.id === id)), next_after_id: query.after_id });
  page.hide(); page.show(); await flush();
  expect($(".thread").textContent).toContain("Answer 6");
  expect(api.membersGreet).not.toHaveBeenCalled();
  // One message goes: the other stays, nothing is asked.
  rows = [answered(6)];
  emit({ type: "AgentTurn", turn_id: 5, member_id: 0 } as MainEvent);
  await vi.advanceTimersByTimeAsync(600); await flush();
  expect($(".thread").textContent).not.toContain("Answer 5");
  expect($(".thread").textContent).toContain("Answer 6");
  expect(api.membersGreet).not.toHaveBeenCalled();
  // The last one goes: the page is the empty ordinary layout, and Raphael starts again instead of leaving a blank page.
  rows = [];
  emit({ type: "AgentTurn", turn_id: 6, member_id: 0 } as MainEvent);
  await vi.advanceTimersByTimeAsync(600); await flush();
  expectOrdinaryLayout();
  expect(api.membersGreet).toHaveBeenCalledExactlyOnceWith(0);
  // A refresh of the still empty page does not ask again.
  emit({ type: "AgentTurn", turn_id: 0, member_id: 0 } as MainEvent);
  await vi.advanceTimersByTimeAsync(600); await flush();
  expect(api.membersGreet).toHaveBeenCalledTimes(1);
  page.hide();
});

test("a conversation emptied by Settings › data is the ordinary layout and begins the tour again", async () => {
  model = "openai/gpt-6-luna";
  const cleared = new Cleared();
  const page = mount(cleared);
  api.agentHistoryList.mockResolvedValue({ turns: [answered(5)] });
  page.hide(); page.show(); await flush();
  expect($(".thread").textContent).toContain("Answer 5");
  expect(api.membersGreet).not.toHaveBeenCalled();
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  cleared.say("conversation"); await flush();
  expectOrdinaryLayout();
  expect(api.membersGreet).toHaveBeenCalledExactlyOnceWith(0);
  page.hide();
});
