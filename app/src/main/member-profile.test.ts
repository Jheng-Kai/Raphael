// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "./api";
import { setLocale, t } from "./i18n";
import { openEditMemberDialog, type MemberProfileHost } from "./member-profile";
import { mountMemberResources } from "./member-profile-resources";
import { memberPreset, randomMemberName } from "./member-profile-presets";
import type { Member } from "./types";
import { closeMenu } from "./ui";

vi.mock("./api", () => ({ core: vi.fn(), membersUpdate: vi.fn(), membersSkillsList: vi.fn(), membersSkillsImport: vi.fn(), membersSkillsUpdate: vi.fn(), membersSkillsDelete: vi.fn(), membersCommandsList: vi.fn(), membersCommandsSave: vi.fn(), membersCommandsDelete: vi.fn(), membersVoices: vi.fn(), routinesList: vi.fn(), routinesCreate: vi.fn(), routinesUpdate: vi.fn(), routinesDelete: vi.fn() }));
const member: Member = { id: 7, name: "Mia", role: "Research", instructions: "Keep sources", personality: "Careful", avatar: "", group_id: null, model: "", tools: null, position: 0, created: 0, unread: false, waiting: false, preview: "", last_at: null };
const flush = async (): Promise<void> => { for (let i = 0; i < 25; i++) await Promise.resolve(); };

test('open resource consumers share event reads and retain the trailing skill change', async () => {
  vi.useFakeTimers();
  const scope = {}, roots = [document.createElement('div'),document.createElement('div')];
  roots.forEach(root=>document.body.append(root));
  const editors=roots.map(root=>mountMemberResources(root,{memberId:7,tab:'skills',scope}));
  try {
    await flush(); vi.mocked(api.membersSkillsList).mockClear(); vi.mocked(api.membersCommandsList).mockClear();
    const refresh=(editor:typeof editors[number])=>editor.refresh(true);
    await Promise.all(editors.map(refresh));
    expect(api.membersSkillsList).toHaveBeenCalledTimes(1);
    expect(api.membersCommandsList).toHaveBeenCalledTimes(1);
    const pending=editors.map(refresh);
    vi.mocked(api.membersSkillsList).mockResolvedValue({skills:[{id:1,name:'Fresh sample skill',description:'Changed',enabled:true,source:'owner'}] } as Awaited<ReturnType<typeof api.membersSkillsList>>);
    await vi.advanceTimersByTimeAsync(300); await Promise.all(pending);
    roots.forEach(root=>expect(root.textContent).toContain('Fresh sample skill'));
    expect(api.membersSkillsList).toHaveBeenCalledTimes(2);
  } finally {editors.forEach(editor=>editor.destroy());vi.useRealTimers();}
});
const host = (over: Partial<MemberProfileHost> = {}): MemberProfileHost => ({ groups: [], taken: [], ...over });
const click = (root: ParentNode, selector: string): void => root.querySelector<HTMLElement>(selector)!.click();
const fill = (root: ParentNode, selector: string, text: string): void => { const field = root.querySelector<HTMLInputElement>(selector)!; field.value = text; field.dispatchEvent(new Event("input", { bubbles: true })); };

beforeEach(() => {
  document.body.innerHTML = "";
  vi.resetAllMocks();
  setLocale("zh-TW");
  vi.mocked(api.membersSkillsList).mockResolvedValue({ skills: [] });
  vi.mocked(api.membersCommandsList).mockResolvedValue({ commands: [] });
  vi.mocked(api.membersVoices).mockResolvedValue({ voices: [{ id: "fish:1", name: "Voice 1" }], configured: true });
  vi.mocked(api.core).mockResolvedValue({ memories: [] });
  vi.mocked(api.routinesList).mockResolvedValue({ routines: [] });
});

