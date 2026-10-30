import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { scenes } from "./scenes/index.mjs";
import { parseOptions } from "./options.mjs";

const root = resolve(import.meta.dirname, "../../..");
const deployed = resolve(root, ".agents/skills/verify-raphael");
// Protected instruction paths can be staged at the brief's explicit fallback.
const skill = existsSync(deployed) ? deployed : resolve(root, ".fold/.agents/skills/verify-raphael");
const readMap = file => {
  const staged = resolve(root, ".fold/.agents/skills/verify-raphael", file);
  return readFileSync(existsSync(staged) ? staged : resolve(skill, file), "utf8");
};
const names = ["home", "conversation", "members", "automations", "team-and-rooms", "dictation", "settings-appearance", "connections-mcp", "usage", "onboarding"];

describe("maintained verification feature map", () => {
  it("uses explicit modifier fields instead of unsupported Puppeteer key chords", () => {
    expect(scenes.flatMap(scene => scene.steps.filter(step => step.action === 'key' && /(?:Shift|Control|Alt|Meta)\+/.test(step.key)).map(step => `${scene.name}: ${step.key}`))).toEqual([]);
  });
  it("documents every requested feature with executable, current scene commands", () => {
    const index = readMap("features/README.md");
    for (const name of names) {
      expect(index).toContain(`](${name}.md)`);
      const content = readMap(`features/${name}.md`);
      for (const heading of ["Sub-features", "How to get to it (user POV)", "Driving it with look", "Gotchas"])
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
        expect(allowedWidths, `${name}: ${command}`).toContainEqual(options.widths);
        if (options.widths.includes(1920)) expect(options.heights[1920], `${name}: ${command}`).toBe(1080);
        if (options.widths.includes(1180)) expect(options.heights[1180], `${name}: ${command}`).toBe(780);
        if (options.widths.includes(1280)) expect(options.heights[1280], `${name}: ${command}`).toBe(800);
      }
    }
    const staged = resolve(root, ".fold/.agents/skills/verify-raphael/features");
    const files = [...new Set([...readdirSync(resolve(skill, "features")), ...(existsSync(staged) ? readdirSync(staged) : [])])];
    expect(files.filter(file => file !== "README.md").sort()).toEqual([...names, "member-computer"].map(name => `${name}.md`).sort());
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
