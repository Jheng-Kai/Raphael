// @vitest-environment happy-dom
// Exercise the real page and member shell; only the native IPC boundary is mocked.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AgentTurn, AppContext, MainEvent, Member, TurnMessage } from "../types";

const api = vi.hoisted(() => Object.fromEntries([
  "agentHistoryList", "agentQuestionOpen", "agentAskText", "agentVoice", "agentVoiceComposed", "agentStop", "agentSendNow", "cancelSession", "workerCancel",
  "membersList", "membersPresets", "membersRead", "membersViewing", "membersToolChoices", "toolsetsList",
  "routinesList", "modelsCatalog", "providersList", "brainsCli", "core", "roomsList", "statusGet",
  "membersGreet",
].map(name => [name, vi.fn()])));
vi.mock("../api", () => api);
import { Cleared } from "../cleared";
import { createAgent } from "./agent";

const conversations = [
  { id: 1, member_id: 0, is_default: 1, kind: "main", title: "", created_at_ms: 1, updated_at_ms: 1 },
  { id: 4, member_id: 0, is_default: 0, kind: "quick", title: "", created_at_ms: 1, updated_at_ms: 1 },
  { id: 31, member_id: 3, is_default: 1, kind: "main", title: "", created_at_ms: 1, updated_at_ms: 1 },
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
  // A member has one conversation; only Raphael's panel switches between his and the quick questions.
  if (member !== 0) return;
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
const pointer = (button: HTMLElement, type: string) => {
  button.setPointerCapture = vi.fn();
  button.dispatchEvent(new PointerEvent(type, { button: 0, pointerId: 7, bubbles: true }));
};
const pointerClick = (button: HTMLElement) => button.dispatchEvent(new MouseEvent("click", { detail: 1, bubbles: true }));
function mount(mode: "hold" | "toggle" = "hold") {
  agent = createAgent({ go: vi.fn(), device: () => ({ dictation_mode: mode }), cleared: new Cleared(),
    undo: { begin: vi.fn() }, onEvent(handler: typeof emit) { emit = handler; return () => {}; },
  } as unknown as AppContext);
  document.body.append(agent.el); agent.show();
}

test("while work runs the field sends message after message and stops nothing", async () => {
  turns = [live()];
  mount(); await flush();
  expectStop();
  const input = $<HTMLTextAreaElement>(".cmp-input");
  for (const words of ["First addition", "Second addition", "Third addition"]) {
    input.value = words;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(false);
    $(".cmp-send").click();
    await flush();
    expect(input.value).toBe("");
    expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(true);
  }
  expect(api.agentAskText.mock.calls.map(call => call[0])).toEqual(["First addition", "Second addition", "Third addition"]);
  expect(api.agentStop).not.toHaveBeenCalled();
  expectStop();
});

test.each([[0, 1], [3, 31]])("the composer voice press stays in member %s conversation %s through navigation", async (member, conversation) => {
  mount(); await flush(); await choose(member, conversation);
  const button = $(".cmp-voice");
  pointer(button, "pointerdown");
  await vi.advanceTimersByTimeAsync(300); await flush();
  expect(api.agentVoice.mock.calls).toEqual([["down", member, conversation]]);
  emit({ type: "Dictation", phase: "listening", agent: true, member_id: member });
  await choose(0, 4);
  pointer(button, "pointerup"); pointerClick(button); await flush();
  expect(api.agentVoice.mock.calls).toEqual([["down", member, conversation], ["up", member, conversation]]);
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: member });
  expect(document.querySelector('[data-key="hearing"]')).toBeNull();
  await choose(member, conversation); expectStop("ack");
  turns = [live({ member_id: member, conversation_id: conversation, source: "voice", status: "done", text: "Report ready" })];
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: member });
  expect(document.querySelector('[data-key="hearing"]')).toBeNull();
  expect(document.body.textContent).toContain("Report ready");
});

test("a member's voice button records a voice message on a click, a hold and a key", async () => {
  mount(); await flush(); await choose(3, 31);
  const button = $(".cmp-voice");
  pointer(button, "pointerdown");
  expect(api.agentVoice.mock.calls).toEqual([["down", 3, 31]]);
  pointer(button, "pointerup"); pointerClick(button); await flush();
  pointer(button, "pointerdown"); await vi.advanceTimersByTimeAsync(600);
  pointer(button, "pointerup"); pointerClick(button); await flush();
  button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await flush();
  document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true })); await flush();
  expect(api.agentVoice.mock.calls).toEqual([["down", 3, 31], ["up", 3, 31], ["down", 3, 31], ["up", 3, 31], ["down", 3, 31], ["up", 3, 31]]);
});