test("Raphael saves command templates and toggles shared skills through the ordinary resource editor", async () => {
  const root = document.createElement("div");
  document.body.append(root);
  vi.mocked(api.membersCommandsSave).mockResolvedValue({ command: { id: 1, name: "review", description: "", template: "Review {input}" } });
  const commands = mountMemberResources(root, { memberId: 0, tab: "commands", standalone: true });
  await flush();
  fill(root, "#mp-command-name", "review");
  fill(root, "#mp-command-template", "Review {input}");
  click(root, '[data-res="command-save"]'); await flush();
  expect(api.membersCommandsSave).toHaveBeenCalledWith(0, { name: "review", description: "", template: "Review {input}" });
  commands.destroy();
  vi.mocked(api.membersSkillsList).mockResolvedValue({ skills: [{ id: 9, name: "writer", description: "Write", source: "local:C:/Synthetic/.claude/skills/writer", enabled: true, shared: true }] });
  const skills = mountMemberResources(root, { memberId: 0, tab: "skills", standalone: true });
  await flush();
  expect(root.querySelector('[data-res="skill-menu"]')).toBeNull();
  expect(root.textContent).toContain(t("skills.shared"));
  expect(root.textContent).toContain(`${t("skills.shared")} · ~/.claude/skills/writer`);
  expect(root.textContent).not.toContain("local:");
  click(root, '[data-res="skill-toggle"]'); await flush();
  expect(api.membersSkillsUpdate).toHaveBeenCalledWith(0, 9, false);
  skills.destroy();
});

test("inherited plugin components show their set name and version with the ordinary grant switch", async () => {
  const root = document.createElement("div"); document.body.append(root);
  vi.mocked(api.membersSkillsList).mockResolvedValue({ skills: [{ id: 12, name: "review", description: "Review", source: "plugin:desk", plugin: "desk", plugin_version: "2.0.0", set_id: 1, set_kind: "command", enabled: true, shared: true }] });
  const resources = mountMemberResources(root, { memberId: 0, tab: "skills", standalone: true }); await flush();
  expect(root.textContent).toContain(`${t("skills.shared")} · desk · 2.0.0`);
  expect(root.textContent).not.toContain("plugin:");
  expect(root.querySelector('[data-res="skill-menu"]')).toBeNull();
  click(root, '[data-res="skill-toggle"]'); await flush();
  expect(api.membersSkillsUpdate).toHaveBeenCalledWith(0, 12, false);
  resources.destroy();
});

test("tabs retain fields and keyboard navigation selects a visible panel", () => {
  const dialog = openEditMemberDialog(host(), member);
  fill(dialog.el, "#mb-new-name", "Ada");
  const tab = dialog.el.querySelector<HTMLElement>('#mp-tab-identity')!;
  tab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  expect(dialog.el.querySelector('#mp-page-soul')!.hasAttribute("hidden")).toBe(false);
  fill(dialog.el, "#mb-new-instr", "12345");
  expect(dialog.el.querySelector(".mp-counter")!.textContent).toBe("5 / 2000");
  click(dialog.el, '#mp-tab-identity');
  expect(dialog.el.querySelector<HTMLInputElement>("#mb-new-name")!.value).toBe("Ada");
  dialog.close();
});

test("a member is a slime and every pane groups content in cards", async () => {
  const dialog = openEditMemberDialog(host(), member);
  expect(dialog.el.querySelector('.mb-new-av .mb-av-slime')).not.toBeNull();
  fill(dialog.el, '#mb-new-name', 'Ada');
  expect(dialog.el.querySelector('.mb-new-av .mb-av-slime')).not.toBeNull();
  for (const tab of ['identity', 'soul', 'skills', 'memory', 'routines', 'permissions', 'voice']) {
    click(dialog.el, `#mp-tab-${tab}`); await flush();
    expect(dialog.el.querySelector(`#mp-page-${tab} .mp-card`)).not.toBeNull();
  }
  expect(dialog.el.querySelector('#mp-memory')!.closest('.mp-card')).not.toBeNull();
  expect(dialog.el.querySelector('[data-dlg="routine-add"]')!.closest('.mp-card')).not.toBeNull();
  expect(dialog.el.querySelector('[data-dlg="ask"]')!.closest('.mp-resource')!.querySelector('p')!.textContent).toBeTruthy();
  dialog.close();
});

