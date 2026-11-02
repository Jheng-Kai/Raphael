// @vitest-environment happy-dom
// Exercise the real page and member shell; only the native IPC boundary is mocked.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AgentTurn, AppContext, MainEvent, Member } from "../types";

const api = vi.hoisted(() => Object.fromEntries([
  "agentHistoryList", "agentQuestionOpen", "agentAskText", "agentVoice", "agentStop", "cancelSession", "workerCancel",
  "membersList", "membersPresets", "membersRead", "membersViewing", "membersToolChoices", "toolsetsList",
  "routinesList", "modelsCatalog", "providersList", "brainsCli", "core", "roomsList", "statusGet",
].map(name => [name, vi.fn()])));
vi.mock("../api", () => api);
import { Cleared } from "../cleared";
import { createAgent } from "./agent";

const conversations = [
  { id: 1, member_id: 0, is_default: 1, kind: "main", title: "", created_at_ms: 1, updated_at_ms: 1 },
  { id: 2, member_id: 0, is_default: 0, kind: "standard", title: "Project", created_at_ms: 1, updated_at_ms: 1 },
  { id: 4, member_id: 0, is_default: 0, kind: "quick", title: "", created_at_ms: 1, updated_at_ms: 1 },
  { id: 31, member_id: 3, is_default: 1, kind: "main", title: "", created_at_ms: 1, updated_at_ms: 1 },
  { id: 32, member_id: 3, is_default: 0, kind: "standard", title: "Project", created_at_ms: 1, updated_at_ms: 1 },
];
let turns: AgentTurn[];
let emit: (event: MainEvent) => void;
let agent: ReturnType<typeof createAgent>;
const $ = <T extends HTMLElement>(selector: string): T => document.querySelector<T>(selector)!;
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const refresh = async (event: MainEvent = { type: "MembersChanged" }) => { emit(event); await vi.advanceTimersByTimeAsync(400); await flush(); };
const choose = async (member: number, conversation: number) => {
  $(`.mb-col [data-member="${member}"]`).click();
  await flush();
  if ($<HTMLElement>(".mb-det").hidden) $(".conversation-trigger").click();
  await flush();
  $(`[data-conversation-open="${conversation}"]`).click();
  await flush();
};
const live = (more: Partial<AgentTurn> = {}): AgentTurn => ({
  id: 11, session_id: "reply-11", created_at_ms: Date.now(), question: "Please prepare the report", source: "app",
  route: "answer", prefix: "", text: "", detail: null, status: "running", member_id: 0, conversation_id: 1, messages: [], ...more,
});
const expectStop = (state = "running") => {
  expect($(".composer").dataset.taskState).toBe(state);
  expect($(".cmp-voice").getAttribute("aria-label")).toBe("停止");
  expect($(".cmp-voice").querySelector(".av")).toBeNull();
};
const press = () => {
  $(".cmp-voice").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
};
function mount() {
  agent = createAgent({ go: vi.fn(), device: () => ({ dictation_mode: "hold" }), cleared: new Cleared(),
    undo: { begin: vi.fn() }, onEvent(handler: typeof emit) { emit = handler; return () => {}; },
  } as unknown as AppContext);
  document.body.append(agent.el); agent.show();
}

test.each([[0, 1], [0, 2], [3, 31], [3, 32]])("the composer voice press stays in member %s conversation %s through navigation", async (member, conversation) => {
  mount(); await flush(); await choose(member, conversation);
  press(); await flush();
  expect(api.agentVoice.mock.calls).toEqual([["down", member, conversation], ["up", member, conversation]]);
  emit({ type: "Dictation", phase: "listening", agent: true, member_id: member });
  await choose(0, 4);
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: member });
  expect(document.querySelector('[data-key="hearing"]')).toBeNull();
  await choose(member, conversation); expectStop("ack");
  turns = [live({ member_id: member, conversation_id: conversation, source: "voice", status: "done", text: "Report ready" })];
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: member });
  expect(document.querySelector('[data-key="hearing"]')).toBeNull();
  expect(document.body.textContent).toContain("Report ready");
});