const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
/** The composer holding a picture and the owner's words, as the plus button and the keyboard leave it. */
const compose = async (words: string) => {
  const picker = $<HTMLInputElement>(".cmp-picker");
  Object.defineProperty(picker, "files", { value: [new File([PICTURE], "photo.png", { type: "image/png" })], configurable: true });
  picker.dispatchEvent(new Event("change")); await flush();
  const field = $<HTMLTextAreaElement>(".cmp-input"); field.value = words; field.dispatchEvent(new Event("input", { bubbles: true }));
};
const PHOTO = { name: "photo.png", mime: "image/png", data: expect.any(String) };
/** The voice button held and let go in a conversation: the recording is heard in between. */
const holdAndRelease = async (member: number) => {
  const button = $(".cmp-voice");
  pointer(button, "pointerdown"); await vi.advanceTimersByTimeAsync(300); await flush();
  emit({ type: "Dictation", phase: "listening", agent: true, member_id: member });
  pointer(button, "pointerup"); pointerClick(button); await flush();
};

test.each([[0, 4], [3, 31]])("the voice button sends the composer's words and picture with the recording (member %s, conversation %s)", async (member, conversation) => {
  mount(); await flush(); await choose(member, conversation);
  await compose("Look at this");
  await holdAndRelease(member);
  expect(api.agentVoiceComposed).toHaveBeenCalledExactlyOnceWith("Look at this", [PHOTO], member, conversation, undefined);
  const up = api.agentVoice.mock.calls.findIndex(call => call[0] === "up");
  expect(up).toBeGreaterThan(0);
  expect(api.agentVoiceComposed.mock.invocationCallOrder[0]).toBeLessThan(api.agentVoice.mock.invocationCallOrder[up]!);
  expect($<HTMLTextAreaElement>(".cmp-input").value).toBe("");
  expect(document.querySelector(".cmp-file .cmp-chip")).toBeNull();
});

test("in toggle mode the second press hands the composer over once, before the key's two edges", async () => {
  mount("toggle"); await flush(); await choose(3, 31);
  await compose("");
  const button = $(".cmp-voice");
  pointer(button, "pointerdown"); pointer(button, "pointerup"); pointerClick(button); await flush();
  expect(api.agentVoiceComposed).not.toHaveBeenCalled();
  emit({ type: "Dictation", phase: "listening", agent: true, member_id: 3 });
  api.agentVoice.mockClear();
  pointer(button, "pointerdown"); pointer(button, "pointerup"); pointerClick(button); await flush();
  expect(api.agentVoiceComposed).toHaveBeenCalledExactlyOnceWith("", [PHOTO], 3, 31, undefined);
  expect(api.agentVoice.mock.calls).toEqual([["down", 3, 31], ["up", 3, 31]]);
  expect(api.agentVoiceComposed.mock.invocationCallOrder[0]).toBeLessThan(api.agentVoice.mock.invocationCallOrder[0]!);
  expect(document.querySelector(".cmp-file .cmp-chip")).toBeNull();
});