test("記憶 is the member's whole document, and the dialog's one 儲存 writes it from the copy it opened", async () => {
  const update = vi.fn().mockResolvedValue(true);
  vi.mocked(api.core).mockImplementation(async (method: string, params?: unknown) => {
    if (method === "memory.get") return { text: "第一段\n\n第二段\n", revision: "r1", chars: 8, entries: 2, limit: 2200, summary: null };
    if (method === "memory.update") return { text: (params as { text: string }).text, revision: "r2", chars: 3, entries: 1, limit: 2200, summary: null };
    return {};
  });
  const dialog = openEditMemberDialog(host({ update }), member, "memory"); await flush();
  const box = dialog.el.querySelector<HTMLTextAreaElement>("#mp-memory")!;
  expect(box.value).toBe("第一段\n\n第二段");
  expect(dialog.el.querySelectorAll('[data-dlg="save"]')).toHaveLength(1);
  fill(dialog.el, "#mp-memory", "第一段");
  click(dialog.el, '[data-dlg="save"]'); await flush();
  expect(api.core).toHaveBeenCalledWith("memory.update", { member_id: 7, space: "own", text: "第一段", revision: "r1" });
  expect(update).toHaveBeenCalled();
});

test("the dialog writes no memory it did not change, and stays open on one that is refused", async () => {
  const update = vi.fn().mockResolvedValue(true);
  const refuse = { refuse: false };
  vi.mocked(api.core).mockImplementation(async (method: string) => {
    if (method === "memory.get") return { text: "第一段\n", revision: "r1", chars: 3, entries: 1, limit: 2200, summary: null };
    if (method === "memory.update" && refuse.refuse) throw "Invalid params: changed: The memory changed while it was being edited.";
    return {};
  });
  const first = openEditMemberDialog(host({ update }), member, "memory"); await flush();
  click(first.el, '[data-dlg="save"]'); await flush();
  expect(api.core).not.toHaveBeenCalledWith("memory.update", expect.anything());
  expect(update).toHaveBeenCalledTimes(1);

  refuse.refuse = true;
  const second = openEditMemberDialog(host({ update }), member, "memory"); await flush();
  fill(second.el, "#mp-memory", "我打的字");
  click(second.el, '[data-dlg="save"]'); await flush();
  expect(update).toHaveBeenCalledTimes(1);
  expect(second.el.querySelector<HTMLTextAreaElement>("#mp-memory")!.value).toBe("我打的字");
  second.close();
});

test("profile routines use the shared editor with every recurrence and HH:MM validation", async () => {
  const dialog = openEditMemberDialog(host(), member);
  click(dialog.el, '#mp-tab-routines'); await flush();
  click(dialog.el, '[data-dlg="routine-add"]');
  const form = document.querySelector<HTMLElement>('.au-routine-dialog')!;
  // 重複 is one dropdown of its six choices, never a row of chips that runs out of room.
  click(form, '[data-dlg="kind-menu"]');
  expect(document.querySelectorAll('#app-popover [data-value]')).toHaveLength(6);
  closeMenu();
  expect(form.querySelector<HTMLInputElement>('#au-time')!.type).toBe('text');
  fill(form, '#au-title', 'Review'); fill(form, '#au-prompt', 'Review updates');
  fill(form, '#au-time', '25:60'); click(form, '[data-dlg="save"]'); await flush();
  expect(form.isConnected).toBe(true);
  expect(api.routinesCreate).not.toHaveBeenCalled();
  click(form, '[data-dlg="kind-menu"]'); click(document.body, '#app-popover [data-value="weekly"]');
  expect(form.querySelectorAll('[data-dlg="day"]')).toHaveLength(7);
  click(form, '[data-dlg="cancel"]'); dialog.close();
});

test("localized role presets fill all identity and instruction fields", async () => {
  const dialog = openEditMemberDialog(host(), member);
  click(dialog.el, '[data-dlg="preset"]');
  click(document, '#app-popover [data-value="research"]');
  expect(dialog.el.querySelector<HTMLInputElement>("#mb-new-role")!.value).toBe("研究夥伴");
  expect(dialog.el.querySelector<HTMLInputElement>("#mp-blurb")!.value).toContain("資料");
  expect(dialog.el.querySelector<HTMLTextAreaElement>("#mb-new-instr")!.value).toContain("第一手");
  dialog.close();
  setLocale("ja"); expect(memberPreset("research").role).toBe("リサーチャー");
  expect(randomMemberName("female", [])).toMatch(/[\u3040-\u9fff]/);
  setLocale("en"); expect(memberPreset("coding").role).toBe("Coding partner");
  expect(randomMemberName("male", [])).toMatch(/^[A-Za-z]+$/);
});

