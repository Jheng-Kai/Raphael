// @vitest-environment happy-dom
// The 拉斐爾 page with members (pages/agent.ts and members-shell.ts): picking a member loads its own
// thread, asks it and searches it alone; its answers are plain, its composer says 「傳訊息給 <name>」
// and has the emblem voice button; the gold card shows in the thread that asked; Raphael's thread is as it
// was; a turn of another thread does not touch the open one; the slot of the background questions
// sits above the composer; the details panel closes and comes back from the pill.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentTurn, AppContext, MainEvent, Member, MembersList, Routine } from "../types";

const api = vi.hoisted(() => ({ statusGet: vi.fn(async () => ({ openrouter: { state: "ok" }, spend: { month_usd: 0, limit_usd: 10 } })),
  agentHistoryList: vi.fn(),
  agentHistoryClear: vi.fn(),
  agentHistorySearch: vi.fn(),
  agentAskText: vi.fn(),
  agentRetract: vi.fn(),
  agentQuestionOpen: vi.fn(),
  agentQuestionAnswer: vi.fn(),
  agentVoice: vi.fn(),
  cancelSession: vi.fn(),
  workerCancel: vi.fn(),
  workerRerun: vi.fn(),
  membersList: vi.fn(),
  membersRead: vi.fn(),
  membersViewing: vi.fn(),
  membersToolChoices: vi.fn(),
  membersUpdate: vi.fn(),
  membersCreate: vi.fn(),
  membersDelete: vi.fn(),
  settingsGet: vi.fn(async () => ({settings:{computer_ssh_alias:''}})),
  membersSetAvatar: vi.fn(),
  routinesCreate: vi.fn(),
  toolsetsList: vi.fn(),
  routinesList: vi.fn(),
  modelsCatalog: vi.fn(),
  providersList: vi.fn(),
  brainsCli: vi.fn(),
  core: vi.fn(),
  roomsList: vi.fn(),
  roomMessages: vi.fn(),
  desktopStatus: vi.fn(), desktopOpen: vi.fn(), desktopRenew: vi.fn(), desktopClose: vi.fn(),
}));
vi.mock("../api", () => api);

import { Cleared } from "../cleared";
import { createAgent } from "./agent";
import { openGroupChat } from "../group-chats";

const member = (id: number, more: Partial<Member> = {}): Member => ({
  id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
});
const LIST: MembersList = {
  members: [
    member(0, { name: "拉斐爾" }),
    member(3, { name: "日文老師", role: "N2 嚴格版", preview: "今天的單字" }),
    member(4, { name: "行程管家", unread: true, preview: "明天 10:00 有會議" }),
  ],
  groups: [],
};
const turn = (id: number, more: Partial<AgentTurn> = {}): AgentTurn => ({
  id, created_at_ms: Date.parse("2026-10-20T10:00:00+08:00") + id * 1000, question: `問題 ${id}`, route: "chat",
  prefix: "答", text: `回答 ${id}`, detail: null, status: "done", source: "app", ...more,
});
const THREADS: Record<number, AgentTurn[]> = {
  0: [turn(2, { source: "voice" }), turn(1, { source: "voice" })],
  3: [turn(31, { member_id: 3, text: "今天的單字" }), turn(30, { member_id: 3, source: "routine", route: "routine", prefix: "", question: "每天的單字", text: "10 題已送出" })],
  4: [turn(41, { member_id: 4, text: "明天 10:00 有會議" })],
};

let send: (event: MainEvent) => void = () => {};
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function mount(mode: "hold" | "toggle" = "hold") {
  const app = {
    go: vi.fn(),
    device: () => ({ dictation_mode: mode }),
    onEvent(handler: (event: MainEvent) => void) {
      send = handler;
      return () => {};
    },
    undo: { begin: vi.fn() },
    cleared: new Cleared(),
  } as unknown as AppContext;
  const agent = createAgent(app);
  document.body.append(agent.el);
  agent.el.hidden=false;
  agent.show();
  return agent;
}
const $ = <T extends HTMLElement>(q: string) => document.querySelector<T>(q)!;
const pick = async (id: number) => {
  $(`.mb-col [data-member="${id}"]`).click();
  await flush();
};

test.each(["member", "page", "room"])("the first unseen turn has its own stable line until the thread is left (%s)", async leave => {
  vi.useFakeTimers();
  const roster = structuredClone(LIST);
  Object.assign(roster.members.find(m => m.id === 3)!, { unread: true, unread_from: 31 });
  api.membersList.mockImplementation(async () => structuredClone(roster));
  api.membersRead.mockImplementation(async (id: number) => {
    Object.assign(roster.members.find(m => m.id === id)!, { unread: false, unread_from: null });
    return {};
  });
  const agent = mount(); await flush(); await pick(3);
  const divider = $('.thread-new');
  expect(divider).not.toBeNull();
  expect(divider.nextElementSibling).toBe($('.tn[data-id="31"]'));
  const old = $('.tn[data-id="30"]'), unseen = $('.tn[data-id="31"]');
  const oldHTML = old.outerHTML, unseenHTML = unseen.outerHTML;
  api.agentHistoryList.mockResolvedValueOnce({ turns: [turn(32, { member_id: 3 }), ...THREADS[3]] });
  send({ type: 'AgentTurn', turn_id: 32, member_id: 3 });
  await vi.advanceTimersByTimeAsync(400); await flush();
  expect($('.thread-new')).toBe(divider);
  expect($('.tn[data-id="30"]')).toBe(old); expect(old.outerHTML).toBe(oldHTML);
  expect($('.tn[data-id="31"]')).toBe(unseen); expect(unseen.outerHTML).toBe(unseenHTML);
  expect(api.membersRead.mock.calls.filter(([id]) => id === 3)).toHaveLength(1);
  if (leave === "member") { await pick(0); await pick(3); }
  if (leave === "page") { agent.hide(); agent.show(); await flush(); }
  if (leave === "room") { await openGroupChat(1); await flush(); await pick(3); }
  expect(document.querySelector('.thread-new')).toBeNull();
  agent.hide();
});

test("an unread boundary before the newest history page loads its original turn", async () => {
  const roster = structuredClone(LIST);
  Object.assign(roster.members.find(m => m.id === 3)!, { unread: true, unread_from: 101 });
  api.membersList.mockResolvedValue(roster);
  const history = Array.from({length:61}, (_, i) => turn(100 + i, {member_id:3})).reverse();
  api.agentHistoryList.mockImplementation(async (q: {member_id?: number; before_id?: number; limit?: number}) => ({turns:
    q.member_id === 3 ? history.filter(t => q.before_id === undefined || t.id < q.before_id).slice(0,q.limit) : THREADS[0]}));
  const agent = mount(); await flush();
  Object.defineProperties($('.mb-chat .ra-scroll'), {scrollHeight:{configurable:true,value:5000},clientHeight:{configurable:true,value:500}});
  await pick(3);
  expect($('.thread-new').nextElementSibling).toBe($('.tn[data-id="101"]'));
  expect(api.agentHistoryList.mock.calls.some(([q]) => q.member_id === 3 && q.before_id === 111)).toBe(true);
  agent.hide();
});

test("the initial chief thread snapshots news before viewing clears it", async () => {
  const roster = structuredClone(LIST);
  Object.assign(roster.members[0], {unread:true, unread_from:2});
  api.membersList.mockImplementation(async () => structuredClone(roster));
  api.membersViewing.mockImplementation(async (id: number) => {
    if (id === 0) Object.assign(roster.members[0], {unread:false, unread_from:null});
    return {};
  });
  const agent = mount(); await flush();
  expect($('.thread-new').nextElementSibling).toBe($('.tn[data-id="2"]'));
  agent.hide(); agent.show(); await flush();
  expect(document.querySelector('.thread-new')).toBeNull();
  agent.hide();
});

test("a delayed initial roster still opens at news before the newest history page", async () => {
  let deliver!: (list: MembersList) => void;
  const roster = structuredClone(LIST);
  Object.assign(roster.members[0], {unread:true, unread_from:101});
  api.membersList.mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
  const history = Array.from({length:61}, (_, i) => turn(100 + i)).reverse();
  api.agentHistoryList.mockImplementation(async (q: {before_id?: number; limit?: number}) => ({turns:
    history.filter(t => q.before_id === undefined || t.id < q.before_id).slice(0,q.limit)}));
  const agent = mount();
  Object.defineProperties($('.mb-chat .ra-scroll'), {scrollHeight:{configurable:true,value:5000},clientHeight:{configurable:true,value:500}});
  await flush(); deliver(roster); await flush();
  expect($('.thread-new').nextElementSibling).toBe($('.tn[data-id="101"]'));
  agent.hide();
});

test.each([false, true])("opening unread content follows its length (long: %s)", async long => {
  // Without an end observer the reading anchor decides following from the real scroll position.
  vi.stubGlobal("IntersectionObserver", undefined);
  const roster = structuredClone(LIST);
  Object.assign(roster.members.find(m => m.id === 3)!, { unread: true, unread_from: 31 });
  api.membersList.mockResolvedValue(roster);
  const agent = mount(); await flush();
  const scroller = $('.mb-chat .ra-scroll');
  Object.defineProperties(scroller, { scrollHeight: { configurable: true, get: () => 1500 }, clientHeight: { configurable: true, get: () => 500 } });
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    return { top: this.classList.contains('thread-new') ? (long ? 200 : 1200) - scroller.scrollTop : 0 } as DOMRect;
  });
  await pick(3);
  expect(scroller.scrollTop).toBe(long ? 176 : 1500);
  // A later draw keeps a long run at its line; a short run keeps following the bottom.
  api.agentHistoryList.mockResolvedValue({ turns: [turn(32, { member_id: 3 }), ...THREADS[3]] });
  send({ type: "AgentTurn", turn_id: 32, member_id: 3 });
  await new Promise(resolve => setTimeout(resolve, 800)); await flush();
  for (let frame = 0; frame < 3; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  expect(document.querySelector('.tn[data-id="32"]')).not.toBeNull();
  if (long) expect(scroller.scrollTop).toBe(176);
  else expect(scroller.scrollTop).toBeGreaterThanOrEqual(1500);
  rect.mockRestore(); agent.hide(); vi.unstubAllGlobals();
});

test("member drafts follow the composer owner through switching and page return", async () => {
  const agent = mount(); await flush();
  const input = agent.el.querySelector<HTMLTextAreaElement>('.composer textarea')!;
  input.value = 'Chief unfinished'; input.dispatchEvent(new Event('input'));
  await pick(3); expect(input.value).toBe('');
  input.value = 'Member unfinished'; input.dispatchEvent(new Event('input'));
  await pick(0); expect(input.value).toBe('Chief unfinished');
  await pick(3); expect(input.value).toBe('Member unfinished');
  agent.hide(); agent.show(); await flush();
  expect(input.value).toBe('Member unfinished');
  expect(input.selectionStart).toBe(input.value.length);
  agent.hide();
});

