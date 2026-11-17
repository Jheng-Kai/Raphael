import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { coreCheck } from "./guardian.mjs";

const app = resolve(import.meta.dirname, ".."), root = resolve(app, "..");
// A developer's machine runs two Vitest workers (it is shared with other work). A hosted CI runner (4 cores
// are expected; one CI run confirms it) has them to itself, so it runs three.
const CI_WORKERS = 3;
// What --contract runs of the core suite, from the core folder.
export const CORE_CONTRACT = ["tests/evaluate", "tests/members/test_management_discovery.py"];

// The repository's own rule tests, which read the whole tree (RULES.md and its named tests, feature maps, tokens, focus
// rings, layout, UI rules, every locale, history marks): --changed runs them whatever changed, as Vitest filters.
export const RULE_TESTS = ["src/architecture", "guardian-contract", "feature-map", "src/design-tokens", "src/focus-rings", "src/layout.test", "src/ui-rules", "src/main/ui.test", "i18n/i18n.test", "scripts/repo-clean"];

/** The core tests --changed runs for the files a change touched, from the core folder: the test folder of each core
 *  package it changed (`raphael_core/members/…` → `tests/members`), the test file of a changed top-level module
 *  (`raphael_core/app.py` → `tests/test_app.py`) and each changed test file; a file inside a folder that runs is not
 *  named again. */
export function coreTargets(changed, exists = path => existsSync(join(root, "core", path))) {
  const targets = new Set();
  for (const file of changed) {
    const inPackage = /^core\/src\/raphael_core\/([^/]+)\//.exec(file), module = /^core\/src\/raphael_core\/([^/]+)\.py$/.exec(file);
    const test = /^core\/(tests\/.+\.py)$/.exec(file);
    if (inPackage && exists(`tests/${inPackage[1]}`)) targets.add(`tests/${inPackage[1]}`);
    else if (module && exists(`tests/test_${module[1]}.py`)) targets.add(`tests/test_${module[1]}.py`);
    else if (test && exists(test[1])) targets.add(test[1].endsWith("/conftest.py") ? test[1].slice(0, -"/conftest.py".length) : test[1]);
  }
  return [...targets].filter(target => ![...targets].some(other => other !== target && target.startsWith(`${other}/`))).sort();
}

/** The checks one verify run makes, in order. `directory` is the run's own folder, `judge` a look run to review,
 *  `changed` the repository paths the change touched (for --changed: committed since it left origin/main, or not yet). */
export function verifyChecks({ args, directory, judge, environment = process.env, changed = [] }) {
  const vitest = [join(app, "node_modules/vitest/vitest.mjs")], vitestOptions = ["--configLoader", "runner", `--maxWorkers=${environment.CI ? CI_WORKERS : 2}`, "--no-cache", "--fsModuleCachePath", join(directory, "vitest-cache")];
  const core = join(root, "core"), python = environment.RAPHAEL_CORE_PYTHON || join(core, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const pytestCheck = (name, targets) => {
    const pytest = ["-m", "pytest", "-p", "no:cacheprovider", "-W", "error", ...targets];
    return existsSync(python) ? { name, command: python, args: pytest, cwd: core } : { name, command: "uv", args: ["run", "--offline", "--frozen", "--no-sync", "python", ...pytest], cwd: core };
  };
  const tauri = join(app, "src-tauri"), rust = args.includes("--rust"), only = args.includes("--changed");
  const checks = [{ name: "tsc", command: process.execPath, args: [join(app, "node_modules/typescript/bin/tsc"), "--noEmit"], cwd: app }];
  if (only) {
    // What a change touched, not the whole tree (AGENTS.md, "Test what changed"): the frontend tests that import a changed
    // file, the rule tests, the core tests of the changed packages, and contrast or formatting only for their own files.
    const front = changed.filter(file => /^app\/(src|scripts)\/.+\.(ts|mjs|js|css)$/.test(file)).map(file => file.slice("app/".length));
    if (front.length) checks.push({ name: "related", command: process.execPath, args: [...vitest, "related", "--run", "--passWithNoTests", ...vitestOptions, ...front], cwd: app });
    checks.push({ name: "rules", command: process.execPath, args: [...vitest, "run", ...vitestOptions, ...RULE_TESTS], cwd: app });
    if (changed.some(file => /^app\/src\/.+\.css$/.test(file))) checks.push({ name: "contrast", command: process.execPath, args: [join(app, "scripts/check-palette.mjs")], cwd: app });
    const targets = coreTargets(changed);
    if (targets.length) checks.push(pytestCheck("core", targets));
  } else {
    checks.push({ name: "vitest", command: process.execPath, args: [...vitest, "run", ...vitestOptions], cwd: app });
    if (!args.includes("--quick")) checks.push({ name: "contrast", command: process.execPath, args: [join(app, "scripts/check-palette.mjs")], cwd: app });
  }
  // --core is the whole suite, which CI runs on every push in a quarter of an hour over eight machines; here it takes
  // far longer. --contract is the part a change to the core loop or its prompt runs before it is handed back: the scenario
  // drivers and the default prompt's size budget, where the work of two units that each passed alone has broken together.
  const whole = args.includes("--core"), contract = args.includes("--contract") && !whole;
  if (whole || contract) checks.push(pytestCheck(contract ? "contract" : "pytest", contract ? CORE_CONTRACT : []));
  // Formatting was half of the red CI runs and takes a second, so a developer's machine checks it on every run that may
  // have changed Rust. CI's Rust job checks it with the pinned toolchain; the frontend job would use the runner's.
  const rustTouched = !only || changed.some(file => file.startsWith("app/src-tauri/") && file.endsWith(".rs"));
  if (rust || (!args.includes("--quick") && !environment.CI && rustTouched)) checks.push({ name: "rustfmt", command: "cargo", args: ["fmt", "--all", "--", "--check"], cwd: tauri });
  if (rust) {
    checks.push(
      { name: "cargo", command: "cargo", args: ["test", "--offline", "--locked"], cwd: tauri },
      { name: "listener", command: "cargo", args: ["test", "--offline", "--locked", "--lib", "--manifest-path", "vendor/handy-keys/Cargo.toml"], cwd: tauri },
      { name: "clippy", command: "cargo", args: ["clippy", "--offline", "--locked", "--all-targets", "--", "-D", "warnings"], cwd: tauri },
    );
  }
  if (args.includes("--live")) checks.push(coreCheck("live"));
  if (args.includes("--computer")) {
    const computer = coreCheck("computer", ["--out", directory]);
    computer.env.RAPHAEL_COMPUTER_CANCEL_FILE = join(directory, "computer.cancel");
    checks.push(computer);
  }
  if (judge) checks.push(coreCheck("judge", [resolve(judge)]));
  return checks;
}
