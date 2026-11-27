import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
// TypeScript 7 (the build) ships no compiler API; parsing uses the 6.x compatibility package it recommends for tools.
import ts from "typescript-6";
import { expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const read = (path: string): string => readFileSync(path, "utf8");
// RAPHAEL_STAGED_DOCS names a folder that mirrors the tree with edited documents not applied yet.
const stagedRoot = process.env.RAPHAEL_STAGED_DOCS ? resolve(root, process.env.RAPHAEL_STAGED_DOCS) : null;
const located = (path: string): string => stagedRoot && existsSync(join(stagedRoot, path)) ? join(stagedRoot, path) : join(root, path);
const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
// The product rules: RULES.md, the index, and the area files beside it in rules/ (each read staged when it is).
const ledger = (): string => [".agents/product/RULES.md", ...readdirSync(join(root, ".agents/product/rules")).filter(name => name.endsWith(".md")).sort()
  .map(name => `.agents/product/rules/${name}`)].map(path => read(located(path))).join("\n");
const sources = walk(join(root, "app/src/main")).filter(path => path.endsWith(".ts") && !path.endsWith(".test.ts"));

it("mechanical rules link existing named tests", () => {
  // The rows name the same test files hundreds of times, some of them very long: each is read once. Read once per
  // reference, this test ran past its five seconds on a busy machine.
  const kept = new Map<string, string>();
  const once = (path: string): string => { if (!kept.has(path)) kept.set(path, read(path)); return kept.get(path)!; };
  for (const name of ["RULES", "ARCHITECTURE"]) {
    const spec = name === "RULES" ? ledger() : read(located(`.agents/product/${name}.md`));
    // An ID is unique across every file, a multi-part one (R-CLI-SIGNIN-06) included: a merge of two branches left a rule's
    // old row beside its new one, and two rules took one ID, where only one-part IDs were compared.
    const every = spec.split("\n").filter(line => /^\| (?:R-[A-Z]+(?:-[A-Z]+)*-\d+|A-\d+) \|/.test(line));
    const ids = every.map(row => row.split("|")[1]!.trim());
    expect(ids.filter((id, at) => ids.indexOf(id) !== at)).toEqual([]);
    const rows = every; // the named-test check covers every row too, a multi-part ID (R-COMP-HOST-08) included
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const checks = row.split("|")[name === "RULES" ? 4 : 3]!.split(",").map(check => check.trim());
      if (!checks.some(check => ["lint", "look", "pytest", "vitest"].includes(check))) continue;
      const references = [...row.matchAll(/([\w./-]+(?:\.test\.(?:ts|mjs)|test_[\w]+\.py))::([^|;]+)/g)];
      expect(references.length, row).toBeGreaterThan(0);
      for (const [, path, title] of references) {
        const absolute = resolve(root, path!);
        expect(absolute.startsWith(root + "/") || absolute.startsWith(root + "\\"), row).toBe(true);
        expect(existsSync(absolute), row).toBe(true);
        const source = once(absolute);
        const label = title!.trim();
        expect(source.includes(`"${label}"`) || source.includes(`'${label}'`) || source.includes(`def ${label}(`), row).toBe(true);
      }
    }
  }
}, 60_000);

it("no rule row holds a control character, which breaks the row for the tools that read it", () => {
  // A "\f" written through a script once became a form feed inside a row, and the design judge read half a row.
  const broken = ledger().split("\n").filter(line => /^\| R-/.test(line) && /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x85\u2028\u2029]/.test(line))
    .map(line => line.split("|")[1]!.trim());
  expect(broken).toEqual([]);
});

it("a rule named in the code is in the ledger", () => {
  const known = new Set([...ledger().matchAll(/^(?:\| )?(R-[A-Z]+(?:-[A-Z]+)*-\d+)(?: \||:)/gm)].map(match => match[1]));
  const unknownOnPurpose = "R-UI-99"; // test_design_judge.py proves an unknown rule id is refused
  const code = ["app/src", "app/scripts", "core/src", "core/tests"].flatMap(dir => walk(join(root, dir)))
    .filter(path => /\.(?:ts|mjs|py|css)$/.test(path));
  const dangling = code.flatMap(path => [...read(path).matchAll(/\bR-[A-Z]+(?:-[A-Z]+)*-\d+\b/g)]
    .filter(match => !known.has(match[0]) && match[0] !== unknownOnPurpose)
    .map(match => `${path.slice(root.length + 1)}: ${match[0]}`));
  expect(dangling).toEqual([]);
}, 60_000);

it("core IPC has one frontend boundary", () => {
  const violations: string[] = [];
  for (const path of sources) {
    if (path === join(root, "app/src/main/api.ts")) continue;
    const tree = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
    const hotkeys = path === join(root, "app/src/main/window-hotkeys.ts");
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === "@tauri-apps/api/core" && !hotkeys) violations.push(path);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "invoke") {
        const arg = node.arguments[0];
        if (!hotkeys || !arg || !ts.isStringLiteral(arg) || arg.text !== "window_hotkey") violations.push(path);
      }
      if (ts.isStringLiteral(node) && node.text === "core_call") violations.push(path);
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  expect(violations).toEqual([]);
  // Parsing every source takes seconds under the whole suite's load (previously timed out twice).
}, 60_000);

it("main templates never introduce native selects", () => {
  expect(sources.filter(path => /<select(?:\s|>)/i.test(read(path)))).toEqual([]);
});

it("literal frontend RPC calls are allowed by the shell", () => {
  const shell = read(join(root, "app/src-tauri/src/commands.rs"));
  const constants = ["ALLOWED_METHODS", "ALLOWED_PREFIXES"].map(name => {
    const block = shell.match(new RegExp(`const ${name}:[^=]+?=\\s*&?\\[([\\s\\S]*?)\\];`));
    expect(block, name).not.toBeNull();
    return [...block![1]!.matchAll(/^\s*"([a-z][a-z0-9_.]+)"/gm)].map(match => match[1]!);
  });
  const [methods, prefixes] = constants;
  const rejected: string[] = [];
  let checked = 0;
  for (const path of sources) {
    const tree = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && ["core", "connectorCall"].includes(node.expression.text)) || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "core"))) {
        const method = node.arguments[0];
        if (method && ts.isStringLiteral(method)) {
          checked++;
          if (!methods!.includes(method.text) && !prefixes!.some(prefix => method.text.startsWith(prefix))) rejected.push(method.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  expect(checked).toBeGreaterThan(100);
  expect(rejected).toEqual([]);
}, 60_000);
