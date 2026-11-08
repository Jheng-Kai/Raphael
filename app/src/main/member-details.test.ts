// @vitest-environment happy-dom
// The details panel (member-details.ts): what it shows for a member and for Raphael: its routines, bots, library and
// computer, and the calls those make. What the owner changes about a member is the member settings page
// (member-settings.test.ts); the panel's gear opens it.
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
  memberMessagingStatus: vi.fn(),
  memberMessagingConnect: vi.fn(),
  telegramStatus: vi.fn(),
  messagingCall: vi.fn(),
  agentAskText: vi.fn().mockResolvedValue(undefined),
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
let host: Parameters<typeof createDetails>[0] & { update: Mock<(id: number, patch: MemberPatch) => Promise<boolean>>; close: Mock<() => void>; openSettings: Mock<() => void> };

function mount() {
  host = {
    app: { undo: { begin: vi.fn() } } as unknown as AppContext,
    member: () => LIST.members.find((m) => m.id === current)!,
    list: () => LIST,
    update: vi.fn(async (_id: number, _patch: MemberPatch) => true),
    close: vi.fn<() => void>(),
    openSettings: vi.fn<() => void>(),
  };
  const panel = createDetails(host);
  document.body.append(panel.el);
  panel.showMember();
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
  api.core.mockImplementation(async () => ({}));
});

