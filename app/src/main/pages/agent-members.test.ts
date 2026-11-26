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
  membersSkillsList: vi.fn(), membersCommandsList: vi.fn(),
  membersUpdate: vi.fn(), groupsUpdate: vi.fn(),
  membersCreate: vi.fn(),
  membersGreet: vi.fn(async () => ({ turn_id: 99 })),
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
  desktopStatus: vi.fn(), desktopOpen: vi.fn(), desktopRenew: vi.fn(), desktopClose: vi.fn(), desktopControl: vi.fn(),
}));
vi.mock("../api", () => api);

import { Cleared } from "../cleared";
import { createAgent } from "./agent";
import { openDialog } from "../member-dialogs";
import { openGroupChat } from "../group-chats";
import { closeMenu } from "../ui";
import { resetAsks } from "../chat-ask";
import { describeError } from "../format";
import { clearLayerForward } from "../nav-history";
import { stepOpenLayer } from "../dismissals";
import { installNavInput } from "../nav-input";
import { PlaceHistory, stepPlace } from "../place-history";
import { navInputs, sendNavInput } from "../test-support/nav-layer-input";

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
/** The same roster with a chief of staff, who is a slime (Raphael is member 0 and never one), as the core lists it. */
const withChief = (primary: number | null): MembersList => ({
  ...structuredClone(LIST),
  members: LIST.members.map(m => ({ ...m, ...(m.id === 0 ? { raphael: true as const } : {}), chief: m.id === primary })),
  team_context: { primary_id: primary, chief_id: primary, members: LIST.members.filter(m => m.id !== 0).map(m => ({ id: m.id, name: m.name, role: m.role, blurb: "" })) } as unknown as MembersList["team_context"],
});
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

function mount(mode: "hold" | "toggle" = "hold", history?: PlaceHistory) {
  const notePlace = (): void => { history?.arrive(agent.currentChatPlace()); };
  const app = {
    go: vi.fn((page: string, arg?: Parameters<ReturnType<typeof createAgent>["show"]>[0]) => {
      if (page === "agent" && (arg?.startsWith("member-settings:") || !arg && agent.settingsOf() !== null)) agent.show(arg);
      notePlace();
    }),
    device: () => ({ dictation_mode: mode }),
    onEvent(handler: (event: MainEvent) => void) {
      send = handler;
      return () => {};
    },
    undo: { begin: vi.fn() },
    cleared: new Cleared(),
  } as unknown as AppContext;
  const agent = createAgent(app, { changed: notePlace, resolved: (member, conversation) => history?.resolveConversation(member, conversation) });
  document.body.append(agent.el);
  agent.el.hidden=false;
  agent.show();
  notePlace();
  opened = agent;
  return agent;
}
const $ = <T extends HTMLElement>(q: string) => document.querySelector<T>(q)!;
/** Edit and Cancel live in a message's ⋯ menu (agent.ts messageMenu), not beside it. */
const pickMessage = (scope: string, pick: "edit" | "cancel"): void => { $(`${scope} [data-act="more-message"]`).click(); $(`#app-popover [data-pick="${pick}"]`).click(); };
let opened: ReturnType<typeof createAgent> | undefined;
/** Opens a conversation: a slime's from the sidebar, Raphael's by the account menu's route (it is no row of the sidebar). */
const pick = async (id: number) => {
  if (id === 0) opened!.show("raphael"); else $(`.mb-col [data-member="${id}"]`).click();
  await flush();
};

test.each(["owner", "watching"])("outside presses in the conversation, sidebar and panel header preserve the enlarged computer (%s)", async mode => {
  const running = { state: "running", ready: true, control: "member", transport: "host", target: "tab" };
  api.desktopStatus.mockResolvedValue(running);
  api.desktopOpen.mockResolvedValue({ session: "outside", url: "http://127.0.0.1:5000/outside" });
  api.desktopRenew.mockResolvedValue(running);
  api.desktopControl.mockResolvedValue({ ...running, control: "owner" });
  const agent = mount();
  try {
    await flush();
    await pick(3);
    const trigger = $(".conversation-trigger");
    if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
    $('[data-det="tab"][data-tab="computer"]').click();
    await flush();
    const frame = $<HTMLIFrameElement>(".desktop-screen iframe");
    const signal = (state: string, held = false) => window.dispatchEvent(new MessageEvent("message", {
      source: frame.contentWindow, origin: "http://127.0.0.1:5000", data: { type: "raphael-desktop", state, held },
    }));
    signal("connected");
    $('[data-desktop="enlarge"]').click();
    if (mode === "owner") {
      $('[data-desktop="take"]').click();
      await flush();
      signal("interactive", true);
    }
    const closeCount = api.desktopClose.mock.calls.length;
    // In the floating layout the scrim receives a press over the conversation.
    for (const selector of [".mb-det-scrim", ".composer", ".mb-col", ".conversation-trigger"]) {
      const target = $(selector);
      target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
      target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 }));
      target.click();
      await flush();
      expect(api.desktopClose.mock.calls.slice(closeCount), selector).toEqual([]);
      expect($(".desktop-panel").hasAttribute("data-expanded"), selector).toBe(true);
      expect($(".desktop-screen iframe"), selector).toBe(frame);
      expect($(".desktop-panel").dataset.interactive, selector).toBe(String(mode === "owner"));
    }
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    if (mode === "owner") {
      api.desktopControl.mockResolvedValue(running);
      $('[data-desktop="return"]').click();
      await flush();
    }
    $('[data-desktop="collapse"]').click();
  } finally {
    agent.hide();
  }
});

test.each(navInputs)("Back closes the open Computer panel and Forward restores its tab with %s", async input => {
  const agent = mount();
  const stop = installNavInput(window, stepOpenLayer);
  try {
    await flush(); await pick(3);
    const trigger = $(".conversation-trigger");
    if (trigger.getAttribute("aria-expanded") === "true") trigger.click();
    trigger.click();
    const panel = $("#member-details");
    $('[data-det="tab"][data-tab="computer"]').click();
    expect(panel.dataset.detailsTab).toBe("computer");
    sendNavInput(input, "back");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(agent.currentChatPlace().page).toBe("member");
    sendNavInput(input, "forward");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel.dataset.detailsTab).toBe("computer");
  } finally { stop(); clearLayerForward(); agent.hide(); }
});

test.each(navInputs)("Back closes member settings from Skills and Forward restores Skills with %s", async input => {
  const agent = mount();
  const stop = installNavInput(window, stepOpenLayer);
  try {
    await flush(); await pick(3);
    agent.show("member-settings:3");
    $('[data-ms="cat"][data-cat="skills"]').click();
    expect($('[data-ms="cat"][data-cat="skills"]').getAttribute("aria-current")).toBe("page");
    sendNavInput(input, "back");
    expect(agent.settingsOf()).toBeNull();
    sendNavInput(input, "forward");
    expect(agent.settingsOf()).toBe(3);
    expect($('[data-ms="cat"][data-cat="skills"]').getAttribute("aria-current")).toBe("page");
  } finally { stop(); clearLayerForward(); agent.hide(); }
});

test("Back keeps a member's unsent composer draft in its conversation", async () => {
  const history = new PlaceHistory();
  const agent = mount("hold", history);
  const show = vi.fn();
  const stop = installNavInput(window, direction => stepPlace(direction, history, {
    layer: stepOpenLayer, leave: agent.keepNavigationPlace, exists: () => true, show,
  }));
  try {
    await flush(); await pick(3); await pick(4);
    const composer = $<HTMLTextAreaElement>(".page-agent .cmp-input");
    composer.value = "Keep this unsent";
    sendNavInput("mouse", "back");
    expect(show).not.toHaveBeenCalled();
    expect(composer.value).toBe("Keep this unsent");
    expect(document.activeElement).toBe(composer);
  } finally { stop(); agent.hide(); }
});

test("mouse Back closes the dialog over the current member before walking conversation history", async () => {
  const history = new PlaceHistory();
  const agent = mount("hold", history);
  const stop = installNavInput(window, direction => stepPlace(direction, history, {
    layer: stepOpenLayer,
    exists: place => place.page === "member" && agent.chatPlaceExists(place),
    show: place => { if (place.page === "member") agent.showChatPlace(place); },
  }));
  try {
    await flush();
    await pick(3);
    const first = agent.currentChatPlace();
    await pick(4);
    const current = agent.currentChatPlace();
    const dialog = openDialog({ title: "Review", body: '<textarea></textarea>', actions: {}, onAct() {} });
    try {
      const field = dialog.el.querySelector("textarea")!;
      field.value = "Keep these words";
      sendNavInput("mouse", "back");
      expect(dialog.el.isConnected).toBe(true);
      expect(field.value).toBe("Keep these words");
      field.value = "";
      sendNavInput("mouse", "back");
      expect(dialog.el.isConnected).toBe(false);
      expect(agent.currentChatPlace()).toEqual(current);
      sendNavInput("mouse", "forward");
      expect(dialog.el.isConnected).toBe(true);
      sendNavInput("mouse", "back");
      sendNavInput("mouse", "back");
      expect(agent.currentChatPlace()).toEqual(first);
    } finally { dialog.close(); clearLayerForward(); }
  } finally { stop(); agent.hide(); }
});

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