beforeEach(() => {
  vi.useFakeTimers(); document.body.innerHTML = ""; localStorage.clear();
  for (const fn of Object.values(api)) fn.mockReset();
  turns = [];
  api.agentQuestionOpen.mockResolvedValue(null);
  api.membersList.mockResolvedValue({ groups: [], members: [0, 3].map(id => ({ id, name: id ? "小晴" : "拉斐爾", role: "", avatar: "", position: id,
    group_id: null, instructions: "", model: "", tools: null, created: 0, unread: false, waiting: false, preview: "", last_at: null } as Member)) });
  api.membersPresets.mockResolvedValue({ presets: [] }); api.membersRead.mockResolvedValue({}); api.membersViewing.mockResolvedValue({});
  api.membersToolChoices.mockResolvedValue({ tools: [], connections: [] }); api.toolsetsList.mockResolvedValue({ groups: [] });
  api.routinesList.mockResolvedValue({ routines: [] }); api.roomsList.mockResolvedValue({ rooms: [] });
  api.brainsCli.mockResolvedValue({ clis: [] }); api.providersList.mockResolvedValue({ providers: [] });
  api.agentVoice.mockResolvedValue(undefined); api.cancelSession.mockResolvedValue(undefined);
  api.core.mockImplementation(async (method: string, params: { member_id?: number } = {}) => method === "conversations.list"
    ? { conversations: conversations.filter(c => c.member_id === params.member_id) } : { questions: [] });
  api.agentHistoryList.mockImplementation(async (q: { member_id?: number; conversation_id?: number }) => ({ turns: turns.filter(turn =>
    turn.member_id === (q.member_id ?? 0) && turn.conversation_id === q.conversation_id) }));
  api.agentStop.mockImplementation(async (session: string) => { turns = turns.map(turn => turn.session_id === session ? { ...turn, status: "denied" } : turn); });
});
afterEach(() => { agent?.hide(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

test.each(["running", "queued", "waiting", "turn"])("a restored %s reply keeps Stop after roster updates", async kind => {
  turns = [live(kind === "turn" ? {} : { status: "done", task: { id: 7, state: kind } as AgentTurn["task"] })];
  mount(); await flush();
  await refresh(); expectStop();
  if (kind !== "turn") {
    api.workerCancel.mockResolvedValue({ cancelled: true }); press(); await flush();
    expect(api.workerCancel).toHaveBeenCalledExactlyOnceWith(7);
  } else {
    press(); await flush(); expect(api.agentStop).toHaveBeenCalledExactlyOnceWith("reply-11", 0);
  }
  expect(api.agentVoice).not.toHaveBeenCalled();
});

test("a typed request remains stoppable before the CLI's first turn and through member refresh", async () => {
  api.agentAskText.mockReturnValue(new Promise(() => {})); mount(); await flush();
  $<HTMLTextAreaElement>(".cmp-input").value = "Please prepare the report";
  $(".composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await refresh(); expectStop("ack"); press(); await flush();
  expect(api.agentStop).toHaveBeenCalledExactlyOnceWith(api.agentAskText.mock.lastCall![3].requestId, 0);
  expect(api.agentVoice).not.toHaveBeenCalled();
});

test("a pending request uses the live work line and keeps its seconds through the running announcement", async () => {
  api.agentAskText.mockReturnValue(new Promise(() => {})); mount(); await flush();
  $<HTMLTextAreaElement>(".cmp-input").value = "Please prepare the report";
  $(".composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  const pending = $(".is-pending .work-section.is-live");
  expect(pending).not.toBeNull();
  expect(pending.textContent).toBe("思考中…· 0 秒");
  expect(pending.querySelectorAll(".think i")).toHaveLength(3);
  expect(pending.querySelector("button, [data-act], .work-chevron, .work-body")).toBeNull();
  expect(document.querySelector(".ans.thinking")).toBeNull();
  await vi.advanceTimersByTimeAsync(3000);
  expect($(".is-pending .work-time").textContent).toBe("· 3 秒");
  turns = [live({ session_id: api.agentAskText.mock.lastCall![3].requestId })];
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
  expect(document.querySelector(".is-pending")).toBeNull();
  expect($('[data-thinking-turn="11"] .work-time').textContent).toBe("· 3 秒");
  await vi.advanceTimersByTimeAsync(1000);
  expect($('[data-thinking-turn="11"] .work-time').textContent).toBe("· 4 秒");
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
  expect($('[data-thinking-turn="11"] .work-time').textContent).toBe("· 5 秒");
});

test("a spoken pending request keeps its clock when its running turn arrives", async () => {
  mount(); await flush(); await choose(0, 4);
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: 0 });
  await vi.advanceTimersByTimeAsync(3000);
  expect($(".is-pending .work-time")?.textContent).toBe("· 3 秒");
  turns = [live({ conversation_id: 4, source: "voice" })];
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
  expect($('[data-thinking-turn="11"] .work-time').textContent).toBe("· 3 秒");
});

test("a finished paced reply keeps its settled work chip without a second waiting style", async () => {
  turns = [live()]; mount(); await flush();
  turns = [live({ status: "done", messages: [
    { seq: 1, kind: "reply", text: "First answer", at_ms: Date.now() },
    { seq: 2, kind: "reply", text: "The next answer is still being revealed", at_ms: Date.now() },
  ] })];
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
  expect(document.body.textContent).not.toContain("The next answer");
  expect(document.querySelector(".ans.thinking, .work-section.is-live")).toBeNull();
  expect($(".work-toggle")?.textContent).toContain("已處理 0 秒");
});

test.each([[0, 4], [3, 31]])("voice processing for member %s is stoppable before any turn is announced", async (member, conversation) => {
  mount(); await flush(); await choose(member, conversation);
  emit({ type: "Dictation", phase: "listening", agent: true, member_id: member });
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: member });
  expectStop("ack"); press(); await flush();
  expect(api.cancelSession).toHaveBeenCalledExactlyOnceWith();
  expect(api.agentStop).not.toHaveBeenCalled(); expect(api.agentVoice).not.toHaveBeenCalled();
});

test("while the owner speaks the one button sends, and Stop appears only once it is sent", async () => {
  mount(); await flush(); await choose(0, 1);
  const button = $<HTMLButtonElement>(".cmp-voice");
  expect($(".composer").dataset.taskState).toBe("idle");
  expect(button.querySelector(".av")).not.toBeNull();
  // The owner presses the microphone; the app says it is listening.
  press(); await flush();
  emit({ type: "Dictation", phase: "listening", agent: true, member_id: 0 });
  // Recording: the same real button, now the send glyph with the send label; no Stop square yet.
  expect($(".composer").dataset.taskState).toBe("recording");
  expect($(".cmp-voice")).toBe(button);
  expect(button.tagName).toBe("BUTTON"); expect(button.type).toBe("button"); expect(button.disabled).toBe(false);
  expect(button.getAttribute("aria-label")).toBe("送出");
  expect(button.dataset.tooltip).toBe("送出"); expect(button.hasAttribute("title")).toBe(false);
  expect(button.querySelector(".cmp-plane")).not.toBeNull(); expect(button.querySelector(".av")).toBeNull();
  expect(button.querySelector('[d*="M6 6"], .i')).toBeNull();
  // Pressing it sends what was said: the question key goes down and up, and nothing is cancelled.
  api.agentVoice.mockClear(); press(); await flush();
  expect(api.agentVoice.mock.calls.map(call => call[0])).toEqual(["down", "up"]);
  expect(api.cancelSession).not.toHaveBeenCalled();
  // Sent: now the same button is Stop, and it stops that.
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: 0 });
  expect($(".cmp-voice")).toBe(button);
  expectStop("ack");
  expect(button.querySelector(".cmp-plane")).toBeNull();
  press(); await flush();
  expect(api.cancelSession).toHaveBeenCalledExactlyOnceWith();
});

