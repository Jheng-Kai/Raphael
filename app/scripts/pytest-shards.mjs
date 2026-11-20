// Runs the core tests a verify check names in several pytest processes at once, each keeping one share of the test
// files: the same deal CI makes over its eight machines (RAPHAEL_TEST_SHARE, tests/conftest.py). One process took 36 to 73
// minutes for one changed agent file; the shares together take a fraction of that on a machine with cores to spare.
//
//   node scripts/pytest-shards.mjs <python> <pytest arguments...>
//
// Each share has a short temporary folder of its own (Windows refuses the long paths of a nested pytest folder, which
// failed tests that pass in CI) and writes to its own log; this prints each share's failures and summary, and fails
// when any share failed. A share with no test in it (pytest's exit 5) passes. RAPHAEL_VERIFY_SHARES sets the number
// of shares (1 runs pytest once, as before).
import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** How many shares: RAPHAEL_VERIFY_SHARES, or half the cores and at most the eight CI uses (the machine is shared with
 *  the app, a build or a look run). */
export const shareCount = (environment = process.env, cores = availableParallelism()) => {
  const wanted = Number(environment.RAPHAEL_VERIFY_SHARES);
  return Number.isInteger(wanted) && wanted >= 1 ? wanted : Math.max(1, Math.min(8, Math.floor(cores / 2)));
};

/** What a share's log says: its failed and erroring tests, and its last summary line. */
export function summary(log) {
  const lines = log.split(/\r?\n/);
  const failures = lines.filter(line => /^(FAILED|ERROR) /.test(line));
  const last = [...lines].reverse().find(line => /\b(passed|failed|errors?|no tests ran|deselected)\b/.test(line)) ?? "";
  return { failures, last: last.replace(/^=+\s*|\s*=+$/g, "") };
}

/** One pytest process for share `index` of `shares`, its output in `log`; resolves to its exit code. */
function share(python, pytest, index, shares, base) {
  const log = join(base, `share-${index}.log`), fd = openSync(log, "w");
  const args = ["-m", "pytest", "-q", "-ra", "--basetemp", join(base, `t${index}`), ...pytest];
  const env = { ...process.env, ...(shares > 1 ? { RAPHAEL_TEST_SHARE: `${index}/${shares}` } : {}) };
  return new Promise(done => {
    const child = spawn(python, args, { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", fd, fd], env });
    child.on("error", () => { closeSync(fd); done({ index, code: 1, log }); });
    child.on("close", code => { closeSync(fd); done({ index, code: code ?? 1, log }); });
  });
}

export async function run([python, ...pytest], shares = shareCount()) {
  const base = mkdtempSync(join(tmpdir(), "rv-"));
  const results = await Promise.all(Array.from({ length: shares }, (_, i) => share(python, pytest, i + 1, shares, base)));
  let failed = false;
  for (const { index, code, log } of results) {
    const text = readFileSync(log, "utf8"), { failures, last } = summary(text), ok = code === 0 || code === 5;
    failed ||= !ok;
    console.log(`share ${index}/${shares}: ${ok ? "PASS" : `FAIL (exit ${code})`} ${last}`);
    for (const line of failures) console.log(`  ${line}`);
    if (!ok && !failures.length) console.log(text.split(/\r?\n/).slice(-40).join("\n"));
  }
  rmSync(base, { recursive: true, force: true });
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await run(process.argv.slice(2));