test("a preset in edit mode suggests a command without writing until its explicit save", async () => {
  const dialog = openEditMemberDialog(host(), member);
  click(dialog.el, '[data-dlg="preset"]'); click(document, '#app-popover [data-value="coding"]');
  click(dialog.el, '#mp-tab-skills'); await flush();
  expect(dialog.el.querySelector<HTMLInputElement>('#mp-command-name')!.value).toBe('coding');
  expect(dialog.el.querySelector<HTMLTextAreaElement>('#mp-command-template')!.value).toContain('{input}');
  expect(api.membersCommandsSave).not.toHaveBeenCalled();
  dialog.close();
});

test("editing then closing does not save main fields or voice switches", async () => {
  const update = vi.fn(async () => true);
  const dialog = openEditMemberDialog(host({ update }), member);
  fill(dialog.el, '#mb-new-name', 'Changed');
  click(dialog.el, '#mp-tab-voice'); await flush();
  click(dialog.el, '[data-res="notify"]'); await flush();
  click(dialog.el, '[data-dlg="cancel"]');
  expect(update).not.toHaveBeenCalled();
  expect(api.membersUpdate).not.toHaveBeenCalled();
});

test("editing saves reply style, blurb and permission through the footer", async () => {
  const update = vi.fn(async () => true);
  const dialog = openEditMemberDialog(host({ update, taken: ['Mia'] }), member, "soul");
  fill(dialog.el, '#mp-blurb', 'A useful teammate');
  click(dialog.el, '[data-dlg="reply"]'); click(document, '#app-popover [data-value="conversational"]');
  click(dialog.el, '#mp-tab-permissions'); click(dialog.el, '[data-dlg="ask"]');
  click(dialog.el, '[data-dlg="save"]'); await flush();
  expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ reply_style: 'conversational', blurb: 'A useful teammate', ask_before_members: true }));
});

test("a member writes mail as a draft for the owner to send unless the owner turns that off, and it is saved with the rest", async () => {
  const update = vi.fn(async () => true);
  const dialog = openEditMemberDialog(host({ update, taken: ['Mia'] }), member, "soul");
  click(dialog.el, '#mp-tab-permissions');
  const draft = dialog.el.querySelector<HTMLElement>('[data-dlg="draft"]')!;
  expect(draft.getAttribute("role")).toBe("switch");
  expect(draft.getAttribute("aria-checked")).toBe("true");
  click(dialog.el, '[data-dlg="save"]'); await flush();
  expect(update).toHaveBeenLastCalledWith(7, expect.objectContaining({ draft_first: true }));
  click(dialog.el, '[data-dlg="draft"]');
  expect(dialog.el.querySelector('[data-dlg="draft"]')!.getAttribute("aria-checked")).toBe("false");
  click(dialog.el, '[data-dlg="save"]'); await flush();
  expect(update).toHaveBeenLastCalledWith(7, expect.objectContaining({ draft_first: false }));
  // A member that was set not to starts with the switch off.
  const off = openEditMemberDialog(host({ update, taken: ['Mia'] }), { ...member, draft_first: false }, "soul");
  click(off.el, '#mp-tab-permissions');
  expect(off.el.querySelector('[data-dlg="draft"]')!.getAttribute("aria-checked")).toBe("false");
});

