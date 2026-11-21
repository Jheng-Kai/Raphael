// @vitest-environment happy-dom
// Taking a sent message back into the composer to edit it (R-UI-158): every kind of message crossed with every state the composer can be
// in when 編輯 is chosen, and every way the edit can end. Whatever the composer held before comes back, nothing the owner wrote is lost,
// and the thread shows the message exactly once. The real page and member shell run; only the native IPC boundary is faked, and the core's
// own handling of an edit (the message replaced by the edit, with its id) is played by `core`. Since R-UI-163 the composer takes the owner's
// last message while its member is still thinking about it and has sent no bubble for it (`asked`); an answered one is edited in its bubble.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentTurn, AppContext, MainEvent, Member, MembersList } from "../types";

const api = vi.hoisted(() => ({
  statusGet: vi.fn(async () => ({ openrouter: { state: "ok" }, spend: { month_usd: 0, limit_usd: 10 } })),
  agentHistoryList: vi.fn(), agentHistoryClear: vi.fn(), agentHistorySearch: vi.fn(), agentAskText: vi.fn(), agentRetract: vi.fn(),
  agentQuestionOpen: vi.fn(), agentQuestionAnswer: vi.fn(), agentVoice: vi.fn(), agentVoiceComposed: vi.fn(), agentStop: vi.fn(), agentSendNow: vi.fn(),
  cancelSession: vi.fn(), workerCancel: vi.fn(), workerRerun: vi.fn(),
  membersList: vi.fn(), membersRead: vi.fn(), membersViewing: vi.fn(), membersToolChoices: vi.fn(), membersSkillsList: vi.fn(), membersCommandsList: vi.fn(),
  membersUpdate: vi.fn(), groupsUpdate: vi.fn(), membersCreate: vi.fn(), membersGreet: vi.fn(async () => ({ turn_id: 99 })), membersDelete: vi.fn(),
  settingsGet: vi.fn(async () => ({ settings: { computer_ssh_alias: "" } })), membersSetAvatar: vi.fn(), routinesCreate: vi.fn(),
  toolsetsList: vi.fn(), routinesList: vi.fn(), modelsCatalog: vi.fn(), providersList: vi.fn(), brainsCli: vi.fn(), core: vi.fn(),
  roomsList: vi.fn(), roomMessages: vi.fn(), desktopStatus: vi.fn(), desktopOpen: vi.fn(), desktopRenew: vi.fn(), desktopClose: vi.fn(),
}));
vi.mock("../api", () => api);

import { Cleared } from "../cleared";
import { createAgent } from "./agent";
import { messageActionsHTML } from "../timeline";
import { closeMenu } from "../ui";

const member = (id: number, more: Partial<Member> = {}): Member => ({
  id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
});
const LIST: MembersList = { members: [member(0, { name: "拉斐爾" }), member(3, { name: "日文老師" }), member(4, { name: "行程管家" })], groups: [] };
const turn = (id: number, more: Partial<AgentTurn> = {}): AgentTurn => ({
  id, created_at_ms: Date.parse("2026-10-20T10:00:00+08:00") + id * 1000, question: `問題 ${id}`, route: "chat",
  prefix: "答", text: `回答 ${id}`, detail: null, status: "done", source: "app", member_id: 3, session_id: `s${id}`, ...more,
});
/** The owner's message its member is still thinking about, with no bubble for it yet: the one 編輯 takes into the composer. */
const asked = (id: number, more: Partial<AgentTurn> = {}): AgentTurn => turn(id, { status: "running", text: "", ...more });