test("Raphael's conversation and his quick questions keep their own drafts through activity, sending and other members", async () => {
  const conversations = [
    {id:1,member_id:0,title:'First sample',kind:'standard',is_default:1,updated_at_ms:1},
    {id:9,member_id:0,title:'',kind:'quick',is_default:0,updated_at_ms:20},
  ];
  api.core.mockImplementation(async (method:string)=>method==='conversations.list'?{conversations:structuredClone(conversations)}:{questions:[]});
  const agent=mount();await flush();
  const input=agent.el.querySelector<HTMLTextAreaElement>('.composer textarea')!;
  input.value='First unfinished';input.dispatchEvent(new Event('input'));
  conversations[1].updated_at_ms=100;
  window.dispatchEvent(new CustomEvent('conversations-changed',{detail:0}));await flush();
  expect($<HTMLElement>('.conversation-caption').hidden).toBe(true);
  if($('.mb-det').hidden)$('.conversation-trigger').click();await flush();
  $('[data-conversation-open="9"]').click();await flush();
  expect($('.conversation-caption').textContent).toBe('快速提問');
  expect(input.value).toBe('');input.value='Send quick';input.dispatchEvent(new Event('input'));
  agent.el.querySelector<HTMLFormElement>('.composer')!.requestSubmit();await flush();
  $('[data-conversation-open="1"]').click();await flush();
  expect(input.value).toBe('First unfinished');
  await pick(3);input.value='Other member draft';input.dispatchEvent(new Event('input'));
  await pick(4);await pick(3);expect(input.value).toBe('Other member draft');agent.hide();
});

test("typing defers storage work until the pause and a new page restores the saved words", async () => {
  vi.useFakeTimers();
  api.core.mockImplementation(async (method:string)=>method==='conversations.list'?{conversations:[{id:1,member_id:0,title:'Sample',kind:'standard',is_default:1,updated_at_ms:1}]}:{questions:[]});
  const agent=mount();await flush();
  const input=agent.el.querySelector<HTMLTextAreaElement>('.composer textarea')!;
  const read=vi.spyOn(localStorage,'getItem'),write=vi.spyOn(localStorage,'setItem');
  input.value='Unfinished long sample '.repeat(5000);input.dispatchEvent(new Event('input'));
  input.value+='Last word';input.dispatchEvent(new Event('input'));
  expect(read.mock.calls.filter(([key])=>key==='raphael.composer.drafts')).toHaveLength(0);
  expect(write.mock.calls.filter(([key])=>key==='raphael.composer.drafts')).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(300);
  expect(write.mock.calls.filter(([key])=>key==='raphael.composer.drafts')).toHaveLength(1);
  const text=input.value;agent.hide();agent.el.remove();
  const next=mount();await flush();
  expect(next.el.querySelector<HTMLTextAreaElement>('.composer textarea')!.value.length).toBe(text.length);
  next.hide();
});

test("a conversation the core folded into the member's one conversation drops its saved draft", async () => {
  let conversations = [
    {id:1,member_id:0,title:'First sample',kind:'standard',is_default:1,updated_at_ms:1},
    {id:2,member_id:0,title:'Recent sample',kind:'standard',is_default:0,updated_at_ms:20},
  ];
  api.core.mockImplementation(async (method:string)=>method==='conversations.list'?{conversations:structuredClone(conversations)}:{questions:[]});
  const agent=mount();await flush();
  const input=agent.el.querySelector<HTMLTextAreaElement>('.composer textarea')!;
  input.value='Folded conversation draft';input.dispatchEvent(new Event('input'));agent.hide();agent.show();await flush();
  conversations=conversations.filter(item=>item.id!==2);
  window.dispatchEvent(new CustomEvent('conversations-changed',{detail:0}));await flush();
  expect(input.value).toBe('');
  expect(JSON.parse(localStorage.getItem('raphael.composer.drafts')??'{}')['member:0:2']).toBeUndefined();agent.hide();
});

test("a long draft keeps its words without repeated full-text height measurements", async () => {
 const agent=mount();await flush();
 const input=agent.el.querySelector<HTMLTextAreaElement>('.composer textarea')!;
 const height=vi.fn(()=>100000);Object.defineProperty(input,'scrollHeight',{get:height,configurable:true});
 const text='Long sample draft '.repeat(10000);input.value=text;input.dispatchEvent(new Event('input'));
 expect(input.value).toBe(text);expect(height).not.toHaveBeenCalled();agent.hide();
});

test('work events refresh the visible preview without rereading skills or commands', async () => {
  vi.useFakeTimers();
  const agent=mount(); await flush(); await pick(3);
  api.core.mockClear();
  api.membersList.mockResolvedValue({...LIST,members:LIST.members.map(member => member.id===3 ? {...member,preview:'Updated sample progress'} : member)});
  send({type:'WorkerChanged',task_id:999,state:'done',running:false});
  await vi.advanceTimersByTimeAsync(1200); await flush();
  expect(document.querySelector('[data-member="3"] .mb-row-p')?.textContent).toContain('Updated sample progress');
  expect(api.core.mock.calls.map(call => call[0])).not.toContain('members.skills.list');
  expect(api.core.mock.calls.map(call => call[0])).not.toContain('members.commands.list');
  agent.hide();
});

test('hidden thread metadata waits until the thread is shown, and the header names only the member', async () => {
  vi.useFakeTimers();
  let title='Original sample';
  api.core.mockImplementation(async (method:string)=>method==='conversations.list' ? {conversations:[{id:701,member_id:0,is_default:1,kind:'standard',title,created_at_ms:1,updated_at_ms:1},{id:702,member_id:0,is_default:0,kind:'quick',title:'',created_at_ms:1,updated_at_ms:1}]} : {questions:[]});
  const agent=mount(); await flush(); agent.hide();
  api.core.mockClear(); title='Updated sample';
  send({type:'AgentTurn',turn_id:1,member_id:0});
  await vi.advanceTimersByTimeAsync(400); await flush();
  expect(api.core.mock.calls.filter(call=>call[0]==='conversations.list')).toHaveLength(0);
  agent.show(); await flush();
  expect(api.core.mock.calls.filter(call=>call[0]==='conversations.list').length).toBeGreaterThan(0);
  expect($('.conversation-trigger').textContent).toBe('拉斐爾');
  expect($<HTMLElement>('.conversation-caption').hidden).toBe(true);
  if ($<HTMLElement>('.mb-det').hidden) $('.conversation-trigger').click(); await flush();
  $('[data-conversation-open="702"]').click(); await flush();
  expect($('.conversation-caption').textContent).toBe('快速提問');
  agent.hide();
});

test("returning to an unchanged thread restores viewing once", async () => {
  const agent = mount(); await flush(); await pick(3);
  api.membersViewing.mockClear();
  agent.hide(); await flush();
  expect(api.membersViewing).toHaveBeenCalledExactlyOnceWith(null);
  api.membersViewing.mockClear();
  agent.show(); await flush();
  expect(api.membersViewing).toHaveBeenCalledExactlyOnceWith(3);
  agent.show(); await flush();
  expect(api.membersViewing).toHaveBeenCalledTimes(1);
  agent.hide();
});

test("show reads an unread thread already loaded while hidden", async () => {
  const agent = mount(); await flush(); await pick(3); agent.hide(); await flush();
  api.membersList.mockResolvedValue({ ...LIST, members: LIST.members.map(m => m.id === 3 ? { ...m, unread: true } : m) });
  await agent.loadSidebar(); await flush();
  expect(document.querySelector('[data-member="3"] .is-unread')).not.toBeNull();
  api.membersRead.mockClear();
  agent.show(); await flush();
  expect(api.membersRead).toHaveBeenCalledExactlyOnceWith(3);
  expect(document.querySelector('[data-member="3"] .is-unread')).toBeNull();
  agent.hide();
});

const openDetails = async (): Promise<void> => { if (document.querySelector<HTMLElement>(".mb-det")?.hidden) $(".conversation-trigger").click(); await flush(); };

test("a closed details panel reads nothing while work runs, and opening it shows the current counts", async () => {
  const agent = mount(); await flush(); await pick(3);
  expect(document.querySelector<HTMLElement>(".mb-det")!.hidden).toBe(true);
  api.core.mockClear();
  send({ type: "CoreReady" } as unknown as MainEvent); await flush();
  const read = (): string[] => api.core.mock.calls.map(([method]) => method as string);
  for (const method of ["memory.get", "members.skills.list", "members.commands.list"]) expect(read()).not.toContain(method);
  await openDetails();
  for (const method of ["memory.get", "members.skills.list", "members.commands.list"]) expect(read()).toContain(method);
  agent.hide();
});

test("a restarted core receives the current viewing even with an unchanged roster", async () => {
  const agent = mount(); await flush(); await pick(3); await openDetails();
  api.membersViewing.mockClear(); api.membersList.mockClear();
  api.core.mockClear();
  send({ type: "CoreReady" } as unknown as MainEvent); await flush();
  expect(api.membersList).toHaveBeenCalledTimes(1);
  expect(api.membersViewing).toHaveBeenCalledExactlyOnceWith(3);
  await vi.waitFor(() => expect(api.core.mock.calls.some(([method]) => method === "memory.get")).toBe(true));
  agent.hide();
});

test("an unchanged worker storm sends no additional viewing calls", async () => {
  vi.useFakeTimers();
  const agent = mount(); await flush(); await pick(3);
  api.membersViewing.mockClear();
  for (let i = 0; i < 20; i++) {
    send({ type: "WorkerChanged", task_id: 999, state: "running", running: true });
    await vi.advanceTimersByTimeAsync(200); await flush();
  }
  expect(api.membersViewing).not.toHaveBeenCalled();
  agent.hide();
});

test("returning from a room refreshes the same member without clearing retained turns", async () => {
  vi.useFakeTimers();
  const agent = mount(); await flush(); await pick(3);
  const old = $('.mb-chat .tn[data-id="30"]');
  await openGroupChat(1); await flush();
  send({ type: "AgentTurn", turn_id: 32, member_id: 3 });
  await vi.advanceTimersByTimeAsync(400); await flush();
  let finish!: (result: { turns: AgentTurn[] }) => void;
  api.agentHistoryList.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  $('[data-member="3"]').click(); await flush();
  expect($('.mb-chat').hidden).toBe(false);
  expect(document.querySelector('.mb-chat .tn[data-id="30"]')).toBe(old);
  finish({ turns: [turn(32, { member_id: 3, text: "Arrived while the room was open" }), ...THREADS[3]] });
  await flush();
  expect($('.mb-chat .thread').textContent).toContain("Arrived while the room was open");
  expect($('.mb-chat .tn[data-id="30"]')).toBe(old);
  agent.hide();
});

