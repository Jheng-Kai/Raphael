import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { coreCheck } from "./guardian.mjs";
import { scenes } from "./look/scenes/index.mjs";

const root = resolve(import.meta.dirname, "../..");
// RAPHAEL_STAGED_DOCS names a folder that mirrors the tree with edited documents not applied yet.
const staged = process.env.RAPHAEL_STAGED_DOCS ? resolve(root, process.env.RAPHAEL_STAGED_DOCS) : null;
const located = path => staged && existsSync(resolve(staged, path)) ? resolve(staged, path) : resolve(root, path);
const read = path => readFileSync(located(path), "utf8");

it("CI enforces the offline layers on every PR, and the rendered matrix stays local", () => {
  const ci = read(".github/workflows/ci.yml");
  for (const command of ["npm run verify", "pytest -q", "cargo test --locked", "actions/upload-artifact", "merge_group:", "Guardian required gates"])
    expect(ci).toContain(command);
  expect(ci).not.toContain("paths-ignore:");
  expect(ci).toContain("out true true true");
  // A full look run took two hours on the runner; it is local acceptance (AGENTS.md).
  expect(ci).not.toContain("npm run look");
  expect(ci).not.toContain("npm run judge");
  expect(ci).not.toContain("secrets.OPENROUTER_API_KEY");
  expect(ci).toContain("needs: [changes, frontend, python, windows-shell]");
  const nightly = read(".github/workflows/guardian-live.yml");
  expect(nightly).toContain("--api-only");
  expect(nightly).toContain("--max-turns 120");
  expect(nightly).toContain("Live API matrix SKIP");
});

it("portable guard commands use the installed core environment without shell interpolation", () => {
  for (const kind of ["live", "judge"]) {
    const check = coreCheck(kind, kind === "judge" ? ["C:/an evidence path/run"] : []);
    expect(check.cwd).toBe(resolve(root, "core"));
    expect(check.args).toContain(kind === "live" ? "raphael_core.evaluate.guardian" : "raphael_core.evaluate.design_judge");
    expect(check.args).not.toContain("sync");
    expect(check.env.PYTHONPATH.split(process.platform === "win32" ? ";" : ":")[0]).toBe(resolve(root, "core/src"));
    if (kind === "judge") expect(check.args.slice(-2)).toEqual(["--brain", "claude"]);
  }
});

it("every captured scene has feature context for the judge", () => {
  const names = ["home", "conversation", "members", "member-computer", "automations", "team-and-rooms", "dictation", "settings-appearance", "connections-mcp", "usage", "onboarding", "owner-polish", "composer-discovery"];
  const mapped = new Set(names.flatMap(name => {
    const path = `.agents/skills/verify-raphael/features/${name}.md`;
    return [...read(path).matchAll(/^npm run look -- (.+)$/gm)].flatMap(([, command]) => command.split(/\s+/));
  }));
  expect(scenes.filter(scene => !mapped.has(scene.name)).map(scene => scene.name)).toEqual([]);
});

it("the hand-off contract requires rule IDs and evidence without claiming unrun acceptance", () => {
  const template = read(".github/pull_request_template.md");
  for (const text of ["RULES IDs", "ARCHITECTURE IDs", "Judge report", "images inspected", "Unverified", "Live brain matrix"]) expect(template).toContain(text);
  const spec = ".agents/skills/verify-raphael/SKILL.md";
  expect(existsSync(located(spec))).toBe(true);
  expect(read(spec)).toContain("after look and before UI hand-off");
});
