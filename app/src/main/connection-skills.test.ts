import { beforeEach, expect, test, vi } from "vitest";
import { loadSkillItems, skillDialogHTML, skillImportsHTML, skillListItems, skillPage, skillRowHTML, skillsSectionHTML } from "./connection-skills";
import { skillSourceLabel } from "./skill-source";
import { setLocale } from "./i18n";

const api = vi.hoisted(() => ({ membersList: vi.fn(), membersSkillsList: vi.fn() }));
vi.mock("./api", () => api);
beforeEach(() => { vi.resetAllMocks(); setLocale("en"); });

test("one shared row retains Raphael and individual member grants in the detail dialog", async () => {
  api.membersList.mockResolvedValue({ members: [{ id: 0, name: "Raphael" }, { id: 1, name: "Ada" }] });
  api.membersSkillsList.mockImplementation(async (id: number) => ({ skills: [{ id: 7, name: "write", description: "Write notes", source: "local:C:/synthetic/write", enabled: true, shared: id >= 0 }] }));
  const { items } = await loadSkillItems();
  expect(items.map(item => item.member.id)).toEqual([0, 1, -1]);
  const listed = skillListItems(items);
  expect(listed).toHaveLength(1);
  expect(listed[0]!.grants!.map(each => each.member.id)).toEqual([0, 1]);
  const row = skillRowHTML(listed[0]!);
  expect(row).toContain("C:/synthetic/write");
  expect(row).not.toContain("local:");
  expect(row).toContain("Shared · Given to 2 members");
  expect(row).toContain('class="cs-library-icon"');
  expect(row).not.toContain('data-conn="skill-enable"');
  const shared = skillDialogHTML(items[0]!, { ...skillPage(0, 7), state: "ready", saved: "a", draft: "b" }, "", "");
  expect(shared).toContain('data-conn="skill-enable"');
  expect(shared).not.toContain('data-conn="skill-delete"');
  expect(shared).toMatch(/data-k="cs-skill-save" disabled/);
  const library = skillDialogHTML({ ...items[2]!, skill: { ...items[2]!.skill, source_changed: true } }, skillPage(-1, 7), "", "");
  expect(library).toContain('data-conn="skill-reimport"');
});

