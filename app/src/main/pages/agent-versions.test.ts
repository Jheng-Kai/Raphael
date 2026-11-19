// @vitest-environment happy-dom
// The owner edits a message their member already answered (R-UI-163): the message's own bubble is the editor, the composer is not
// touched, and sending keeps the first exchange as version 1 of the message; ‹ 2/2 › under the bubble shows either version and what the
// member answered it with. The real page and member shell run; only the native IPC boundary is faked, and the core's own handling of
// an edit (the edit written with the message's id as its newest version) is played here.
import { navInputs, pressLayer } from "../test-support/nav-layer-input";
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
import { closeMenu } from "../ui";

const member = (id: number, more: Partial<Member> = {}): Member => ({
  id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
});
const LIST: MembersList = { members: [member(0, { name: "拉斐爾" }), member(3, { name: "日文老師" }), member(4, { name: "行程管家" })], groups: [] };
const turn = (id: number, more: Partial<AgentTurn> = {}): AgentTurn => ({
  id, created_at_ms: Date.parse("2026-10-20T10:00:00+08:00") + id * 1000, question: `問題 ${id}`, route: "chat", prefix: "答", text: "",
  detail: null, status: "done", source: "app", member_id: 3, conversation_id: 83, session_id: `s${id}`, messages: [{ seq: 1, kind: "reply", text: `回答 ${id}`, at_ms: 1 }], ...more,
});

/** Member 3's thread as the core keeps it, newest first, and the earlier versions of its edited message, oldest first. */
let rows: AgentTurn[] = [];
let kept: AgentTurn[] = [];
const flush = async (): Promise<void> => { for (let i = 0; i < 30; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); for (let i = 0; i < 30; i++) await Promise.resolve(); };
const $ = <T extends HTMLElement>(q: string): T => document.querySelector<T>(q)!;
const composer = (): HTMLTextAreaElement => $<HTMLTextAreaElement>(".cmp-input");
const field = (): HTMLTextAreaElement | null => document.querySelector<HTMLTextAreaElement>(".thread [data-edit-input]");
const typeInto = (box: HTMLTextAreaElement, words: string): void => { box.value = words; box.dispatchEvent(new Event("input", { bubbles: true })); };
const press = (target: HTMLElement, key: string, more: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more });
  target.dispatchEvent(event);
  return event;
};
const menu = (id: number): string[] => {
  $(`[data-id="${id}"] .owner-message [data-act="more-message"]`).click();
  const picks = [...document.querySelectorAll<HTMLElement>("#app-popover [data-pick]")].map(item => item.dataset.pick!);
  closeMenu();
  return picks;
};
const edit = async (id: number): Promise<void> => { $(`[data-id="${id}"] .owner-message [data-act="more-message"]`).click(); $('#app-popover [data-pick="edit"]').click(); await flush(); };
const pickMember = async (id: number): Promise<void> => { $(`.mb-col [data-member="${id}"]`).click(); await flush(); };
const words = (id: number): string => $(`.thread [data-id="${id}"] .owner-message .message-text`).textContent!.trim();
const said = (id: number): string[] => [...document.querySelectorAll(`.thread [data-id="${id}"] .chat-message[data-reply] .message-text`)].map(node => node.textContent!.trim());
const pager = (id: number): { count: string; previous: HTMLButtonElement; next: HTMLButtonElement } | null => {
  const box = document.querySelector<HTMLElement>(`.thread [data-id="${id}"] .msg-versions`);
  if (!box) return null;
  const [previous, next] = [...box.querySelectorAll<HTMLButtonElement>("button")];
  return { count: box.querySelector(".msg-versions-count")!.textContent!, previous: previous!, next: next! };
};

