import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { coreCheck } from "./guardian.mjs";

const app = resolve(import.meta.dirname, ".."), root = resolve(app, "..");

/** The checks one verify run makes, in order. `directory` is the run's own folder, `judge` a look run to review. */
export function verifyChecks({ args, directory, judge, environment = process.env }) {
  const checks = [
    { name: "tsc", command: process.execPath, args: [join(app, "node_modules/typescript/bin/tsc"), "--noEmit"], cwd: app },
    { name: "vitest", command: process.execPath, args: [join(app, "node_modules/vitest/vitest.mjs"), "run", "--configLoader", "runner", "--maxWorkers=2", "--no-cache", "--fsModuleCachePath", join(directory, "vitest-cache")], cwd: app },
  ];
  if (!args.includes("--quick")) checks.push({ name: "contrast", command: process.execPath, args: [join(app, "scripts/check-palette.mjs")], cwd: app });
  if (args.includes("--core")) {
    const core = join(root, "core"), python = environment.RAPHAEL_CORE_PYTHON || join(core, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
    checks.push(existsSync(python) ? { name: "pytest", command: python, args: ["-m", "pytest", "-p", "no:cacheprovider", "-W", "error"], cwd: core } : { name: "pytest", command: "uv", args: ["run", "--offline", "--frozen", "--no-sync", "python", "-m", "pytest", "-p", "no:cacheprovider", "-W", "error"], cwd: core });
  }
  const tauri = join(app, "src-tauri"), rust = args.includes("--rust");
  // Formatting was half of the red CI runs and takes a second, so a developer's machine checks it on
  // every run. CI's Rust job checks it with the pinned toolchain; the frontend job would use the runner's.
  if (rust || (!args.includes("--quick") && !environment.CI)) checks.push({ name: "rustfmt", command: "cargo", args: ["fmt", "--all", "--", "--check"], cwd: tauri });
  if (rust) {
    checks.push(
      { name: "cargo", command: "cargo", args: ["test", "--offline", "--locked"], cwd: tauri },
      { name: "listener", command: "cargo", args: ["test", "--offline", "--locked", "--lib", "--manifest-path", "vendor/handy-keys/Cargo.toml"], cwd: tauri },
      { name: "clippy", command: "cargo", args: ["clippy", "--offline", "--locked", "--all-targets", "--", "-D", "warnings"], cwd: tauri },
    );
  }
  if (args.includes("--live")) checks.push(coreCheck("live"));
  if (judge) checks.push(coreCheck("judge", [resolve(judge)]));
  return checks;
}