test("showing unchanged members restores the current destination without replacing faces", async () => {
  const agent = mount(); await flush();
  const row = $('.mb-chief'), face = row.querySelector('.av');
  agent.hide(); await agent.loadSidebar();
  expect(row.getAttribute('aria-current')).toBe('false');
  agent.show(); await flush();
  expect($('.mb-chief').getAttribute('aria-current')).toBe('true');
  expect($('.mb-chief .av')).toBe(face);
  expect(document.querySelector('[data-member="4"] .is-unread')).not.toBeNull();
  await openGroupChat(1); await flush();
  expect($('.mb-chief').getAttribute('aria-current')).toBe('false');
  await pick(3);
  expect($('[data-member="3"]').getAttribute('aria-current')).toBe('true');
  expect($('.mb-chief .av')).toBe(face);
  agent.hide();
});

test("sidebar pin and hide update only their target and hiding the open member returns to Raphael", async () => {
  const agent = mount(); await flush(); await pick(3);
  api.membersUpdate.mockResolvedValue({});
  $('[data-member-more="3"]').click(); $('[data-pick="pin"]').click(); await flush();
  expect(api.membersUpdate).toHaveBeenCalledWith(3, {pinned: true});
  $('[data-member-more="3"]').click(); $('[data-pick="hide"]').click(); await flush();
  expect(api.membersUpdate).toHaveBeenCalledWith(3, {hidden: true});
  expect(document.querySelector('.mb-chief[aria-current="true"]')).not.toBeNull();
  agent.hide();
});

test("an unconfigured Raphael is immediately usable before and after history clears", async () => {
  api.membersList.mockResolvedValue({...LIST,members:LIST.members.map(m=>({...m,profile_ready:false}))});
  api.agentHistoryList.mockResolvedValue({turns:[]});
  const agent=mount(); await flush();
  for (const id of [0,3,0]) {
    await pick(id);
    expect(document.querySelector('.first-bot')).toBeNull();
    expect($('.composer').hidden).toBe(false);
    expect($('.ra-hi').hidden).toBe(false);
  }
  api.core.mockResolvedValue({questions:[]});
  $('[data-member-more="3"]').click(); $('[data-pick="clear"]').click();
  $('[data-dlg="clear"]').click(); await flush();
  expect(api.core).toHaveBeenCalledWith("agent.history.clear", {member_id:3});
  expect(document.querySelector('.first-bot')).toBeNull();
  expect($('.composer').hidden).toBe(false);
  agent.hide();
});

test("clearing conversations requires confirmation and scopes the request to that member", async () => {
  const agent = mount(); await flush(); await pick(3);
  api.core.mockResolvedValue({questions: []});
  $('[data-member-more="3"]').click(); $('[data-pick="clear"]').click();
  expect(api.core).not.toHaveBeenCalledWith("agent.history.clear", expect.anything());
  $('[data-dlg="cancel"]').click();
  $('[data-member-more="3"]').click(); $('[data-pick="clear"]').click();
  $('[data-dlg="clear"]').click(); await flush();
  expect(api.core).toHaveBeenCalledWith("agent.history.clear", {member_id: 3});
  expect(document.querySelector(".mb-confirm")).toBeNull(); agent.hide();
});

test("a fresh window opens the member's one conversation, never the quick questions", async () => {
  const conversations = [
    {id:4,member_id:0,title:"",kind:"quick",is_default:0,updated_at_ms:100},
    {id:1,member_id:0,title:"Main sample",kind:"standard",is_default:1,updated_at_ms:1},
  ];
  api.core.mockImplementation(async (method:string) => method === "conversations.list" ? {conversations:structuredClone(conversations)} : {questions:[]});
  const agent=mount();await flush();
  expect(api.agentHistoryList).toHaveBeenLastCalledWith(expect.objectContaining({conversation_id:1}));
  expect($<HTMLElement>(".conversation-caption").hidden).toBe(true);agent.hide();
});

test("a member is deleted from its ⋯ menu only after the confirmation, and its open thread returns to Raphael", async () => {
  api.membersDelete.mockResolvedValue({ deleted: true });
  const agent = mount(); await flush(); await pick(3);
  $('[data-member-more="3"]').click(); $('[data-pick="delete"]').click(); await flush();
  expect(api.membersDelete).not.toHaveBeenCalled();
  $('[data-dlg="delete"]').click(); await flush();
  expect(api.membersDelete).toHaveBeenCalledWith(3);
  expect(document.querySelector('.mb-chief[aria-current="true"]')).not.toBeNull();
  agent.hide();
});

test("nobody makes a conversation: neither the sidebar's plus nor a member's details offers one", async () => {
  const conversations = [{ id: 31, member_id: 3, title: "Cobalt", is_default: 1, kind: "standard", created_at_ms: 1, updated_at_ms: 1 }];
  api.core.mockImplementation(async (method: string, params: { member_id?: number }) =>
    method === "conversations.list" ? { conversations: conversations.filter(c => c.member_id === params.member_id) } : undefined);
  const agent = mount(); await flush(); await pick(3); await openDetails();
  $('[data-col="add"]').click();
  expect(document.querySelector('#app-popover [data-pick="conversation"]')).toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.querySelector(".mb-det [data-conversation-new], .mb-det [data-slot=\"conversations\"]")).toBeNull();
  expect(api.agentHistoryList).toHaveBeenLastCalledWith(expect.objectContaining({ member_id: 3, conversation_id: 31 }));
  expect(api.core).not.toHaveBeenCalledWith("conversations.create", expect.anything());
  agent.hide();
});

test.each([undefined, 0, 4])("primary %s swaps the member picker without changing the open thread", async primary_id => {
  api.membersList.mockResolvedValue({ ...LIST, team_context: { primary_id } });
  const agent = mount(); await flush();
  const expected = primary_id === 4 ? ['4', '3', '0'] : ['0', '3', '4'];
  const historyCalls = api.agentHistoryList.mock.calls.length;
  $('.mb-pick').click();
  expect([...document.querySelectorAll<HTMLElement>('#app-popover [data-value]')].slice(0, 3).map(row => row.dataset.value)).toEqual(expected);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(api.agentHistoryList).toHaveBeenCalledTimes(historyCalls);
  expect(document.querySelector('.mb-col [data-member="0"][aria-current="true"]')).not.toBeNull();
  agent.hide();
});


test("files dropped into a member's thread are sent only to that member", async () => {
  const agent = mount(); await flush(); await pick(3);
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types: ["Files"], files: [new File(["report"], "report.csv", { type: "text/csv" })] } });
  agent.el.querySelector(".ra-stage")!.dispatchEvent(event);
  await flush(); await new Promise(resolve => setTimeout(resolve, 0)); await flush();
  expect(agent.el.querySelector(".cmp-chip-t")?.textContent).toBe("report.csv");
  agent.el.querySelector<HTMLFormElement>(".composer")!.requestSubmit(); await flush();
  expect(api.agentAskText).toHaveBeenCalledWith("", [{ name: "report.csv", mime: "text/csv", data: btoa("report") }], 3, expect.objectContaining({ requestId: expect.any(String) }));
  agent.hide();
});

test("a routine run link selects its member and loads the linked older turn", async () => {
  const agent = mount(); await flush();
  api.agentHistoryList.mockImplementation(async (q: { member_id?: number; before_id?: number }) => ({ turns: q.before_id === 11 ? [turn(10, { member_id: 3, text: "Linked routine result" })] : THREADS[q.member_id ?? 0] }));
  window.dispatchEvent(new CustomEvent("raphael:open-member", { detail: { memberId: 3, turnId: 10 } }));
  await flush(); await flush();
  expect(api.agentHistoryList).toHaveBeenCalledWith(expect.objectContaining({ member_id: 3, before_id: 11 }));
  expect(agent.el.querySelector('.tn[data-id="10"]')?.textContent).toContain("Linked routine result");
  expect(agent.el.querySelector('.mb-col [data-member="3"]')?.getAttribute("aria-current")).toBe("true");
  agent.hide();
});