test("resource editor updates existing skills and edits command fields without resetting them", async () => {
  vi.mocked(api.membersSkillsList).mockResolvedValue({ skills: [{ id: 4, name: 'Research', description: 'Sources', enabled: true, source: 'owner/repo' }] });
  vi.mocked(api.membersCommandsList).mockResolvedValue({ commands: [{ id: 6, name: 'review', description: 'Review code', template: 'Review {input}' }] });
  const container = document.createElement('div'); document.body.append(container);
  const editor = mountMemberResources(container, { memberId: 7, tab: 'skills' }); await flush();
  click(container, '[data-res="skill-toggle"]'); await flush();
  expect(api.membersSkillsUpdate).toHaveBeenCalledWith(7, 4, false);
  click(container, '[data-res="command-menu"]');
  click(document, '#app-popover [data-pick="command-edit"]');
  expect(container.querySelector<HTMLInputElement>('#mp-command-name')!.value).toBe('review');
  expect(container.querySelector<HTMLTextAreaElement>('#mp-command-template')!.value).toBe('Review {input}');
  fill(container, '#mp-command-template', 'Changed {input}');
  click(container, '[data-res="command-save"]'); await flush();
  expect(api.membersCommandsSave).toHaveBeenCalledWith(7, { id: 6, name: 'review', description: 'Review code', template: 'Changed {input}' });
  editor.destroy();
});

test("resource refresh ignores late responses after destroy", async () => {
  let finish!: (answer: { commands: [] }) => void;
  vi.mocked(api.membersCommandsList).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const container = document.createElement('div');
  const editor = mountMemberResources(container, { memberId: 7, tab: 'commands' });
  editor.destroy(); const before = container.innerHTML;
  finish({ commands: [] }); await flush();
  expect(container.innerHTML).toBe(before);
});

test("the details panel standalone skills page omits the separate command editor", async () => {
  const container = document.createElement('div');
  const editor = mountMemberResources(container, { memberId: 7, tab: 'skills', standalone: true });
  await flush();
  expect(container.querySelector('#mp-skill-source')).not.toBeNull();
  expect(container.querySelector('#mp-command-template')).toBeNull();
  editor.destroy();
});

test("a successful command mutation uses its result without a second fallible list request", async () => {
  const container = document.createElement('div'); document.body.append(container);
  const editor = mountMemberResources(container, { memberId: 7, tab: 'commands' }); await flush();
  vi.mocked(api.membersCommandsSave).mockResolvedValue({ command: { id: 10, name: 'review', description: '', template: 'Review {input}' } });
  vi.mocked(api.membersCommandsList).mockRejectedValue(new Error('offline'));
  fill(container, '#mp-command-name', '/Review'); fill(container, '#mp-command-template', 'Review {input}');
  click(container, '[data-res="command-save"]'); await flush();
  expect(container.textContent).toContain('/review');
  expect(container.querySelector<HTMLInputElement>('#mp-command-name')!.value).toBe('');
  expect(api.membersCommandsList).toHaveBeenCalledTimes(1);
  editor.destroy();
});

test("a late command save cannot erase the next subpage after the editor is destroyed", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api.membersCommandsSave).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const container = document.createElement('div'); document.body.append(container);
  const editor = mountMemberResources(container, { memberId: 7, tab: 'commands' }); await flush();
  fill(container, '#mp-command-name', 'review'); fill(container, '#mp-command-template', 'Review {input}');
  click(container, '[data-res="command-save"]');
  editor.destroy(); container.innerHTML = '<p>Next member page</p>';
  finish({ command: { id: 10, name: 'review', description: '', template: 'Review {input}' } }); await flush();
  expect(container.innerHTML).toBe('<p>Next member page</p>');
});

test("editing a saved routine from the profile preserves schedule end conditions", async () => {
  const routine = { id: 4, member_id: 7, title: "Review", prompt: "Review updates", enabled: true, last_run: null, next_run: null, schedule: { kind: "weekly", days: [1, 3], time: "08:45", start_date: "2026-10-26", max_runs: 12 } } as const;
  vi.mocked(api.routinesList).mockResolvedValue({ routines: [{ ...routine, schedule: { ...routine.schedule, days: [1, 3] } }] });
  vi.mocked(api.routinesUpdate).mockResolvedValue({ routine: { ...routine, schedule: { ...routine.schedule, days: [1, 3] } } });
  const dialog = openEditMemberDialog(host(), member, "routines"); await flush();
  click(dialog.el, '[data-dlg="routine-edit"]');
  const form = document.querySelector<HTMLElement>(".au-routine-dialog")!;
  expect(form.querySelector<HTMLInputElement>("#au-count")!.value).toBe("12");
  fill(form, "#au-title", "Updated review"); click(form, '[data-dlg="save"]'); await flush();
  expect(api.routinesUpdate).toHaveBeenCalledWith(4, { title: "Updated review", prompt: "Review updates", schedule: {...routine.schedule,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone} });
  expect(form.isConnected).toBe(false); dialog.close();
});