test("the composer's own send while recording ends the recording with the picture, and sends no second message", async () => {
  mount("toggle"); await flush(); await choose(3, 31);
  await compose("Look at this");
  const button = $(".cmp-voice");
  pointer(button, "pointerdown"); pointer(button, "pointerup"); pointerClick(button); await flush();
  emit({ type: "Dictation", phase: "listening", agent: true, member_id: 3 });
  api.agentVoice.mockClear();
  $<HTMLTextAreaElement>(".cmp-input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); await flush();
  expect(api.agentVoiceComposed).toHaveBeenCalledExactlyOnceWith("Look at this", [PHOTO], 3, 31, undefined);
  expect(api.agentVoice.mock.calls).toEqual([["down", 3, 31], ["up", 3, 31]]);
  expect(api.agentAskText).not.toHaveBeenCalled();
  expect($<HTMLTextAreaElement>(".cmp-input").value).toBe("");
  expect(document.querySelector(".cmp-file .cmp-chip")).toBeNull();
});

test("an empty composer sends the voice edges at once, with nothing handed over", async () => {
  mount(); await flush(); await choose(3, 31);
  const button = $(".cmp-voice");
  pointer(button, "pointerdown"); await vi.advanceTimersByTimeAsync(300); await flush();
  emit({ type: "Dictation", phase: "listening", agent: true, member_id: 3 });
  pointer(button, "pointerup"); pointerClick(button);
  expect(api.agentVoice.mock.calls).toEqual([["down", 3, 31], ["up", 3, 31]]);
  expect(api.agentVoiceComposed).not.toHaveBeenCalled();
});

test("a recording that does not take the composer leaves it as it was", async () => {
  api.agentVoiceComposed.mockResolvedValue(false);
  mount(); await flush(); await choose(3, 31);
  await compose("Keep me");
  await holdAndRelease(3);
  expect($<HTMLTextAreaElement>(".cmp-input").value).toBe("Keep me");
  expect(document.querySelector(".cmp-file .cmp-chip")).not.toBeNull();
  expect(api.agentVoice.mock.calls[api.agentVoice.mock.calls.length - 1]).toEqual(["up", 3, 31]);
});

test.each(["cancelled", "failed"] as const)("a voice message that is %s gives the composer its words and picture back", async phase => {
  mount(); await flush(); await choose(3, 31);
  await compose("Look at this");
  await holdAndRelease(3);
  expect($<HTMLTextAreaElement>(".cmp-input").value).toBe("");
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: 3 });
  emit({ type: "Dictation", phase, agent: true, member_id: 3 });
  expect($<HTMLTextAreaElement>(".cmp-input").value).toBe("Look at this");
  expect(document.querySelector(".cmp-file .cmp-chip")).not.toBeNull();
});

test("a voice message that reached the history is not given back by a later cancel", async () => {
  mount(); await flush(); await choose(3, 31);
  await compose("Look at this");
  await holdAndRelease(3);
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: 3 });
  emit({ type: "AgentTurn", turn_id: 11, member_id: 3 });
  emit({ type: "Dictation", phase: "cancelled", agent: true, member_id: 3 });
  expect($<HTMLTextAreaElement>(".cmp-input").value).toBe("");
  expect(document.querySelector(".cmp-file .cmp-chip")).toBeNull();
});

