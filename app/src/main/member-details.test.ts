// @vitest-environment happy-dom
// The details panel (member-details.ts): what it shows for a member and for Raphael, and the calls
// its edits make: the name, the role and the instructions saved when they lose the focus, the group,
// the routines, the tools, and the two memories with the move between them.
import { type Mock, beforeEach, describe, expect, test, vi } from "vitest";
import type { AppContext, Member, MemberPatch, MembersList, Routine } from "./types";

const api = vi.hoisted(() => ({
  core: vi.fn(),
  workerCancel: vi.fn().mockResolvedValue({}),
  workerRerun: vi.fn().mockResolvedValue({}),
  openTeamFile: vi.fn().mockResolvedValue(undefined),
  routinesList: vi.fn(),
  routineRuns: vi.fn(),
  routinesCreate: vi.fn(),
  routinesUpdate: vi.fn(),
  routinesDelete: vi.fn(),
  avatarPick: vi.fn(),
  avatarSave: vi.fn(),
  avatarClear: vi.fn(),
  avatarGet: vi.fn(),
}));
vi.mock("./api", () => api);

import { createDetails } from "./member-details";
import { setAvatar } from "./avatar";
import { setLocale, t } from "./i18n";

const member = (id: number, more: Partial<Member> = {}): Member => ({
  id, name: `成員${id}`, role: "", instructions: "", avatar: "", group_id: null, model: "", tools: null, position: id, created: 0, unread: false, waiting: false, preview: "", last_at: null, ...more,
});
const LIST: MembersList = {
  members: [member(0, { name: "拉斐爾" }), member(3, { name: "日文老師", role: "N2 嚴格版", group_id: 20, instructions: "每天出 10 題" }), member(4, { name: "行程管家" })],
  groups: [{ id: 20, name: "學習", position: 0, sources: [{ kind: "github", ref: "example/app" }] }, { id: 21, name: "專案", position: 1, sources: [] }],
};
const ROUTINE: Routine = { id: 9, member_id: 3, title: "每天的單字", prompt: "出題", schedule: { kind: "daily", time: "08:00" }, enabled: true, last_run: null, next_run: null };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

let current = 3;
let host: Parameters<typeof createDetails>[0] & { update: Mock<(id: number, patch: MemberPatch) => Promise<boolean>>; close: Mock<() => void> };

function mount(settings = true) {
  host = {
    app: { undo: { begin: vi.fn() } } as unknown as AppContext,
    member: () => LIST.members.find((m) => m.id === current)!,
    list: () => LIST,
    update: vi.fn(async (_id: number, _patch: MemberPatch) => true),
    close: vi.fn<() => void>(),
  };
  const panel = createDetails(host);
  document.body.append(panel.el);
  panel.showMember();
  if (settings) panel.el.querySelector<HTMLButtonElement>('[data-det="gear"]')!.click();
  return panel;
}

beforeEach(() => {
  document.body.innerHTML = "";
  setAvatar(null);
  setLocale('zh-TW');
  current = 3;
  for (const fn of Object.values(api)) fn.mockReset();
  api.routinesList.mockResolvedValue({ routines: [ROUTINE] });
  api.routineRuns.mockResolvedValue({ runs: [] });
  api.routinesCreate.mockResolvedValue({});
  api.routinesUpdate.mockResolvedValue({});
  api.core.mockImplementation(async (method: string, params: { space?: string }) => {
    if (method === "memory.get" || method === "memory.update") {
      const shared = params?.space === "shared";
      return { text: shared ? "主人住台北\n" : "在背單字\n\n每週三複習\n", revision: "r1", chars: 9, entries: shared ? 1 : 2, limit: shared ? 1375 : 2200, summary: null };
    }
    return {};
  });
});

