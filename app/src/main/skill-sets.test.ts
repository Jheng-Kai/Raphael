import { beforeEach, expect, test } from "vitest";
import { setLocale } from "./i18n";
import { skillImportsHTML, skillListItems, skillsSectionHTML, skillDialogHTML, skillPage } from "./connection-skills";
import { type SkillSet, skillSetDialogHTML, marketplacesHTML } from "./skill-sets";

beforeEach(() => setLocale("zh-TW"));

export const sampleSet: SkillSet = { id: 1, name: "desk", version: "1.0.0", description: "Writing workflows", source: "github:owner/repo/desk", marketplace: "owner/repo", skill_count: 1, command_count: 1, source_changed: true,
  mcp_servers: [{ name: "Files", transport: "stdio", command: "python", args: ["server.py"], url: "", env: ["TOKEN"], headers: [] }, { name: "Cloud", transport: "http", command: "", args: [], url: "https://example.invalid/mcp", env: [], headers: [] }] };

test("one plugin entry imports the set while individual skills remain available", () => {
  const html = skillImportsHTML([{ name: "desk", version: "1.0.0", description: "Write", kind: "plugin", plugin: "desk", source: "local:C:/Synthetic/.claude/plugins/cache/market/desk/1.0.0", skill_count: 2, skills: [
    { source: "local:C:/Synthetic/.claude/plugins/cache/market/desk/1.0.0/skills/write", name: "write", description: "Write" },
    { source: "local:C:/Synthetic/.claude/plugins/cache/market/desk/1.0.0/skills/check", name: "check", description: "Check" },
  ] }]);
  expect(html.match(/data-plugin-source/g)).toHaveLength(1);
  expect(html.match(/data-conn="skill-import-local"/g)).toHaveLength(1);
  expect(html.match(/data-conn="skill-import-alone"/g)).toHaveLength(2);
  expect(html).toContain("desk · 1.0.0"); expect(html).toContain("2 個技能");
  expect(html).not.toContain("local:");
});

test("set skills stay grouped once with individual grants and one whole-set update", () => {
  const skill = { id: 7, set_id: 1, set_kind: "skill" as const, name: "write", description: "Write", source: "plugin:desk", plugin: "desk", plugin_version: "1.0.0", enabled: true };
  const rows = skillListItems([{ member: { id: -1, name: "Shared" }, skill }, { member: { id: 0, name: "Raphael" }, skill: { ...skill, shared: true } }]);
  const html = skillsSectionHTML(rows, false, [sampleSet]);
  expect(html.match(/data-library-skill/g)).toHaveLength(1);
  expect(html.match(/data-skill-set=/g)).toHaveLength(1);
  expect(html.match(/data-conn="set-update"/g)).toHaveLength(1);
  expect(html).toContain("1 個技能 · 1 個指令");
  expect(html).toContain("desk · 1.0.0");
  const dialog = skillDialogHTML(rows[0]!, skillPage(-1, 7), "", "");
  expect(dialog).toContain('data-skill-grant="0"');
  expect(dialog).not.toContain('data-conn="skill-delete"');
});

test("marketplace plugins show version and unsupported reasons without an install action being enabled", () => {
  const html = marketplacesHTML([{ repo: "owner/repo", name: "market", plugins: [{ name: "desk", version: "2.0.0", description: "Write", installable: true }, { name: "npm-only", version: "1.0.0", description: "Unsupported", installable: false, reason: "GitHub sources only <unsafe>" }] }], false);
  expect(html).toContain("desk · 2.0.0");
  expect(html).toMatch(/data-plugin="1" disabled/);
  expect(html).toContain("GitHub sources only &lt;unsafe&gt;");
});

test("set details reuse one add-MCP card per server and say which plugin parts are unused", () => {
  const html = skillSetDialogHTML(sampleSet, "", "", false);
  expect(html.match(/class="[^"]*mcp-proposal/g)).toHaveLength(2);
  expect(html.match(/data-conn="set-mcp"/g)).toHaveLength(2);
  expect(html).toContain("不執行事件鉤子、代理定義或其他外掛功能");
  expect(html).not.toContain('data-mcp-operation="enable"');
  expect(html).toContain('data-conn="set-delete"');
});