function mount(initial: AgentTurn[]) {
  rows = initial;
  const app = { go: vi.fn(), device: () => ({ dictation_mode: "hold" }), onEvent(_handler: (event: MainEvent) => void) { return () => {}; }, undo: { begin: vi.fn() }, cleared: new Cleared() } as unknown as AppContext;
  const agent = createAgent(app);
  document.body.append(agent.el);
  agent.el.hidden = false;
  agent.show();
  return agent;
}

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = "";
  kept = [];
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
  api.core.mockImplementation(async (method: string, params?: { id?: string; member_id?: number; turn_id?: number; version?: number }) => {
    if (method === "attachments.get") return { mime: "image/png", data: btoa("bytes") };
    if (method === "conversations.list") return { conversations: [{ id: 80 + (params?.member_id ?? 0), member_id: params?.member_id ?? 0, is_default: 1, kind: "standard", title: "", created_at_ms: 1, updated_at_ms: 1 }] };
    if (method === "agent.history.version") {
      const live = rows.find(item => item.id === params!.turn_id)!, versions = live.versions ?? 1;
      const shown = params!.version === versions ? live : kept[params!.version! - 1]!;
      return { turn: { ...structuredClone(shown), version: params!.version, versions }, version: params!.version, versions };
    }
    return { questions: [] };
  });
  // The core's edit of an answered message: the first exchange is kept as a version, and the edit takes the message's id as its newest.
  api.agentAskText.mockImplementation(async (text: string, files: { name: string; mime: string }[], _member: number, options: { requestId: string; replaceTurnId?: number }) => {
    if (options.replaceTurnId === undefined) { rows = [turn(Math.max(...rows.map(item => item.id)) + 1, { question: text, session_id: options.requestId, messages: [] }), ...rows]; return; }
    const old = rows.find(item => item.id === options.replaceTurnId)!, versions = (old.versions ?? 1) + 1;
    kept.push(structuredClone(old));
    rows = rows.map(item => item.id === old.id ? { ...item, question: text, session_id: options.requestId, status: "running", messages: [], version: versions, versions,
      attachments: files.map(file => ({ name: file.name, mime: file.mime })) } : item);
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); closeMenu(); });