/** The thread of member 3, newest first, as the core keeps it; an edit writes into it as the core does (the replaced message's id). */
let rows: AgentTurn[] = [];
let send: (event: MainEvent) => void = () => {};
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); for (let i = 0; i < 30; i++) await Promise.resolve(); };
const $ = <T extends HTMLElement>(q: string): T => document.querySelector<T>(q)!;
const box = (): HTMLTextAreaElement => $<HTMLTextAreaElement>(".cmp-input");
const typeInto = (words: string): void => { box().value = words; box().dispatchEvent(new Event("input", { bubbles: true })); };
const press = (key: string, more: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more });
  box().dispatchEvent(event);
  return event;
};
const pickMessage = (scope: string, pick: "edit" | "cancel"): void => { $(`${scope} [data-act="more-message"]`).click(); $(`#app-popover [data-pick="${pick}"]`).click(); };
const editMessage = async (id: number): Promise<void> => { pickMessage(`[data-id="${id}"]`, "edit"); await flush(); };
const pickMember = async (id: number): Promise<void> => { $(`.mb-col [data-member="${id}"]`).click(); await flush(); };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const addFile = async (name = "mine.png"): Promise<void> => {
  const picker = $<HTMLInputElement>(".cmp-picker");
  Object.defineProperty(picker, "files", { value: [new File([PNG], name, { type: "image/png" })], configurable: true });
  picker.dispatchEvent(new Event("change"));
  await flush();
};
const chips = (): string[] => [...document.querySelectorAll(".composer .cmp-file .cmp-chip")].map(chip => chip.querySelector(".cmp-chip-t")?.textContent ?? chip.querySelector(".cmp-pic")?.getAttribute("aria-label") ?? "");
const composerNow = () => ({ text: box().value, chips: chips(), replacing: $(".composer").hasAttribute("data-replacing"), quote: document.querySelector(".cmp-quote .quote-text")?.textContent ?? null });
/** How many owner bubbles of the thread say these words (a message the thread draws twice shows here). */
const shown = (words: string): number => [...document.querySelectorAll(".thread .owner-message .message-text")].filter(node => node.textContent!.trim() === words).length;
const lines = (id: number): number => document.querySelectorAll(`.thread .tn[data-id="${id}"]`).length;

const id = (n: number, ext: string): string => `${String(n).repeat(32).slice(0, 32)}.${ext}`;
const MIMES: Record<string, string> = { png: "image/png", csv: "text/csv" };
interface Kind { name: string; turn: Partial<AgentTurn>; files: string[]; quote?: string }
const KINDS: Kind[] = [
  { name: "text only", turn: { question: "just words" }, files: [] },
  { name: "one picture", turn: { question: "one pic", attachments: [{ id: id(1, "png"), name: "a.png", mime: "image/png", size: 6 }] }, files: ["a.png"] },
  { name: "several pictures", turn: { question: "three pics", attachments: [1, 2, 3].map(n => ({ id: id(n, "png"), name: `p${n}.png`, mime: "image/png", size: 6 })) }, files: ["p1.png", "p2.png", "p3.png"] },
  { name: "a file", turn: { question: "a sheet", attachments: [{ id: id(4, "csv"), name: "r.csv", mime: "text/csv", size: 6 }] }, files: ["r.csv"] },
  { name: "pictures only", turn: { question: "", attachments: [{ id: id(1, "png"), name: "a.png", mime: "image/png", size: 6 }] }, files: ["a.png"] },
  { name: "a quote", turn: { question: "with a quote", quote: { text: "Saved passage", author: "You" } }, files: [], quote: "Saved passage" },
  { name: "a mention", turn: { question: "@成員4 請看這個" }, files: [] },
  { name: "a skill", turn: { question: "/日文 練習 N2" }, files: [] },
  { name: "a voice note", turn: { question: "口述的問題", source: "voice" }, files: [] },
];

