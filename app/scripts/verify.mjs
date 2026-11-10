import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { coreEnvironment } from "./guardian.mjs";
import { verifyChecks } from "./verify-checks.mjs";

const app = resolve(import.meta.dirname, "..");
const execute = promisify(execFile);
// Shared Windows worktrees can opt into a fresh process check before each boundary.
async function waitForIdle() {
  if (process.env.RAPHAEL_VERIFY_WAIT_FOR_IDLE !== "1") return;
  if (process.platform !== "win32") throw new Error("RAPHAEL_VERIFY_WAIT_FOR_IDLE requires Windows");
  const query = `Get-CimInstance Win32_Process | Where-Object {
    $_.Name -match '^(cargo|rustc|pytest|vitest)(\\.exe)?$' -or
    ($_.Name -match '^(python|node|app|raphael)' -and $_.CommandLine -match
      '([p]ytest|[v]itest|scripts[/\\\\][l]ook|[t]auri.+dev|[c]argo.+(build|test|run)|[.]worktrees.+[\\\\/](app|raphael)[.]exe)')
  } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;
  for (;;) {
    const { stdout } = await execute("powershell.exe", ["-NoProfile", "-Command", query], { windowsHide: true });
    if (!stdout.trim()) return;
    console.log(`Waiting for other heavy processes: ${stdout.trim()}`);
    await new Promise(resolve => setTimeout(resolve, 20000));
  }
}
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outValue = outIndex < 0 ? undefined : args[outIndex + 1];
if (outIndex >= 0 && outValue && !outValue.startsWith("--")) args.splice(outIndex, 2);
const output = outValue && !outValue.startsWith("--") ? resolve(outValue) : join(app, ".look");
const judgeIndex = args.indexOf("--judge");
const judgeValue = judgeIndex < 0 ? undefined : args[judgeIndex + 1];
if (judgeValue && !judgeValue.startsWith("--")) args.splice(judgeIndex, 2);
const allowed = ["--quick", "--core", "--rust", "--live", "--help"];
const unknown = args.find(arg => !allowed.includes(arg));
if (unknown || (args.includes("--quick") && (args.includes("--core") || args.includes("--rust")))) {
  console.error(unknown ? `Unknown option: ${unknown}` : "--quick cannot be combined with --core or --rust");
  process.exitCode = 1;
} else if (args.includes("--help")) {
  console.log("npm run verify -- [--quick] [--core] [--rust] [--live] [--judge run] [--out dir]\nDefault: tsc, vitest, contrast, and cargo fmt --check outside CI. --quick: tsc + vitest only.\n--core: also run offline core pytest with warnings as errors, as CI does.\n--rust: also run cargo fmt --check, offline cargo test for the app and the vendored listener, and Clippy with warnings denied, as CI does.\n--live: paid brain/tool matrix. --judge run: subscription CLI design review after look (720,1120,1920, both themes).\nLogs and summary: app/.look/verify-*/ (override with --out). Default checks use no network; --live and --judge explicitly opt in. No installs.");
} else {
  await mkdir(output, { recursive: true });
  const directory = await mkdtemp(join(output, "verify-"));
  const checks = verifyChecks({ args, directory, judge: judgeValue && !judgeValue.startsWith("--") ? judgeValue : undefined });
  const results = [];
  let activeChild;
  const interrupted = signal => { activeChild?.kill(signal); process.exitCode = 1; };
  process.on("SIGINT", interrupted);
  process.on("SIGTERM", interrupted);
  for (const check of checks) {
    if (process.exitCode) break;
    await waitForIdle();
    console.log(`Running ${check.name}...`);
    const start = performance.now(), log = join(directory, `${check.name}.log`);
    const handle = await open(log, "w");
    let exitCode, error;
    try {
      const result = await new Promise(resolve => {
        activeChild = spawn(check.command, check.args, { cwd: check.cwd, windowsHide: true, shell: false, stdio: ["ignore", handle.fd, handle.fd], env: { ...process.env, ...coreEnvironment(), ...check.env, NO_COLOR: "1", PYTHONDONTWRITEBYTECODE: "1", UV_CACHE_DIR: join(directory, "uv-cache"), CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || join(output, "cargo-target") } });
        activeChild.once("error", value => resolve({ exitCode: 1, error: value.message }));
        activeChild.once("close", (code, signal) => resolve({ exitCode: code ?? 1, ...(signal ? { error: `Terminated by ${signal}` } : {}) }));
      });
      exitCode = result.exitCode; error = result.error;
      if (error) await handle.write(`${error}\n`);
    } finally { activeChild = null; await handle.close(); }
    results.push({ check: check.name, command: check.command, args: check.args, cwd: check.cwd, exitCode, seconds: +((performance.now() - start) / 1000).toFixed(2), log, ...(error ? { error } : {}) });
  }
  process.removeListener("SIGINT", interrupted);
  process.removeListener("SIGTERM", interrupted);
  console.log("\nCheck       Result  Seconds");
  for (const result of results) console.log(`${result.check.padEnd(12)}${(result.exitCode === 0 ? "PASS" : "FAIL").padEnd(8)}${result.seconds}`);
  await writeFile(join(directory, "report.json"), JSON.stringify({ results, skipped: checks.slice(results.length).map(check => check.name) }, null, 2) + "\n");
  console.log(`Logs: ${directory}`);
  process.exitCode = process.exitCode || (results.some(result => result.exitCode !== 0) ? 1 : 0);
}