test("a quick voice request stays out of formal threads and returns with Stop after navigation", async () => {
  mount(); await flush(); await choose(0, 4);
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: 0 });
  await choose(0, 1);
  expect($(".composer").dataset.taskState).toBe("idle");
  expect(document.querySelector('[data-key="hearing"]')).toBeNull();
  await choose(3, 31); expect($(".composer").dataset.taskState).toBe("idle");
  await choose(0, 4); expectStop("ack");
  // A voice/CLI path may announce only the final turn, after processing began.
  turns = [live({ conversation_id: 4, source: "voice", status: "done", text: "Report ready" })];
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
  expect($(".composer").dataset.taskState).toBe("idle");
});

test("running member and quick turns survive navigation and page reopening without new send events", async () => {
  turns = [live({ conversation_id: 4 }), live({ id: 12, session_id: "member-reply", member_id: 3, conversation_id: 31 })];
  mount(); await flush(); await choose(3, 31); await refresh(); expectStop();
  await choose(0, 1); expect($(".composer").dataset.taskState).toBe("idle");
  await choose(0, 4); agent.hide(); agent.show(); await flush(); await refresh(); expectStop();
  press(); await flush(); expect(api.agentStop).toHaveBeenCalledExactlyOnceWith("reply-11", 0);
  expect(turns.find(turn => turn.id === 12)!.status).toBe("running");
});