describe("the owner's answered message is edited in its own bubble", () => {
  test("編輯 makes the bubble the editor where it stands: the words ready, the composer untouched, 取消 and 送出 inside it", async () => {
    const agent = mount([turn(8)]); await flush(); await pickMember(3);
    typeInto(composer(), "my own draft");
    await edit(8);
    const box = field()!;
    expect(box).not.toBeNull();
    expect(box.value).toBe("問題 8");
    expect(document.activeElement).toBe(box);
    expect([box.selectionStart, box.selectionEnd]).toEqual([4, 4]);
    // The bubble itself is the editor, in the message's own line, with what the member answered still under it.
    const message = box.closest<HTMLElement>(".owner-message")!;
    expect(message.matches(".chat-message.owner-message.is-editing[data-msg-editor]")).toBe(true);
    expect(box.closest(".bubble")).not.toBeNull();
    expect(said(8)).toEqual(["回答 8"]);
    // The actions beside it keep their room and cannot be pressed meanwhile.
    expect(message.querySelector(":scope > .message-actions.is-held[inert]")).not.toBeNull();
    const buttons = [...message.querySelectorAll<HTMLButtonElement>(".bubble .msg-editor-actions .btn")];
    expect(buttons.map(button => button.textContent)).toEqual(["取消", "送出"]);
    expect(buttons[1]!.classList.contains("pri")).toBe(true);
    expect(composer().value).toBe("my own draft");
    expect($(".composer").hasAttribute("data-replacing")).toBe(false);
    expect(api.agentAskText).not.toHaveBeenCalled();
    agent.hide();
  });

  test("Enter sends the new words as the message's next version, Shift+Enter is a new line, and the composer keeps its own draft", async () => {
    const agent = mount([turn(8, { attachments: [{ id: `${"a".repeat(32)}.png`, name: "shot.png", mime: "image/png", size: 6 }], quote: { text: "Saved", author: "You" } })]); await flush(); await pickMember(3);
    typeInto(composer(), "my own draft");
    await edit(8);
    typeInto(field()!, "問題 8，說得更清楚");
    expect(press(field()!, "Enter", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(field()!, "Enter", { isComposing: true }).defaultPrevented).toBe(false);
    expect(api.agentAskText).not.toHaveBeenCalled();
    expect(press(field()!, "Enter").defaultPrevented).toBe(true);
    await flush();
    expect(api.agentAskText).toHaveBeenCalledTimes(1);
    expect(api.agentAskText).toHaveBeenCalledWith("問題 8，說得更清楚", [{ name: "shot.png", mime: "image/png", data: btoa("bytes") }], 3,
      expect.objectContaining({ replaceTurnId: 8, quote: { text: "Saved", author: "You" } }));
    // The new version stands where the message stood, with 2/2 under it; the editor is gone and the composer is as it was.
    expect(field()).toBeNull();
    expect(document.querySelectorAll('.thread .tn[data-id="8"]')).toHaveLength(1);
    expect(words(8)).toBe("問題 8，說得更清楚");
    expect(pager(8)!.count).toBe("2/2");
    expect(composer().value).toBe("my own draft");
    agent.hide();
  });

  test.each(navInputs)("%s leaves a bubble edit only after confirming changed words", async input => {
    const agent = mount([turn(8)]); await flush(); await pickMember(3);
    await edit(8);
    typeInto(field()!, "Changed");
    pressLayer(input, "forward");
    pressLayer(input);
    expect($('[data-act="edit-cancel"]').dataset.cancelArmed).toBe("true");
    pressLayer(input);
    expect(field()).toBeNull();
    expect(api.agentAskText).not.toHaveBeenCalled();
    agent.hide();
  });

  test("Escape on the words as they were leaves at once, changed words need Escape twice with the first arming 取消, and 取消 leaves too", async () => {
    const agent = mount([turn(8)]); await flush(); await pickMember(3);
    const before = $('[data-id="8"] .owner-message').outerHTML;
    await edit(8);
    press(field()!, "Escape"); await flush();
    expect(field()).toBeNull();
    expect($('[data-id="8"] .owner-message').outerHTML).toBe(before);
    await edit(8);
    typeInto(field()!, "changed");
    press(field()!, "Escape"); await flush();
    expect(field()!.value).toBe("changed");
    expect($('[data-act="edit-cancel"]').dataset.cancelArmed).toBe("true");
    press(field()!, "Escape"); await flush();
    expect(field()).toBeNull();
    expect(words(8)).toBe("問題 8");
    await edit(8);
    $('[data-act="edit-cancel"]').click(); await flush();
    expect(field()).toBeNull();
    expect(api.agentAskText).not.toHaveBeenCalled();
    agent.hide();
  });

  test("words emptied leave 送出 off, and a send that fails opens the editor again with the words as typed", async () => {
    const agent = mount([turn(8)]); await flush(); await pickMember(3);
    await edit(8);
    typeInto(field()!, "  ");
    expect($<HTMLButtonElement>('[data-act="edit-send"]').disabled).toBe(true);
    api.agentAskText.mockRejectedValueOnce(new Error("offline"));
    typeInto(field()!, "kept words");
    expect($<HTMLButtonElement>('[data-act="edit-send"]').disabled).toBe(false);
    $('[data-act="edit-send"]').click(); await flush();
    expect(field()!.value).toBe("kept words");
    expect(rows[0]!.versions).toBeUndefined();
    agent.hide();
  });

  test("an editor belongs to its conversation: leaving it gives the edit up, and nothing of it comes back as a draft", async () => {
    const agent = mount([turn(8)]); await flush(); await pickMember(3);
    await edit(8);
    typeInto(field()!, "half edited");
    await pickMember(4); await pickMember(3);
    expect(field()).toBeNull();
    expect(words(8)).toBe("問題 8");
    expect(composer().value).toBe("");
    agent.hide();
  });

  test("a message the owner sends from the composer meanwhile ends the editor: the edited one is no longer their last", async () => {
    const agent = mount([turn(8)]); await flush(); await pickMember(3);
    await edit(8);
    typeInto(composer(), "a newer question"); press(composer(), "Enter"); await flush();
    expect(field()).toBeNull();
    expect(menu(8)).not.toContain("edit");
    agent.hide();
  });

  test("an answered message whose member still works is edited in its bubble too, with 取消 still in its ⋯", async () => {
    const agent = mount([turn(8, { status: "running" })]); await flush(); await pickMember(3);
    expect(menu(8)).toEqual(expect.arrayContaining(["edit", "cancel"]));
    await edit(8);
    expect(field()).not.toBeNull();
    expect($(".composer").hasAttribute("data-replacing")).toBe(false);
    agent.hide();
  });
});

describe("‹ 2/2 › under an edited message", () => {
  const edited = (): AgentTurn[] => {
    kept = [turn(8, { question: "Plan a trip to Kyoto", messages: [{ seq: 1, kind: "reply", text: "Kyoto plan", at_ms: 1 }] })];
    return [turn(8, { question: "Plan a trip to Osaka", messages: [{ seq: 1, kind: "reply", text: "Osaka plan", at_ms: 2 }], version: 2, versions: 2 })];
  };

  test("‹ shows the first version and what the member answered it with, read only, and › goes back to the newest without asking the core", async () => {
    const agent = mount(edited()); await flush(); await pickMember(3);
    expect(words(8)).toBe("Plan a trip to Osaka");
    expect(said(8)).toEqual(["Osaka plan"]);
    expect(pager(8)!.count).toBe("2/2");
    expect([pager(8)!.previous.disabled, pager(8)!.next.disabled]).toEqual([false, true]);
    pager(8)!.previous.click(); await flush();
    expect(api.core).toHaveBeenCalledWith("agent.history.version", { member_id: 3, conversation_id: 83, turn_id: 8, version: 1 });
    expect(words(8)).toBe("Plan a trip to Kyoto");
    expect(said(8)).toEqual(["Kyoto plan"]);
    expect(pager(8)!.count).toBe("1/2");
    expect([pager(8)!.previous.disabled, pager(8)!.next.disabled]).toEqual([true, false]);
    // The keyboard stays on the pager: the button pressed reached its end, so the other one has the focus.
    expect(document.activeElement).toBe(pager(8)!.next);
    // An earlier version is read again, not answered or edited: Copy in sight, no ⋯, no reaction.
    const line = $('.thread [data-id="8"]');
    expect(line.querySelector('[data-act="more-message"], [data-act="react-message"], [data-act="reply-message"]')).toBeNull();
    expect(line.querySelectorAll('[data-act="copy-message"]').length).toBeGreaterThan(0);
    const calls = api.core.mock.calls.filter(call => call[0] === "agent.history.version").length;
    pager(8)!.next.click(); await flush();
    expect(api.core.mock.calls.filter(call => call[0] === "agent.history.version")).toHaveLength(calls);
    expect(words(8)).toBe("Plan a trip to Osaka");
    expect(pager(8)!.count).toBe("2/2");
    expect(menu(8)).toContain("edit");
    // Read once: going back again asks the core nothing more.
    pager(8)!.previous.click(); await flush();
    expect(api.core.mock.calls.filter(call => call[0] === "agent.history.version")).toHaveLength(calls);
    expect(words(8)).toBe("Plan a trip to Kyoto");
    agent.hide();
  });

  test("the version read is the owner's alone: changing it sends nothing, and another edit shows its newest, 3/3", async () => {
    const agent = mount(edited()); await flush(); await pickMember(3);
    pager(8)!.previous.click(); await flush();
    expect(api.agentAskText).not.toHaveBeenCalled();
    expect(api.agentRetract).not.toHaveBeenCalled();
    pager(8)!.next.click(); await flush();
    await edit(8);
    typeInto(field()!, "Plan a trip to Nara"); press(field()!, "Enter"); await flush();
    expect(api.agentAskText).toHaveBeenLastCalledWith("Plan a trip to Nara", [], 3, expect.objectContaining({ replaceTurnId: 8 }));
    expect(words(8)).toBe("Plan a trip to Nara");
    expect(pager(8)!.count).toBe("3/3");
    pager(8)!.previous.click(); await flush();
    expect(words(8)).toBe("Plan a trip to Osaka");
    expect(pager(8)!.count).toBe("2/3");
    pager(8)!.previous.click(); await flush();
    expect(words(8)).toBe("Plan a trip to Kyoto");
    expect(pager(8)!.count).toBe("1/3");
    agent.hide();
  });

  test("the version chosen stays with its conversation, and a message never edited has no pager", async () => {
    const agent = mount([...edited(), turn(7, { question: "an earlier one" })]); await flush(); await pickMember(3);
    expect(pager(7)).toBeNull();
    pager(8)!.previous.click(); await flush();
    await pickMember(4); await pickMember(3);
    expect(pager(8)!.count).toBe("1/2");
    expect(words(8)).toBe("Plan a trip to Kyoto");
    agent.hide();
  });
});