test("local discovery shows imports, empty and failed states and escapes source text", () => {
  expect(skillsSectionHTML([])).toContain('data-conn="skill-discover"');
  expect(skillImportsHTML([])).toContain("No installed skills found");
  expect(skillImportsHTML("loading")).toContain('role="status"');
  expect(skillImportsHTML("failed")).toContain('role="alert"');
  const html = skillImportsHTML([{ source: "local:C:/<script>", name: "<writer>", description: "Write" }]);
  expect(html).toContain("&lt;writer&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain('data-conn="skill-import-local"');
});

test("one skills heading owns its import action and source groups keep their original import indices", () => {
  setLocale("zh-TW");
  const section = skillsSectionHTML([]);
  expect(section.match(/<h2>/g)).toHaveLength(1);
  expect(section).toContain('<div class="data-heading"><h2>技能</h2><button');
  expect(section).toContain("匯入");
  expect(section).not.toContain("技能庫");
  const dialog = skillImportsHTML([
    { source: "local:C:/home/.codex/skills/first", name: "first", description: "Codex source" },
    { source: "local:C:/home/.claude/plugins/cache/market/docs/1.0/skills/second", name: "second", description: "Plugin source", plugin: "docs" },
    { source: "local:C:/home/.claude/skills/third", name: "third", description: "Claude source" },
  ]);
  expect(dialog.indexOf("Claude Code")).toBeLessThan(dialog.indexOf("Codex"));
  expect(dialog.indexOf("Codex")).toBeLessThan(dialog.indexOf("外掛"));
  expect(dialog).toMatch(/data-skill-origin="0"[\s\S]*?data-source="2"/);
  expect(dialog).toMatch(/data-skill-origin="1"[\s\S]*?data-source="0"/);
  expect(dialog).toMatch(/data-skill-origin="2"[\s\S]*?data-source="1"/);
});

test("changed shared skill rows reimport through the library while member switches stay in its dialog", () => {
  const skill = { id: 7, name: "write", description: "Write", source: "local:C:/source", source_changed: true, enabled: true };
  const listed = skillListItems([
    { member: { id: 1, name: "Ada" }, skill: { ...skill, shared: true, enabled: false } },
    { member: { id: 0, name: "Raphael" }, skill: { ...skill, shared: true } },
    { member: { id: -1, name: "Shared" }, skill },
    { member: { id: 1, name: "Ada" }, skill: { ...skill, id: 8, name: "private" } },
  ]);
  expect(listed).toHaveLength(2);
  const row = skillRowHTML(listed[0]!);
  expect(row).toContain('data-conn="skill-reimport" data-member="-1" data-id="7"');
  expect(row.match(/data-conn="skill-reimport"/g)).toHaveLength(1);
  expect(row).toContain("Given to 1 members");
  expect(row).not.toContain('data-conn="skill-enable"');
  const dialog = skillDialogHTML(listed[0]!, skillPage(-1, 7), "", "");
  expect(dialog.indexOf('data-skill-grant="0"')).toBeLessThan(dialog.indexOf('data-skill-grant="1"'));
  expect(dialog).toMatch(/aria-checked="false"[^>]*data-conn="skill-enable" data-member="1"/);
  expect(dialog).toMatch(/aria-checked="true"[^>]*data-conn="skill-enable" data-member="0"/);
  expect(skillRowHTML(listed[1]!)).not.toContain('class="cs-library-icon"');
  expect(skillRowHTML(listed[1]!)).toContain('data-conn="skill-enable" data-member="1"');
});

test("ten shared packages stay ten rows for six members", () => {
  const items = Array.from({ length: 10 }, (_, id) => {
    const skill = { id, name: `skill-${id}`, description: "Write", source: "owner", enabled: true };
    return [{ member: { id: -1, name: "Shared" }, skill }, ...Array.from({ length: 6 }, (_, memberId) => ({
      member: { id: memberId, name: `Member ${memberId}` }, skill: { ...skill, shared: true },
    }))];
  }).flat();
  const rows = skillListItems(items);
  expect(rows).toHaveLength(10);
  expect(rows.every(row => row.grants!.length === 6)).toBe(true);
});

test("installed sources use home-relative folders or plugin names and versions without transport prefixes", () => {
  expect(skillSourceLabel("github:owner/research-skills")).toBe("owner/research-skills");
  expect(skillSourceLabel("learned")).toBe("Self-taught");
  expect(skillSourceLabel("owner")).toBe("From owner");
  expect(skillSourceLabel("local:C:\\Users\\Owner\\.claude\\skills\\writer")).toBe("~/.claude/skills/writer");
  expect(skillSourceLabel("local:/home/owner/.codex/skills/writer")).toBe("~/.codex/skills/writer");
  expect(skillSourceLabel("local:C:/Users/Owner/.agents/skills/writer")).toBe("~/.agents/skills/writer");
  expect(skillSourceLabel("local:C:/Synthetic/.claude/plugins/cache/market/docs/2.0.0/skills/notes", "Documents")).toBe("Documents · 2.0.0");
  expect(skillSourceLabel("local:C:\\Synthetic\\.codex\\plugins\\cache\\market\\docs\\2.1.0-beta.1\\skills\\notes")).toBe("docs · 2.1.0-beta.1");
  expect(skillSourceLabel("owner/research-skills")).toBe("owner/research-skills");
  const html = skillImportsHTML([{ source: "local:C:/Synthetic/.claude/plugins/cache/market/docs/2.0.0/skills/notes", name: "notes", description: "Notes", plugin: "<Docs>" }]);
  expect(html).toContain("&lt;Docs&gt; · 2.0.0");
  expect(html).not.toContain("local:");
  expect(html).not.toContain("plugins/cache");
});

test("learned skill rows and their detail dialog show one localized origin and date", () => {
  const item = { member: { id: 1, name: "Ada" }, skill: { id: 7, name: "summary", description: "Summarize", source: "learned", provenance: "learned" as const, learned_at: "2026-10-29T12:00:00", enabled: true } };
  for (const html of [skillRowHTML(item), skillDialogHTML(item, skillPage(1, 7), "", "")]) {
    expect(html.match(/data-skill-provenance/g)).toHaveLength(1);
    expect(html).toContain("Self-taught · Oct 29, 2026");
    expect(html).not.toMatch(/>learned</);
  }
});