test("repeated Stop presses send one cancellation and cannot turn into a voice press", async () => {
  turns = [live()]; mount(); await flush();
  let finish!: () => void;
  api.agentStop.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  press(); await refresh(); press(); await flush();
  expect(api.agentStop).toHaveBeenCalledTimes(1);
  expect($<HTMLButtonElement>(".cmp-voice").disabled).toBe(true);
  expect(api.agentVoice).not.toHaveBeenCalled(); finish(); await flush();
});

test("opening quick after Alt+Space processing does not mistake an older voice turn for its answer", async () => {
  turns = [live({ id: 90, conversation_id: 4, source: "voice", status: "done", created_at_ms: Date.now() - 60_000, text: "Earlier answer" })];
  mount(); await flush();
  emit({ type: "Dictation", phase: "listening", agent: true, member_id: 0 });
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: 0 });
  await choose(0, 4); expectStop("ack");
});

test("typed acknowledgement becomes a running turn, then idle before the native call finishes", async () => {
  let finish!: () => void;
  api.agentAskText.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
  mount(); await flush();
  $<HTMLTextAreaElement>(".cmp-input").value = "Please prepare the report";
  $(".composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  expectStop("ack");
  turns = [live({ session_id: api.agentAskText.mock.lastCall![3].requestId })];
  // AgentService._record(running) precedes progress/final agent.turn and the ask RPC return.
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 }); expectStop();
  turns = [{ ...turns[0], status: "done", text: "Report ready" }];
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
  expect($(".composer").dataset.taskState).toBe("idle"); finish(); await flush();
  expect($(".composer").dataset.taskState).toBe("idle");
});

test.each(["failed", "cancelled", "pasted"] as const)("voice %s releases its pre-turn Stop", async phase => {
  mount(); await flush(); await choose(0, 4);
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: 0 }); expectStop("ack");
  emit({ type: "Dictation", phase, agent: true, member_id: 0 });
  expect($(".composer").dataset.taskState).toBe("idle");
  expect($(".cmp-voice").querySelector('.av')).not.toBeNull();
});