test("share sits in a member's conversation header, opposite the status light, and asks the member to write its template there", async () => {
  resetAsks(); api.agentAskText.mockResolvedValue({});
  const agent = mount(); await flush();
  expect($('[data-act="share-member"]').hidden).toBe(true); // Raphael is the app's own
  await pick(3);
  const share = $('.mb-head .ra-tools [data-act="share-member"]');
  expect(share.hidden).toBe(false);
  expect($('.mb-head .mb-head-l [data-act="status"]')).not.toBeNull();
  expect($('.mb-head [data-act="search"]')).toBeNull();
  share.click();
  $('#app-popover [data-action="0"]').click(); await flush();
  expect(api.agentAskText).toHaveBeenCalledWith(expect.any(String), [], 3, { intent: "share-template" });
  closeMenu(); agent.hide();
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

test("a thread whose boundary is still on its way is drawn but not shown, then shown at its place once", async () => {
  // The first place is the last: a thread seen at the bottom and then moved to the line jumped up.
  let deliver!: (list: MembersList) => void;
  const roster = structuredClone(LIST);
  Object.assign(roster.members[0], { unread: true, unread_from: 2 });
  api.membersList.mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
  const agent = mount(); await flush();
  expect($('.mb-chat .tn[data-id="1"]')).not.toBeNull();
  expect($('.mb-chat .ra-scroll').classList.contains("is-opening")).toBe(true);
  deliver(roster); await flush();
  expect($('.mb-chat .ra-scroll').classList.contains("is-opening")).toBe(false);
  expect($('.thread-new').nextElementSibling).toBe($('.tn[data-id="2"]'));
  agent.hide();
});

test("a page shown again takes its boundary from the roster it has, so a late roster moves nothing", async () => {
  const roster = structuredClone(LIST);
  api.membersList.mockImplementation(async () => structuredClone(roster));
  const agent = mount(); await flush();
  agent.hide();
  // News came while the page was away; the roster that carries it is read again late when the page is shown.
  Object.assign(roster.members[0], { unread: true, unread_from: 2 });
  send({ type: "MembersChanged" } as MainEvent);
  await new Promise(resolve => setTimeout(resolve, 400)); await flush();
  let deliver!: (list: MembersList) => void;
  api.membersList.mockImplementation(() => new Promise(resolve => { deliver = resolve; }));
  agent.show(); await flush();
  const divider = document.querySelector('.thread-new');
  expect(divider).not.toBeNull();
  expect($('.mb-chat .ra-scroll').classList.contains("is-opening")).toBe(false);
  deliver(structuredClone(roster)); await flush();
  expect($('.thread-new')).toBe(divider);
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

test("Raphael's conversation and its quick questions keep their own drafts through activity, sending and other members", async () => {
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

test("the sidebar opens its member's waiting card without clearing Raphael's quick conversation", async () => {
  const conversations = [
    { id: 701, member_id: 0, is_default: 1, kind: "standard" },
    { id: 702, member_id: 0, is_default: 0, kind: "quick" },
    { id: 703, member_id: 3, is_default: 1, kind: "standard" },
  ];
  api.core.mockImplementation(async (method: string, params?: { member_id?: number }) => method === "conversations.list"
    ? { conversations: conversations.filter(item => item.member_id === (params?.member_id ?? 0)) }
    : { questions: [] });
  const roster: MembersList = {
    groups: [],
    members: [
      member(0, { main_conversation_id: 701, unread: true, unread_threads: [{ conversation_id: 702, from: 1, kind: "done" }] }),
      member(3, { main_conversation_id: 703, unread_threads: [], waiting: true, waiting_cards: [{ id: "sample", conversation_id: 703 }] }),
    ],
  };
  api.membersList.mockResolvedValue(roster);
  const agent = mount(); await flush();
  const status = $('.mb-head [data-act="status"]');
  expect(status.dataset.dot).toBe("needs");
  await pick(3);
  expect(status.dataset.dot).toBe("done");
  status.click();
  expect(status.dataset.dot).toBe("done");
  $('.menu-choice[data-value="0:702"]').click(); await flush();
  expect(agent.currentChatPlace()).toEqual({ page: "member", member: 0, conversation: 702 });
  expect(api.membersRead).toHaveBeenCalledWith(0, 702);
  expect(status.dataset.dot).toBeUndefined();
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

test("the details panel has no fold button: its left edge drags it, narrower than it can be it closes, and it reopens at its width", async () => {
  localStorage.removeItem("raphael.panel.width");
  const agent = mount(); await flush(); await pick(3);
  await openDetails();
  const panel = document.querySelector<HTMLElement>(".mb-det")!, page = panel.parentElement!;
  const edge = panel.querySelector<HTMLElement>(":scope > .det-edge")!;
  expect(edge.getAttribute("role")).toBe("separator");
  panel.getBoundingClientRect = () => ({ left: 700, right: 1120, width: 420, top: 0, bottom: 900, height: 900, x: 700, y: 0, toJSON() {} }) as DOMRect;
  edge.setPointerCapture = vi.fn(); edge.hasPointerCapture = () => true; edge.releasePointerCapture = vi.fn();
  const drag = (...xs: number[]): void => {
    edge.dispatchEvent(new PointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: xs[0], bubbles: true }));
    for (const x of xs.slice(1)) edge.dispatchEvent(new PointerEvent("pointermove", { pointerId: 1, clientX: x, bubbles: true }));
    edge.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, bubbles: true }));
  };
  drag(700, 600);
  expect(page.style.getPropertyValue("--pa-det")).toBe("520px");
  expect(localStorage.getItem("raphael.panel.width")).toBe("520");
  drag(600, 1000);
  await vi.waitFor(() => expect(panel.hidden).toBe(true));
  await openDetails();
  expect(page.style.getPropertyValue("--pa-det")).toBe("520px");
  localStorage.removeItem("raphael.panel.width");
  agent.hide();
});

test("the settings page folds the details panel away at any width, and leaving it puts the panel back as it was", async () => {
  const agent = mount(); await flush(); await pick(3);
  await openDetails();
  const panel = document.querySelector<HTMLElement>(".mb-det")!;
  expect(panel.hidden).toBe(false);
  agent.show("member-settings:3"); await flush();
  await vi.waitFor(() => expect(panel.hidden).toBe(true));
  expect(document.querySelector<HTMLElement>("[data-member-settings]")!.hidden).toBe(false);
  agent.show(); await flush();
  await vi.waitFor(() => expect(panel.hidden).toBe(false));
  // A panel that was closed stays closed after the page.
  $('[data-det="close"]').click(); await flush();
  await vi.waitFor(() => expect(panel.hidden).toBe(true));
  agent.show("member-settings:3"); await flush();
  agent.show(); await flush();
  expect(panel.hidden).toBe(true);
  agent.hide();
});

test("a closed details panel reads nothing while work runs, and the settings page reads its counts only once it is opened", async () => {
  const agent = mount(); await flush(); await pick(3);
  expect(document.querySelector<HTMLElement>(".mb-det")!.hidden).toBe(true);
  api.core.mockClear(); api.membersSkillsList.mockClear(); api.membersCommandsList.mockClear();
  send({ type: "CoreReady" } as unknown as MainEvent); await flush();
  const read = (): string[] => api.core.mock.calls.map(([method]) => method as string);
  expect(read()).not.toContain("memory.get");
  expect(api.membersSkillsList).not.toHaveBeenCalled(); expect(api.membersCommandsList).not.toHaveBeenCalled();
  // The panel no longer counts skills or commands: those are the settings page's.
  await openDetails();
  expect(read()).not.toContain("memory.get"); expect(api.membersSkillsList).not.toHaveBeenCalled();
  agent.show("member-settings:3"); await flush();
  // The page holds no memory to read, only what the member has.
  expect(read()).not.toContain("memory.get");
  expect(api.membersSkillsList).toHaveBeenCalledWith(3); expect(api.membersCommandsList).toHaveBeenCalledWith(3);
  agent.hide();
});

test("a restarted core receives the current viewing even with an unchanged roster", async () => {
  const agent = mount(); await flush(); await pick(3); await openDetails();
  api.membersViewing.mockClear(); api.membersList.mockClear();
  api.core.mockClear();
  send({ type: "CoreReady" } as unknown as MainEvent); await flush();
  expect(api.membersList).toHaveBeenCalledTimes(1);
  expect(api.membersViewing).toHaveBeenCalledExactlyOnceWith(3);
  // The open settings page reads what the member has again for the restarted core.
  agent.show("member-settings:3"); await flush();
  api.membersSkillsList.mockClear();
  send({ type: "CoreReady" } as unknown as MainEvent); await flush();
  await vi.waitFor(() => expect(api.membersSkillsList).toHaveBeenCalledWith(3));
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
  api.membersList.mockResolvedValue(withChief(3));
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
  await pick(4);
  expect($('[data-member="4"]').getAttribute('aria-current')).toBe('true');
  expect($('.mb-chief .av')).toBe(face);
  agent.hide();
});

test("sidebar pin and hide update only their target and hiding the open member opens the next slime", async () => {
  const agent = mount(); await flush(); await pick(3);
  api.membersUpdate.mockResolvedValue({});
  $('[data-member-more="3"]').click(); $('[data-pick="pin"]').click(); await flush();
  expect(api.membersUpdate).toHaveBeenCalledWith(3, {pinned: true});
  $('[data-member-more="3"]').click(); $('[data-pick="hide"]').click(); await flush();
  expect(api.membersUpdate).toHaveBeenCalledWith(3, {hidden: true});
  expect(document.querySelector('.mb-col [data-member="4"][aria-current="true"]')).not.toBeNull();
  agent.hide();
});

test("an unconfigured Raphael is immediately usable, and so is an empty member", async () => {
  api.membersList.mockResolvedValue({...LIST,members:LIST.members.map(m=>({...m,profile_ready:false}))});
  api.agentHistoryList.mockResolvedValue({turns:[]});
  const agent=mount(); await flush();
  for (const id of [0,3,0]) {
    await pick(id);
    expect(document.querySelector('.first-bot')).toBeNull();
    expect($('.composer').hidden).toBe(false);
    expect($('.ra-hi').hidden).toBe(false);
  }
  agent.hide();
});

test("a member's menu no longer clears its one conversation (one conversation per member, R-UI-103)", async () => {
  const agent = mount(); await flush(); await pick(3);
  $('[data-member-more="3"]').click();
  expect(document.querySelector('#app-popover [data-pick="clear"]')).toBeNull();
  expect(api.core).not.toHaveBeenCalledWith("agent.history.clear", expect.anything());
  agent.hide();
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

test("a member is deleted from its ⋯ menu only after the confirmation, and its open thread moves to the next slime", async () => {
  api.membersDelete.mockResolvedValue({ deleted: true });
  const agent = mount(); await flush(); await pick(3);
  $('[data-member-more="3"]').click(); $('[data-pick="delete"]').click(); await flush();
  expect(api.membersDelete).not.toHaveBeenCalled();
  $('[data-dlg="delete"]').click(); await flush();
  expect(api.membersDelete).toHaveBeenCalledWith(3);
  expect(document.querySelector('.mb-col [data-member="4"][aria-current="true"]')).not.toBeNull();
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

test.each([undefined, 0, 4])("primary %s: the member picker lists slimes only, the chief first, and the app opens on the chief or Raphael", async primary_id => {
  api.membersList.mockResolvedValue({ ...withChief(null), team_context: { primary_id, members: [] } as unknown as MembersList["team_context"] });
  const agent = mount(); await flush();
  const expected = primary_id === 4 ? ['4', '3'] : ['3', '4'];
  const historyCalls = api.agentHistoryList.mock.calls.length;
  $('.mb-pick').click();
  expect([...document.querySelectorAll<HTMLElement>('#app-popover [data-value]')].slice(0, 3).map(row => row.dataset.value)).toEqual(expected);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(api.agentHistoryList).toHaveBeenCalledTimes(historyCalls);
  expect(document.querySelector('.mb-col [aria-current="true"]')?.getAttribute('data-member') ?? null).toBe(primary_id === 4 ? '4' : null);
  expect($('.mb-pill-t').textContent).toBe(primary_id === 4 ? '行程管家' : '拉斐爾');
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
  api.membersSkillsList.mockResolvedValue({ skills: [] }); api.membersCommandsList.mockResolvedValue({ commands: [] });
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
  pickMessage('.is-pending', 'cancel'); await flush();
  expect(api.agentRetract).toHaveBeenCalledWith(options.requestId, 3, undefined);
  expect(input.value).toBe("fix this typo");
  expect(document.activeElement).toBe(input);
  expect(document.querySelector(".is-pending")).toBeNull();
  finish(); await flush();
  expect(input.value).toBe("fix this typo");
  agent.hide();
});

const press = (target: HTMLElement, key: string, more: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more });
  target.dispatchEvent(event);
  return event;
};
const typeInto = (field: HTMLTextAreaElement, words: string): void => { field.value = words; field.dispatchEvent(new Event("input", { bubbles: true })); };

describe("a sent message is taken back into the composer to be edited", () => {
  const SHOT = `${"c".repeat(32)}.png`, QUOTE = { text: "Saved passage", author: "You" };
  // The composer takes the owner's last message while its member is still thinking about it, with no bubble for it yet (R-UI-163).
  beforeEach(() => {
    api.agentHistoryList.mockImplementation(async (q: { member_id?: number; limit?: number }) => ({ turns: (q.member_id === 3
      ? [turn(31, { member_id: 3, status: "running", text: "" }), THREADS[3][1]!] : THREADS[q.member_id ?? 0]).slice(0, q.limit) }));
  });
  /** A member's thread whose newest message carries a picture and a quote, as stored (the core hands its bytes back by id). */
  const withPicture = (): AgentTurn => {
    const original = turn(8, { member_id: 3, session_id: "saved", status: "running", text: "", attachments: [{ id: SHOT, name: "shot.png", mime: "image/png", size: 6 }], quote: QUOTE });
    api.agentHistoryList.mockImplementation(async ({ member_id }: { member_id?: number }) => ({ turns: member_id === 3 ? [original] : [] }));
    api.core.mockImplementation(async (method: string) => method === "attachments.get" ? { mime: "image/png", data: btoa("pixels") }
      : method === "conversations.list" ? { conversations: [{ id: 81, member_id: 3, is_default: 1, kind: "standard", title: "", created_at_ms: 1, updated_at_ms: 1 }] } : { questions: [] });
    return original;
  };
  const box = (): HTMLTextAreaElement => $<HTMLTextAreaElement>(".cmp-input");

  test("choosing Edit puts the words, the picture's chip and the quote into the composer, and the bubble leaves the thread", async () => {
    const original = withPicture();
    const agent = mount(); await flush(); await pick(3);
    expect($('[data-id="8"] .owner-message .bubble').textContent).toContain("問題 8");
    pickMessage('[data-id="8"]', 'edit'); await flush();
    expect(box().value).toBe("問題 8");
    expect(document.activeElement).toBe(box());
    expect($(".composer .cmp-chip .cmp-pic").getAttribute("aria-label")).toBe("shot.png");
    expect($<HTMLImageElement>(".composer .cmp-chip img.cmp-thumb").src).toBe(`data:image/png;base64,${btoa("pixels")}`);
    expect($(".cmp-quote .quote-text").textContent).toBe("Saved passage");
    expect($(".composer").hasAttribute("data-replacing")).toBe(true);
    expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(false);
    // The original bubble, its picture and its quote are gone from the thread at once; the member still thinking about it stays.
    expect(document.querySelector('[data-id="8"] .owner-message')).toBeNull();
    expect(document.querySelector('[data-id="8"] .me-files')).toBeNull();
    expect(document.querySelector('[data-id="8"] .live-presence')).not.toBeNull();
    // Nothing was sent or taken back from the core, and the stored message is untouched.
    expect(api.agentAskText).not.toHaveBeenCalled();
    expect(api.agentRetract).not.toHaveBeenCalled();
    expect(original.attachments).toEqual([{ id: SHOT, name: "shot.png", mime: "image/png", size: 6 }]);
    agent.hide();
  });

  test("a message its member has not answered goes into the composer, never into an editor in its bubble", async () => {
    const agent = mount(); await flush(); await pick(3);
    pickMessage('[data-id="31"]', 'edit'); await flush();
    expect(document.querySelector('[data-edit-input], [data-msg-editor], .msg-editor-input, .msg-editor-under, [data-act="edit-send"], [data-act="edit-cancel"], [data-act="drop-edit-missing"]')).toBeNull();
    expect(box().value).toBe("問題 31");
    agent.hide();
  });

  test("sending replaces the turn with the edited words, the same picture and the same quote, and the edit stands in its place", async () => {
    let finish!: () => void;
    api.agentAskText.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    withPicture();
    const agent = mount(); await flush(); await pick(3);
    pickMessage('[data-id="8"]', 'edit'); await flush();
    typeInto(box(), "corrected");
    expect(press(box(), "Enter", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(api.agentAskText).not.toHaveBeenCalled();
    expect(press(box(), "Enter").defaultPrevented).toBe(true); await flush();
    expect(api.agentAskText).toHaveBeenCalledTimes(1);
    expect(api.agentAskText).toHaveBeenCalledWith("corrected", [{ name: "shot.png", mime: "image/png", data: btoa("pixels") }], 3, expect.objectContaining({ replaceTurnId: 8, quote: QUOTE }));
    expect(api.agentRetract).not.toHaveBeenCalled();
    // On its way the edit stands in the message's place, once; the composer is empty and no longer marks a replacement.
    expect(document.querySelector('[data-id="8"]')).toBeNull();
    expect(document.querySelectorAll(".is-pending").length).toBe(1);
    expect($(".is-pending .message-text").textContent).toBe("corrected");
    expect(box().value).toBe("");
    expect($(".composer").hasAttribute("data-replacing")).toBe(false);
    expect(document.querySelector(".composer .cmp-chip")).toBeNull();
    finish(); await flush();
    agent.hide();
  });

  test("words emptied stop the send, and a second Enter after a send goes nowhere", async () => {
    let finish!: () => void;
    api.agentAskText.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    const agent = mount(); await flush(); await pick(3);
    pickMessage('[data-id="31"]', 'edit'); await flush();
    typeInto(box(), "  ");
    expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(true);
    press(box(), "Enter"); await flush();
    expect(api.agentAskText).not.toHaveBeenCalled();
    typeInto(box(), "again");
    press(box(), "Enter"); await flush();
    press(box(), "Enter"); await flush();
    expect(api.agentAskText).toHaveBeenCalledTimes(1);
    finish(); await flush();
    agent.hide();
  });

  test("a send that fails gives the words back in the composer, still replacing the message, whose bubble stays away", async () => {
    api.agentAskText.mockRejectedValueOnce(new Error("offline"));
    const agent = mount(); await flush(); await pick(3);
    pickMessage('[data-id="31"]', 'edit'); await flush();
    typeInto(box(), "kept words");
    press(box(), "Enter"); await flush();
    expect(box().value).toBe("kept words");
    expect($(".composer").hasAttribute("data-replacing")).toBe(true);
    expect(document.querySelector('[data-id="31"] .owner-message')).toBeNull();
    expect(document.querySelector(".composer-failure")).not.toBeNull();
    api.agentAskText.mockResolvedValue(undefined);
    press(box(), "Enter"); await flush();
    expect(api.agentAskText).toHaveBeenLastCalledWith("kept words", [], 3, expect.objectContaining({ replaceTurnId: 31 }));
    agent.hide();
  });

  test("Escape on the words as 編輯 gave them leaves at once and the bubble comes back as it was, and changed words need Escape twice", async () => {
    withPicture();
    const agent = mount(); await flush(); await pick(3);
    const before = $('[data-id="8"] .owner-message').outerHTML;
    pickMessage('[data-id="8"]', 'edit'); await flush();
    press(box(), "Escape"); await flush();
    expect(box().value).toBe("");
    expect(document.querySelector(".composer .cmp-chip")).toBeNull();
    expect(document.querySelector(".cmp-quote .quote-text")).toBeNull();
    expect($(".composer").hasAttribute("data-replacing")).toBe(false);
    expect($('[data-id="8"] .owner-message').outerHTML).toBe(before);
    pickMessage('[data-id="8"]', 'edit'); await flush();
    typeInto(box(), "changed");
    press(box(), "Escape"); await flush();
    expect($(".cmp-voice").dataset.cancelArmed).toBe("true");
    expect(box().value).toBe("changed");
    expect(document.querySelector('[data-id="8"] .owner-message')).toBeNull();
    press(box(), "Escape"); await flush();
    expect(box().value).toBe("");
    expect(document.querySelector(".composer .cmp-chip")).toBeNull();
    expect($('[data-id="8"] .owner-message').outerHTML).toBe(before);
    expect(api.agentAskText).not.toHaveBeenCalled();
    expect(api.agentRetract).not.toHaveBeenCalled();
    agent.hide();
  });

  test("words being written before 編輯 come back once the edit is given up, and once it is sent", async () => {
    const agent = mount(); await flush(); await pick(3);
    typeInto(box(), "half a new question");
    pickMessage('[data-id="31"]', 'edit'); await flush();
    expect(box().value).toBe("問題 31");
    press(box(), "Escape"); await flush();
    expect(box().value).toBe("half a new question");
    expect($(".composer").hasAttribute("data-replacing")).toBe(false);
    pickMessage('[data-id="31"]', 'edit'); await flush();
    typeInto(box(), "corrected");
    press(box(), "Enter"); await flush();
    expect(api.agentAskText).toHaveBeenLastCalledWith("corrected", [], 3, expect.objectContaining({ replaceTurnId: 31 }));
    expect(box().value).toBe("half a new question");
    expect($(".composer").hasAttribute("data-replacing")).toBe(false);
    agent.hide();
  });

  test("words typed while the message's files are read stay: 編輯 does not write over them", async () => {
    withPicture();
    let give!: () => void;
    const read = api.core.getMockImplementation()!;
    api.core.mockImplementation((method: string, ...rest: unknown[]) => method === "attachments.get"
      ? new Promise(resolve => { give = () => resolve({ mime: "image/png", data: btoa("pixels") }); }) : read(method, ...rest));
    const agent = mount(); await flush(); await pick(3);
    pickMessage('[data-id="8"]', 'edit'); await flush();
    typeInto(box(), "something newer");
    give(); await flush();
    expect(box().value).toBe("something newer");
    expect($(".composer").hasAttribute("data-replacing")).toBe(false);
    expect($('[data-id="8"] .owner-message .bubble').textContent).toContain("問題 8");
    agent.hide();
  });

  test("leaving the conversation gives the edit up: the bubble is there as it was, and nothing of the edit comes back as a draft", async () => {
    const agent = mount(); await flush(); await pick(3);
    pickMessage('[data-id="31"]', 'edit'); await flush();
    typeInto(box(), "half edited");
    await pick(4);
    expect(box().value).toBe("");
    expect(document.querySelector("[data-replacing]")).toBeNull();
    await pick(3);
    expect(box().value).toBe("");
    expect($(".composer").hasAttribute("data-replacing")).toBe(false);
    expect($('[data-id="31"] .owner-message .bubble').textContent).toContain("問題 31");
    // The words emptied before leaving give it up in the same way.
    pickMessage('[data-id="31"]', 'edit'); await flush();
    typeInto(box(), "");
    await pick(4); await pick(3);
    expect($('[data-id="31"] .owner-message .bubble').textContent).toContain("問題 31");
    expect(api.agentAskText).not.toHaveBeenCalled();
    agent.hide();
  });

  test("the composer's own draft stands again for a message that is not being edited, and a thread drawn again keeps the bubble away", async () => {
    const agent = mount(); await flush(); await pick(3);
    pickMessage('[data-id="31"]', 'edit'); await flush();
    api.agentHistoryList.mockResolvedValueOnce({ turns: [turn(32, { member_id: 3 }), ...THREADS[3]] });
    send({ type: "AgentTurn", turn_id: 32, member_id: 3 });
    await new Promise(resolve => setTimeout(resolve, 450)); await flush();
    expect(document.querySelector('[data-id="31"] .owner-message')).toBeNull();
    expect($('[data-id="32"] .owner-message')).not.toBeNull();
    expect(box().value).toBe("問題 31");
    agent.hide();
  });
});

test("message actions show an app tooltip on keyboard focus, with no native title", async () => {
  const agent = mount(); await flush();
  const reply = $('[data-id="2"] [data-act="reply-message"]');
  expect(reply.hasAttribute("title")).toBe(false);
  reply.focus();
  expect($('[role="tooltip"]').textContent).toBe("回覆");
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
  const original = turn(8, { session_id: "saved", status: "running", text: "", attachments: [{ name: "original.pdf", mime: "application/pdf" }], quote: { text: "Saved passage", author: "You" } });
  api.agentHistoryList.mockResolvedValue({ turns: [original] });
  const agent = mount(); await flush();
  pickMessage('[data-id="8"]', 'edit'); await flush();
  expect($(".cmp-quote .quote-text").textContent).toBe("Saved passage");
  expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(true);
  expect($("[data-missing]").textContent).toContain("original.pdf");
  $('[data-act="drop-missing"]').click();
  expect($<HTMLButtonElement>(".cmp-send").disabled).toBe(false);
  expect(original.attachments).toEqual([{ name: "original.pdf", mime: "application/pdf" }]);
  expect(api.agentRetract).not.toHaveBeenCalled();
  agent.hide();
});

test.each(["edit", "cancel", "regenerate"])("%s after reload retrieves stored files and preserves the quote in its member thread", async action => {
  const id = `${"a".repeat(32)}.csv`;
  const quote = { text: "Saved passage", author: "You" };
  // 編輯 takes a message its member is still thinking about into the composer (R-UI-163); 重新產生 is a finished reply's.
  const original = turn(8, { member_id: 3, session_id: "saved", status: action === "regenerate" ? "done" : "running", ...(action === "edit" ? { text: "" } : {}),
    attachments: [{ id, name: "report.csv", mime: "text/csv", size: 6 }], quote });
  api.agentHistoryList.mockImplementation(async ({ member_id }: { member_id?: number }) => ({ turns: member_id === 3 ? [original] : [] }));
  api.core.mockImplementation(async (method: string) => method === "attachments.get" ? { mime: "text/csv", data: btoa("report") }
    : method === "attachments.info" ? { mime: "text/csv", size: 6 } : { questions: [] });
  const agent = mount(); await flush(); await pick(3);
  // Edit, Cancel and Regenerate all live in the message's ⋯ menu.
  $(`[data-id="8"] ${action === "regenerate" ? ".ra" : ".me"} [data-act="more-message"]`).click(); await flush();
  $(`[data-pick="${action}"]`).click(); await flush();
  // 重新產生 sends the message's files as the stored copies they are, in the message's own place, never their bytes again.
  if (action === "regenerate") {
    expect(api.core).toHaveBeenCalledWith("attachments.info", { id });
    expect(api.core).not.toHaveBeenCalledWith("attachments.get", expect.anything());
    expect(api.agentAskText).toHaveBeenCalledWith("問題 8", [{ name: "report.csv", mime: "text/csv", data: "", stored_id: id }], 3, expect.objectContaining({ quote, replaceTurnId: 8 }));
    agent.hide();
    return;
  }
  expect(api.core).toHaveBeenCalledWith("attachments.get", { id });
  if (action === "edit" || action === "cancel") {
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
  pickMessage('[data-id="8"]', 'edit'); await flush();
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
  pickMessage('[data-id="8"]', 'edit'); await flush();
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
  pickMessage('.is-pending', 'cancel'); await flush();
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
  if (mode === "search") window.dispatchEvent(new CustomEvent("raphael:conversation-shortcut", { detail: "find" }));
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

test("a member whose conversation is empty is asked once to greet; Raphael and a member with words are not", async () => {
  api.agentHistoryList.mockResolvedValue({ turns: [] });
  const agent = mount(); await flush();
  expect(api.membersGreet).not.toHaveBeenCalled();
  await pick(3);
  expect(api.membersGreet).toHaveBeenCalledExactlyOnceWith(3);
  await pick(0); await pick(3);
  expect(api.membersGreet).toHaveBeenCalledTimes(1);
  api.agentHistoryList.mockResolvedValue({ turns: [turn(35, { member_id: 4 })] });
  await pick(4);
  expect(api.membersGreet).toHaveBeenCalledTimes(1);
  agent.hide();
});

test("a failed greeting is written again by the member's own model, and a greeting that came through is never written twice", async () => {
  const greeting = (status: string, text: string) => turn(34, { member_id: 3, question: "", route: "greeting", source: "greeting", prefix: "", status, text });
  api.agentHistoryList.mockResolvedValue({ turns: [greeting("error", "CLI stopped")] });
  const agent = mount(); await flush(); await pick(3);
  $('[data-id="34"] .rerun').click(); await flush();
  expect(api.membersGreet).toHaveBeenCalledExactlyOnceWith(3);
  expect(api.agentAskText).not.toHaveBeenCalled();
  api.agentHistoryList.mockResolvedValue({ turns: [greeting("done", "嗨，我是日文老師。想讓我幫你分擔什麼？")] });
  await pick(0); await pick(3);
  document.querySelector<HTMLButtonElement>('.tn[data-id="34"] .ra [data-act="more-message"]')!.click(); await flush();
  expect([...document.querySelectorAll<HTMLElement>("#app-popover [data-pick]")].map(item => item.dataset.pick)).toEqual(["reply", "copy"]);
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
  expect(api.agentAskText).toHaveBeenCalledExactlyOnceWith("問題 31", [], 3, expect.objectContaining({ requestId: expect.any(String), replaceTurnId: 31 }));
  agent.hide();
});

test("routine notifications refresh the open panel immediately and keep the routine being read", async () => {
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
  const scroll = $(".mb-det-scroll");
  scroll.scrollTop = 84;
  api.routinesList.mockResolvedValue({ routines: [routine, { ...routine, id: 10, title: "New routine" }] });
  send({ type: "RoutinesChanged", member_id: 3 });
  await flush();
  expect($(".mb-rts").textContent).toContain("New routine");
  expect(document.querySelector(".mb-dialog.rv-dialog .rv-prompt")!.textContent).toBe("Review");
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
  const agent = mount();
  await flush();
  await pick(3);
  await openDetails();
  agent.show("member-settings:3");
  const next = structuredClone(LIST);
  next.members[1] = { ...next.members[1], name: "Updated name", role: "Updated role", group_id: 5 };
  next.members[2] = { ...next.members[2], waiting: true, unread: true, preview: "New preview" };
  next.groups = [{ id: 5, name: "New group", position: 0, sources: [] }];
  api.membersList.mockResolvedValue(next);
  send({ type: "MembersChanged" });
  await flush();
  expect($(".mb-pill-t").textContent).toBe("Updated name");
  expect($<HTMLInputElement>("#ms-name").value).toBe("Updated name");
  expect($(".mb-col").textContent).toContain("New group");
  expect($('.mb-col [data-member="4"]').textContent).toContain("New preview");
  expect($('.mb-col [data-member="4"] .mb-dot')).not.toBeNull();
});

test("a memory change reads nothing and shows nothing on the member's page", async () => {
  api.core.mockImplementation(async () => ({ questions: [] }));
  const agent = mount();
  await flush();
  await pick(3);
  $(".conversation-trigger").click();
  agent.show("member-settings:3"); await flush();
  api.core.mockClear(); api.membersSkillsList.mockClear();
  for (const event of [{ member_id: 4, space: "own" }, { member_id: 3, space: "own" }, { member_id: 0, space: "shared" }] as const) {
    send({ type: "MemoryChanged", ...event });
    await flush();
  }
  expect(api.core).not.toHaveBeenCalled();
  expect(api.membersSkillsList).not.toHaveBeenCalled();
  expect(globalThis.document.querySelector('.ms-pane [data-mem-space], .ms-pane [data-mem-section], .ms-pane [data-cat="memory"]')).toBeNull();
});


test("a roster that moves only a last line, a step or an unread mark starts no Library read and leaves the panel alone, and a renamed member reads and shows", async () => {
  vi.useFakeTimers();
  const agent = mount(); await flush(); await pick(3); await openDetails();
  await vi.advanceTimersByTimeAsync(1000); await flush();
  const panel = $(".mb-det");
  const library = (): number => api.core.mock.calls.filter(([method]) => method === "members.library").length;
  const touched: MutationRecord[] = [];
  const watch = new MutationObserver(records => touched.push(...records));
  api.core.mockClear(); api.membersSkillsList.mockClear(); api.membersCommandsList.mockClear();
  watch.observe(panel, { subtree: true, childList: true, attributes: true, characterData: true });
  for (let step = 1; step <= 5; step++) {
    api.membersList.mockResolvedValue({ ...LIST, members: LIST.members.map(m => m.id === 3 ? { ...m, preview: `Checking ${step}`, activity: "searching", activity_label: `Step ${step}`, last_at: Date.now() - 1000 + step, unread: step % 2 === 0 } : m) });
    send({ type: "MembersChanged" }); await vi.advanceTimersByTimeAsync(400); await flush();
  }
  expect(library()).toBe(0);
  expect(api.membersSkillsList).not.toHaveBeenCalled(); expect(api.membersCommandsList).not.toHaveBeenCalled();
  // Only the words of the face's tooltip follow the step, on the face where it stands.
  expect(touched.map(record => record.target.nodeName + ":" + record.attributeName)).toEqual(Array(5).fill("SPAN:data-tooltip"));
  expect($('.mb-col [data-member="3"]').textContent).toContain("Checking 5");
  // What the panel shows moved: it is drawn and the Library is read once.
  api.membersList.mockResolvedValue({ ...LIST, members: LIST.members.map(m => m.id === 3 ? { ...m, name: "Renamed" } : m) });
  send({ type: "MembersChanged" }); await vi.advanceTimersByTimeAsync(400); await flush();
  expect($(".mb-who b").textContent).toBe("Renamed");
  expect(library()).toBe(1);
  watch.disconnect(); agent.hide();
});
describe("Raphael's thread", () => {
  test("reads plainly: its answers without 《》, 傳訊息給 and its name as every member's, its voice button, asked with no member", async () => {
    mount();
    await flush();
    expect(api.agentHistoryList).toHaveBeenCalledWith({ limit: 50 });
    expect($(".thread").textContent).toContain("回答 2");
    expect($(".thread").textContent).not.toContain("《");
    expect($<HTMLTextAreaElement>(".cmp-input").placeholder).toBe("傳訊息給 拉斐爾");
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
    expect([...document.querySelectorAll(".mb-col .mb-list .mb-row b")].map((b) => b.textContent)).toEqual(["日文老師", "行程管家"]);
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
    window.dispatchEvent(new CustomEvent("raphael:conversation-shortcut", { detail: "find" }));
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

  test("back to Raphael: its own thread again, and its composer", async () => {
    mount();
    await flush();
    await pick(3);
    await pick(0);
    expect(api.agentHistoryList).toHaveBeenLastCalledWith({ limit: 50 });
    expect($(".thread").textContent).toContain("回答 2");
    expect($(".thread").textContent).not.toContain("今天的單字");
    expect($<HTMLTextAreaElement>(".cmp-input").placeholder).toBe("傳訊息給 拉斐爾");
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

  test("the gold card shows in the thread of its member only: their name there, Raphael's emblem in its own, plain words in both", async () => {
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

  test("what a colleague asked a member is one line in its chat that opens the two members' conversation", async () => {
    THREADS[4] = [turn(42, { member_id: 4, peer_id: 0, route: "exchange", source: "member", scope: "exchange", question: "主人明天幾點有空？", text: "下午兩點以後" })];
    mount();
    await flush();
    await pick(4);
    const line = $<HTMLElement>('.exchange-event[data-exchange="42"]');
    expect(line.textContent!.replace(/\s+/g, " ").trim()).toBe("與 拉斐爾 的 2 則訊息");
    // Neither the owner's bubble nor the answer stands in the thread: both are read in the conversation view.
    expect(document.querySelector('.tn[data-id="42"] .me')).toBeNull();
    expect(document.querySelector('.tn[data-id="42"]')!.textContent).not.toContain("下午兩點以後");
    line.querySelector<HTMLElement>(".event-count")!.click();
    await flush();
    const view = $<HTMLElement>(".peer-chat");
    expect(view.querySelector(".peer-pill")!.getAttribute("aria-label")).toContain("⇄");
    expect([...view.querySelectorAll(".peer-line .message-text")].map((text) => text.textContent)).toEqual(["主人明天幾點有空？", "下午兩點以後"]);
    view.querySelector<HTMLButtonElement>('[data-peer="close"]')!.click();
    expect(document.querySelector(".peer-chat")).toBeNull();
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

  test("renaming the open member on its settings page updates the composer placeholder and thread faces", async () => {
    const agent = mount();
    await flush();
    await pick(3);
    if ($(".mb-det").hidden) $(".conversation-trigger").click();
    agent.show("member-settings:3");
    api.membersUpdate.mockResolvedValue({ member: { ...LIST.members[1], name: "嚴格老師" } });
    api.membersList.mockResolvedValue({
      ...structuredClone(LIST),
      members: LIST.members.map((m) => (m.id === 3 ? { ...m, name: "嚴格老師" } : m)),
    });
    const name = $<HTMLInputElement>("#ms-name");
    name.focus();
    name.value = "嚴格老師";
    name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    expect($<HTMLTextAreaElement>(".cmp-input").placeholder).toBe("傳訊息給 嚴格老師");
    expect($(".mb-pill-face svg.slime")).not.toBeNull();
    expect($(".thread .ra-face")).toBeNull();
  });
});

test("a core without the members: Raphael's conversation alone, and the page works as before", async () => {
  api.membersList.mockRejectedValue("mock: members.list");
  mount();
  await flush();
  expect(document.querySelectorAll(".mb-col .mb-list .mb-row")).toHaveLength(0);
  expect($(".mb-pill-t").textContent).toBe("拉斐爾");
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
 agent.el.querySelector<HTMLButtonElement>('#member-tab-computer')?.click(); await flush();
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
  window.dispatchEvent(new CustomEvent("raphael:conversation-shortcut", { detail: "find" }));
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
  api.desktopStatus.mockResolvedValue({transport:"idle", state:"absent", ready:false, control:"member"});
  const agent = mount(); await flush();
  window.dispatchEvent(new CustomEvent("raphael:open-room", {detail:{roomId:1}})); await flush();
  agent.show("computer"); await flush();
  expect(agent.el.querySelector<HTMLElement>(".au-room-pane")!.hidden).toBe(true);
  expect(agent.el.querySelector<HTMLElement>(".mb-det")!.hidden).toBe(false);
  expect(agent.el.querySelector<HTMLElement>(".mb-det")!.dataset.detailsTab).toBe("computer");
  expect(agent.el.querySelector(".mb-det [data-computer-choice]")).not.toBeNull();
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

/**
 * The core as an edit meets it: it removes the message it replaces and writes the edit with that message's id and time
 * (`place`), or, as a core that does not keep places does, at the end with the next id. The call lasts until the answer.
 */
function editingCore(initial: AgentTurn[], where: "in place" | "at the end") {
  let rows = [...initial], newest = Math.max(...rows.map(item => item.id)), release!: () => void;
  api.agentHistoryList.mockImplementation(async (q: { member_id?: number; limit?: number; after_id?: number; turn_ids?: number[] }) => {
    if (q.member_id !== 3) return { turns: THREADS[q.member_id ?? 0] };
    const sorted = [...rows].sort((a, b) => b.id - a.id);
    if (q.after_id === undefined) return { turns: sorted.slice(0, q.limit) };
    const ids = q.turn_ids ?? [], changed = sorted.filter(item => item.id > q.after_id! || ids.includes(item.id));
    return { turns: changed, delta: true, removed_ids: ids.filter(id => !rows.some(item => item.id === id)), has_more: false, next_after_id: changed.length ? Math.max(...changed.map(item => item.id)) : q.after_id };
  });
  api.agentAskText.mockImplementation(async (text: string, _files: unknown, member: number, options: { requestId: string; replaceTurnId?: number }) => {
    const old = rows.find(item => item.id === options.replaceTurnId);
    if (old) { rows = rows.filter(item => item !== old); send({ type: "AgentTurn", turn_id: old.id, member_id: member }); }
    const id = old && where === "in place" ? old.id : ++newest;
    rows.push(turn(id, { member_id: member, question: text, session_id: options.requestId, status: "running", text: "", created_at_ms: old && where === "in place" ? old.created_at_ms : Date.now() }));
    send({ type: "AgentTurn", turn_id: id, member_id: member });
    await new Promise<void>(resolve => { release = resolve; });
    Object.assign(rows.find(item => item.id === id)!, { status: "done", text: "new answer" });
    send({ type: "AgentTurn", turn_id: id, member_id: member });
  });
  return { answer: () => release() };
}
const routineTurn = (id: number, question: string): AgentTurn => turn(id, { member_id: 3, source: "routine", route: "routine", prefix: "", question, text: `${question} done` });
/** The lines of the thread, in order: a turn by its id, a message on its way as "pending". */
const lineIds = (): string[] => [...document.querySelectorAll<HTMLElement>(".thread > .tn")].map(line => line.classList.contains("is-pending") ? "pending" : line.dataset.id ?? "?");
const settle = async (): Promise<void> => { await new Promise(resolve => setTimeout(resolve, 600)); await flush(); };

/**
 * The owner's message 31 as each editor takes it (R-UI-163): one its member is still thinking about goes into the composer, one it
 * answered is edited in its own bubble. Both send the same edit, which stands where the message stood.
 */
type Flow = "composer" | "bubble";
const FLOWS: Flow[] = ["composer", "bubble"];
const message31 = (flow: Flow): AgentTurn => flow === "composer" ? turn(31, { member_id: 3, status: "running", text: "" }) : turn(31, { member_id: 3, text: "ans 31" });
async function editAndSend(id: number, words: string, flow: Flow): Promise<void> {
  pickMessage(`[data-id="${id}"]`, 'edit'); await flush();
  const field = document.querySelector<HTMLTextAreaElement>(`[data-id="${id}"] [data-edit-input]`);
  expect(!!field).toBe(flow === "bubble");
  if (field) { typeInto(field, words); $(`[data-id="${id}"] [data-act="edit-send"]`).click(); }
  else { typeInto($<HTMLTextAreaElement>(".cmp-input"), words); $(".cmp-send").click(); }
  await flush();
}

describe("an edited message stands where its message stood", () => {
  test.each(FLOWS.flatMap(flow => (["in place", "at the end"] as const).map(where => [flow, where] as const)))("edited in the %s, a message with routine turns after it, against a core that writes %s: it never leaves its place before the edit is written, and never shows twice", async (flow, where) => {
    const core = editingCore([routineTurn(30, "daily"), message31(flow), routineTurn(32, "7am"), routineTurn(33, "8am")], where);
    const agent = mount(); await flush(); await pick(3);
    expect(lineIds()).toEqual(["30", "31", "32", "33"]);
    await editAndSend(31, "corrected", flow);
    // On its way: the edit stands where the message stood, with the routine turns after it, and nothing is waiting at the end.
    expect(lineIds()).toEqual(["30", "pending", "32", "33"]);
    expect($(".tn.is-pending .message-text").textContent).toBe("corrected");
    await settle();
    // The core has written it: the edit's own turn, where the message stood (a core that appends writes it at the end).
    expect(lineIds()).toEqual(where === "in place" ? ["30", "31", "32", "33"] : ["30", "32", "33", "34"]);
    expect(document.querySelectorAll(".is-pending").length).toBe(0);
    expect([...document.querySelectorAll(".thread .owner-message .message-text")].filter(node => node.textContent === "corrected")).toHaveLength(1);
    core.answer(); await flush(); await settle();
    expect(document.querySelectorAll(".is-pending").length).toBe(0);
    expect([...document.querySelectorAll(".thread .owner-message .message-text")].filter(node => node.textContent === "corrected")).toHaveLength(1);
    expect(lineIds()).toEqual(where === "in place" ? ["30", "31", "32", "33"] : ["30", "32", "33", "34"]);
    agent.hide();
  });

  test.each(FLOWS)("the newest message, edited in the %s: its edit has its id and does not vanish while the member answers", async flow => {
    const core = editingCore([routineTurn(30, "daily"), message31(flow)], "in place");
    const agent = mount(); await flush(); await pick(3);
    await editAndSend(31, "corrected", flow);
    await settle();
    // The member is answering: the message is on screen, once, with the new words.
    expect(lineIds()).toEqual(["30", "31"]);
    expect($('[data-id="31"] .owner-message .message-text').textContent).toBe("corrected");
    core.answer(); await flush(); await settle();
    expect($('[data-id="31"]').textContent).toContain("new answer");
    agent.hide();
  });

  test.each(FLOWS)("the reader stays where they are while an edit of an earlier message is on its way (%s)", async flow => {
    editingCore([routineTurn(30, "daily"), message31(flow), routineTurn(32, "7am")], "in place");
    const agent = mount(); await flush(); await pick(3);
    const scroller = $(".ra-scroll");
    scroller.scrollTop = 17;
    await editAndSend(31, "corrected", flow);
    expect(scroller.scrollTop).toBe(17);
    agent.hide();
  });
});

// ---------- reordering the sidebar (R-SIDE-03) ----------

describe("a row or a folder dropped on the sidebar", () => {
  const FOLDERS: MembersList = {
    members: [member(0, { name: "拉斐爾" }), member(3, { group_id: 1, position: 0 }), member(4, { group_id: 1, position: 1 }), member(5, { group_id: 1, position: 2 }), member(6, { group_id: 2, position: 2 }), member(7, { position: 4 })],
    groups: [{ id: 1, name: "學習", position: 0, sources: [] }, { id: 2, name: "工作", position: 1, sources: [] }],
  };
  let core: MembersList;
  const order = (folder: number): number[] => [...document.querySelectorAll<HTMLElement>(`.mb-col .mb-sec[data-group="${folder}"] [data-member-item]`)].map(row => Number(row.dataset.memberItem));
  const folders = (): string[] => [...document.querySelectorAll<HTMLElement>('.mb-col .mb-sec[data-group]:not([data-group="none"]):not([data-group="hidden"])')].map(section => section.dataset.group!);
  /** What the core does to a place: members/store.py `_move`. */
  const move = <T extends { id: number; position: number }>(items: T[], id: number, position: number): void => {
    const rest = items.filter(item => item.id !== id).sort((a, b) => a.position - b.position || a.id - b.id);
    rest.splice(Math.min(position, rest.length), 0, items.find(item => item.id === id)!);
    rest.forEach((item, place) => { item.position = place; });
  };
  const place = (element: Element, top: number, height: number): void => {
    (element as HTMLElement).getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 240, width: 240, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  };
  /** The rows and folders where the window would draw them: a heading 30 px high, then each row 40 px under the one before. */
  const lay = (): Map<Element, number> => {
    const tops = new Map<Element, number>();
    let top = 100;
    for (const section of document.querySelectorAll('.mb-col .mb-sec[data-group]')) {
      const rows = [...section.querySelectorAll('[data-member-item]')];
      place(section, top, 30 + 40 * rows.length);
      tops.set(section, top);
      for (const [index, row] of rows.entries()) { place(row, top + 30 + 40 * index, 40); tops.set(row, top + 30 + 40 * index); }
      top += 30 + 40 * rows.length + 10;
    }
    return tops;
  };
  /** The pointer takes `source` and lets go over the upper half of `destination`. */
  const drop = (source: string, destination: string): void => {
    const tops = lay(), target = $(destination);
    $(source).dispatchEvent(new Event("dragstart", { bubbles: true, cancelable: true }));
    const clientY = tops.get(target)! + 3;
    target.dispatchEvent(new MouseEvent("dragover", { bubbles: true, cancelable: true, clientY }));
    target.dispatchEvent(new MouseEvent("drop", { bubbles: true, cancelable: true, clientY }));
  };
  const asked = (method: string): number => api.core.mock.calls.filter(([name]) => name === method).length;

  beforeEach(() => {
    core = structuredClone(FOLDERS);
    api.membersList.mockImplementation(async () => structuredClone(core));
    api.membersUpdate.mockImplementation(async (id: number, patch: { group_id?: number | null; position?: number }) => {
      const found = core.members.find(item => item.id === id)!;
      if (patch.group_id !== undefined) found.group_id = patch.group_id;
      if (patch.position !== undefined) move(core.members.filter(item => item.id !== 0), id, patch.position);
      core.members.sort((a, b) => a.id === 0 ? -1 : b.id === 0 ? 1 : a.position - b.position || a.id - b.id);
      return { member: found };
    });
    api.groupsUpdate.mockImplementation(async (id: number, patch: { position: number }) => {
      move(core.groups, id, patch.position);
      core.groups.sort((a, b) => a.position - b.position);
      return { group: core.groups.find(group => group.id === id) };
    });
  });

  test("stands where it was dropped at once, is saved with one request, and the answer that confirms it draws nothing", async () => {
    let answer!: () => void;
    const held = api.membersUpdate.getMockImplementation()! as (...args: unknown[]) => Promise<unknown>;
    api.membersUpdate.mockImplementation((...args: unknown[]) => new Promise(resolve => { answer = () => resolve(held(...args)); }));
    const agent = mount(); await flush();
    const rows = Object.fromEntries([3, 4, 5, 6].map(id => [id, $(`.mb-col [data-member-item="${id}"]`)]));
    const faces = Object.fromEntries([3, 4, 5].map(id => [id, $(`.mb-col [data-member-item="${id}"] svg.slime`)]));
    const listReads = api.membersList.mock.calls.length, libraryReads = asked("members.library");
    drop('.mb-col [data-member-item="3"]', '.mb-col [data-group="1"] [data-member-item="5"]');
    // Before the core has heard anything.
    expect(order(1)).toEqual([4, 3, 5]);
    await flush();
    expect(api.membersUpdate).toHaveBeenCalledTimes(1);
    expect(api.membersUpdate).toHaveBeenCalledWith(3, { position: 1 });
    for (const id of [4, 5]) expect($(`.mb-col [data-member-item="${id}"]`)).toBe(rows[id]);
    // The core's own change event arrives before its answer: it is not read over the move.
    send({ type: "MembersChanged" }); await flush();
    expect(api.membersList.mock.calls.length).toBe(listReads);
    expect(order(1)).toEqual([4, 3, 5]);
    answer(); await flush();
    expect(api.membersList.mock.calls.length).toBe(listReads + 1);
    send({ type: "MembersChanged" }); await flush();
    expect(order(1)).toEqual([4, 3, 5]);
    for (const id of [3, 4, 5, 6]) expect($(`.mb-col [data-member-item="${id}"]`)).toBe(rows[id]);
    for (const id of [3, 4, 5]) expect($(`.mb-col [data-member-item="${id}"] svg.slime`)).toBe(faces[id]);
    // The panel's Library was not read again, and the one request is all the core was asked to save.
    expect(asked("members.library")).toBe(libraryReads);
    expect(api.membersUpdate).toHaveBeenCalledTimes(1);
    agent.hide();
  });

  test("into another folder keeps its face and every other row, and sends its folder and place together", async () => {
    const agent = mount(); await flush();
    const others = Object.fromEntries([3, 4, 6].map(id => [id, $(`.mb-col [data-member-item="${id}"]`)]));
    const face = $(`.mb-col [data-member-item="5"] svg.slime`);
    drop('.mb-col [data-member-item="5"]', '.mb-col [data-group="2"] [data-member-item="6"]');
    expect(order(1)).toEqual([3, 4]);
    expect(order(2)).toEqual([5, 6]);
    expect($(`.mb-col [data-group="2"] [data-member-item="5"] svg.slime`)).toBe(face);
    await flush();
    expect(api.membersUpdate).toHaveBeenCalledTimes(1);
    expect(api.membersUpdate).toHaveBeenCalledWith(5, { group_id: 2, position: 2 });
    for (const id of [3, 4, 6]) expect($(`.mb-col [data-member-item="${id}"]`)).toBe(others[id]);
    expect(order(2)).toEqual([5, 6]);
    agent.hide();
  });

  test("a save that fails puts the row back, says why, and reads the core again", async () => {
    api.membersUpdate.mockRejectedValue(new Error("the core is busy"));
    const agent = mount(); await flush();
    const reads = api.membersList.mock.calls.length;
    drop('.mb-col [data-member-item="3"]', '.mb-col [data-group="1"] [data-member-item="5"]');
    expect(order(1)).toEqual([4, 3, 5]);
    await flush();
    expect(order(1)).toEqual([3, 4, 5]);
    expect(document.body.textContent).toContain(describeError(new Error("the core is busy")));
    expect(api.membersList.mock.calls.length).toBe(reads + 1);
    agent.hide();
  });

  test("a folder dropped before another stands there at once and is saved with one request", async () => {
    const agent = mount(); await flush();
    const rows = [3, 4, 5, 6].map(id => $(`.mb-col [data-member-item="${id}"]`));
    drop('.mb-col [data-group="2"] .mb-gname', '.mb-col [data-group="1"]');
    expect(folders()).toEqual(["2", "1"]);
    await flush();
    expect(api.groupsUpdate).toHaveBeenCalledTimes(1);
    expect(api.groupsUpdate).toHaveBeenCalledWith(2, { position: 0 });
    expect(folders()).toEqual(["2", "1"]);
    expect([3, 4, 5, 6].map(id => $(`.mb-col [data-member-item="${id}"]`))).toEqual(rows);
    agent.hide();
  });

  test("a row let go where it stands asks nothing", async () => {
    const agent = mount(); await flush();
    drop('.mb-col [data-member-item="3"]', '.mb-col [data-group="1"] [data-member-item="4"]');
    await flush();
    expect(api.membersUpdate).not.toHaveBeenCalled();
    expect(order(1)).toEqual([3, 4, 5]);
    agent.hide();
  });
});

describe("Raphael apart from the slimes", () => {
  const roster = (primary: number | null, slimes = [3, 4]): MembersList => ({
    members: [member(0, { name: "拉斐爾", raphael: true } as Partial<Member>), ...LIST.members.filter(m => slimes.includes(m.id)).map(m => ({ ...m, chief: m.id === primary }))],
    groups: [], team_context: { primary_id: primary, chief_id: primary, members: slimes.map(id => ({ id, name: `成員${id}`, role: "", blurb: "" })) } as unknown as MembersList["team_context"],
  });
  const quick = [{ id: 4, member_id: 0, title: "", kind: "quick", is_default: 0, updated_at_ms: 100 }, { id: 1, member_id: 0, title: "Main", kind: "standard", is_default: 1, updated_at_ms: 1 }];
  const readConversations = (): void => {
    api.core.mockImplementation(async (method: string, params: { member_id?: number }) =>
      method === "conversations.list" ? { conversations: [...quick, { id: 31, member_id: 3, title: "Cobalt", is_default: 1, kind: "standard", updated_at_ms: 1 }].filter(c => c.member_id === (params.member_id ?? 0)) } : { questions: [] });
  };
  const pillName = (): string => $(".mb-pill-t").textContent!;
  const listed = (): string[] => [...document.querySelectorAll<HTMLElement>(".mb-col [data-member]")].map(row => row.dataset.member!);

  test("with a chief the sidebar lists slimes only and the app opens on the chief, whose panel has no quick questions", async () => {
    api.membersList.mockResolvedValue(roster(3)); readConversations();
    const agent = mount(); await flush();
    expect(listed()).toEqual(["3", "4"]);
    expect($('.mb-col [data-member="3"]').getAttribute("aria-current")).toBe("true");
    expect(pillName()).toBe("日文老師");
    expect(api.agentHistoryList).toHaveBeenLastCalledWith(expect.objectContaining({ member_id: 3 }));
    await openDetails();
    expect(document.querySelector('.mb-det [data-slot="conversations"]')).toBeNull();
    agent.hide();
  });

  test("with no slime at all the app opens on Raphael's conversation, the sidebar is empty and nothing fails", async () => {
    api.membersList.mockResolvedValue(roster(null, [])); readConversations();
    const agent = mount(); await flush();
    expect(listed()).toEqual([]);
    expect(pillName()).toBe("拉斐爾");
    expect(api.agentHistoryList).toHaveBeenLastCalledWith(expect.not.objectContaining({ member_id: expect.anything() }));
    expect($('[data-col="add"]')).not.toBeNull();
    await openDetails();
    expect(document.querySelector('.mb-det [data-slot="conversations"]')).not.toBeNull();
    agent.hide();
  });

  test("a roster whose chief is null opens on Raphael too, and the slimes stay listed", async () => {
    api.membersList.mockResolvedValue(roster(null)); readConversations();
    const agent = mount(); await flush();
    expect(listed()).toEqual(["3", "4"]);
    expect(pillName()).toBe("拉斐爾");
    expect(document.querySelector('.mb-col [aria-current="true"]')).toBeNull();
    agent.hide();
  });

  test("the route to Raphael shows its space in the same chat view, with its quick questions and no share button, and a slime row leaves it", async () => {
    api.membersList.mockResolvedValue(roster(3)); readConversations();
    const agent = mount(); await flush();
    agent.show("raphael"); await flush();
    expect(pillName()).toBe("拉斐爾");
    expect(listed()).toEqual(["3", "4"]);
    expect(document.querySelector('.mb-col [aria-current="true"]')).toBeNull();
    expect(api.agentHistoryList).toHaveBeenLastCalledWith(expect.not.objectContaining({ member_id: expect.anything() }));
    expect($('[data-act="share-member"]').hidden).toBe(true);
    await openDetails();
    expect(document.querySelector('.mb-det [data-slot="conversations"]')).not.toBeNull();
    expect(document.querySelector(".mb-det .mb-face-edit")).toBeNull();
    await pick(4);
    expect(pillName()).toBe("行程管家");
    expect(document.querySelector('.mb-det [data-slot="conversations"]')).toBeNull();
    agent.hide();
  });

  test("a roster that no longer has the open slime moves to the chief, or Raphael when no slime is left", async () => {
    api.membersList.mockResolvedValue(roster(3)); readConversations();
    const agent = mount(); await flush(); await pick(4);
    api.membersList.mockResolvedValue(roster(3, [3]));
    send({ type: "MembersChanged" } as MainEvent); await flush(); await flush();
    expect(pillName()).toBe("日文老師");
    // The core's events are read at most once in 300 ms.
    await new Promise(resolve => setTimeout(resolve, 350));
    api.membersList.mockResolvedValue(roster(null, []));
    send({ type: "MembersChanged" } as MainEvent); await flush(); await flush();
    expect(pillName()).toBe("拉斐爾");
    agent.hide();
  });
});