test.each([["zh-TW", "2026/10/29"], ["ja", "2026/10/29"], ["en", "Oct 29, 2026"]] as const)("learned skills use the %s UI date and reading the editor never writes or notifies", async (locale, date) => {
  setLocale(locale);
  const skill = { id: 12, name: "research-summary", description: "Check sources", source: "learned", provenance: "learned" as const, learned_at: "2026-10-29T12:00:00", enabled: true };
  vi.mocked(api.membersSkillsList).mockResolvedValue({ skills: [skill], undo: "revision-1" });
  vi.mocked(api.core).mockResolvedValue({ skill: { ...skill, revision: "document-hash" }, text: "Instructions" });
  const root = document.createElement("div"); document.body.append(root);
  const changed = vi.fn();
  const editor = mountMemberResources(root, { memberId: 7, tab: "skills", standalone: true, changed });
  await flush();
  expect(root.textContent).toContain(date);
  expect([...root.querySelectorAll('.mp-resource p')].map(line => line.textContent)).not.toContain("learned");
  expect(root.querySelectorAll('[data-skill-provenance]')).toHaveLength(1);
  expect(root.querySelector('[data-skill-provenance]')!.textContent).toBe(t("skills.learnedAt", { p0: date }));
  click(root, '[data-res="skill-menu"]');
  document.querySelector<HTMLButtonElement>('#app-popover [data-pick="skill-edit"]')!.click();
  await flush();
  expect(root.querySelector<HTMLTextAreaElement>("#mp-skill-text")!.value).toBe("Instructions");
  expect(api.core).toHaveBeenCalledExactlyOnceWith("members.skills.read", { member_id: 7, id: 12 });
  expect(changed).not.toHaveBeenCalled();
  fill(root, "#mp-skill-text", "Unsaved instructions");
  setLocale(locale === "en" ? "ja" : "en");
  expect(root.textContent).toContain(locale === "en" ? "2026/10/29" : "Oct 29, 2026");
  expect(root.querySelector<HTMLTextAreaElement>("#mp-skill-text")!.value).toBe("Unsaved instructions");
  fill(root, "#mp-skill-text", "Updated instructions");
  click(root, '[data-res="skill-save"]'); await flush();
  expect(api.core).toHaveBeenCalledWith("members.skills.update", { member_id: 7, id: 12, text: "Updated instructions", expected_hash: "document-hash" });
  click(root, '[data-res="skill-undo"]'); await flush();
  expect(api.core).toHaveBeenCalledWith("members.skills.update", { member_id: 7, undo: "revision-1" });
  editor.destroy();
});


test("an event routine edits a readable filter without losing its read tool arguments", async () => {
  const when = { app: "gmail", event: { tool: "mcp:gmail/messages", arguments: { limit: 50 }, items: "messages", id: "id" }, filter: { field: "sender", equals: "client@example.com" } };
  const routine = { id: 9, member_id: 7, title: "Client mail", prompt: "Prepare a draft", enabled: true, last_run: null, next_run: null, schedule: null, when, last_checked: 1792792800000 };
  vi.mocked(api.routinesList).mockResolvedValue({ routines: [routine] });
  vi.mocked(api.routinesUpdate).mockResolvedValue({ routine });
  const dialog = openEditMemberDialog(host(), member, "routines"); await flush();
  expect(dialog.el.textContent).toContain("client@example.com");
  click(dialog.el, '[data-dlg="routine-edit"]');
  const form = document.querySelector<HTMLElement>(".au-routine-dialog")!;
  expect(form.querySelector("#au-time")).toBeNull();
  expect(form.textContent).not.toContain('"arguments"');
  fill(form, "#au-filter", "owner@example.com"); click(form, '[data-dlg="save"]'); await flush();
  expect(api.routinesUpdate).toHaveBeenCalledWith(9, { title: routine.title, prompt: routine.prompt, when: { ...when, filter: { ...when.filter, equals: "owner@example.com" } } });
  dialog.close();
});
