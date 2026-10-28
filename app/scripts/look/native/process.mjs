import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execute = promisify(execFile);
export async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export function launch(program, args, { cwd, env, log }) {
  const child = spawn(program, args, { cwd, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", value => log(value));
  child.stderr.on("data", value => log(value));
  const closed = new Promise(resolve => {
    child.once("error", error => resolve({ error: error.message }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return { child, closed, pid: child.pid };
}

export async function stopOwned(process, executeCommand = execute) {
  if (!process?.pid || !Number.isInteger(process.pid) || process.pid <= 0) return;
  if (process.child.exitCode !== null || process.child.signalCode !== null) return;
  // The PID is returned by our own spawn. /T includes its core and isolated WebView2 children.
  if (globalThis.process.platform === "win32") {
    try { await executeCommand("taskkill.exe", ["/PID", String(process.pid), "/T", "/F"], { windowsHide: true }); }
    catch {
      // Restricted Windows sessions can deny taskkill's process enumeration. The spawn handle
      // still owns this exact PID; its termination closes the shell's kill-on-close core Job.
      // Close can win this race before Node dispatches its exit event. A false kill result is
      // harmless only if the owned close promise below resolves; otherwise it times out.
      process.child.kill();
    }
  } else process.child.kill("SIGTERM");
  await Promise.race([process.closed, new Promise((_, reject) => setTimeout(() => reject(new Error(`PID ${process.pid} did not close`)), 10000).unref())]);
}

export async function connectWebView(puppeteer, port, process, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (process.child.exitCode !== null) throw new Error(`App PID ${process.pid} exited: ${JSON.stringify(await process.closed)}`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
      if (!targets.some(target => target.type === "page" || target.type === "webview")) {
        await new Promise(resolve => setTimeout(resolve, 250));
        continue;
      }
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      const version = await response.json();
      return await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl, defaultViewport: null });
    } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  throw new Error(`WebView2 CDP readiness timed out on port ${port}`);
}
