import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as verifyModule from "./verify-checks.mjs";
import { verifyChecks } from "./verify-checks.mjs";

const app = resolve(import.meta.dirname, "..");
const names = (args, environment = {}) => verifyChecks({ args, directory: "run", environment }).map(check => check.name);
describe("the checks of a verify run", () => {
  it("checks Rust formatting on every run of a developer's machine, where it costs a second", () => {
    expect(names([])).toEqual(["tsc", "vitest", "contrast", "rustfmt"]);
  });
  it("runs more Vitest workers in CI than on a developer's shared machine", () => {
    const workers = environment => verifyChecks({ args: [], directory: "run", environment }).find(check => check.name === "vitest").args.find(arg => arg.startsWith("--maxWorkers="));
    expect(workers({})).toBe("--maxWorkers=2");
    expect(workers({ CI: "true" })).toBe("--maxWorkers=3");
  });
  it("leaves formatting to CI's Rust job, which pins the toolchain", () => {
    expect(names([], { CI: "true" })).toEqual(["tsc", "vitest", "contrast"]);
    expect(names(["--rust"], { CI: "true" })).toEqual(["tsc", "vitest", "contrast", "rustfmt", "cargo", "listener", "clippy"]);
  });
  it("keeps the quick run to the two frontend checks", () => {
    expect(names(["--quick"])).toEqual(["tsc", "vitest"]);
  });
  it("runs the core contract in place of the whole suite, and the whole suite when both are asked for", () => {
    expect(names(["--contract"])).toEqual(["tsc", "vitest", "contrast", "contract", "rustfmt"]);
    expect(names(["--contract", "--core"])).toContain("pytest");
    expect(names(["--contract", "--core"])).not.toContain("contract");
  });
  it("checks formatting once when the Rust checks are asked for", () => {
    expect(names(["--core", "--rust"])).toEqual(["tsc", "vitest", "contrast", "pytest", "rustfmt", "cargo", "listener", "clippy"]);
  });
  it("runs isolated computer acceptance only when explicitly requested and keeps its JSON in the verify run", () => {
    for (const args of [[], ["--core"], ["--contract"], ["--live"]]) expect(names(args)).not.toContain("computer");
    expect(names([], { CI: "true" })).not.toContain("computer");
    const check = verifyChecks({ args: ["--computer"], directory: "C:/a verify run", environment: {} }).find(check => check.name === "computer");
    expect(check.args).toContain("raphael_core.evaluate.computer_acceptance");
    expect(check.args.slice(-2)).toEqual(["--out", "C:/a verify run"]);
    expect(check.env.RAPHAEL_COMPUTER_CANCEL_FILE).toBe(join("C:/a verify run", "computer.cancel"));
    expect(check.args).not.toContain("raphael_core.evaluate.guardian");
    expect(check.env.PYTHONPATH.split(process.platform === "win32" ? ";" : ":")[0]).toBe(resolve(app, "../core/src"));
  });
});
describe("a verify run of only what changed (--changed)", () => {
  const run = (changed, args = ["--changed"]) => verifyChecks({ args, directory: "run", environment: {}, changed });
  const of = (changed, name, args) => run(changed, args).find(check => check.name === name);
  it("runs the frontend tests related to changed files and the rule tests, never the whole suite", () => {
    const checks = run(["app/src/main/desktop-viewer.ts", "app/src/main/desktop-viewer.test.ts", "app/scripts/look/checks.mjs", ".agents/product/RULES.md"]);
    expect(checks.map(check => check.name)).toEqual(["tsc", "related", "rules"]);
    const related = checks[1].args;
    expect(related.slice(1, 4)).toEqual(["related", "--run", "--passWithNoTests"]);
    const front = ["src/main/desktop-viewer.ts", "src/main/desktop-viewer.test.ts", "scripts/look/checks.mjs"], at = related.indexOf(front[0]);
    expect(related.slice(at, at + 3)).toEqual(front);
    // After them, the tests that read one of them as text, which vitest related does not follow.
    expect(related.slice(at + 3)).toEqual(verifyModule.textReaders(front));
    expect(of([], "rules").args).toEqual(expect.arrayContaining(["run", "src/architecture", "guardian-contract", "feature-map", "scripts/repo-clean"]));
  });
  it("runs the test folder of each changed core package, a changed module's test file and changed test files, once", () => {
    const exists = path => ["tests/members", "tests/computer", "tests/test_app.py", "tests/members/test_service.py", "tests/computer/conftest.py", "tests/agent"].includes(path);
    const { coreTargets } = verifyModule;
    expect(coreTargets(["core/src/raphael_core/members/service.py", "core/tests/members/test_service.py", "core/src/raphael_core/app.py", "core/src/raphael_core/computer/vm.py", "core/src/raphael_core/agent/history.py"], exists))
      .toEqual(["tests/agent", "tests/computer", "tests/members", "tests/test_app.py"]);
    expect(coreTargets(["core/tests/computer/conftest.py", "core/src/raphael_core/nowhere/x.py", "core/pyproject.toml"], exists)).toEqual(["tests/computer"]);
    const core = of(["core/src/raphael_core/members/service.py"], "core");
    expect(core.args).toEqual(expect.arrayContaining(["-W", "error", "tests/members"]));
    expect(core.cwd).toBe(resolve(app, "../core"));
  });
  it("runs the core tests that read a changed app file as text, such as the boundary test the shell's method list feeds", () => {
    const { coreTargets } = verifyModule;
    const exists = path => path.startsWith("tests/architecture/");
    expect(coreTargets(["app/src-tauri/src/commands.rs"], exists)).toEqual(["tests/architecture/test_boundaries.py", "tests/architecture/test_management_coverage.py"]);
    expect(coreTargets(["app/src/main/api.ts", "core/src/raphael_core/management.py"], exists)).toEqual(["tests/architecture/test_management_coverage.py"]);
    expect(of(["app/src-tauri/src/commands.rs"], "core").args).toEqual(expect.arrayContaining(["tests/architecture/test_management_coverage.py"]));
  });
  it("knows every app file a core test reads as text", () => {
    const { READ_BY_CORE_TESTS } = verifyModule;
    const core = resolve(app, "../core"), listing = spawnSync("git", ["ls-files", "tests/**/*.py"], { cwd: core, encoding: "utf8" });
    const reads = [];
    for (const test of listing.stdout.split("\n").filter(Boolean)) {
      for (const match of readFileSync(join(core, test), "utf8").matchAll(/\/ "(app\/[^"]+\.(?:ts|rs|mjs))"\)\.read_text/g)) reads.push([match[1], test]);
    }
    expect(reads.length).toBeGreaterThan(3);
    for (const [file, test] of reads) expect(READ_BY_CORE_TESTS[file] ?? [], `${test} reads ${file}`).toContain(test);
  }, 30_000); // It lists and reads every core test file: about 3 s alone, past 5 s twice under a loaded verify.
  it("runs the frontend tests that read a changed file as text, which vitest related does not follow", () => {
    const { textReaders } = verifyModule;
    const texts = { "src/main/agent-sizing.test.ts": 'read("agent.css")', "src/main/other.test.ts": 'import "./agent"', "scripts/look/a.test.mjs": 'join(app, "src/main/agent.css")' };
    const tests = Object.keys(texts), read = path => texts[path];
    expect(textReaders(["src/main/agent.css"], tests, read)).toEqual(["src/main/agent-sizing.test.ts", "scripts/look/a.test.mjs"]);
    expect(textReaders(["src/main/agent-sizing.test.ts"], tests, read)).toEqual([]);
    // The real tree: the test that failed only in the whole suite, after a change to agent.css, is run by --changed.
    expect(textReaders(["src/main/agent.css"])).toContain("src/main/agent-sizing.test.ts");
    const related = run(["app/src/main/agent.css"]).find(check => check.name === "related");
    expect(related.args).toContain("src/main/agent-sizing.test.ts");
  });
  it("checks contrast only when CSS changed and Rust formatting only when Rust changed", () => {
    expect(run(["app/src/main/agent.ts"]).map(check => check.name)).not.toContain("contrast");
    expect(run(["app/src/main/agent.css"]).map(check => check.name)).toContain("contrast");
    expect(run(["app/src/main/agent.ts"]).map(check => check.name)).not.toContain("rustfmt");
    expect(run(["app/src-tauri/src/commands.rs"]).map(check => check.name)).toContain("rustfmt");
  });
  it("adds the core contract, the Rust suite or a judge only when asked, and refuses to mix with --quick", () => {
    expect(run(["core/src/raphael_core/agent/persona.py"], ["--changed", "--contract"]).map(check => check.name)).toContain("contract");
    expect(run(["app/src-tauri/src/commands.rs"], ["--changed", "--rust"]).map(check => check.name)).toEqual(expect.arrayContaining(["rustfmt", "cargo", "clippy"]));
    expect(run([]).map(check => check.name)).toEqual(["tsc", "rules"]);
    const result = spawnSync(process.execPath, [join(app, "scripts/verify.mjs"), "--quick", "--changed"], { cwd: app, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--quick cannot be combined with --changed");
  });
});
describe("the TypeScript compiler of the build", () => {
  const read = path => JSON.parse(readFileSync(resolve(app, path), "utf8"));
  it("is TypeScript 7, by path: the 6.x parser package drags a second `tsc` bin that owns node_modules/.bin/tsc", () => {
    expect(read("node_modules/typescript/package.json").version).toMatch(/^7\./);
    expect(read("package.json").scripts.build).toMatch(/^node node_modules\/typescript\/bin\/tsc /);
    expect(verifyChecks({ args: [], directory: "run", environment: {} }).find(check => check.name === "tsc").args[0]).toBe(join(app, "node_modules/typescript/bin/tsc"));
  });
  it("keeps TypeScript 6 only as the parser the tests and look scripts import under its own name", () => {
    const manifest = read("package.json");
    expect(manifest.devDependencies["typescript-6"]).toMatch(/^npm:@typescript\/typescript6@/);
    expect(read("node_modules/typescript-6/package.json").name).toBe("@typescript/typescript6");
  });
});
describe("verify CLI", () => {
  it("documents optional core/Rust checks without executing them", () => {
    const result = spawnSync(process.execPath, ["scripts/verify.mjs", "--help"], { cwd: app, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("--quick");
    expect(result.stdout).toContain("--core");
    expect(result.stdout).toContain("--rust");
    expect(result.stdout).toContain("--out dir");
    expect(result.stdout).toContain("--live");
    expect(result.stdout).toContain("--computer");
    expect(result.stdout).toContain("requires running Linux Docker");
    expect(result.stdout).toContain("--judge run");
  });
  it("runs the Rust checks CI runs, so a formatting or Clippy failure shows up before a push", () => {
    const result = spawnSync(process.execPath, ["scripts/verify.mjs", "--help"], { cwd: app, encoding: "utf8" });
    expect(result.stdout).toContain("--rust: also run cargo fmt --check, offline cargo test for the app and the vendored listener, and Clippy with warnings denied");
    expect(result.stdout).toContain("--core: also run offline core pytest with warnings as errors");
    expect(result.stdout).toContain("Default: tsc, vitest, contrast, and cargo fmt --check outside CI.");
  });
  it("rejects an output flag without a directory", () => {
    for (const args of [["--out"], ["--out", "--quick"]]) {
      const result = spawnSync(process.execPath, ["scripts/verify.mjs", ...args], { cwd: app, encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unknown option: --out");
    }
  });
  it("rejects a judge flag without evidence", () => {
    const result = spawnSync(process.execPath, ["scripts/verify.mjs", "--judge"], { cwd: app, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option: --judge");
  });
});