function mount(initial: AgentTurn[]) {
  rows = initial;
  const app = { go: vi.fn(), device: () => ({ dictation_mode: "hold" }), onEvent(handler: (event: MainEvent) => void) { send = handler; return () => {}; }, undo: { begin: vi.fn() }, cleared: new Cleared() } as unknown as AppContext;
  const agent = createAgent(app);
  document.body.append(agent.el);
  agent.el.hidden = false;
  agent.show();
  return agent;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  for (const fn of Object.values(api)) fn.mockReset();
  api.roomsList.mockResolvedValue({ rooms: [] }); api.roomMessages.mockResolvedValue({ messages: [] });
  api.brainsCli.mockResolvedValue({ clis: [] }); api.providersList.mockResolvedValue({ providers: [] });
  api.agentQuestionOpen.mockResolvedValue(null);
  api.membersList.mockResolvedValue(structuredClone(LIST));
  api.membersRead.mockResolvedValue({}); api.membersViewing.mockResolvedValue({});
  api.membersToolChoices.mockResolvedValue({ tools: [], connections: [] });
  api.membersSkillsList.mockResolvedValue({ skills: [] }); api.membersCommandsList.mockResolvedValue({ commands: [] });
  api.toolsetsList.mockResolvedValue({ groups: [] }); api.routinesList.mockResolvedValue({ routines: [] }); api.modelsCatalog.mockResolvedValue(null);
  api.agentRetract.mockResolvedValue(undefined); api.agentVoice.mockResolvedValue(undefined); api.cancelSession.mockResolvedValue(undefined);
  api.agentStop.mockResolvedValue(undefined); api.workerCancel.mockResolvedValue({ cancelled: true });
  api.agentHistoryList.mockImplementation(async (query: { member_id?: number; limit?: number }) => ({ turns: (query.member_id === 3 ? rows : []).slice(0, query.limit ?? 50) }));
  api.core.mockImplementation(async (method: string, params?: { id?: string; member_id?: number }) => {
    if (method === "attachments.get") return { mime: MIMES[params!.id!.split(".")[1]!] ?? "application/octet-stream", data: btoa("bytes") };
    if (method === "conversations.list") return { conversations: [{ id: 80 + (params?.member_id ?? 0), member_id: params?.member_id ?? 0, is_default: 1, kind: "standard", title: "", created_at_ms: 1, updated_at_ms: 1 }] };
    return { questions: [] };
  });
  // The core's edit: the replaced message goes and the edit takes its id and its place, written with the request's id.
  api.agentAskText.mockImplementation(async (text: string, files: { name: string; mime: string }[], _member: number, options: { requestId: string; replaceTurnId?: number }) => {
    if (options.replaceTurnId === undefined) { rows = [turn(rows.length ? Math.max(...rows.map(item => item.id)) + 1 : 1, { question: text, session_id: options.requestId, text: "" }), ...rows]; return; }
    rows = rows.map(item => item.id === options.replaceTurnId ? { ...item, question: text, session_id: options.requestId, attachments: files.map(file => ({ name: file.name, mime: file.mime })) } : item);
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const ENDINGS = ["sent", "Escape", "Escape twice after a change", "another conversation and back", "new turns from the core"] as const;
type Ending = typeof ENDINGS[number];

async function finish(ending: Ending, target: number, extra: { words: string }): Promise<void> {
  if (ending === "sent") { typeInto(extra.words); press("Enter"); await flush(); }
  else if (ending === "Escape") { press("Escape"); await flush(); }
  else if (ending === "Escape twice after a change") { typeInto(`${box().value} changed`); press("Escape"); await flush(); press("Escape"); await flush(); }
  else if (ending === "another conversation and back") { await pickMember(4); await pickMember(3); }
  else {
    rows = [turn(target + 100, { text: "a routine turn", source: "routine", route: "routine", prefix: "", question: "每天" }), ...rows];
    send({ type: "AgentTurn", turn_id: target + 100, member_id: 3 });
    await new Promise(resolve => setTimeout(resolve, 450)); await flush();
    // The edit is still there after the page drew the new turns; it is then given up the plain way.
    expect(composerNow().replacing).toBe(true);
    expect(lines(target)).toBe(1);
    expect(document.querySelectorAll(`.thread .tn[data-id="${target}"] .owner-message`)).toHaveLength(0);
    press("Escape"); await flush();
  }
}

test("the key card's × retracts its own turn and restores the draft", async () => {
  const agent = mount([turn(8, { status: "confirm", question: "Run the script", secrets: [{
    id: "key-8", name: "SAMPLE_API_KEY", secret: "SAMPLE_API_KEY", key: true, state: "pending", error: null, expires_at_ms: 0, resumed: false,
  }] })]);
  await flush(); await pickMember(3);
  api.agentRetract.mockImplementation(async (session: string) => { rows = rows.filter(item => item.session_id !== session); });
  const card = $('.tn[data-id="8"] .key-card');
  expect(card).not.toBeNull();
  expect(document.querySelector('.tn[data-id="8"] [data-owner-act="cancel"]')).toBeNull();
  const cancel = card.querySelector<HTMLButtonElement>('.card-head > [data-act="cancel-secret-turn"]')!;
  expect(cancel.getAttribute("aria-label")).toBe("取消");
  cancel.click(); await flush();
  expect(api.agentRetract).toHaveBeenCalledExactlyOnceWith("s8", 3, 8);
  expect(document.querySelector('[data-secret-card="key-8"]')).toBeNull();
  expect(box().value).toBe("Run the script");
  agent.hide();
});

test("Cancel below a queued bubble withdraws that message", async () => {
  const agent = mount([turn(8, { status: "queued", text: "", question: "Queued draft" })]);
  await flush(); await pickMember(3);
  api.agentRetract.mockImplementation(async (session: string) => { rows = rows.filter(item => item.session_id !== session); });
  $('.tn[data-id="8"] .queued-actions [data-act="cancel-message"]').click(); await flush();
  expect(api.agentRetract).toHaveBeenCalledExactlyOnceWith("s8", 3, 8);
  expect(document.querySelector('.tn[data-id="8"]')).toBeNull();
  expect(box().value).toBe("Queued draft");
  agent.hide();
});

describe("every kind of message, edited from an empty composer", () => {
  test.each(KINDS.flatMap(kind => ENDINGS.map(ending => [kind.name, ending, kind] as const)))("%s, ending: %s", async (_name, ending, kind) => {
    const original = asked(8, kind.turn);
    const agent = mount([original]); await flush(); await pickMember(3);
    const words = kind.turn.question ?? "";
    await editMessage(8);
    // What the message carried is in the composer, and its bubble is not in the thread.
    expect(composerNow()).toEqual({ text: words, chips: kind.files, replacing: true, quote: kind.quote ?? null });
    expect(document.querySelector('.thread [data-id="8"] .owner-message')).toBeNull();
    expect(lines(8)).toBe(1);
    await finish(ending, 8, { words: "the edit" });
    const after = composerNow();
    expect(after).toEqual({ text: "", chips: [], replacing: false, quote: null });
    expect(lines(8)).toBe(1);
    if (ending === "sent") {
      expect(api.agentAskText).toHaveBeenCalledTimes(1);
      expect(api.agentAskText.mock.calls[0]![3]).toEqual(expect.objectContaining({ replaceTurnId: 8 }));
      expect(api.agentAskText.mock.calls[0]![1].map((file: { name: string }) => file.name)).toEqual(kind.files);
      expect(shown("the edit")).toBe(1);
      if (words !== "the edit") expect(shown(words)).toBe(0);
    } else {
      expect(api.agentAskText).not.toHaveBeenCalled();
      // The message is back as it was, once; nothing of it stayed behind in the composer as a second copy.
      if (words) expect(shown(words)).toBe(1);
      expect(document.querySelectorAll('.thread [data-id="8"] .owner-message')).toHaveLength(1);
      expect(original.attachments).toEqual(kind.turn.attachments);
    }
    agent.hide();
  });
});

type Before = { name: string; set(): Promise<void>; kept: { text: string; chips: string[] } };
const BEFORES: Before[] = [
  { name: "empty", set: async () => {}, kept: { text: "", chips: [] } },
  { name: "words being written", set: async () => { typeInto("half a new question"); }, kept: { text: "half a new question", chips: [] } },
  { name: "words and a picture being written", set: async () => { typeInto("with a picture"); await addFile(); }, kept: { text: "with a picture", chips: ["mine.png"] } },
  { name: "a picture only", set: async () => { await addFile(); }, kept: { text: "", chips: ["mine.png"] } },
];

describe("what the composer held before 編輯 is never lost", () => {
  test.each(BEFORES.flatMap(before => ENDINGS.map(ending => [before.name, ending, before] as const)))("%s, ending: %s", async (_name, ending, before) => {
    const agent = mount([asked(8, { question: "message eight" })]); await flush(); await pickMember(3);
    await before.set();
    await editMessage(8);
    expect(composerNow()).toEqual({ text: "message eight", chips: [], replacing: true, quote: null });
    await finish(ending, 8, { words: "the edit" });
    expect(composerNow()).toEqual({ text: before.kept.text, chips: before.kept.chips, replacing: false, quote: null });
    expect(lines(8)).toBe(1);
    if (ending === "sent") expect(shown("the edit")).toBe(1);
    else expect(shown("message eight")).toBe(1);
    // The draft is also the conversation's draft: it comes back after leaving and returning, once.
    if (before.kept.text) {
      await pickMember(4); await pickMember(3);
      expect(box().value).toBe(before.kept.text);
    }
    agent.hide();
  });
});

// A second edit while one is open can no longer happen (R-UI-163): only the owner's last message has 編輯, so the earlier one offers none.
describe("only the owner's last message can be edited", () => {
  const menu = (id: number): string[] => {
    $(`[data-id="${id}"] .owner-message [data-act="more-message"]`).click();
    const picks = [...document.querySelectorAll<HTMLElement>("#app-popover [data-pick]")].map(item => item.dataset.pick!);
    closeMenu();
    return picks;
  };

  test("a message the owner sent something after offers no 編輯, whatever its state, and the last one does", async () => {
    const agent = mount([asked(8, { question: "message eight" }), turn(7, { question: "message seven" }), asked(6, { question: "message six", status: "done" })]); await flush(); await pickMember(3);
    expect(menu(7)).not.toContain("edit");
    expect(menu(6)).not.toContain("edit");
    expect(menu(8)).toContain("edit");
    typeInto("my own draft");
    await editMessage(8);
    // While the last one is in the composer, the earlier one is still not editable: nothing takes the composer from the edit.
    expect(menu(7)).not.toContain("edit");
    expect(composerNow()).toEqual({ text: "message eight", chips: [], replacing: true, quote: null });
    box().focus();
    press("Escape"); await flush();
    expect(box().value).toBe("my own draft");
    expect(shown("message seven")).toBe(1); expect(shown("message eight")).toBe(1);
    agent.hide();
  });

  test("a message sent after it takes 編輯 away from the one before, also while it is on its way", async () => {
    let finishSend!: () => void;
    const agent = mount([asked(8, { question: "message eight" })]); await flush(); await pickMember(3);
    expect(menu(8)).toContain("edit");
    api.agentAskText.mockImplementationOnce(() => new Promise<void>(resolve => { finishSend = resolve; }));
    typeInto("a newer question"); press("Enter"); await flush();
    expect(menu(8)).not.toContain("edit");
    finishSend(); await flush();
    agent.hide();
  });

  test("a file still being read when 編輯 is chosen is kept for after the edit", async () => {
    const agent = mount([asked(8, { question: "message eight" })]); await flush(); await pickMember(3);
    const picker = $<HTMLInputElement>(".cmp-picker");
    Object.defineProperty(picker, "files", { value: [new File([PNG], "slow.png", { type: "image/png" })], configurable: true });
    picker.dispatchEvent(new Event("change"));
    pickMessage('[data-id="8"]', "edit"); await flush();
    press("Escape"); await flush();
    expect(chips()).toEqual(["slow.png"]);
    expect(composerNow().replacing).toBe(false);
    agent.hide();
  });
});

describe("a recording in progress", () => {
  test.each(["sent", "another conversation and back"] as const)("編輯 keeps the edit and the recording apart (%s)", async ending => {
    const agent = mount([asked(8, { question: "message eight" })]); await flush(); await pickMember(3);
    typeInto("spoken draft");
    send({ type: "Dictation", phase: "listening", agent: true, member_id: 3 });
    await editMessage(8);
    expect(composerNow()).toEqual({ text: "message eight", chips: [], replacing: true, quote: null });
    expect($(".composer").dataset.taskState).toBe("recording");
    // The recording's button does not hand an edit over as a new message.
    expect(api.agentVoiceComposed).not.toHaveBeenCalled();
    await finish(ending, 8, { words: "the edit" });
    expect(box().value).toBe("spoken draft");
    expect(composerNow().replacing).toBe(false);
    expect(lines(8)).toBe(1);
    agent.hide();
  });
});

describe("work that is under way while a message is edited", () => {
  // Work after the owner's last message that is not a message of theirs: a routine's run (R-UI-163 keeps the edited message the last one),
  // after a message whose turn ended with no bubble of its member's (still one the composer takes back).
  const running = (): AgentTurn => turn(9, { question: "每天", source: "routine", route: "routine", status: "running", session_id: "run9", text: "" });
  const ended = (): AgentTurn => asked(8, { question: "message eight", status: "done" });
  const press2 = (): void => {
    $(".cmp-voice").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
  };

  test("Stop returns the queued words after the edit: the edit is still an edit, and they come back with what it held before", async () => {
    const agent = mount([running(), ended()]); await flush(); await pickMember(3);
    typeInto("my own draft");
    await editMessage(8);
    api.agentStop.mockResolvedValue({ returned: [{ session_id: "queued1", text: "queued words", attachments: [] }] });
    press2(); await flush();
    expect(api.agentStop).toHaveBeenCalledWith("run9", 3);
    // The edit is as it was: its words, still replacing message 8, whose bubble stays away; the returned words wait.
    expect(composerNow()).toEqual({ text: "message eight", chips: [], replacing: true, quote: null });
    expect(shown("message eight")).toBe(0);
    rows = rows.map(item => item.id === 9 ? { ...item, status: "done" } : item);
    typeInto("eight, rewritten"); press("Enter"); await flush();
    expect(api.agentAskText).toHaveBeenCalledTimes(1);
    expect(api.agentAskText.mock.calls[0]![3]).toEqual(expect.objectContaining({ replaceTurnId: 8 }));
    expect(composerNow().replacing).toBe(false);
    expect(box().value).toBe("my own draft\n\nqueued words");
    expect(shown("eight, rewritten")).toBe(1);
    agent.hide();
  });

  test("Escape in an edit belongs to the work under way: it asks to stop that work, and the edit stays until it is sent or left", async () => {
    const agent = mount([running(), ended()]); await flush(); await pickMember(3);
    await editMessage(8);
    box().focus();
    press("Escape"); await flush();
    expect($(".cmp-voice").dataset.cancelArmed).toBe("true");
    expect(composerNow()).toEqual({ text: "message eight", chips: [], replacing: true, quote: null });
    expect(api.agentRetract).not.toHaveBeenCalled();
    await pickMember(4); await pickMember(3);
    expect(composerNow().replacing).toBe(false);
    expect(shown("message eight")).toBe(1);
    agent.hide();
  });

  test("Escape in the edit of a message its member is still thinking about gives the edit up, and that work goes on", async () => {
    const agent = mount([asked(8, { question: "message eight", session_id: "run8" })]); await flush(); await pickMember(3);
    await editMessage(8);
    box().focus();
    press("Escape"); await flush();
    expect(composerNow()).toEqual({ text: "", chips: [], replacing: false, quote: null });
    expect(shown("message eight")).toBe(1);
    expect(api.agentStop).not.toHaveBeenCalled();
    expect(api.agentRetract).not.toHaveBeenCalled();
    agent.hide();
  });

  test("Cancel on a running message keeps the words being written, and an edit in the composer stays an edit", async () => {
    const agent = mount([turn(9, { question: "later question", status: "running", session_id: "run9", text: "" }), asked(8, { question: "message eight" })]); await flush(); await pickMember(3);
    api.agentRetract.mockImplementation(async (session: string) => { rows = rows.filter(item => item.session_id !== session); });
    typeInto("my own draft");
    pickMessage('[data-id="9"]', "cancel"); await flush();
    expect(api.agentRetract).toHaveBeenCalledTimes(1);
    expect(box().value).toBe("my own draft\n\nlater question");
    box().value = ""; box().dispatchEvent(new Event("input", { bubbles: true }));
    // Message 8 is the owner's last again: it is taken into the composer before another message of theirs comes (from their phone).
    await editMessage(8);
    rows = [turn(10, { question: "another later question", status: "running", session_id: "run10", text: "" }), ...rows];
    send({ type: "AgentTurn", turn_id: 10, member_id: 3 });
    await new Promise(resolve => setTimeout(resolve, 450)); await flush();
    pickMessage('[data-id="10"]', "cancel"); await flush();
    expect(composerNow()).toEqual({ text: "message eight", chips: [], replacing: true, quote: null });
    expect(shown("message eight")).toBe(0);
    box().focus();
    press("Escape"); await flush();
    expect(composerNow()).toEqual({ text: "another later question", chips: [], replacing: false, quote: null });
    expect(shown("message eight")).toBe(1);
    agent.hide();
  });
});

describe("the message being edited is gone from the conversation", () => {
  test.each(["a turn was removed", "the history was cleared"] as const)("%s: the words stay as a draft that replaces nothing, and send as a new message", async what => {
    const agent = mount([asked(8, { question: "message eight" }), turn(7, { question: "message seven" })]); await flush(); await pickMember(3);
    typeInto("a half written draft");
    await editMessage(8);
    typeInto("eight, rewritten");
    rows = what === "a turn was removed" ? rows.filter(item => item.id !== 8) : [];
    send({ type: "AgentTurn", turn_id: 8, member_id: 3 });
    await new Promise(resolve => setTimeout(resolve, 450)); await flush();
    expect(composerNow().replacing).toBe(false);
    expect(box().value).toBe("a half written draft\n\neight, rewritten");
    press("Enter"); await flush();
    expect(api.agentAskText.mock.calls[0]![3]).not.toHaveProperty("replaceTurnId");
    agent.hide();
  });

  test("a message that is still there keeps the edit through the same read", async () => {
    const agent = mount([asked(8, { question: "message eight" })]); await flush(); await pickMember(3);
    await editMessage(8);
    rows = [turn(9, { question: "later question" }), ...rows];
    send({ type: "AgentTurn", turn_id: 9, member_id: 3 });
    await new Promise(resolve => setTimeout(resolve, 450)); await flush();
    expect(composerNow().replacing).toBe(true);
    agent.hide();
  });
});

describe("the actions of a message stand on the message, whatever it carries", () => {
  // The place beside the bubble is drawn by look (owner-picture-actions); what the page must give it is one actions block as the message's own
  // child, and the pictures and the bubble as the siblings the stylesheet anchors to.
  test.each(KINDS.map(kind => [kind.name, kind] as const))("%s", async (_name, kind) => {
    const agent = mount([turn(8, { ...kind.turn, reactions: undefined })]); await flush(); await pickMember(3);
    const message = $('.thread .tn[data-id="8"] .owner-message');
    expect(message.querySelectorAll(":scope > .message-actions")).toHaveLength(1);
    expect(message.querySelectorAll('[data-act="more-message"]')).toHaveLength(1);
    expect(message.querySelectorAll('[data-act="reply-message"]')).toHaveLength(1);
    const words = (kind.turn.question ?? "").trim() !== "";
    expect(message.querySelectorAll(".bubble")).toHaveLength(words ? 1 : 0);
    expect(message.querySelectorAll(".me-files + .bubble")).toHaveLength(words && kind.files.length ? 1 : 0);
    expect(message.querySelectorAll(".message-actions .message-actions, .me-files .message-actions, .bubble .message-actions")).toHaveLength(0);
    agent.hide();
  });

  test("a group room's own message offers no edit", () => {
    expect(messageActionsHTML(1, false, undefined, false)).not.toContain("data-owner-act");
    expect(messageActionsHTML(1, false, "own", true)).toContain('data-owner-act="own"');
  });
});