beforeEach(() => { localStorage.clear();
  document.body.innerHTML = "";
  for (const fn of Object.values(api)) fn.mockReset();
  api.core.mockResolvedValue({ questions: [] });
  api.roomsList.mockResolvedValue({rooms:[{id:1,name:"Launch",member_ids:[0,3],is_team:0}]});
  api.roomMessages.mockResolvedValue({messages:[{id:1,member_id:3,text:"Ready",created:1,status:"done",turn_id:31}]});
  api.brainsCli.mockResolvedValue({ clis: [] });
  api.providersList.mockResolvedValue({ providers: [] });
  api.agentQuestionOpen.mockResolvedValue(null);
  api.membersList.mockResolvedValue(structuredClone(LIST));
  api.membersRead.mockResolvedValue({});
  api.membersViewing.mockResolvedValue({});
  api.membersToolChoices.mockResolvedValue({ tools: ["web_search", "weather"], connections: [] });
  api.toolsetsList.mockResolvedValue({ groups: [] });
  api.routinesList.mockResolvedValue({ routines: [] });
  api.modelsCatalog.mockResolvedValue(null);
  api.agentAskText.mockResolvedValue(undefined);
  api.agentRetract.mockResolvedValue(undefined);
  api.agentVoice.mockResolvedValue(undefined);
  api.cancelSession.mockResolvedValue(undefined);
  api.core.mockResolvedValue({});
  api.agentHistoryList.mockImplementation(async (q: { member_id?: number; limit?: number }) => ({ turns: THREADS[q.member_id ?? 0].slice(0, q.limit) }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test("pending owner questions can be cancelled into the same member's composer, without late delivery restoring them", async () => {
  let finish!: () => void;
  api.agentAskText.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const agent = mount(); await flush(); await pick(3);
  const input = $<HTMLTextAreaElement>(".cmp-input");
  input.value = "fix this typo"; input.dispatchEvent(new Event("input"));
  $(".cmp-send").click(); await flush();
  const options = api.agentAskText.mock.calls[0][3];
  expect(options.requestId).toEqual(expect.any(String));
  $('.is-pending [data-act="cancel-message"]').click(); await flush();
  expect(api.agentRetract).toHaveBeenCalledWith(options.requestId, 3, undefined);
  expect(input.value).toBe("fix this typo");
  expect(document.activeElement).toBe(input);
  expect(document.querySelector(".is-pending")).toBeNull();
  finish(); await flush();
  expect(input.value).toBe("fix this typo");
  agent.hide();
});

test("editing preserves the old turn until resending the replacement in its own thread", async () => {
  const agent = mount(); await flush(); await pick(3);
  $('[data-id="31"] [data-act="edit-message"]').click(); await flush();
  const input = $<HTMLTextAreaElement>(".cmp-input");
  expect(input.value).toBe("問題 31");
  expect(document.querySelector('[data-id="31"]')).not.toBeNull();
  expect(api.agentRetract).not.toHaveBeenCalled();
  input.value = "corrected"; $(".composer").dispatchEvent(new Event("submit", { cancelable: true })); await flush();
  expect(api.agentAskText).toHaveBeenCalledWith("corrected", [], 3, expect.objectContaining({ replaceTurnId: 31 }));
  agent.hide();
});

test("message actions show an app tooltip on keyboard focus, with no native title", async () => {
  const agent = mount(); await flush();
  const edit = $('[data-id="2"] [data-act="edit-message"]');
  expect(edit.hasAttribute("title")).toBe(false);
  edit.focus();
  expect($('[role="tooltip"]').textContent).toBe("編輯");
  expect($('[role="tooltip"]').hidden).toBe(false);
  $<HTMLTextAreaElement>(".cmp-input").focus();
  expect($('[role="tooltip"]').hidden).toBe(true);
  agent.hide();
});

test("Escape cancels only from an empty composer and restores a running turn", async () => {
  api.agentHistoryList.mockResolvedValue({ turns: [turn(8, { session_id: "running", status: "running", text: "Partial" })] });
  const agent = mount(); await flush();
  const input = $<HTMLTextAreaElement>(".cmp-input");
  input.value = "new draft";
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await flush();
  expect(api.agentRetract).not.toHaveBeenCalled();
  input.value = "";
  input.dispatchEvent(new Event("input", {bubbles:true}));
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await flush();
  expect(api.agentRetract).not.toHaveBeenCalled();
  expect($(".cmp-voice").dataset.cancelArmed).toBe("true");
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await flush();
  expect(api.agentRetract).toHaveBeenCalledWith("running", 0, 8);
  expect(input.value).toBe("問題 8");
  expect(document.querySelector('[data-id="8"]')).toBeNull();
  agent.hide();
});

test("editing a legacy attachment without a stored copy requires reattachment, without mutating history", async () => {
  const original = turn(8, { session_id: "saved", attachments: [{ name: "original.pdf", mime: "application/pdf" }], quote: { text: "Saved passage", author: "You" } });
  api.agentHistoryList.mockResolvedValue({ turns: [original] });
  const agent = mount(); await flush();
  $('[data-id="8"] [data-act="edit-message"]').click(); await flush();
  expect($(".cmp-quote .quote-text").textContent).toBe("Saved passage");
  expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(true);
  $('[data-act="drop-missing"]').click();
  expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(false);
  expect(original.attachments).toEqual([{ name: "original.pdf", mime: "application/pdf" }]);
  expect(api.agentRetract).not.toHaveBeenCalled();
  agent.hide();
});

test.each(["edit", "cancel", "regenerate"])("%s after reload retrieves stored files and preserves the quote in its member thread", async action => {
  const id = `${"a".repeat(32)}.csv`;
  const quote = { text: "Saved passage", author: "You" };
  const original = turn(8, { member_id: 3, session_id: "saved", status: action === "cancel" ? "running" : "done",
    attachments: [{ id, name: "report.csv", mime: "text/csv", size: 6 }], quote });
  api.agentHistoryList.mockImplementation(async ({ member_id }: { member_id?: number }) => ({ turns: member_id === 3 ? [original] : [] }));
  api.core.mockImplementation(async (method: string) => method === "attachments.get" ? { mime: "text/csv", data: btoa("report") } : { questions: [] });
  const agent = mount(); await flush(); await pick(3);
  $(`[data-id="8"] ${action === "regenerate" ? ".ra " : ""}[data-act="${action === "regenerate" ? "more-message" : `${action}-message`}"]`).click(); await flush();
  if (action === "regenerate") { $('[data-pick="regenerate"]').click(); await flush(); }
  expect(api.core).toHaveBeenCalledWith("attachments.get", { id });
  if (action !== "regenerate") {
    expect($<HTMLTextAreaElement>(".cmp-input").value).toBe("問題 8");
    expect($(".cmp-chip-t").textContent).toBe("report.csv");
    expect(document.querySelector("[data-missing]")).toBeNull();
    expect($(".cmp-quote .quote-text").textContent).toBe("Saved passage");
    expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(false);
    $(".composer").dispatchEvent(new Event("submit", { cancelable: true })); await flush();
  }
  expect(api.agentAskText).toHaveBeenCalledWith("問題 8", [{ name: "report.csv", mime: "text/csv", data: btoa("report") }], 3,
    expect.objectContaining({ quote, ...(action === "edit" ? { replaceTurnId: 8 } : {}) }));
  expect(original.attachments).toEqual([{ id, name: "report.csv", mime: "text/csv", size: 6 }]);
  agent.hide();
});

test("an unavailable stored copy falls back to reattachment", async () => {
  const id = `${"b".repeat(32)}.pdf`;
  api.agentHistoryList.mockResolvedValue({ turns: [turn(8, { attachments: [{ id, name: "lost.pdf", mime: "application/pdf" }] })] });
  api.core.mockImplementation(async (method: string) => { if (method === "attachments.get") throw new Error("unavailable"); return { questions: [] }; });
  const agent = mount(); await flush();
  $('[data-id="8"] [data-act="edit-message"]').click(); await flush();
  expect(api.core).toHaveBeenCalledWith("attachments.get", { id });
  expect($("[data-missing]").textContent).toContain("lost.pdf");
  expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(true);
  agent.hide();
});

test("a stored-file read finishing after a thread switch cannot fill the new composer", async () => {
  let finish!: (file: { mime: string; data: string }) => void;
  api.agentHistoryList.mockResolvedValue({ turns: [turn(8, { attachments: [{ id: `${"c".repeat(32)}.csv`, name: "old.csv", mime: "text/csv" }] })] });
  api.core.mockImplementation((method: string) => method === "attachments.get" ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ questions: [] }));
  const agent = mount(); await flush();
  $('[data-id="8"] [data-act="edit-message"]').click(); await flush();
  await pick(3);
  finish({ mime: "text/csv", data: btoa("old") }); await flush();
  expect($<HTMLTextAreaElement>(".cmp-input").value).toBe("");
  expect(document.querySelector(".cmp-chip")).toBeNull();
  agent.hide();
});

test("a selected member reply travels separately, renders on the pending bubble, and returns on cancel", async () => {
  api.agentAskText.mockImplementation(() => new Promise<void>(() => {}));
  const agent = mount(); await flush(); await pick(3);
  const message = $('[data-id="31"] .ra .message-text');
  const range = document.createRange(); range.selectNodeContents(message);
  range.getClientRects = () => [{ left: 100, right: 200, top: 100, bottom: 120, width: 100, height: 20 }] as unknown as DOMRectList;
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  $(".quote-pill").click();
  expect($(".cmp-quote .quote-author").textContent).toContain("日文老師");
  const input = $<HTMLTextAreaElement>(".cmp-input");
  expect(document.activeElement).toBe(input);
  input.value = "Explain"; $(".composer").dispatchEvent(new Event("submit", { cancelable: true })); await flush();
  expect(api.agentAskText).toHaveBeenCalledWith("Explain", [], 3, expect.objectContaining({ quote: { text: "今天的單字", author: "日文老師" } }));
  expect($(".is-pending .quote-text").textContent).toBe("今天的單字");
  expect($(".cmp-quote").hidden).toBe(true);
  $('.is-pending [data-act="cancel-message"]').click(); await flush();
  expect($(".cmp-quote .quote-text").textContent).toBe("今天的單字");
  $('[data-act="remove-quote"]').click();
  expect($(".cmp-quote").hidden).toBe(true);
  agent.hide();
});

test.each(["finish", "switch", "search", "reduced"])("a finished member burst reveals with its settled work chip; %s completes or flushes it", async mode => {
  vi.useFakeTimers();
  let reduce = false;
  let preferenceChanged: () => void = () => {};
  vi.spyOn(window, "matchMedia").mockImplementation(() => ({ get matches() { return reduce; }, addEventListener: (_: string, listener: () => void) => { preferenceChanged = listener; } }) as unknown as MediaQueryList);
  let running = true;
  api.agentHistoryList.mockImplementation(async (query: { member_id?: number }) => ({ turns: query.member_id === 3 ? [turn(50, {
    member_id: 3, session_id: "burst", status: running ? "running" : "done", text: running ? "" : "All replies",
    messages: running ? [] : ["First", "Second", "Third"].map((text, index) => ({ seq: index + 1, kind: "reply", text, at_ms: Date.now() })),
  })] : [] }));
  const agent = mount(); await flush(); await pick(3);
  running = false; send({ type: "AgentTurn", turn_id: 50, member_id: 3 });
  await vi.advanceTimersByTimeAsync(150); await flush();
  const replies = () => [...document.querySelectorAll('[data-id="50"] .ra .message-text')].map(element => element.textContent);
  expect(replies()).toEqual(["First"]);
  expect(document.querySelector('[data-id="50"] .ans.thinking, [data-id="50"] .work-section.is-live')).toBeNull();
  expect($('[data-id="50"] .work-toggle')).toBeNull();
  if (mode === "finish") await vi.advanceTimersByTimeAsync(2000);
  if (mode === "switch") { await pick(4); await pick(3); }
  if (mode === "search") $('[data-act="search"]').click();
  if (mode === "reduced") {
    reduce = true;
    preferenceChanged();
  }
  expect(replies()).toEqual(["First", "Second", "Third"]);
  expect(document.querySelector('[data-id="50"] .thinking')).toBeNull();
  agent.hide();
});

test("rerunning an older failed reply asks its original question in the same member thread", async () => {
  api.agentHistoryList.mockResolvedValue({turns:[turn(33,{member_id:3}),turn(32,{member_id:3,status:"error",text:"CLI stopped"})]});
  const agent = mount(); await flush(); await pick(3);
  $('[data-id="32"] .message-actions .rerun').click(); await flush();
  expect(api.agentAskText).toHaveBeenCalledExactlyOnceWith("問題 32", [], 3, expect.objectContaining({requestId:expect.any(String)}));
  agent.hide();
});

test("regenerating the latest member reply asks the same question in that member's thread", async () => {
  const agent = mount(); await flush(); await pick(3);
  document.querySelector<HTMLButtonElement>('.tn[data-id="30"] .ra [data-act="more-message"]')!.click();
  await flush(); expect(document.querySelector('[data-pick="regenerate"]')).toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  document.querySelector<HTMLButtonElement>('.tn[data-id="31"] .ra [data-act="more-message"]')!.click();
  await flush(); document.querySelector<HTMLButtonElement>('[data-pick="regenerate"]')!.click();
  await flush();
  expect(api.agentAskText).toHaveBeenCalledExactlyOnceWith("問題 31", [], 3, expect.objectContaining({ requestId: expect.any(String) }));
  agent.hide();
});

test("routine notifications refresh the open panel immediately and keep the routine being edited", async () => {
  mount();
  await flush();
  await pick(3);
  $(".conversation-trigger").click();
  const routine: Routine = { id: 9, member_id: 3, title: "Daily review", prompt: "Review", schedule: { kind: "daily", time: "09:00" }, enabled: true, next_run: null, last_run: null };
  api.routinesList.mockResolvedValue({ routines: [routine] });
  send({ type: "RoutinesChanged", member_id: 3 });
  await flush();
  expect($(".mb-rts").textContent).toContain("Daily review");
  $('[data-det="routine-open"]').click();
  const title = document.querySelector<HTMLInputElement>("#au-title")!;
  title.focus();
  title.value = "My unsaved title";
  title.setSelectionRange(3, 5);
  const scroll = $(".mb-det-scroll");
  scroll.scrollTop = 84;
  api.routinesList.mockResolvedValue({ routines: [routine, { ...routine, id: 10, title: "New routine" }] });
  send({ type: "RoutinesChanged", member_id: 3 });
  await flush();
  expect($(".mb-rts").textContent).toContain("New routine");
  expect(document.querySelector<HTMLInputElement>("#au-title")!.value).toBe("My unsaved title");
  expect(document.activeElement).toBe(document.querySelector("#au-title"));
  expect(document.querySelector<HTMLInputElement>("#au-title")!.selectionStart).toBe(3);
  expect(scroll.scrollTop).toBe(84);
});

test("a chat event refreshes routines even when its explicit change notification was missed", async () => {
  vi.useFakeTimers();
  mount();
  await flush();
  await pick(3);
  $(".conversation-trigger").click();
  const routine = { id: 9, member_id: 3, title: "Created from chat", prompt: "Review", schedule: { kind: "daily", time: "09:00" }, enabled: true, next_run: null, last_run: null };
  api.routinesList.mockResolvedValue({ routines: [routine] });
  api.agentHistoryList.mockResolvedValue({ turns: [turn(99, { member_id: 3, messages: [{ seq: 1, kind: "event", text: "Routine created", at_ms: 1 }] })] });
  send({ type: "AgentTurn", turn_id: 99, member_id: 3 });
  await vi.advanceTimersByTimeAsync(350);
  await flush();
  expect($(".mb-rts").textContent).toContain("Created from chat");
});

test("member notifications refresh names, groups, unread dots and the open header", async () => {
  mount();
  await flush();
  await pick(3);
  await openDetails();
  $('[data-det="gear"]').click();
  const next = structuredClone(LIST);
  next.members[1] = { ...next.members[1], name: "Updated name", role: "Updated role", group_id: 5 };
  next.members[2] = { ...next.members[2], waiting: true, unread: true, preview: "New preview" };
  next.groups = [{ id: 5, name: "New group", position: 0, sources: [] }];
  api.membersList.mockResolvedValue(next);
  send({ type: "MembersChanged" });
  await flush();
  expect($(".mb-pill-t").textContent).toBe("Updated name");
  expect($<HTMLInputElement>("#mb-det-name").value).toBe("Updated name");
  expect($(".mb-col").textContent).toContain("New group");
  expect($('.mb-col [data-member="4"]').textContent).toContain("New preview");
  expect($('.mb-col [data-member="4"] .mb-dot')).not.toBeNull();
});

test("memory notifications refresh the visible own and shared lists with correct scope", async () => {
  const document = (text: string) => ({ text, revision: "r", chars: text.length, entries: text ? 1 : 0, limit: 2200, summary: null });
  api.core.mockImplementation(async (method: string) => method === "memory.get" ? document("") : { questions: [] });
  mount();
  await flush();
  await pick(3);
  $(".conversation-trigger").click();
  $('[data-det="gear"]').click();
  $('[data-tab="memory"]').click();
  await flush();
  api.core.mockClear();
  send({ type: "MemoryChanged", member_id: 4, space: "own" });
  await flush();
  expect(api.core).not.toHaveBeenCalled();
  api.core.mockImplementation(async (method: string) => method === "memory.get" ? document("Fresh note") : { questions: [] });
  send({ type: "MemoryChanged", member_id: 3, space: "own" });
  await flush();
  expect(api.core).toHaveBeenLastCalledWith("memory.get", { member_id: 3, space: "own" });
  expect($('[data-mem-space="own"]').textContent).toContain("Fresh note");
  send({ type: "MemoryChanged", member_id: 0, space: "shared" });
  await flush();
  expect(api.core).toHaveBeenLastCalledWith("memory.get", { space: "shared" });
  expect($('[data-mem-space="shared"]').textContent).toContain("Fresh note");
});

describe("Raphael's thread", () => {
  test("reads plainly: his answers without 《》, 問拉斐爾, his voice button, asked with no member", async () => {
    mount();
    await flush();
    expect(api.agentHistoryList).toHaveBeenCalledWith({ limit: 50 });
    expect($(".thread").textContent).toContain("回答 2");
    expect($(".thread").textContent).not.toContain("《");
    expect($<HTMLTextAreaElement>(".cmp-input").placeholder).toBe("問拉斐爾");
    expect($(".cmp-voice").hidden).toBe(false);
    expect($(".mb-pill-t").textContent).toBe("拉斐爾");
    $<HTMLTextAreaElement>(".cmp-input").value = "你好";
    $<HTMLFormElement>(".composer").requestSubmit();
    await flush();
    expect(api.agentAskText).toHaveBeenCalledWith("你好", [], 0, expect.objectContaining({ requestId: expect.any(String) }));
  });

  test("the member column lists the members, each with the last line of its thread from the list", async () => {
    mount();
    await flush();
    expect([...document.querySelectorAll(".mb-col .mb-list .mb-row b")].map((b) => b.textContent)).toEqual(["拉斐爾", "日文老師", "行程管家"]);
    expect($('.mb-col [data-member="3"] .mb-row-p').textContent).toBe("今天的單字");
    // no thread but the open one is read
    expect(api.agentHistoryList.mock.calls.every(([q]) => q.member_id === undefined)).toBe(true);
  });
});

describe("a member's thread", () => {
  test("every composer has a send button immediately before voice, enabled by its draft", async () => {
    const agent = mount(); await flush();
    for (const id of [0, 3, 4]) {
      await pick(id);
      const sendButton = $<HTMLButtonElement>(".cmp-send"), input = $<HTMLTextAreaElement>(".cmp-input");
      expect(sendButton.nextElementSibling).toBe($(".cmp-voice"));
      expect(sendButton.disabled).toBe(true);
      input.value = "Send this"; input.dispatchEvent(new Event("input"));
      expect(sendButton.disabled).toBe(false);
      sendButton.click(); await flush();
      expect(api.agentAskText.mock.calls[api.agentAskText.mock.calls.length - 1]?.[0]).toBe("Send this");
      expect(sendButton.disabled).toBe(true);
    }
    agent.hide();
  });
  test("loads that member's turns alone, plain, with the routine's line", async () => {
    mount();
    await flush();
    await pick(3);
    expect(api.agentHistoryList).toHaveBeenLastCalledWith({ limit: 50, member_id: 3 });
    const thread = $(".thread");
    expect(thread.textContent).not.toContain("回答 2");
    expect(thread.textContent).toContain("今天的單字");
    expect(thread.textContent).not.toContain("《");
    expect(thread.querySelector(".tn .ans")!.textContent).toBe("10 題已送出");
    expect(thread.querySelector(".chat-message .routine-origin")!.textContent).toBe("例行任務 · 每天的單字");
    // a routine's prompt is no bubble of the owner's
    expect(thread.querySelector('[data-id="30"] .bubble')).toBeNull();
    expect($('.mb-col [data-member="3"]').getAttribute("aria-current")).toBe("true");
  });

  test("its composer says 傳訊息給 and the name, has the voice button, and asks that member", async () => {
    mount();
    await flush();
    await pick(3);
    expect($<HTMLTextAreaElement>(".cmp-input").placeholder).toBe("傳訊息給 日文老師");
    expect($(".cmp-voice").hidden).toBe(false);
    expect($(".mb-pill-t").textContent).toContain("日文老師");
    expect(document.querySelector('[data-act="clear"]')).toBeNull();
    expect(document.querySelector('[data-act="settings"]')).toBeNull();
    $<HTMLTextAreaElement>(".cmp-input").value = "考我";
    $<HTMLFormElement>(".composer").requestSubmit();
    await flush();
    expect(api.agentAskText).toHaveBeenCalledWith("考我", [], 3, expect.objectContaining({ requestId: expect.any(String) }));
  });

  test("a member's voice button sends its thread and keeps the pending voice bubble there", async () => {
    vi.useFakeTimers();
    const agent = mount(); await flush(); await pick(3);
    const button = $(".cmp-voice");
    const emblem = button.innerHTML;
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(api.agentVoice).toHaveBeenLastCalledWith("down", 3);
    send({ type: "Dictation", phase: "listening", agent: true, member_id: 3 });
    // Releasing after changing threads must keep the original press's target.
    await pick(4);
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
    expect(api.agentVoice).toHaveBeenLastCalledWith("up", 3);
    send({ type: "Dictation", phase: "processing", agent: true, member_id: 3 });
    expect(document.querySelector('[data-key="hearing"]')).toBeNull();
    await pick(0);
    expect($(".cmp-voice").innerHTML).toBe(emblem);
    expect(document.querySelector('[data-key="hearing"]')).toBeNull();
    await pick(3);
    expect(document.querySelector('[data-key="hearing"]')).not.toBeNull();
    api.agentHistoryList.mockImplementation(async (q: { member_id?: number }) => ({ turns: q.member_id === 3
      ? [turn(50, { member_id: 3, source: "voice", question: "My spoken question", text: "My member reply" }), ...THREADS[3]]
      : THREADS[q.member_id ?? 0] }));
    send({ type: "AgentTurn", turn_id: 50, member_id: 3 });
    await vi.advanceTimersByTimeAsync(200); await flush();
    expect(document.querySelector('[data-key="hearing"]')).toBeNull();
    expect($('[data-id="50"] .bubble').textContent).toContain("My spoken question");
    expect(document.querySelector('[data-id="50"] .me-src')).toBeNull();
    expect($('.thread').textContent).toContain("My member reply");
    await pick(0);
    expect($('.thread').textContent).not.toContain("My spoken question");
    agent.hide();
  });

  test.each([0,3])("clicking the recording's send button for member %s ends capture and sends it instead of cancelling it", async id => {
    vi.useFakeTimers();
    api.agentHistoryList.mockResolvedValue({turns:[]});
    const agent=mount("toggle");await flush();if(id)await pick(id);
    const button=$(".cmp-voice");
    button.setPointerCapture=vi.fn();
    const click=()=>{button.dispatchEvent(new MouseEvent("pointerdown",{button:0,bubbles:true}));button.dispatchEvent(new MouseEvent("pointerup",{button:0,bubbles:true}));};
    click();
    send({type:"Dictation",phase:"listening",agent:true,member_id:id});
    expect(document.querySelector('.is-voice')).not.toBeNull();
    api.agentVoice.mockClear();
    click();
    await flush();
    expect(api.agentVoice.mock.calls.map(call=>call[0])).toEqual(["down","up"]);
    expect(api.cancelSession).not.toHaveBeenCalled();
    agent.hide();
  });

  test("a restored member voice confirmation stays in its own thread", async () => {
    api.agentQuestionOpen.mockResolvedValue({ id: "voice-confirm", member_id: 3, prefix: "問", text: "Send it?", tier: "T2", timeout_ms: 60_000 });
    const agent = mount(); await flush();
    expect($(".ask-card-host").hidden).toBe(true);
    await pick(3);
    expect($(".ask-card-host").hidden).toBe(false);
    expect($(".ask-q").textContent).toBe("Send it?");
    await pick(4);
    expect($(".ask-card-host").hidden).toBe(true);
    agent.hide();
  });

  test.each(["hold", "toggle"] as const)("a member has an accessible send button during %s recording, and Stop only once it is sent", async mode => {
    api.agentHistoryList.mockResolvedValue({turns:[]});
    const agent=mount(mode);await flush();await pick(3);
    const button=$(".cmp-voice");
    send({type:"Dictation",phase:"listening",agent:true,member_id:3});
    expect(button.classList.contains("vm-away")).toBe(false);
    // Speaking: the one button is the send glyph, labelled 送出; pressing it sends what was said.
    expect(button.getAttribute("aria-label")).toBe("送出");expect(button.querySelector(".cmp-plane")).not.toBeNull();expect(button.querySelector(".av")).toBeNull();expect($(".composer").dataset.taskState).toBe("recording");
    expect(button.tagName).toBe("BUTTON");expect((button as HTMLButtonElement).disabled).toBe(false);
    send({type:"Hotkey",kind:"cancel_key"});
    expect(button.dataset.cancelArmed).toBeUndefined();
    await flush();
    expect(api.cancelSession).toHaveBeenCalledOnce();
    send({type:"Dictation",phase:"cancelled",agent:true,member_id:3});
    expect(button.dataset.cancelArmed).toBeUndefined();agent.hide();
  });

  test("processing first seen after reopening does not settle against an older voice turn", async () => {
    api.agentHistoryList.mockImplementation(async (q: { member_id?: number }) => ({ turns: q.member_id === 3
      ? [turn(31, { member_id: 3, source: "voice" })] : THREADS[q.member_id ?? 0] }));
    const agent = mount(); await flush(); await pick(3);
    send({ type: "Dictation", phase: "processing", agent: true, member_id: 3 });
    await pick(4); await pick(3);
    expect(document.querySelector('[data-key="hearing"]')).not.toBeNull();
    agent.hide();
  });

  test("one Escape cancels voice transcription before an agent turn exists", async () => {
    api.agentHistoryList.mockResolvedValue({turns:[]});
    const agent=mount();await flush();await pick(3);
    send({type:"Dictation",phase:"processing",agent:true,member_id:3});
    expect(document.querySelector('[data-key="hearing"]')).not.toBeNull();
    $(".cmp-input").dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
    await flush();
    expect(api.cancelSession).toHaveBeenCalledOnce();
    expect($(".cmp-voice").dataset.cancelArmed).toBeUndefined();
    expect(api.workerCancel).not.toHaveBeenCalled();agent.hide();
  });

  test("the search looks through the open thread alone", async () => {
    vi.useFakeTimers();
    mount();
    await vi.runOnlyPendingTimersAsync();
    $(".mb-col [data-member=\"3\"]").click();
    await vi.runOnlyPendingTimersAsync();
    $('[data-act="search"]').click();
    const input = $<HTMLInputElement>(".ra-find-input");
    input.value = "單字";
    input.dispatchEvent(new Event("input"));
    await vi.advanceTimersByTimeAsync(250);
    expect(api.agentHistoryList).toHaveBeenCalledWith(expect.objectContaining({limit:200,member_id:3}));
    const count = document.querySelector('.ra-find-count')!.textContent;
    expect(count).toMatch(/^\d+\/\d+$/);
    expect(document.querySelectorAll('mark.is-current')).toHaveLength(1);
    expect(document.querySelector('.thread')!.textContent).not.toContain('回答 2');
    await pick(4);
    expect(document.querySelector('mark')).toBeNull();
    expect(document.querySelector<HTMLElement>('.ra-find')!.hidden).toBe(true);
  });

  test("back to Raphael: his own thread again, and his composer", async () => {
    mount();
    await flush();
    await pick(3);
    await pick(0);
    expect(api.agentHistoryList).toHaveBeenLastCalledWith({ limit: 50 });
    expect($(".thread").textContent).toContain("回答 2");
    expect($(".thread").textContent).not.toContain("今天的單字");
    expect($<HTMLTextAreaElement>(".cmp-input").placeholder).toBe("問拉斐爾");
  });

  test("an unread thread opened is told to the core, and its dot goes", async () => {
    mount();
    await flush();
    expect($('.mb-col [data-member="4"] .mb-dot.is-unread')).not.toBeNull();
    await pick(4);
    expect(api.membersRead).toHaveBeenCalledWith(4);
    expect(document.querySelector('.mb-col [data-member="4"] .mb-dot')).toBeNull();
  });

  test("the gold card shows in the thread whose member asked, and only there", async () => {
    let answered: () => void = () => {};
    api.agentAskText.mockImplementation(() => new Promise<void>((resolve) => (answered = resolve)));
    mount();
    await flush();
    await pick(3);
    $<HTMLTextAreaElement>(".cmp-input").value = "幫我寄信";
    $<HTMLFormElement>(".composer").requestSubmit();
    await flush();
    send({ type: "AgentQuestion", id: "c-1", prefix: "問", text: "寄出這封信？", tier: "T2", timeout_ms: 60_000 });
    expect($(".ask-card-host").hidden).toBe(false);
    // a member asks in plain words
    expect($(".ask-q").textContent).toBe("寄出這封信？");
    await pick(4);
    expect($(".ask-card-host").hidden).toBe(true);
    await pick(0);
    expect($(".ask-card-host").hidden).toBe(true);
    await pick(3);
    expect($(".ask-card-host").hidden).toBe(false);
    answered();
    await flush();
  });

  test("a question without a composer request belongs to Raphael's global hotkey", async () => {
    mount();
    await flush();
    await pick(3);
    send({ type: "AgentQuestion", id: "c-2", prefix: "問", text: "要關燈嗎", tier: "T2", timeout_ms: 60_000 });
    expect($(".ask-card-host").hidden).toBe(true);
    await pick(0);
    expect($(".ask-card-host").hidden).toBe(false);
    expect($(".ask-q").textContent).toBe("要關燈嗎");
    // what is typed in a member's thread later does not take Raphael's question along
    api.agentAskText.mockImplementation(() => new Promise<void>(() => {}));
    await pick(3);
    $<HTMLTextAreaElement>(".cmp-input").value = "考我";
    $<HTMLFormElement>(".composer").requestSubmit();
    await flush();
    expect($(".ask-card-host").hidden).toBe(true);
    await pick(0);
    expect($(".ask-card-host").hidden).toBe(false);
  });

  test("concurrent members keep their own approval cards and closed questions stay closed", async () => {
    const agent = mount(); await flush();
    send({ type: "AgentQuestion", id: "raphael", member_id: 0, prefix: "問", text: "儲存摘要？", tier: "T2", timeout_ms: 60_000 });
    send({ type: "AgentQuestion", id: "teacher", member_id: 3, prefix: "問", text: "開始練習？", tier: "T2", timeout_ms: 60_000 });
    expect($(".ask-q").textContent).toContain("儲存摘要？");
    await pick(3);
    expect($(".ask-q").textContent).toBe("開始練習？");
    await pick(4);
    expect($(".ask-card-host").hidden).toBe(true);
    send({ type: "AgentQuestionClosed", id: "teacher" });
    await pick(0);
    expect($(".ask-card-host").hidden).toBe(false);
    expect($(".ask-q").textContent).toContain("儲存摘要？");
    agent.hide(); agent.show(); await flush();
    expect($(".ask-card-host").hidden).toBe(false);
    await pick(3);
    expect($(".ask-card-host").hidden).toBe(true);
    agent.hide();
  });

  test("a turn of another thread reads the list again, not the open thread", async () => {
    vi.useFakeTimers();
    mount();
    await vi.runOnlyPendingTimersAsync();
    $('.mb-col [data-member="3"]').click();
    await vi.runOnlyPendingTimersAsync();
    api.agentHistoryList.mockClear();
    api.membersList.mockClear();
    send({ type: "AgentTurn", turn_id: 50, member_id: 4 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.agentHistoryList).not.toHaveBeenCalled();
    expect(api.membersList).toHaveBeenCalled();
    send({ type: "AgentTurn", turn_id: 51, member_id: 3 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(api.agentHistoryList).toHaveBeenCalledWith(expect.objectContaining({ member_id: 3 }));
  });

  test("a routine's unfinished run shows only live work until its reply arrives", async () => {
    THREADS[3] = [turn(32, { member_id: 3, source: "routine", route: "routine", prefix: "", question: "每天的單字", text: "", status: "running" })];
    mount();
    await flush();
    await pick(3);
    const run = $('.tn[data-id="32"]');
    expect(run.querySelector(".sys,.routine-origin")).toBeNull();
    expect(run.querySelector(".live-presence")).not.toBeNull();
    expect(run.querySelector(".me")).toBeNull();
    THREADS[3] = [turn(31, { member_id: 3, text: "今天的單字" })];
  });

  test("the slot of the questions from the background sits above the composer, in every thread", async () => {
    mount();
    await flush();
    const slot = $('[data-mount="background-questions"]');
    expect(slot.nextElementSibling).toBe($(".composer"));
    await pick(3);
    expect($('[data-mount="background-questions"]').nextElementSibling).toBe($(".composer"));
    expect(document.querySelectorAll('[data-mount="background-questions"]')).toHaveLength(1);
  });

  test("the gold card shows in the thread of its member only: their name there, Raphael's emblem in his, plain words in both", async () => {
    const asked = (member_id: number, text: string) => ({ id: `q-${member_id}`, task_id: 10 + member_id, member_id, prefix: "問", text, tier: null, created_at_ms: 1, expires_at_ms: 2 });
    const waiting: Record<number, ReturnType<typeof asked>[]> = { 0: [asked(0, "要付款嗎？")], 3: [asked(3, "要寄出信件嗎？")] };
    api.core.mockImplementation(async (method: string, params?: { member_id?: number }) =>
      method === "background.questions.list" ? { questions: waiting[params?.member_id ?? 0] ?? [] } : {},
    );
    mount();
    await flush();
    const slot = (): HTMLElement => $('[data-mount="background-questions"]');
    expect(slot().querySelector(".bgq-card")!.textContent).toContain("要付款嗎？");
    expect(slot().querySelector(".bgq-card")!.textContent).not.toContain("《");
    expect(slot().querySelector(".bgq-name")).toBeNull();
    expect(slot().querySelector(".bgq-card img,.bgq-card .av")).toBeNull();
    await pick(3);
    await flush();
    expect(api.core).toHaveBeenCalledWith("background.questions.list", { member_id: 3 });
    const cards = slot().querySelectorAll(".bgq-card");
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector(".card-title")!.textContent).toContain("日文老師");
    expect(cards[0].textContent).toContain("要寄出信件嗎？");
    expect(cards[0].textContent).not.toContain("《");
    expect(cards[0].querySelector("img")).toBeNull();
    await pick(0);
    await flush();
    expect(slot().querySelector(".bgq-card")!.textContent).toContain("要付款嗎？");
    api.core.mockReset();
  });

  test("what a colleague asked a member is one closed line in its chat, holding the question and the answer", async () => {
    THREADS[4] = [turn(42, { member_id: 4, peer_id: 0, route: "exchange", source: "member", scope: "exchange", question: "主人明天幾點有空？", text: "下午兩點以後" })];
    mount();
    await flush();
    await pick(4);
    const line = $<HTMLDetailsElement>('.exchange-event[data-exchange="42"]');
    expect(line.querySelector("summary")!.textContent).toBe("訊息來自 拉斐爾");
    expect(line.open).toBe(false);
    expect(document.querySelector('.tn[data-id="42"] .me')).toBeNull();
    expect([...line.querySelectorAll(".exchange-message")].map((message) => message.textContent)).toEqual(["主人明天幾點有空？"]);
    expect(document.querySelector('.tn[data-id="42"] .ra')!.textContent).toContain("下午兩點以後");
  });

  test("the core is told which thread is on screen, and none once the page goes", async () => {
    const agent = mount();
    await flush();
    expect(api.membersViewing).toHaveBeenLastCalledWith(0);
    await pick(3);
    expect(api.membersViewing).toHaveBeenLastCalledWith(3);
    agent.hide();
    await flush();
    expect(api.membersViewing).toHaveBeenLastCalledWith(null);
  });

  test("switching threads shows their own drafts, and a failed earlier ask does not overwrite the new thread's composer", async () => {
    let failAsk!: (err: Error) => void;
    api.agentAskText.mockImplementationOnce(() => new Promise<void>((_, rej) => (failAsk = rej)));
    mount();
    await flush();
    await pick(3);
    const input = $<HTMLTextAreaElement>(".cmp-input");
    input.value = "給日文老師的草稿";
    await pick(4);
    expect(input.value).toBe("");

    await pick(3);
    input.value = "考我單字";
    $<HTMLFormElement>(".composer").requestSubmit();
    await pick(4);
    input.value = "給管家的話";
    failAsk(new Error("network down"));
    await flush();
    expect(input.value).toBe("給管家的話");
  });

  test("refocusing the window while scrolled up in a thread does not jump scroll to the bottom", async () => {
    const agent = mount();
    await flush();
    const scroller = $<HTMLElement>(".ra-scroll");
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 200, configurable: true });
    scroller.scrollTop = 100;
    agent.show();
    await flush();
    expect(scroller.scrollTop).toBe(100);
  });
});

describe("a new member", () => {
  const OFFER = { title: "每天早上的進度", prompt: "看進度", schedule: { kind: "daily" as const, time: "09:00" } };

  async function create(offer: typeof OFFER | null): Promise<void> {
    const made = member(7, { name: "進度官", group_id: null });
    api.membersCreate.mockResolvedValue({ member: made, routine_offer: offer });
    api.routinesCreate.mockResolvedValue({ routine: {} });
    api.membersList.mockResolvedValue(structuredClone(LIST));
    mount();
    await flush();
    api.membersList.mockResolvedValue({ ...structuredClone(LIST), members: [...structuredClone(LIST).members, made] });
    $('[data-col="add"]').click();
    $('#app-popover [data-pick="member"]').click();
    const name = $<HTMLInputElement>("#mb-new-name");
    name.value = "進度官";
    name.dispatchEvent(new Event("input"));
    $('[data-dlg="create"]').click();
    await flush();
  }

  test("is made in the language of the window and opened; the routine the core offers is asked, 加入 makes it", async () => {
    vi.useFakeTimers();
    await create(OFFER);
    expect(api.membersCreate).toHaveBeenCalledWith(expect.objectContaining({ name: "進度官", group_id: null, ui_language: "zh-TW", greet: true, avatar: expect.stringMatching(/^slime:/) }));
    expect($(".mb-pill-t").textContent).toBe("進度官");
    expect(api.routinesCreate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect($(".mb-dialog h2").textContent).toBe("加入例行任務？");
    $('[data-dlg="yes"]').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(api.routinesCreate).toHaveBeenCalledWith({ member_id: 7, ...OFFER });
  });

  test("不用 leaves the routine out, and no offer asks nothing", async () => {
    vi.useFakeTimers();
    await create(OFFER);
    await vi.advanceTimersByTimeAsync(10);
    $('[data-dlg="no"]').click();
    await vi.advanceTimersByTimeAsync(10);
    expect(api.routinesCreate).not.toHaveBeenCalled();
    document.body.innerHTML = "";
    await create(null);
    await vi.advanceTimersByTimeAsync(10);
    expect(document.querySelector(".mb-dialog")).toBeNull();
  });

  test("opened from the narrow-window picker closes the menu first and returns focus to the picker on Escape", async () => {
    mount();
    await flush();
    const picker = $<HTMLButtonElement>(".mb-pick");
    picker.click();
    expect(document.getElementById("app-popover")).not.toBeNull();
    $<HTMLElement>('#app-popover [data-action="2"]').click();
    expect(document.getElementById("app-popover")).toBeNull();
    expect(document.querySelector(".mb-dialog")).not.toBeNull();
    expect(document.activeElement?.id).toBe("mb-new-name");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".mb-scrim")).toBeNull();
    expect(document.activeElement).toBe(picker);
  });
});

describe("the details panel", () => {
  test("its × closes it, and the pill brings it back", async () => {
    vi.useFakeTimers();
    mount();
    await vi.runOnlyPendingTimersAsync();
    const panel = $(".mb-det");
    const open = panel.hidden === false;
    if (!open) $(".conversation-trigger").click();
    expect($(".mb-det").hidden).toBe(false);
    expect($(".page-agent").dataset.det).toBe("open");
    $('[data-det="close"]').click();
    await vi.advanceTimersByTimeAsync(200);
    expect($(".mb-det").hidden).toBe(true);
    expect($(".page-agent").dataset.det).toBeUndefined();
    await pick(0);
    expect($(".mb-det").hidden).toBe(true);
    $(".conversation-trigger").click();
    expect($(".mb-det").hidden).toBe(false);
  });

  test("renaming the open member in the details panel updates the composer placeholder and thread faces", async () => {
    mount();
    await flush();
    await pick(3);
    if ($(".mb-det").hidden) $(".conversation-trigger").click();
    $('[data-det="gear"]').click();
    api.membersUpdate.mockResolvedValue({ member: { ...LIST.members[1], name: "嚴格老師" } });
    api.membersList.mockResolvedValue({
      ...structuredClone(LIST),
      members: LIST.members.map((m) => (m.id === 3 ? { ...m, name: "嚴格老師" } : m)),
    });
    const name = $<HTMLInputElement>("#mb-det-name");
    name.focus();
    name.value = "嚴格老師";
    name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    expect($<HTMLTextAreaElement>(".cmp-input").placeholder).toBe("傳訊息給 嚴格老師");
    expect($(".mb-pill-face svg.slime")).not.toBeNull();
    expect($(".thread .ra-face")).toBeNull();
  });
});

test("a core without the members: Raphael alone, and the page works as before", async () => {
  api.membersList.mockRejectedValue("mock: members.list");
  mount();
  await flush();
  expect(document.querySelectorAll(".mb-col .mb-list .mb-row")).toHaveLength(1);
  expect($(".mb-col .mb-chief b").textContent).toBe("拉斐爾");
  expect($(".thread").textContent).toContain("回答 2");
});

test("a changed roster preview retains the prompt and empty-page faces", async () => {
  mount(); await flush();
  const prompt = $(".ask-face .av"), hero = $(".ra-hero .av");
  api.membersList.mockResolvedValue({ ...LIST, members: LIST.members.map(member => member.id === 3 ? { ...member, preview: "A new preview" } : member) });
  send({ type: "MembersChanged" }); await flush();
  expect($(".ask-face .av")).toBe(prompt); expect($(".ra-hero .av")).toBe(hero);
  expect(document.querySelector('[data-member="3"] .mb-row-p')?.textContent).toContain("A new preview");
});


test("rooms replace the main conversation pane and member selection returns to its thread", async()=>{
 const agent=mount();await flush();const original=agent.el.querySelector<HTMLElement>(".mb-chat")!;
 window.dispatchEvent(new CustomEvent("raphael:open-room",{detail:{roomId:1}}));await flush();
 expect(original.hidden).toBe(true);expect(agent.el.querySelector<HTMLElement>(".au-room-pane")!.hidden).toBe(false);expect(agent.el.querySelector(".au-room-heading")!.textContent).toContain("Launch");expect(document.querySelector('[role="dialog"]')).toBeNull();
 await pick(3);expect(original.hidden).toBe(false);expect(agent.el.querySelector<HTMLElement>(".au-room-pane")!.hidden).toBe(true);expect(agent.el.querySelector(".thread")!.textContent).toContain("10");
});

test.each(['room','hidden'])("opening member details in a %s page never polls or opens a computer stream", async scope=>{
 api.desktopStatus.mockResolvedValue({state:'running',ready:true,control:'member'});
 api.desktopOpen.mockResolvedValue({session:'sample',url:'http://127.0.0.1:9/sample'});
 const agent=mount(); await flush();
 if(scope==='room') window.dispatchEvent(new CustomEvent('raphael:open-room',{detail:{roomId:1}}));
 else agent.hide();
 await flush();
 api.desktopOpen.mockClear(); api.desktopStatus.mockClear();
 agent.el.querySelector<HTMLButtonElement>('[data-act="computer"]')!.click(); await flush();
 expect(api.desktopStatus).not.toHaveBeenCalled(); expect(api.desktopOpen).not.toHaveBeenCalled();
 agent.hide();
});


test("an approval retry never answers a replacement question", async () => {
 mount(); await flush();
 const ask=(id:string)=>({type:"AgentQuestion",id,prefix:"",text:"Review the sample note?",tier:"T2",timeout_ms:30000} as const);
 send(ask("old")); api.agentQuestionAnswer.mockRejectedValueOnce(new Error("synthetic failure"));
 $(".ask-yes").click(); await flush();
 const retry=document.querySelector<HTMLButtonElement>('[data-card-retry]')!;expect(retry).not.toBeNull();
 send({type:"AgentQuestionClosed",id:"old"}); send(ask("replacement"));
 retry.click(); await flush();
 expect(api.agentQuestionAnswer).toHaveBeenCalledTimes(1);
 expect(document.querySelector('.ask-card-host [data-card-retry]')).toBeNull();
});


test("a burst of turn events while typing makes one history request and preserves the draft and nodes", async () => {
  vi.useFakeTimers();
  const agent = mount(); await flush(); await pick(3);
  const input = agent.el.querySelector<HTMLTextAreaElement>(".composer textarea")!;
  input.value = "Keep typing this draft"; input.dispatchEvent(new Event("input"));
  const node = $('.tn[data-id="31"]');
  api.agentHistoryList.mockClear();
  for (let i = 0; i < 5; i++) {
    send({ type: "AgentTurn", turn_id: 31, member_id: 3 });
    await vi.advanceTimersByTimeAsync(20);
  }
  expect(api.agentHistoryList).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(500); await flush();
  expect(api.agentHistoryList).toHaveBeenCalledTimes(1);
  expect(api.agentHistoryList.mock.calls[0]![0]).toMatchObject({after_id:expect.any(Number),turn_ids:[31]});
  expect(input.value).toBe("Keep typing this draft");
  expect($('.tn[data-id="31"]')).toBe(node);
  agent.hide();
});

test("an empty conversation keeps its empty state while an event refreshes it", async () => {
  vi.useFakeTimers();
  api.agentHistoryList.mockImplementation(async () => ({ turns: [] }));
  const agent = mount(); await flush(); await pick(3);
  const empty = $(".ra-empty");
  expect(empty.hidden).toBe(false);
  let answer!: (value: { turns: never[] }) => void;
  api.agentHistoryList.mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  send({ type: "AgentTurn", turn_id: 0, member_id: 3 });
  await vi.advanceTimersByTimeAsync(500); await flush();
  expect(api.agentHistoryList).toHaveBeenCalled();
  expect(empty.hidden).toBe(false);
  answer({ turns: [] }); await flush();
  expect(empty.hidden).toBe(false);
  agent.hide();
});

test("a cleared conversation reads its history whole, so its old turns leave the screen", async () => {
  vi.useFakeTimers();
  const agent = mount(); await flush(); await pick(3);
  expect(document.querySelector('.tn[data-id="31"]')).not.toBeNull();
  const fresh = { ...structuredClone(THREADS[3]![0]!), id: 40 };
  const last = () => api.agentHistoryList.mock.calls[api.agentHistoryList.mock.calls.length - 1]![0];
  api.agentHistoryList.mockClear();
  api.agentHistoryList.mockImplementation(async (q: { after_id?: number }) => q.after_id === undefined ? { turns: [structuredClone(fresh)] } : { turns: [], delta: true, removed_ids: [] });
  send({ type: "ConversationsChanged", member_id: 3 });
  send({ type: "AgentTurn", turn_id: 0, member_id: 3 });
  await vi.advanceTimersByTimeAsync(500); await flush();
  expect(api.agentHistoryList.mock.calls.some(([q]) => !("after_id" in q))).toBe(true);
  expect(document.querySelector('.tn[data-id="31"]')).toBeNull();
  expect(document.querySelector('.tn[data-id="40"]')).not.toBeNull();
  send({ type: "AgentTurn", turn_id: 40, member_id: 3 });
  await vi.advanceTimersByTimeAsync(500); await flush();
  expect(last()).toMatchObject({ after_id: 40 });
  agent.hide();
});

test("a finished turn reads its colleagues' receipts again while they work and when one ends", async () => {
  vi.useFakeTimers();
  const handoff = { task_id: 77, source_turn_id: 31, work_turn_id: 90, member_id: 4, member_name: "Sample colleague", from_member_id: 3, stage_id: "check",
    mode: "work" as const, state: "running", reason: null, created_at_ms: 1, ready_at_ms: 1, dispatch_policy: "immediate" as const, result: "", evidence: [] };
  const history = structuredClone(THREADS[3]!); history[0]!.handoffs = [handoff];
  api.agentHistoryList.mockImplementation(async (q: { member_id?: number }) => ({ turns: q.member_id === 3 ? structuredClone(history) : THREADS[0] }));
  const agent = mount(); await flush(); await pick(3);
  const lastAsked = () => { const reads = api.agentHistoryList.mock.calls.filter(([q]) => "after_id" in q); return reads[reads.length - 1]?.[0].turn_ids; };
  const read = async (q: { after_id?: number; turn_ids?: number[] }) => q.after_id === undefined ? { turns: structuredClone(history) }
    : { turns: structuredClone(history).filter(item => q.turn_ids?.includes(item.id)), delta: true, removed_ids: [] };
  api.agentHistoryList.mockClear();
  api.agentHistoryList.mockImplementation(read);
  send({ type: "WorkerChanged", task_id: 88, state: "running", running: true });
  await vi.advanceTimersByTimeAsync(3000); await flush();
  expect(lastAsked()).toContain(31);
  history[0]!.handoffs = [{ ...handoff, state: "done" }];
  send({ type: "AgentTurn", turn_id: 0, member_id: 3 });
  await vi.advanceTimersByTimeAsync(3000); await flush();
  expect(lastAsked()).toContain(31);
  send({ type: "AgentTurn", turn_id: 0, member_id: 3 });
  await vi.advanceTimersByTimeAsync(3000); await flush();
  expect(lastAsked()).not.toContain(31);
  send({ type: "WorkerChanged", task_id: 77, state: "failed", running: false });
  await vi.advanceTimersByTimeAsync(3000); await flush();
  expect(lastAsked()).toContain(31);
  agent.hide();
});

test("finding a folded work receipt preserves the reply and its match through a roster refresh", async () => {
  vi.useFakeTimers();
  const history = structuredClone(THREADS[3]!);
  history[0]!.messages = [{ seq: 1, kind: "event", text: "Sample briefing ready", at_ms: history[0]!.created_at_ms }, { seq: 2, kind: "reply", text: history[0]!.text, at_ms: history[0]!.created_at_ms }];
  api.agentHistoryList.mockImplementation(async (q: {member_id?: number}) => ({ turns: q.member_id === 3 ? structuredClone(history) : THREADS[0] }));
  const agent = mount(); await flush(); await pick(3);
  $('[data-act="search"]').click();
  const input = $<HTMLInputElement>('.ra-find-input');
  input.value = "Sample briefing"; input.dispatchEvent(new Event("input"));
  await vi.advanceTimersByTimeAsync(250); await flush();
  const node = $('.tn[data-id="31"]'), mark = $('mark.is-current');
  expect(mark.textContent).toBe("Sample briefing");
  expect(node.querySelector<HTMLElement>('.work-body')!.hidden).toBe(false);
  send({ type: "MembersChanged" });
  await vi.advanceTimersByTimeAsync(500); await flush();
  expect($('.tn[data-id="31"]')).toBe(node);
  expect($('mark.is-current')).toBe(mark);
  agent.hide();
});

test("a same-length reply edit still refreshes without serializing the full history", async () => {
  vi.useFakeTimers();
  const agent = mount(); await flush(); await pick(3);
  const changed = structuredClone(THREADS[3]!);
  const edited = "X".repeat(changed[0]!.text.length);
  changed[0]!.text = edited;
  api.agentHistoryList.mockResolvedValueOnce({ turns: changed });
  send({ type: "AgentTurn", turn_id: 31, member_id: 3 });
  await vi.advanceTimersByTimeAsync(500); await flush();
  expect($('.tn[data-id="31"]').textContent).toContain(edited);
  agent.hide();
});


test("computer search navigation leaves a room and restores the computer landing panel", async () => {
  api.settingsGet.mockResolvedValue({settings:{computer_ssh_alias:""}});
  const agent = mount(); await flush();
  window.dispatchEvent(new CustomEvent("raphael:open-room", {detail:{roomId:1}})); await flush();
  agent.show("computer"); await flush();
  expect(agent.el.querySelector<HTMLElement>(".au-room-pane")!.hidden).toBe(true);
  expect(agent.el.querySelector<HTMLElement>(".mb-det")!.hidden).toBe(false);
  expect(agent.el.querySelector<HTMLElement>(".mb-det")!.dataset.detailsTab).toBe("computer");
  expect(agent.el.querySelector(".mb-det [data-computer-location]")).not.toBeNull();
  agent.el.querySelector<HTMLButtonElement>('[data-det="gear"]')!.click();
  agent.show("computer"); await flush();
  expect(agent.el.querySelector<HTMLElement>(".mb-det")!.dataset.detailsTab).toBe("computer");
  agent.hide();
});

test("a metadata-only reply update does not force latest again", async () => {
  vi.useFakeTimers();
  const agent = mount(); await flush(); await pick(3);
  await vi.advanceTimersByTimeAsync(100); await flush();
  const scroll = $('.mb-chat .ra-scroll'), write = vi.fn();
  Object.defineProperty(scroll, 'scrollTop', { get: () => 0, set: write });
  const node = $('.tn[data-id="31"]');
  const changed = structuredClone(THREADS[3]!);
  changed[0]!.session_id = 'updated-session';
  api.agentHistoryList.mockResolvedValueOnce({ turns: changed });
  send({ type: "AgentTurn", turn_id: 31, member_id: 3 });
  await vi.advanceTimersByTimeAsync(500); await flush();
  expect($('.tn[data-id="31"]')).toBe(node);
  expect(write).not.toHaveBeenCalled();
  agent.hide();
});
