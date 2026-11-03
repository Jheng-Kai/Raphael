import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scenes } from "./scenes/index.mjs";
import { parseOptions } from "./options.mjs";

const root = resolve(import.meta.dirname, "../../..");
const skill = resolve(root, ".agents/skills/verify-raphael");
// RAPHAEL_STAGED_DOCS names a folder that mirrors the tree with edited documents not applied yet.
const staged = process.env.RAPHAEL_STAGED_DOCS ? resolve(root, process.env.RAPHAEL_STAGED_DOCS, ".agents/skills/verify-raphael") : null;
const readMap = file => readFileSync(staged && existsSync(resolve(staged, file)) ? resolve(staged, file) : resolve(skill, file), "utf8");
const names = ["home", "conversation", "members", "automations", "team-and-rooms", "dictation", "settings-appearance", "connections-mcp", "usage", "onboarding", "owner-polish", "composer-discovery", "performance"];

function expectIndexedNotes(index, files) {
  const linked = [...new Set([...index.matchAll(/\]\((?:\.\/)?([\w.-]+\.md)(?:#[^\s)]*)?\)/g)].map(([, file]) => file))];
  expect(files.filter(file => file !== "README.md").sort()).toEqual(linked.filter(file => file !== "README.md").sort());
}

describe("maintained verification feature map", () => {
  it("accepts new notes linked from the index without extending the required names", () => {
    expectIndexedNotes("[Home](home.md) [Future](./future-note.md#checks) [Again](future-note.md)",
      ["README.md", "home.md", "future-note.md"]);
  });
  it("rejects notes absent from the index and index links without a note", () => {
    expect(() => expectIndexedNotes("[Home](home.md)", ["README.md", "home.md", "unlinked.md"])).toThrow();
    expect(() => expectIndexedNotes("[Home](home.md) [Missing](missing.md)", ["README.md", "home.md"])).toThrow();
  });
  it("does not accept external or parent-document links as local feature notes", () => {
    expectIndexedNotes("[Home](home.md) [Web](https://example.test/external.md) [Parent](../SKILL.md) [Section](#checks)",
      ["README.md", "home.md"]);
  });
  it("uses explicit modifier fields instead of unsupported Puppeteer key chords", () => {
    expect(scenes.flatMap(scene => scene.steps.filter(step => step.action === 'key' && /(?:Shift|Control|Alt|Meta)\+/.test(step.key)).map(step => `${scene.name}: ${step.key}`))).toEqual([]);
  });
  it("documents every requested feature with executable, current scene commands", () => {
    const index = readMap("features/README.md");
    for (const name of names) {
      expect(index).toContain(`](${name}.md)`);
      const content = readMap(`features/${name}.md`);
      const headings = name === "performance" ? ["Behavior", "Selected rendered verification", "Native and performance boundaries"] : ["Sub-features", "How to get to it (user POV)", "Driving it with look", "Gotchas"];
      for (const heading of headings)
        expect(content, name).toContain(`## ${heading}`);
      const commands = [...content.matchAll(/^npm run look -- (.+)$/gm)];
      expect(commands.length, name).toBeGreaterThan(0);
      for (const [, command] of commands) {
        const options = parseOptions(command.trim().split(/\s+/), scenes);
        expect(options.themes, `${name}: ${command}`).toEqual(["light", "dark"]);
        const wide = ["home", "automations", "dictation", "members", "conversation", "team-and-rooms", "connections-mcp", "usage"].includes(name) || options.selected.some(scene => scene.name.startsWith("quick-") || scene.name.startsWith("cli-account-") || scene.name.startsWith("window-hover-") );
        const allowedWidths = wide ? [[1120, 720, 1920]] : [[1120, 720], [1120, 720, 1920]];
        allowedWidths.push([1120,720,1920,1180,1280]);
        allowedWidths.push([1120,720,1920,1280]);
        if (name === "connections-mcp") allowedWidths.push([1120, 720, 1920, 1180]);
        if (name === "automations" && options.selected.every(scene => ["calendar-remember", "calendar-view-reload", "calendar-week-fit", "calendar-today-controls"].includes(scene.name))) allowedWidths.push([900, 480]);
        expect(allowedWidths, `${name}: ${command}`).toContainEqual(options.widths);
        if (options.widths.includes(1920)) expect(options.heights[1920], `${name}: ${command}`).toBe(1080);
        if (options.widths.includes(1180)) expect(options.heights[1180], `${name}: ${command}`).toBe(780);
        if (options.widths.includes(1280)) expect(options.heights[1280], `${name}: ${command}`).toBe(800);
      }
    }
    const stagedFeatures = staged && resolve(staged, "features");
    const files = [...new Set([...readdirSync(resolve(skill, "features")), ...(stagedFeatures && existsSync(stagedFeatures) ? readdirSync(stagedFeatures) : [])])];
    expectIndexedNotes(index, files);
  });
  it("maps the Docker-only foundation and live viewer through look and the native journey", () => {
    expect(readMap("features/README.md")).toContain("](member-computer.md)");
    const content = readMap("features/member-computer.md");
    expect(content).toContain("npm.cmd run native -- member-computer");
    expect(content).toContain("Phase A adds no application UI");
    expect(content).toContain("Phase B");
    const command = content.match(/^npm run look -- (desktop-entry .+)$/m)?.[1];
    expect(command).toBeTruthy();
    expect(parseOptions(command.split(/\s+/), scenes).selected.map(scene => scene.name)).toEqual([
      "desktop-entry", "desktop-viewer", "desktop-owner", "desktop-handback", "desktop-stopped", "desktop-unavailable",
      "desktop-starting", "desktop-building", "desktop-preparing", "desktop-absent", "desktop-install",
    ]);
  });
  it("retires deliberately removed owner controls", () => {
    for (const name of ["owner-menu", "owner-keyboard-menu", "owner-photo", "home-expand", "automations-list", "automation-example"])
      expect(() => parseOptions([name], scenes)).toThrow(/Unknown/);
  });
});