test("a pending request returns only to its original conversation and stops before an older worker", async () => {
  turns = [live({ status: "done", task: { id: 7, state: "running", started_at_ms: 1, finished_at_ms: null } })];
  api.agentAskText.mockReturnValue(new Promise(() => {})); mount(); await flush();
  $<HTMLTextAreaElement>(".cmp-input").value = "A newer reply";
  $(".composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await choose(0, 4); expect($(".composer").dataset.taskState).toBe("idle");
  await choose(3, 31); expect($(".composer").dataset.taskState).toBe("idle");
  await choose(0, 1); expectStop("ack"); press(); await flush();
  expect(api.agentStop).toHaveBeenCalledExactlyOnceWith(api.agentAskText.mock.lastCall![3].requestId, 0);
  expect(api.workerCancel).not.toHaveBeenCalled();
});


test("unchanged history refresh touches no live line, face, composer or scroll", async () => {
  turns = [live({ task: { id: 71, state: "running", started_at_ms: Date.now() - 5000 } as AgentTurn["task"] })];
  mount(); await flush();
  const line = $(".tn"), face = $(".mb-chief .av"), input = $<HTMLTextAreaElement>(".cmp-input");
  input.value = "Draft stays"; input.focus(); input.setSelectionRange(3, 3);
  const dock = $(".ra-dock"), dockChanges = vi.fn();
  const observer = new MutationObserver(dockChanges); observer.observe(dock, { childList: true, subtree: true });
  api.membersViewing.mockClear(); api.routinesList.mockClear();
  await refresh({ type: "WorkerChanged", task_id: 71, state: "running", running: true });
  expect($(".tn")).toBe(line); expect($(".mb-chief .av")).toBe(face);
  expect(input.value).toBe("Draft stays"); expect(input.selectionStart).toBe(3); expect(document.activeElement).toBe(input);
  expect(api.membersViewing).not.toHaveBeenCalled(); expect(api.routinesList).not.toHaveBeenCalled();
  expect(dockChanges).not.toHaveBeenCalled(); observer.disconnect();
});

test("an unchanged history refresh updates the day heading across local midnight", async () => {
  vi.setSystemTime(new Date(2026, 9, 20, 23, 59));
  turns = [live({ status: "done", text: "A settled reply" })];
  mount(); await flush();
  const line = $('.tn[data-id="11"]');
  expect($('.thread .day').textContent).toBe("今天");
  vi.setSystemTime(new Date(2026, 9, 21, 0, 1));
  emit({ type: "WorkerChanged", task_id: 999, state: "running", running: true });
  await vi.advanceTimersByTimeAsync(1100); await flush();
  expect($('.thread .day').textContent).toBe("昨天");
  expect($('.tn[data-id="11"]')).toBe(line);
});

test("unrelated worker refresh is bounded but a loaded handoff stays prompt", async () => {
  turns = [live({ handoffs: [{ task_id: 72, member_id: 3, member_name: "Colleague", state: "running", mode: "work", evidence: [], source_turn_id: 11, work_turn_id: 12, from_member_id: 0, stage_id: "work", reason: null, created_at_ms: 0, ready_at_ms: 0, dispatch_policy: "immediate", result: "" }] as AgentTurn["handoffs"] })]; mount(); await flush();
  api.agentHistoryList.mockClear(); api.membersList.mockClear();
  for (let i = 0; i < 20; i++) { emit({ type: "WorkerChanged", task_id: 999, state: "running", running: true }); await vi.advanceTimersByTimeAsync(200); }
  expect(api.agentHistoryList.mock.calls.length).toBeLessThanOrEqual(4);
  expect(api.membersList.mock.calls.length).toBeLessThanOrEqual(4);
  api.agentHistoryList.mockClear();
  emit({ type: "WorkerChanged", task_id: 72, state: "running", running: true }); await vi.advanceTimersByTimeAsync(160);
  expect(api.agentHistoryList).toHaveBeenCalledTimes(1);
});

test("slow history reads still publish while worker events outrun them", async () => {
  turns = [live()]; mount(); await flush();
  api.agentHistoryList.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ turns: [live({ text: "Progress arrived" })] }), 450)));
  for (let i = 0; i < 12; i++) { emit({ type: "WorkerChanged", task_id: 71, state: "running", running: true }); await vi.advanceTimersByTimeAsync(200); }
  expect(document.body.textContent).toContain("Progress arrived");
});

test("a failed typed send restores the exact draft and clears the failure on successful retry", async () => {
 api.agentAskText.mockRejectedValueOnce(new Error("Synthetic unavailable")).mockResolvedValue(undefined);
 mount(); await flush();
 const input = $<HTMLTextAreaElement>(".cmp-input"); input.value = "Please review the note";
 input.dispatchEvent(new Event("input", {bubbles:true}));
 $(".composer").dispatchEvent(new Event("submit", {bubbles:true,cancelable:true})); await flush();
 expect(input.value).toBe("Please review the note"); expect(document.querySelector(".composer-failure .card-status.is-failed")).not.toBeNull();
 input.dispatchEvent(new Event("input", {bubbles:true}));
 $(".cmp-send").click(); await flush();
 expect(api.agentAskText).toHaveBeenCalledTimes(2); expect(document.querySelector(".composer-failure")).toBeNull();
});