describe("a member's panel", () => {
  test('the main tab keyboard handler leaves resource tabs inside Settings alone', async () => {
    const panel = mount(); await flush();
    const resourceTab = document.createElement('button'); resourceTab.setAttribute('role','tab');
    panel.el.querySelector('.mb-tab-body')!.append(resourceTab);
    resourceTab.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    expect(panel.el.dataset.detailsTab).toBe('settings');
  });
  test.each(['running', 'done'])('work in state %s opens its existing result and exposes the matching action', async state => {
    api.core.mockImplementation(async method => method === 'members.list' ? {tasks:[{id:99,turn_id:42,conversation_id:7,title:'Sample work',state,created_at_ms:1}],files:[],has_more:false} : {});
    api.workerCancel.mockResolvedValue({}); api.workerRerun.mockResolvedValue({});
    const panel = mount(false); host.openTurn = vi.fn(); await flush();
    panel.el.querySelector<HTMLButtonElement>('[data-panel-task="99"]')!.click();
    expect(host.openTurn).toHaveBeenCalledExactlyOnceWith(3,7,42);
    panel.el.querySelector<HTMLButtonElement>('[data-panel-task-menu="99"]')!.click();
    const action = document.querySelector<HTMLButtonElement>('.menu [role="menuitem"]')!;
    expect(action.textContent).toContain(t(state === 'running' ? 'agent.stop' : 'members.panelRerun'));
    action.click(); await flush();
    expect(state === 'running' ? api.workerCancel : api.workerRerun).toHaveBeenCalledExactlyOnceWith(99);
  });
  test('the shared three tabs support arrow navigation and reset for another member', async () => {
    const panel = mount(false); await flush();
    const selected = () => panel.el.querySelector<HTMLElement>('.mb-tabs [aria-selected="true"]')!;
    expect(selected().dataset.tab).toBe('details');
    selected().focus(); selected().dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true}));
    expect(selected().dataset.tab).toBe('library');
    expect(document.activeElement).toBe(selected());
    selected().dispatchEvent(new KeyboardEvent('keydown', {key:'End',bubbles:true}));
    expect(selected().dataset.tab).toBe('computer');
    current = 4; panel.showMember(); await flush();
    expect(selected().dataset.tab).toBe('details');
  });
  test('a late library read cannot put another member files into the selected panel', async () => {
    let resolve!: (value: unknown) => void;
    api.core.mockImplementation(async (method, params) => method === 'members.list'
      ? params.panel_member_id === 3 ? new Promise(done => {resolve = done;}) : {tasks:[],files:[],has_more:false}
      : {});
    const panel = mount(false); await flush();
    current = 4; panel.showMember(); panel.select('library'); await flush();
    resolve({tasks:[],files:[{id:'stale',name:'Stale file',kind:'file',at_ms:1}],has_more:false}); await flush();
    expect(panel.el.textContent).not.toContain('Stale file');
    expect(panel.el.querySelector('.mb-tab-body')?.textContent).toBe(t('members.panelNoFiles'));
  });
  test.each([0, 3])("member %s uses the shared draft preference switch", async id => {
    current = id;
    const panel = mount(); await flush();
    const toggle = panel.el.querySelector<HTMLButtonElement>('[data-det="draft"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    toggle.click(); await flush();
    expect(toggle.closest(".mb-panel-pages")).not.toBeNull();
    expect(host.update).toHaveBeenCalledWith(id, { draft_first: false });
    host.member().draft_first = false; panel.draw();
    panel.el.querySelector<HTMLButtonElement>('[data-det="draft"]')!.click(); await flush();
    expect(host.update).toHaveBeenLastCalledWith(id, { draft_first: true });
    delete host.member().draft_first;
  });
  test("the gear Back button follows a locale change", async () => {
    const panel=mount(); await flush(); setLocale('en'); panel.draw();
    expect(panel.el.querySelector('[data-det="back"]')?.getAttribute('aria-label')).toBe(t('members.panelBack'));
    setLocale('zh-TW');
  });
  test("Raphael's gear picture follows the current custom avatar on redraw", async () => {
    current=0; const panel=mount(); await flush();
    const avatar={url:'data:image/png;base64,c2FtcGxl',crop:{x:.5,y:.5,zoom:1}};
    setAvatar(avatar); panel.draw();
    expect(panel.el.querySelector<HTMLImageElement>('.mb-who img')?.getAttribute('src')).toBe(avatar.url);
    setAvatar(null); panel.draw();
    expect(panel.el.querySelector('.mb-who img')?.getAttribute('src')).not.toBe(avatar.url);
  });

  test.each(['mb-det-name','mb-det-role','mb-det-personality','mb-det-instr'])("a rejected save restores %s after focus leaves", async id => {
    const panel=mount(); await flush();
    for (const button of panel.el.querySelectorAll<HTMLButtonElement>('.mb-fold-head')) button.click();
    const input=panel.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!;
    const saved=input.value; host.update.mockImplementation(async()=>{panel.draw(); return false;});
    input.focus(); input.value='Synthetic rejected edit'; input.blur(); await flush(); panel.draw();
    expect(host.update).toHaveBeenCalled();
    expect(panel.el.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${id}`)!.value).toBe(saved);
  });
  test("the first view has routine buttons before conversations and settings behind the gear", async () => {
    const panel = mount(false); await flush();
    expect(panel.el.querySelector('[data-det="tab"][data-tab="routines"]')).toBeNull();
    expect(panel.el.querySelector('button.mb-rt[data-det="routine-open"]')?.textContent).toContain(ROUTINE.title);
    expect(panel.el.querySelector('.mb-rt [role="switch"]')).toBeNull();
    expect(panel.el.querySelector<HTMLElement>('.mb-who')!.hidden).toBe(false);
    expect(panel.el.querySelectorAll('.mb-tabs [role="tab"]')).toHaveLength(3);
    panel.el.querySelector<HTMLButtonElement>('[data-det="gear"]')!.click();
    expect(panel.el.querySelector<HTMLElement>('.mb-who')!.hidden).toBe(false);
    expect(panel.el.querySelector('[data-det="back"]:not([hidden])')).not.toBeNull();
    expect(panel.el.querySelector('[data-det="tab"][data-tab="memory"]')).not.toBeNull();
  });

  test("an unchanged routine refresh keeps every node, focus and scroll untouched", async () => {
    const panel = mount(); await flush();
    const writes: MutationRecord[] = [];
    const observer = new MutationObserver(records => writes.push(...records));
    observer.observe(panel.el, { subtree: true, childList: true, attributes: true, characterData: true });
    panel.refreshRoutines(); await flush();
    expect([...writes, ...observer.takeRecords()]).toHaveLength(0);
    observer.disconnect();
  });
  test("Hide has an action icon without promising another page or submenu", () => {
    const panel = mount();
    const hide = panel.el.querySelector('[data-det="hide"]')!;
    expect(hide.querySelectorAll('svg')).toHaveLength(1);
    expect(hide.hasAttribute('aria-haspopup')).toBe(false);
  });
  test("conversation slot loads the selected member, preserves search on redraw, navigates and collapses when empty", async () => {
    const panel = mount(false);
    const open = vi.fn();
    host.openConversation = open;
    const original = api.core.getMockImplementation()!;
    api.core.mockImplementation(async (method, params) => method === "conversations.list"
      ? { conversations: params.member_id === 3 ? [{ id: 91, member_id: 3, title: "Research", updated_at_ms: Date.now() }] : [] }
      : original(method, params));
    panel.draw(); await flush();
    const slot = panel.el.querySelector<HTMLElement>('[data-slot="conversations"]')!;
    expect([...panel.el.querySelectorAll('.mb-dh')].filter(node => node.textContent === t('conversations.heading'))).toHaveLength(1);
    const input = slot.querySelector<HTMLInputElement>('input')!;
    input.value = "Research"; input.dispatchEvent(new Event("input"));
    panel.draw(); await flush();
    expect(panel.el.querySelector('[data-slot="conversations"] input')).toBe(input);
    panel.el.querySelector<HTMLButtonElement>('[data-conversation-open="91"]')!.click();
    expect(open).toHaveBeenCalledWith(3, 91);
    current = 4; panel.showMember(); await flush();
    expect(panel.el.querySelector<HTMLElement>('[data-slot="conversations"]')!.hidden).toBe(true);
    expect(panel.el.textContent).not.toContain("Research");
  });

  test("editing and hiding belong to settings behind the gear", async () => {
    const panel = mount();
    host.edit = vi.fn();
    host.hide = vi.fn();
    await flush();
    const edit = panel.el.querySelector<HTMLButtonElement>('[data-det="edit"]')!;
    expect(edit.closest(".mb-tab-body")).not.toBeNull();
    expect(panel.el.querySelector('.mb-det-head [data-det="gear"]')).not.toBeNull();
    expect(edit.textContent).toContain("編輯成員");

    expect(panel.el.querySelector<HTMLElement>(".mb-tabs")!.hidden).toBe(true);
    edit.click();
    expect(host.edit).toHaveBeenCalledWith(LIST.members[1]);
    const hide = panel.el.querySelector<HTMLButtonElement>('[data-det="hide"]')!;
    expect(hide.closest(".mb-panel-pages")).not.toBeNull();
    expect(hide.classList.contains("mb-panel-row")).toBe(true);
    expect(hide.textContent).toContain("從側欄隱藏");
    expect(hide.querySelector("small")!.textContent).toContain("設定");
    hide.click();
    expect(host.hide).toHaveBeenCalledWith(LIST.members[1]);
    expect(panel.el.querySelector('[data-slot="conversations"]')).toBeNull();
    current = 0;
    panel.showMember();
    expect(panel.el.querySelector('[data-det="edit"]')).toBeNull();
    expect(panel.el.querySelector('[data-det="hide"]')).toBeNull();
  });

  test("a personality draft survives redraws and is saved to its original member on switching", async () => {
    const panel = mount();
    await flush();
    const box = panel.el.querySelector<HTMLTextAreaElement>("#mb-det-personality")!;
    box.focus();
    box.value = "嚴厲但耐心";
    panel.draw();
    expect(panel.el.querySelector<HTMLTextAreaElement>("#mb-det-personality")!.value).toBe("嚴厲但耐心");
    expect(host.update).not.toHaveBeenCalled();
    current = 4;
    panel.showMember();
    panel.el.querySelector<HTMLButtonElement>('[data-det="gear"]')!.click();
    await flush();
    expect(host.update).toHaveBeenCalledWith(3, { personality: "嚴厲但耐心" });
    expect(panel.el.querySelector<HTMLTextAreaElement>("#mb-det-personality")!.value).toBe("");
  });

  test("stored personality is escaped, unchanged text is not saved, and clearing is saved", async () => {
    const before = LIST.members[1];
    LIST.members[1] = { ...before, personality: '</textarea><script>privateStyle()</script>' };
    try {
      const panel = mount();
      await flush();
      const box = panel.el.querySelector<HTMLTextAreaElement>("#mb-det-personality")!;
      expect(box.value).toBe(LIST.members[1].personality);
      expect(panel.el.querySelector("script")).toBeNull();
      box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      expect(host.update).not.toHaveBeenCalled();
      box.value = " ";
      box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await flush();
      expect(host.update).toHaveBeenCalledWith(3, { personality: "" });
    } finally {
      LIST.members[1] = before;
    }
  });

  test("personality is separate from instructions and saved on blur", async () => {
    const panel = mount();
    await flush();
    // closed, a long field is its name and its first line behind a button; open, the box
    const head = panel.el.querySelector<HTMLButtonElement>('[data-field="mb-det-personality"]')!;
    expect(head.getAttribute("aria-expanded")).toBe("false");
    expect(head.textContent).toContain("個性");
    expect(panel.el.querySelector<HTMLElement>("#mb-det-personality-body")!.hidden).toBe(true);
    head.click();
    const box = panel.el.querySelector<HTMLTextAreaElement>("#mb-det-personality");
    expect(panel.el.querySelector<HTMLElement>("#mb-det-personality-body")!.hidden).toBe(false);
    expect(document.activeElement).toBe(box);
    expect(box!.maxLength).toBe(2000);
    box!.value = "  嚴厲但耐心。\n直接稱呼你。  ";
    box!.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    expect(host.update).toHaveBeenCalledWith(3, { personality: "嚴厲但耐心。\n直接稱呼你。" });
    expect(panel.el.querySelector<HTMLTextAreaElement>("#mb-det-instr")!.value).toBe("每天出 10 題");
    current = 0;
    panel.showMember();
    await flush();
    expect(panel.el.querySelector("#mb-det-personality")).toBeNull();
  });

  test("its picture, its name and role to change in place, and the tabs", async () => {
    const panel = mount();
    await flush();
    expect(panel.el.querySelector<HTMLInputElement>("#mb-det-name")!.value).toBe("日文老師");
    expect(panel.el.querySelector<HTMLInputElement>("#mb-det-role")!.value).toBe("N2 嚴格版");
    expect(panel.el.querySelector(".mb-avbtn .mb-av-slime svg")).not.toBeNull();
    expect([...panel.el.querySelectorAll<HTMLElement>(".mb-panel-pages [data-tab]")].map(b => b.dataset.tab)).toEqual(["memory", "skills", "commands", "voice"]);
    panel.el.querySelector<HTMLElement>('[data-tab="skills"]')!.click();
    expect(panel.el.querySelector<HTMLElement>(".mb-who")!.hidden).toBe(false);
    panel.el.querySelector<HTMLElement>('[data-det="back"]')!.click();
    expect(panel.el.querySelector<HTMLElement>(".mb-who")!.hidden).toBe(false);
  });

  test("the name is saved when it loses the focus; a blank or a taken one goes back", async () => {
    const panel = mount();
    await flush();
    const name = panel.el.querySelector<HTMLInputElement>("#mb-det-name")!;
    name.focus();
    name.value = "老師";
    name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    expect(host.update).toHaveBeenCalledWith(3, { name: "老師" });
    host.update.mockClear();
    name.value = "行程管家";
    name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    name.value = " ";
    name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    expect(host.update).not.toHaveBeenCalled();
    expect(name.value).toBe("日文老師");
  });

  test("the instructions are saved on blur, only when they changed", async () => {
    const panel = mount();
    await flush();
    const box = panel.el.querySelector<HTMLTextAreaElement>("#mb-det-instr")!;
    expect(box.value).toBe("每天出 10 題");
    box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(host.update).not.toHaveBeenCalled();
    box.value = "每天出 20 題";
    box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush();
    expect(host.update).toHaveBeenCalledWith(3, { instructions: "每天出 20 題" });
  });

  test("the group is a dropdown: 未分組, then the groups", async () => {
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLElement>('[data-det="group"]')!.click();
    const items = [...document.querySelectorAll<HTMLElement>("#app-popover [data-value]")];
    expect(items.map((b) => b.textContent)).toEqual(["未分組", "學習", "專案"]);
    items[2].click();
    expect(host.update).toHaveBeenCalledWith(3, { group_id: 21 });
  });

  test("the brain is chosen next to the composer, not here, and the group's places are chips", async () => {
    const panel = mount();
    await flush();
    expect(panel.el.querySelectorAll(".mp-trigger")).toHaveLength(0);
    expect([...panel.el.querySelectorAll(".mb-chips .mb-chip")].map((c) => c.textContent)).toEqual(["example/app"]);
  });

  test("its routine row opens the editor where a saved switch pauses it", async () => {
    const panel = mount();
    await flush();
    expect(api.routinesList).toHaveBeenCalledWith(3);
    panel.el.querySelector<HTMLButtonElement>('[data-det="back"]')!.click();
    const row = panel.el.querySelector<HTMLElement>('[data-routine="9"]')!;
    expect(row.textContent).toContain("每天的單字");
    expect(row.textContent).toContain("每天 08:00");
    expect(row.querySelector('[role="switch"]')).toBeNull();
    row.click();
    const toggle = document.querySelector<HTMLButtonElement>('[data-dlg="enabled"]')!;
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    toggle.click();
    document.querySelector<HTMLButtonElement>('[data-dlg="save"]')!.click();
    await flush();
    expect(api.routinesUpdate).toHaveBeenCalledWith(9, expect.objectContaining({ enabled: false }));
  });

  test("a new routine: title, a schedule from the dropdown, what to do; saved with routines.create", async () => {
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLButtonElement>('[data-det="back"]')!.click();
    panel.el.querySelector<HTMLElement>('[data-det="routine-add"]')!.click();
    document.querySelector<HTMLInputElement>("#au-title")!.value = "每週回顧";
    document.querySelector<HTMLTextAreaElement>("#au-prompt")!.value = "整理這週";
    document.querySelector<HTMLElement>('[data-dlg="kind"][data-kind="every"]')!.click();
    // the title and the prompt typed are kept across the drawing
    expect(document.querySelector<HTMLInputElement>("#au-title")!.value).toBe("每週回顧");
    document.querySelector<HTMLElement>('[data-dlg="hours"]')!.click();
    document.querySelector<HTMLElement>('#app-popover [data-value="6"]')!.click();
    document.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
    await flush();
    expect(api.routinesCreate).toHaveBeenCalledWith({ member_id: 3, title: "每週回顧", prompt: "整理這週", schedule: expect.objectContaining({ kind: "every", hours: 6 }) });
  });

  test("a routine without a title is not sent", async () => {
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLButtonElement>('[data-det="back"]')!.click();
    panel.el.querySelector<HTMLElement>('[data-det="routine-add"]')!.click();
    document.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
    await flush();
    expect(api.routinesCreate).not.toHaveBeenCalled();
  });

  test("the shared HH:MM field rejects invalid times and saves a valid time", async () => {
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLButtonElement>('[data-det="back"]')!.click();
    panel.el.querySelector<HTMLElement>('[data-det="routine-add"]')!.click();
    const form = document.querySelector<HTMLElement>(".au-routine-dialog")!;
    const time = form.querySelector<HTMLInputElement>("#au-time")!;
    expect(time.type).toBe("text");
    expect(time.placeholder).toBe("00:00");
    form.querySelector<HTMLInputElement>("#au-title")!.value = "Review";
    form.querySelector<HTMLTextAreaElement>("#au-prompt")!.value = "Summarize progress";
    form.querySelector<HTMLElement>('[data-kind="daily"]')!.click();
    form.querySelector<HTMLInputElement>("#au-time")!.value = "25:61";
    form.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
    await flush();
    expect(api.routinesCreate).not.toHaveBeenCalled();
    form.querySelector<HTMLInputElement>("#au-time")!.value = "08:45";
    form.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
    await flush();
    expect(api.routinesCreate).toHaveBeenCalledWith({ member_id: 3, title: "Review", prompt: "Summarize progress", schedule: expect.objectContaining({ kind: "daily", time: "08:45" }) });
  });

  test("記憶: 共同記憶 and the member's own, each read with its space", async () => {
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLElement>('[data-tab="memory"]')!.click();
    await flush();
    expect(api.core).toHaveBeenCalledWith("memory.get", { space: "shared" });
    expect(api.core).toHaveBeenCalledWith("memory.get", { space: "own", member_id: 3 });
    const sections = [...panel.el.querySelectorAll<HTMLElement>("[data-mem-section]")];
    expect(sections.map((s) => [s.dataset.memSpace, s.getAttribute("aria-label")])).toEqual([["shared", "共同記憶"], ["own", "日文老師的記憶"]]);
    expect(sections[0].textContent).toContain("主人住台北");
    expect(sections[1].textContent).toContain("在背單字");
  });

  test("the row that opens 記憶 says how many entries the member's own file holds", async () => {
    const panel = mount();
    await flush();
    expect(panel.el.querySelector<HTMLElement>('[data-tab="memory"]')!.textContent).toContain("2 則記憶");
    expect(api.core).toHaveBeenCalledWith("memory.get", { member_id: 3, space: "own" });
  });

  test("編輯 in one section opens the box of that section alone, and 儲存 writes that file", async () => {
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLElement>('[data-tab="memory"]')!.click();
    await flush();
    panel.el.querySelector<HTMLElement>('[data-mem-space="own"] [data-mem="edit"]')!.click();
    const box = panel.el.querySelector<HTMLTextAreaElement>('[data-mem-space="own"] textarea.mem-body')!;
    expect(box.value).toBe("在背單字\n\n每週三複習");
    expect(panel.el.querySelector('[data-mem-space="shared"] textarea')).toBeNull();
    box.value = "在背單字";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    panel.el.querySelector<HTMLElement>('[data-mem-space="own"] [data-mem="save"]')!.click();
    await flush();
    expect(api.core).toHaveBeenCalledWith("memory.update", { space: "own", member_id: 3, text: "在背單字", revision: "r1" });
  });

  test("× closes it", () => {
    const panel = mount();
    panel.el.querySelector<HTMLElement>('[data-det="close"]')!.click();
    expect(host.close).toHaveBeenCalled();
  });

  test("switching members while instructions are focused saves to the previous member and draws the new member", async () => {
    const panel = mount();
    await flush();
    const box = panel.el.querySelector<HTMLTextAreaElement>("#mb-det-instr")!;
    box.focus();
    box.value = "改成每天 5 題";
    current = 4;
    panel.showMember();
    panel.el.querySelector<HTMLButtonElement>('[data-det="gear"]')!.click();
    await flush();
    expect(host.update).toHaveBeenCalledWith(3, { instructions: "改成每天 5 題" });
    expect(panel.el.querySelector<HTMLTextAreaElement>("#mb-det-instr")!.value).toBe("");
  });

  test("renaming a member while tabbing to role updates the face initial in the header", async () => {
    const panel = mount();
    await flush();
    const name = panel.el.querySelector<HTMLInputElement>("#mb-det-name")!;
    const role = panel.el.querySelector<HTMLInputElement>("#mb-det-role")!;
    name.focus();
    name.value = "老師";
    host.update.mockImplementationOnce(async (_id, patch) => {
      await Promise.resolve();
      LIST.members[1] = { ...LIST.members[1], ...patch };
      panel.draw();
      return true;
    });
    name.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    role.focus();
    await flush();
    expect(panel.el.querySelector(".mb-avbtn .mb-av-slime svg")).not.toBeNull();
    LIST.members[1] = { ...LIST.members[1], name: "日文老師" };
  });

  test("double-clicking routine save while create is in flight sends only one request", async () => {
    let finish!: () => void;
    api.routinesCreate.mockImplementation(() => new Promise<Record<string, never>>((r) => (finish = () => r({}))));
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLButtonElement>('[data-det="back"]')!.click();
    panel.el.querySelector<HTMLElement>('[data-det="routine-add"]')!.click();
    document.querySelector<HTMLInputElement>("#au-title")!.value = "早報";
    document.querySelector<HTMLTextAreaElement>("#au-prompt")!.value = "摘要";
    document.querySelector<HTMLElement>('[data-dlg="kind"][data-kind="daily"]')!.click();
    const save = document.querySelector<HTMLElement>('[data-dlg="save"]')!;
    save.click();
    save.click();
    expect(api.routinesCreate).toHaveBeenCalledTimes(1);
    finish();
    await flush();
  });
});

describe("Raphael's panel", () => {
  test("his picture and his name only, and his routines", async () => {
    current = 0;
    const panel = mount();
    await flush();
    expect(panel.el.querySelector("#mb-det-name")).toBeNull();
    expect(panel.el.querySelector(".mb-who-name")!.textContent).toBe("拉斐爾");
    expect(panel.el.querySelector(".mb-avbtn .av")!.innerHTML).toContain("app-emblem");
    expect(panel.el.querySelector("#mb-det-instr")).toBeNull();
    expect(panel.el.querySelector('[data-det="group"]')).toBeNull();
    expect([...panel.el.querySelectorAll<HTMLElement>(".mb-panel-pages [data-tab]")].map(row => row.dataset.tab)).toEqual(["memory", "skills", "commands", "voice"]);
    expect(api.core).toHaveBeenCalledWith("members.commands.list", { member_id: 0 });
    expect(api.routinesList).toHaveBeenCalledWith(0);
  });

  test("his picture is changed here: from the PC, nothing of presets", async () => {
    current = 0;
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLElement>('[data-det="avatar"]')!.click();
    expect([...document.querySelectorAll("#app-popover button")].map((b) => b.textContent)).toEqual(["從電腦選…"]);
    api.avatarPick.mockResolvedValue(null);
    document.querySelector<HTMLElement>("#app-popover button")!.click();
    await flush();
    expect(api.avatarPick).toHaveBeenCalled();
  });

  test("his memory: 共同記憶 and 拉斐爾的記憶", async () => {
    current = 0;
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLElement>('[data-tab="memory"]')!.click();
    await flush();
    expect(api.core).toHaveBeenCalledWith("memory.get", { space: "own", member_id: 0 });
    expect([...panel.el.querySelectorAll("[data-mem-section]")].map((s) => s.getAttribute("aria-label"))).toEqual(["共同記憶", "拉斐爾的記憶"]);
  });
});

test("live routines update while instructions retain their node, draft and caret", async () => {
  const panel = mount();
  await flush();
  const box = panel.el.querySelector<HTMLTextAreaElement>("#mb-det-instr")!;
  box.focus();
  box.value = "Unsaved instructions";
  box.setSelectionRange(2, 6);
  api.routinesList.mockResolvedValue({ routines: [{ ...ROUTINE, title: "Changed live" }] });
  panel.refreshRoutines();
  await flush();
  expect(panel.el.querySelector("#mb-det-instr")).toBe(box);
  expect(document.activeElement).toBe(box);
  expect(box.value).toBe("Unsaved instructions");
  expect(box.selectionStart).toBe(2);
  expect(host.update).not.toHaveBeenCalled();
  panel.el.querySelector<HTMLButtonElement>('[data-det="back"]')!.click();
  expect(panel.el.querySelector('.mb-rts')!.textContent).toContain('Changed live');
});

test("a remote deletion keeps the routine draft editable and refresh failure keeps rows", async () => {
  const panel = mount();
  await flush();
  panel.el.querySelector<HTMLButtonElement>('[data-det="back"]')!.click();
  panel.el.querySelector<HTMLElement>('[data-det="routine-open"]')!.click();
  const title = document.querySelector<HTMLInputElement>("#au-title")!;
  title.value = "Unsaved routine";
  title.focus();
  api.routinesList.mockResolvedValue({ routines: [] });
  panel.refreshRoutines();
  await flush();
  expect(document.querySelector<HTMLInputElement>("#au-title")!.value).toBe("Unsaved routine");
  expect(document.activeElement?.id).toBe("au-title");
  document.querySelector<HTMLElement>('[data-dlg="cancel"]')!.click();
  api.routinesList.mockResolvedValue({ routines: [ROUTINE] });
  panel.refreshRoutines();
  await flush();
  api.routinesList.mockRejectedValue(new Error("offline"));
  panel.refreshRoutines();
  await flush();
  expect(panel.el.querySelector('[data-routine="9"]')).not.toBeNull();
});

test("a late routine response cannot replace the newly selected member's routines", async () => {
  const panel = mount();
  await flush();
  let resolve!: (value: { routines: Routine[] }) => void;
  api.routinesList.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  panel.refreshRoutines();
  current = 4;
  api.routinesList.mockResolvedValue({ routines: [{ ...ROUTINE, id: 10, member_id: 4, title: "Other member" }] });
  panel.showMember();
  await flush();
  resolve({ routines: [ROUTINE] });
  await flush();
  expect(panel.el.querySelector(".mb-rts")!.textContent).toContain("Other member");
  expect(panel.el.querySelector('[data-routine="9"]')).toBeNull();
});


test("a focused name keeps its draft while the remote role updates", async () => {
  const panel = mount();
  await flush();
  const name = panel.el.querySelector<HTMLInputElement>("#mb-det-name")!;
  name.focus();
  name.value = "Draft name";
  name.setSelectionRange(2, 4);
  const original = host.member();
  host.member = () => ({ ...original, role: "New remote role" });
  panel.draw();
  expect(panel.el.querySelector<HTMLInputElement>("#mb-det-role")!.value).toBe("New remote role");
  expect(document.activeElement).toBe(name);
  expect(name.value).toBe("Draft name");
  expect(name.selectionStart).toBe(2);
});

test("resource rows count saved skills including disabled ones and only active routines", async () => {
  api.core.mockImplementation(async (method: string) => {
    if (method === "members.skills.list") return { skills: [{ enabled: true }, { enabled: false }] };
    if (method === "members.commands.list") return { commands: [{ id: 1 }] };
    return { memories: [] };
  });
  api.routinesList.mockResolvedValue({ routines: [ROUTINE, { ...ROUTINE, id: 10, enabled: false }] });
  const panel = mount(); await flush();
  expect(panel.el.querySelector('[data-tab="skills"] small')!.textContent).toContain("2");
  panel.el.querySelector<HTMLButtonElement>('[data-det="back"]')!.click();
  expect(panel.el.querySelectorAll('.mb-rt-state.is-on')).toHaveLength(1);
});


describe("primary changes do not add face badges", () => {
  const withPrimary = (primary_id: number): MembersList => ({ ...LIST, team_context: { primary_id } as MembersList["team_context"] });
  test.each([0, 3])("member %s keeps its picture and editable draft without a primary star", async id => {
    current = id;
    const panel = mount(); await flush();
    const name = panel.el.querySelector<HTMLInputElement>('#mb-det-name');
    if (name) { name.focus(); name.value = 'Draft name'; }
    for (const primary of [id, 4, 0]) {
      host.list = () => withPrimary(primary); panel.draw();
      expect(panel.el.querySelector('.mb-star')).toBeNull();
      expect(panel.el.querySelector('.mb-who-face .mb-avbtn .av')).not.toBeNull();
      if (name) { expect(document.activeElement).toBe(name); expect(name.value).toBe('Draft name'); }
    }
    if (id === 0) expect(panel.el.querySelector('.mb-who-face .mb-av')).toBeNull();
  });
});


test("the details routine editor uses the same relative history timestamp", async () => {
  const now = new Date(2026, 10, 5, 12).getTime();
  const started = new Date(2026, 10, 4, 8, 0, 37).getTime();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now);
  api.routineRuns.mockResolvedValue({ runs: [{ id: 1, routine_id: ROUTINE.id, started, finished: started + 1000, status: "done", summary: "Completed", cost: 0, turn_id: 1 }] });
  try {
    const panel = mount(false);
    await flush();
    panel.el.querySelector<HTMLElement>('[data-det="routine-open"]')!.click();
    await flush();
    expect(document.querySelector('[data-run-status="done"]')?.textContent).toBe("成功 · 昨天 08:00Completed");
    expect(document.querySelector('.au-run-history')?.textContent).not.toContain("08:00:37");
    document.querySelector<HTMLElement>('[data-dlg="cancel"]')!.click();
  } finally { clock.mockRestore(); }
});