test.each(["pointercancel", "lostpointercapture"])("%s ends a member's voice message once", async event => {
  mount(); await flush(); await choose(3, 31);
  const button = $(".cmp-voice"); pointer(button, "pointerdown");
  pointer(button, event); pointer(button, "pointerup"); pointerClick(button); await flush();
  expect(api.agentVoice.mock.calls).toEqual([["down", 3, 31], ["up", 3, 31]]);
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
  api.routinesList.mockResolvedValue({ routines: [] }); api.roomsList.mockResolvedValue({ rooms: [] }); api.membersGreet.mockResolvedValue({ turn_id: 1 });
  api.brainsCli.mockResolvedValue({ clis: [] }); api.providersList.mockResolvedValue({ providers: [] });
  api.agentVoice.mockResolvedValue(undefined); api.agentVoiceComposed.mockResolvedValue(true); api.cancelSession.mockResolvedValue(undefined);
  api.core.mockImplementation(async (method: string, params: { member_id?: number } = {}) => method === "conversations.list"
    ? { conversations: conversations.filter(c => c.member_id === params.member_id) } : { questions: [] });
  api.agentHistoryList.mockImplementation(async (q: { member_id?: number; conversation_id?: number }) => ({ turns: turns.filter(turn =>
    turn.member_id === (q.member_id ?? 0) && turn.conversation_id === q.conversation_id) }));
  api.agentStop.mockImplementation(async (session: string) => { turns = turns.map(turn => turn.session_id === session ? { ...turn, status: "denied" } : turn); });
});
afterEach(() => { agent?.hide(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

test("Stop targets the running turn and appends every queued draft after current words", async () => {
 turns=[live(),live({id:12,session_id:"queued-b",status:"queued",question:"Second"}),live({id:13,session_id:"queued-c",status:"queued",question:"Third"})];
 api.agentStop.mockResolvedValue({stopped:true,returned:[{session_id:"queued-b",text:"Second",attachments:[{id:"stored-example",name:"example.txt",mime:"text/plain",size:7}]},{session_id:"queued-c",text:"Third",attachments:[]}]});
 const originalCore = api.core.getMockImplementation()!;
 api.core.mockImplementation((method,params) => method === "attachments.get" ? Promise.resolve({mime:"text/plain",data:"ZXhhbXBsZQ=="}) : originalCore(method,params));
 mount();await flush();
 const field=$<HTMLTextAreaElement>(".cmp-input");field.value="Already typed";field.dispatchEvent(new Event("input"));
 press();await flush();
 expect(api.agentStop).toHaveBeenCalledWith("reply-11",0);
 expect(field.value).toBe("Already typed\n\nSecond\n\nThird");
 expect(document.querySelector('.cmp-file')?.textContent).toContain("example.txt");
 expect(api.core).toHaveBeenCalledWith("attachments.get", {id:"stored-example"});
});

test("a queued message shows 立即送出 in sight beside 排隊中, not in its menu, and sends it by turn, while a running one has none", async () => {
 turns=[live({question:"Original request"}),live({id:12,session_id:"queued-b",status:"queued",question:"Second",text:"",messages:[]})];
 api.agentSendNow.mockImplementation(async (session: string) => {
   turns = turns.map(turn => turn.session_id === "reply-11" ? { ...turn, status: "denied" } : turn.session_id === session ? { ...turn, status: "running" } : turn);
   return { sent: true, stopped: true };
 });
 mount();await flush();
 const menu=async (id:number)=>{ $(`.tn[data-id="${id}"] [data-act="more-message"]`).click(); await flush(); return [...document.querySelectorAll<HTMLElement>("#app-popover [data-pick]")].map(item=>item.dataset.pick); };
 const button=$('.tn[data-id="12"] .message-actions [data-act="send-now"]');
 expect(button.textContent).toContain("立即送出");
 expect(button.previousElementSibling?.classList.contains("queued-mark")).toBe(true);
 const queued=await menu(12);
 expect(queued).toEqual(expect.arrayContaining(["copy","cancel"]));
 expect(queued).not.toContain("send-now");
 document.body.click();await flush();
 button.click();await flush();
 expect(api.agentSendNow).toHaveBeenCalledTimes(1);
 expect(api.agentSendNow).toHaveBeenCalledWith("queued-b",0,12);
 expect(api.agentStop).not.toHaveBeenCalled();
 expect(api.core).not.toHaveBeenCalledWith("agent.history.retract",expect.anything());
 // The running message has no send now: nothing waits there.
 expect(document.querySelector('.tn[data-id="11"] [data-act="send-now"]')).toBeNull();
});

test("a single live presence stays below additions without changing on an unchanged refresh", async () => {
 turns=[live(),live({id:12,session_id:"queued-b",status:"queued",question:"Second",text:"",messages:[]}),live({id:13,session_id:"steered-c",status:"done",route:"owner_input",question:"Third",text:"",messages:[]})];
 mount();await flush();
 expect(document.querySelectorAll(".thread .live-presence")).toHaveLength(1);
 const presence=$(".thread .live-presence");
 const lines=[...document.querySelectorAll(".thread > li")];
 expect(lines[lines.length-1]?.contains(presence)).toBe(true);
 await refresh({type:"AgentTurn",turn_id:12,member_id:0});
 expect($(".thread .live-presence")).toBe(presence);
});

test("a message sent while the work runs stands where it was sent and the reply that answers it follows", async () => {
 const start = Date.now();
 const said = (seq: number, kind: TurnMessage["kind"], text: string, after: number): TurnMessage => ({ seq, kind, text, at_ms: start + after });
 const before = [said(1, "progress", "Laying out the poster", 1000), said(2, "reply", "A first layout is ready.", 2000)];
 const file = said(3, "media", JSON.stringify({ attachment: { id: `${"a".repeat(32)}.txt`, name: "poster-notes.txt", mime: "text/plain", size: 7 } }), 6000);
 const addition = live({ id: 12, session_id: "steered-12", route: "owner_input", status: "done", question: "Generate a picture instead", text: "", created_at_ms: start + 3000 });
 const thread = () => $(".thread").textContent ?? "";
 const inOrder = (...words: string[]) => {
  const at = words.map(word => thread().indexOf(word));
  expect(at.every(index => index >= 0), `${words.join(" < ")} in ${thread()}`).toBe(true);
  expect(at, words.join(" < ")).toEqual([...at].sort((a, b) => a - b));
 };
 turns = [live({ question: "Make a poster for the open day", messages: before }), addition];
 mount(); await flush();
 inOrder("Make a poster for the open day", "A first layout is ready.", "Generate a picture instead");
 // The work goes on after reading the message: what it makes now comes under the message, not above it.
 turns = [live({ question: "Make a poster for the open day", messages: [...before, file] }), addition];
 await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
 inOrder("Make a poster for the open day", "A first layout is ready.", "Generate a picture instead", "poster-notes.txt");
 expect(document.querySelectorAll(".thread .live-presence")).toHaveLength(1);
 // Finished, the reply answers the message above it: the owner's words are not left last and unanswered.
 const reply = "Made as a generated picture, as you asked.";
 turns = [live({ question: "Make a poster for the open day", status: "done", text: reply, messages: [...before, file, said(4, "reply", reply, 9000)] }), addition];
 await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
 await vi.advanceTimersByTimeAsync(5000); await flush();
 inOrder("Make a poster for the open day", "A first layout is ready.", "Generate a picture instead", "poster-notes.txt", reply);
 const last = [...document.querySelectorAll(".thread > li")].pop()!;
 expect(last.querySelector(".owner-message")).toBeNull();
 expect(last.textContent).toContain(reply);
 // The owner's message keeps its own line and actions, and the question its own.
 expect($('.tn[data-id="12"] .owner-message').textContent).toContain("Generate a picture instead");
 expect(document.querySelectorAll('.thread .owner-message')).toHaveLength(2);
 expect(thread().split(reply)).toHaveLength(2);
});

test("messages before the first announcement share one presence below the newest bubble", async () => {
 api.agentAskText.mockReturnValue(new Promise(() => {}));
 mount(); await flush();
 const field = $<HTMLTextAreaElement>(".cmp-input");
 for (const text of ["First pending request", "Second pending request"]) {
  field.value=text; field.dispatchEvent(new Event("input"));
  $(".composer").dispatchEvent(new Event("submit", {bubbles:true,cancelable:true}));
 }
 expect(document.querySelectorAll(".thread .live-presence")).toHaveLength(1);
 expect($(".thread > li:last-child").contains($(".thread .live-presence"))).toBe(true);
});

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

test("a pending request keeps one live avatar through the running announcement without clock writes", async () => {
  api.agentAskText.mockReturnValue(new Promise(() => {})); mount(); await flush();
  $<HTMLTextAreaElement>(".cmp-input").value = "Please prepare the report";
  $(".composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  const pending = $(".is-pending .live-presence");
  expect(pending).not.toBeNull();
  expect(pending.querySelector("button, [data-act], .work-time, .think")).toBeNull();
  await vi.advanceTimersByTimeAsync(3000);
  expect($(".is-pending .live-presence")).toBe(pending);
  turns = [live({ session_id: api.agentAskText.mock.lastCall![3].requestId })];
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
  expect(document.querySelector(".is-pending")).toBeNull();
  const running = $('[data-id="11"] .live-presence');
  await vi.advanceTimersByTimeAsync(1000);
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
  expect($('[data-id="11"] .live-presence')).toBe(running);
  expect(document.querySelector(".work-time")).toBeNull();
});

test("a spoken pending request becomes one live avatar when its running turn arrives", async () => {
  mount(); await flush(); await choose(0, 4);
  emit({ type: "Dictation", phase: "processing", agent: true, member_id: 0 });
  await vi.advanceTimersByTimeAsync(3000);
  expect($(".is-pending .live-presence")).not.toBeNull();
  turns = [live({ conversation_id: 4, source: "voice" })];
  await refresh({ type: "AgentTurn", turn_id: 11, member_id: 0 });
  expect($('[data-id="11"] .live-presence')).not.toBeNull();
  expect(document.querySelector(".work-time")).toBeNull();
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
  expect($(".work-toggle")).toBeNull();
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

test("Stop follows the running worker in its conversation before a newer submission", async () => {
  turns = [live({ status: "done", task: { id: 7, state: "running", started_at_ms: 1, finished_at_ms: null } })];
  api.agentAskText.mockReturnValue(new Promise(() => {})); mount(); await flush();
  $<HTMLTextAreaElement>(".cmp-input").value = "A newer reply";
  $(".composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await choose(0, 4); expect($(".composer").dataset.taskState).toBe("idle");
  await choose(3, 31); expect($(".composer").dataset.taskState).toBe("idle");
  await choose(0, 1); expectStop("running"); press(); await flush();
  expect(api.agentStop).toHaveBeenCalledExactlyOnceWith("reply-11", 0);
  expect(api.workerCancel).toHaveBeenCalledExactlyOnceWith(7);
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
 expect(input.value).toBe("Please review the note"); expect(document.querySelector(".composer-failure [data-card-retry]")).not.toBeNull();
 // Said once: the title names the message, its status says it was not sent, no sentence repeats it; the words are back in the field.
 const failed = $(".composer-failure");
 expect(failed.getAttribute("role")).toBe("alert"); expect(failed.querySelector(".card-title")!.textContent).toBe("你的訊息");
 expect(failed.querySelector(".card-status.is-failed")!.textContent).toBe("未能傳送"); expect(failed.querySelector(".card-failure p")).toBeNull();
 input.dispatchEvent(new Event("input", {bubbles:true}));
 $(".cmp-send").click(); await flush();
 expect(api.agentAskText).toHaveBeenCalledTimes(2); expect(document.querySelector(".composer-failure")).toBeNull();
});

// One member shows at most one working slime in its conversation (owner, 2026-11-14, R-SLIME-03).
const presences = () => [...document.querySelectorAll<HTMLElement>(".thread .live-presence")];
const at = (id: number, more: Partial<AgentTurn> = {}) => live({ id, session_id: `slime-${id}`, created_at_ms: 1_000_000 + id * 1000, question: `Request ${id}`, ...more });
const task = (id: number, more: Partial<NonNullable<AgentTurn["task"]>> = {}) => ({ id, state: "running", started_at_ms: 1, finished_at_ms: null, ...more }) as AgentTurn["task"];
const reply = (text: string) => [{ seq: 1, kind: "reply" as const, text, at_ms: 1_000_000 }];

test("a reply that handed work to the background shows one slime, on the task line", async () => {
  turns = [at(21, { status: "done", text: "Queued in the background", messages: reply("Queued in the background"), task: task(7, { progress: "Starting the research" }) })];
  mount(); await flush();
  expect(presences()).toHaveLength(1);
  expect(presences()[0]!.closest("li")?.dataset.id).toBe("21");
  expect(presences()[0]!.querySelector(".live-action")?.textContent).toBe("Starting the research");
});

test("a turn that is running without a task shows one slime", async () => {
  turns = [at(22)];
  mount(); await flush();
  expect(presences()).toHaveLength(1);
  expect(presences()[0]!.closest("li")?.dataset.id).toBe("22");
});

test("two background tasks of one member show one slime, on the newest", async () => {
  turns = [at(23, { status: "done", text: "First", messages: reply("First"), task: task(8, { progress: "The older task" }) }),
    at(24, { status: "done", text: "Second", messages: reply("Second"), task: task(9, { progress: "The newer task" }) })];
  mount(); await flush();
  expect(presences()).toHaveLength(1);
  expect(presences()[0]!.closest("li")?.dataset.id).toBe("24");
  expect(presences()[0]!.querySelector(".live-action")?.textContent).toBe("The newer task");
  // A refresh that changes nothing keeps that very slime.
  const stands = presences()[0]!;
  await refresh({ type: "AgentTurn", turn_id: 24, member_id: 0 });
  expect(presences()).toHaveLength(1);
  expect(presences()[0]).toBe(stands);
});

test("a task line with words wins over a face that only waits, as in the owner's picture", async () => {
  turns = [at(25, { status: "done", text: "Queued in the background", messages: reply("Queued in the background"), task: task(10, { state: "waiting", waiting_owner: 1 }) }),
    at(26, { status: "done", text: "", messages: [], task: task(11, { progress: "Checking the sandbox" }) })];
  mount(); await flush();
  expect(presences()).toHaveLength(1);
  expect(presences()[0]!.closest("li")?.dataset.id).toBe("26");
  expect(presences()[0]!.querySelector(".live-action")?.textContent).toBe("Checking the sandbox");
  // Once the working task is over, the waiting turn's own face comes back: it is the only one left.
  turns = [turns[0]!, { ...turns[1]!, task: task(11, { state: "done", finished_at_ms: 2 }) }];
  await refresh({ type: "AgentTurn", turn_id: 26, member_id: 0 });
  expect(presences()).toHaveLength(1);
  expect(presences()[0]!.closest("li")?.dataset.id).toBe("25");
});

test("a message just sent takes the one slime from a task that waits", async () => {
  turns = [at(27, { status: "done", text: "Waiting", messages: reply("Waiting"), task: task(12, { state: "waiting", waiting_owner: 1 }) })];
  api.agentAskText.mockReturnValue(new Promise(() => {}));
  mount(); await flush();
  expect(presences()).toHaveLength(1);
  $<HTMLTextAreaElement>(".cmp-input").value = "One more thing";
  $(".composer").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await flush();
  expect(presences()).toHaveLength(1);
  expect($(".thread > li:last-child").contains(presences()[0]!)).toBe(true);
});
