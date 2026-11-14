// @vitest-environment happy-dom
// The skill and command editor the details panel and the template review share (member-profile-resources.ts).
import { beforeEach, expect, test, vi } from "vitest";
import * as api from "./api";
import { setLocale, t } from "./i18n";
import { mountMemberResources } from "./member-profile-resources";

vi.mock("./api", () => ({ core: vi.fn(), membersUpdate: vi.fn(), membersSkillsList: vi.fn(), membersSkillsImport: vi.fn(), membersSkillsUpdate: vi.fn(), membersSkillsDelete: vi.fn(), membersCommandsList: vi.fn(), membersCommandsSave: vi.fn(), membersCommandsDelete: vi.fn(), routinesList: vi.fn(), routinesCreate: vi.fn(), routinesUpdate: vi.fn(), routinesDelete: vi.fn() }));
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
const click = (root: ParentNode, selector: string): void => root.querySelector<HTMLElement>(selector)!.click();
const fill = (root: ParentNode, selector: string, text: string): void => { const field = root.querySelector<HTMLInputElement>(selector)!; field.value = text; field.dispatchEvent(new Event("input", { bubbles: true })); };

beforeEach(() => {
  document.body.innerHTML = "";
  vi.resetAllMocks();
  setLocale("zh-TW");
  vi.mocked(api.membersSkillsList).mockResolvedValue({ skills: [] });
  vi.mocked(api.membersCommandsList).mockResolvedValue({ commands: [] });
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



test.each([["zh-TW", "2026/10/29"], ["ja", "2026/10/29"], ["en", "Oct 29, 2026"]] as const)("learned skills use the %s UI date and reading the editor never writes or notifies", async (locale, date) => {
  setLocale(locale);
  const skill = { id: 12, name: "research-summary", description: "Check sources", source: "learned", provenance: "learned" as const, learned_at: "2026-10-29T12:00:00", enabled: true };
  vi.mocked(api.membersSkillsList).mockResolvedValue({ skills: [skill] });
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
  editor.destroy();
});


