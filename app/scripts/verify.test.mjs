import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyChecks } from "./verify-checks.mjs";

const app = resolve(import.meta.dirname, "..");
const names = (args, environment = {}) => verifyChecks({ args, directory: "run", environment }).map(check => check.name);
describe("the checks of a verify run", () => {
  it("checks Rust formatting on every run of a developer's machine, where it costs a second", () => {
    expect(names([])).toEqual(["tsc", "vitest", "contrast", "rustfmt"]);
  });
  it("leaves formatting to CI's Rust job, which pins the toolchain", () => {
    expect(names([], { CI: "true" })).toEqual(["tsc", "vitest", "contrast"]);
    expect(names(["--rust"], { CI: "true" })).toEqual(["tsc", "vitest", "contrast", "rustfmt", "cargo", "listener", "clippy"]);
  });
  it("keeps the quick run to the two frontend checks", () => {
    expect(names(["--quick"])).toEqual(["tsc", "vitest"]);
  });
  it("checks formatting once when the Rust checks are asked for", () => {
    expect(names(["--core", "--rust"])).toEqual(["tsc", "vitest", "contrast", "pytest", "rustfmt", "cargo", "listener", "clippy"]);
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