describe("a member's panel", () => {
  test('Details has no list of what the member did: its routines come first', async () => {
    api.core.mockImplementation(async method => method === 'members.list' ? {files:[],has_more:false} : {});
    const panel = mount(); await flush();
    expect(panel.el.querySelector('.mb-panel-tasks, .mb-task-list, [data-panel-task]')).toBeNull();
    expect(panel.el.querySelector('.mb-tab-body > :first-child')?.matches('.mb-panel-routines')).toBe(true);
  });
  test('the shared three tabs support arrow navigation and reset for another member', async () => {
    const panel = mount(); await flush();
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
    api.core.mockImplementation(async (method, params) => method === 'members.library'
      ? params.member_id === 3 ? new Promise(done => {resolve = done;}) : {files:[],has_more:false}
      : {});
    const panel = mount(); await flush();
    current = 4; panel.showMember(); panel.select('library'); await flush();
    resolve({files:[{id:'stale',title:'Stale file',name:'Stale file',kind:'file',at_ms:1,day:'1970-01-01'}],has_more:false}); await flush();
    expect(panel.el.textContent).not.toContain('Stale file');
    expect(panel.el.querySelector('.mb-tab-body')?.textContent).toBe(t('members.panelNoFiles'));
  });
  test("Raphael's face follows the current custom avatar on redraw", async () => {
    current=0; const panel=mount(); await flush();
    const avatar={url:'data:image/png;base64,c2FtcGxl',crop:{x:.5,y:.5,zoom:1}};
    setAvatar(avatar); panel.draw();
    expect(panel.el.querySelector<HTMLImageElement>('.mb-who img')?.getAttribute('src')).toBe(avatar.url);
    setAvatar(null); panel.draw();
    expect(panel.el.querySelector('.mb-who img')?.getAttribute('src')).not.toBe(avatar.url);
  });

  test("the first view has the routines before conversations, and the three tabs", async () => {
    const panel = mount(); await flush();
    expect(panel.el.querySelector('[data-det="tab"][data-tab="routines"]')).toBeNull();
    expect(panel.el.querySelector('button.mb-rt[data-det="routine-open"]')?.textContent).toContain(ROUTINE.title);
    expect(panel.el.querySelector('.mb-rt [role="switch"]')).toBeNull();
    expect(panel.el.querySelector<HTMLElement>('.mb-who')!.hidden).toBe(false);
    expect(panel.el.querySelectorAll('.mb-tabs [role="tab"]')).toHaveLength(3);
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
  test("a member has no conversation list, and Raphael's panel switches between its conversation and quick questions", async () => {
    const panel = mount();
    const open = vi.fn();
    host.openConversation = open;
    const original = api.core.getMockImplementation()!;
    api.core.mockImplementation(async (method, params) => method === "conversations.list"
      ? { conversations: params.member_id === 0
        ? [{ id: 1, member_id: 0, title: "Weekly plan", updated_at_ms: Date.now(), is_default: 1, kind: "standard" }, { id: 2, member_id: 0, title: "", updated_at_ms: Date.now(), kind: "quick" }]
        : [{ id: 91, member_id: params.member_id, title: "Research", updated_at_ms: Date.now(), is_default: 1, kind: "standard" }] }
      : original(method, params));
    panel.draw(); await flush();
    expect(panel.el.querySelector('[data-slot="conversations"]')).toBeNull();
    expect(panel.el.querySelector('[data-conversation-new]')).toBeNull();
    expect(panel.el.textContent).not.toContain("Research");
    current = 0; panel.showMember(); await flush();
    const rows = [...panel.el.querySelectorAll<HTMLButtonElement>('[data-slot="conversations"] [data-conversation-open]')];
    expect(rows.map(row => row.querySelector('span')!.textContent)).toEqual([t('conversations.main'), t('conversations.quick')]);
    expect(panel.el.querySelector('[data-slot="conversations"] input')).toBeNull();
    rows[1]!.click();
    expect(open).toHaveBeenCalledWith(0, 2);
    current = 4; panel.showMember(); await flush();
    expect(panel.el.querySelector('[data-slot="conversations"]')).toBeNull();
  });

  test("the head is the gear on the left, apart from the × on the right, and share and hide are not here", async () => {
    const panel = mount(); await flush();
    expect([...panel.el.querySelectorAll<HTMLElement>('.mb-det-head button')].map(button => button.dataset.det)).toEqual(["gear", "close"]);
    expect(panel.el.querySelector('.mb-det-head > :first-child')?.getAttribute('data-det')).toBe('gear');
    expect(panel.el.querySelector<HTMLElement>('[data-det="gear"]')!.getAttribute('aria-label')).toBe(t('computer.settings'));
    for (const gone of ['share', 'back', 'edit', 'hide', 'draft']) expect(panel.el.querySelector(`[data-det="${gone}"]`), gone).toBeNull();
    // Nothing of the member's settings stands in the panel: no fields, no rows that open settings pages.
    expect(panel.el.querySelector('input, textarea, [data-tab="settings"], [data-tab="memory"], [data-tab="skills"], [data-tab="commands"], [data-tab="voice"], [data-det="group"]')).toBeNull();
    expect(panel.el.dataset.detailsTab).toBe('details');
  });

  test("the gear asks the shell for the settings page, for a member and for Raphael; the × closes the panel", async () => {
    for (const id of [3, 0]) {
      current = id; document.body.innerHTML = "";
      const panel = mount(); await flush();
      panel.el.querySelector<HTMLButtonElement>('[data-det="gear"]')!.click();
      expect(host.openSettings).toHaveBeenCalledTimes(1);
      panel.el.querySelector<HTMLElement>('[data-det="close"]')!.click();
      expect(host.close).toHaveBeenCalled();
    }
  });

  test("the gear's label follows a locale change", async () => {
    const panel = mount(); await flush(); setLocale('en'); panel.draw();
    expect(panel.el.querySelector('[data-det="gear"]')?.getAttribute('aria-label')).toBe(t('computer.settings'));
    expect(panel.el.querySelector('[data-det="close"]')?.getAttribute('aria-label')).toBe(t('members.close'));
  });

  test("its routine row opens the editor where a saved switch pauses it", async () => {
    const panel = mount();
    await flush();
    expect(api.routinesList).toHaveBeenCalledWith(3);
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
    panel.el.querySelector<HTMLElement>('[data-det="routine-add"]')!.click();
    document.querySelector<HTMLInputElement>("#au-title")!.value = "每週回顧";
    document.querySelector<HTMLTextAreaElement>("#au-prompt")!.value = "整理這週";
    document.querySelector<HTMLElement>('[data-dlg="kind-menu"]')!.click(); document.querySelector<HTMLElement>('#app-popover [data-value="every"]')!.click();
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
    panel.el.querySelector<HTMLElement>('[data-det="routine-add"]')!.click();
    document.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
    await flush();
    expect(api.routinesCreate).not.toHaveBeenCalled();
  });

  test("the shared HH:MM field rejects invalid times and saves a valid time", async () => {
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLElement>('[data-det="routine-add"]')!.click();
    const form = document.querySelector<HTMLElement>(".au-routine-dialog")!;
    const time = form.querySelector<HTMLInputElement>("#au-time")!;
    expect(time.type).toBe("text");
    expect(time.placeholder).toBe("00:00");
    form.querySelector<HTMLInputElement>("#au-title")!.value = "Review";
    form.querySelector<HTMLTextAreaElement>("#au-prompt")!.value = "Summarize progress";
    form.querySelector<HTMLElement>('[data-dlg="kind-menu"]')!.click(); document.querySelector<HTMLElement>('#app-popover [data-value="daily"]')!.click();
    form.querySelector<HTMLInputElement>("#au-time")!.value = "25:61";
    form.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
    await flush();
    expect(api.routinesCreate).not.toHaveBeenCalled();
    form.querySelector<HTMLInputElement>("#au-time")!.value = "08:45";
    form.querySelector<HTMLElement>('[data-dlg="save"]')!.click();
    await flush();
    expect(api.routinesCreate).toHaveBeenCalledWith({ member_id: 3, title: "Review", prompt: "Summarize progress", schedule: expect.objectContaining({ kind: "daily", time: "08:45" }) });
  });

  test("double-clicking routine save while create is in flight sends only one request", async () => {
    let finish!: () => void;
    api.routinesCreate.mockImplementation(() => new Promise<Record<string, never>>((r) => (finish = () => r({}))));
    const panel = mount();
    await flush();
    panel.el.querySelector<HTMLElement>('[data-det="routine-add"]')!.click();
    document.querySelector<HTMLInputElement>("#au-title")!.value = "早報";
    document.querySelector<HTMLTextAreaElement>("#au-prompt")!.value = "摘要";
    document.querySelector<HTMLElement>('[data-dlg="kind-menu"]')!.click(); document.querySelector<HTMLElement>('#app-popover [data-value="daily"]')!.click();
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
    expect(panel.el.querySelector("input, textarea")).toBeNull();
    expect(panel.el.querySelector(".mb-panel-identity > b")!.textContent).toBe("拉斐爾");
    // The first blue slime: his emblem shows only in voice.
    expect(panel.el.querySelector(".mb-face-edit .av.mb-av-slime svg.slime")).not.toBeNull();
    expect(panel.el.querySelector('[data-det="group"]')).toBeNull();
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
});

test("a member's face is the button of its picture picker, with a pencil under the pointer", async () => {
  const panel = mount(); await flush();
  const face = panel.el.querySelector<HTMLButtonElement>(".mb-panel-identity .mb-face-edit")!;
  expect(face.querySelector('.mb-face-pencil[aria-hidden="true"] svg.i')).not.toBeNull();
  expect(face.dataset.det).toBe("avatar");
  expect(face.getAttribute("aria-haspopup")).toBe("menu");
  expect(panel.el.querySelector(".mb-panel-identity > b")!.textContent).toBe("日文老師");
  expect(panel.el.querySelector(".mb-panel-identity > small")!.textContent).toBe("N2 嚴格版");
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

test("a remote deletion keeps the routine draft editable and refresh failure keeps rows", async () => {
  const panel = mount();
  await flush();
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

test("routines show their own switches, on for the active one only, and no ⋯ menu", async () => {
  api.routinesList.mockResolvedValue({ routines: [ROUTINE, { ...ROUTINE, id: 10, enabled: false }] });
  const panel = mount(); await flush();
  expect([...panel.el.querySelectorAll('[data-det="routine-toggle"]')].map(toggle => toggle.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  expect(panel.el.querySelector('[data-det="routine-menu"]')).toBeNull();
});

test("訊息平台: a bot not set up is one row whose 設定 asks the member in its conversation; a connected one is its card; Raphael's too", async () => {
  const off = { connected: false, enabled: false, running: false, error: null, bot: null, allowed: [], pending: [], member_id: current, kind: "telegram", paired: false };
  api.memberMessagingStatus.mockImplementation(async (_id: number, platform?: string) => platform === "slack" ? { ...off, connected: true, enabled: true, running: true, bot: { username: "shion_slack" } } : off);
  const panel = mount(); await flush();
  expect(api.memberMessagingStatus).toHaveBeenCalledWith(current, undefined);
  expect(api.memberMessagingStatus).toHaveBeenCalledWith(current, "slack");
  const suggest = panel.el.querySelector<HTMLElement>(".mb-panel-suggest")!;
  expect(suggest.querySelector(".mb-dh")!.textContent).toBe("訊息平台");
  // The bots are all that stands under the routines: the member's settings are a page of their own.
  expect(suggest.querySelectorAll(".mb-dh")).toHaveLength(1);
  expect(suggest.querySelector("input")).toBeNull();
  expect(suggest.textContent).toContain("@shion_slack");
  expect([...suggest.querySelectorAll<HTMLElement>('[data-det="setup"]')].map((button) => button.dataset.intent)).toEqual(["setup-telegram", "setup-discord"]);
  suggest.querySelector<HTMLButtonElement>('[data-intent="setup-telegram"]')!.click(); await flush();
  expect(api.agentAskText).toHaveBeenCalledWith("幫我設定 Telegram", [], current, { intent: "setup-telegram" });
  // Raphael's own bots are in his panel now, Settings no longer holds them.
  current = 0; panel.showMember(); await flush();
  expect(panel.el.querySelectorAll('.mb-panel-suggest [data-det="setup"]').length).toBeGreaterThan(0);
});

test("a routine's switch turns it on or off from the row without opening the editor", async () => {
  api.routinesList.mockResolvedValue({ routines: [{ ...ROUTINE, enabled: true }] });
  const panel = mount(); await flush();
  const toggle = panel.el.querySelector<HTMLButtonElement>('[data-det="routine-toggle"]')!;
  toggle.click();
  expect(api.routinesUpdate).toHaveBeenCalledWith(ROUTINE.id, { enabled: false });
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(document.querySelector(".au-routine-dialog")).toBeNull();
});

describe("primary changes do not add face badges", () => {
  const withPrimary = (primary_id: number): MembersList => ({ ...LIST, team_context: { primary_id } as MembersList["team_context"] });
  test.each([0, 3])("member %s keeps its picture without a primary star", async id => {
    current = id;
    const panel = mount(); await flush();
    for (const primary of [id, 4, 0]) {
      host.list = () => withPrimary(primary); panel.draw();
      expect(panel.el.querySelector('.mb-star')).toBeNull();
      expect(panel.el.querySelector('.mb-panel-identity .mb-face-edit .av')).not.toBeNull();
    }
    if (id === 0) expect(panel.el.querySelector('.mb-panel-identity .mb-av-slime svg.slime')).not.toBeNull();
  });
});

test("a routine row opens the wide editor with its instructions and no history", async () => {
  const panel = mount();
  await flush();
  panel.el.querySelector<HTMLElement>('[data-det="routine-open"]')!.click();
  await flush();
  expect(document.querySelector<HTMLTextAreaElement>(".au-routine-grid #au-prompt")!.value).toBe(ROUTINE.prompt);
  expect(document.querySelector(".au-run-history, .au-run-section")).toBeNull();
  document.querySelector<HTMLElement>('[data-dlg="cancel"]')!.click();
});
