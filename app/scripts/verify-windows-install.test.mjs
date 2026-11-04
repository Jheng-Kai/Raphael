import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

const app = resolve(import.meta.dirname, "..");
const rustSources = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name);
  return entry.isDirectory() ? rustSources(path) : entry.name.endsWith(".rs") ? [readFileSync(path, "utf8")] : [];
});

it("installer count-helper log texts exist in the native application", () => {
  const installer = readFileSync(join(app, "scripts/verify-windows-install.ps1"), "utf8");
  const texts = [...new Set([...installer.matchAll(/&\s*\$count\s+'((?:''|[^'])*)'/g)].map(match => match[1].replaceAll("''", "'")))];
  expect(texts.length, "The installer must expose its count-helper log contract").toBeGreaterThan(0);
  const source = rustSources(join(app, "src-tauri/src")).join("\n");
  for (const text of texts) expect(source.includes(text), `The installer waits for the native log text: ${text}`).toBe(true);
});
