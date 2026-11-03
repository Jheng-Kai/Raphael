import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { launch, stopOwned, freePort, connectWebView } from "./process.mjs";
import { collectErrors, toastError, paidRequests } from "./errors.mjs";
import { remaining, journeys, assertWindowSlept, forwardMainWindow } from "./journeys.mjs";
import { parseOptions } from "../options.mjs";

describe("hidden-window journey", () => {
  it("selects the registered journey through the native CLI options", () => {
    const selected = parseOptions(["hidden-window"], journeys).selected;
    expect(selected.map(journey => journey.name)).toEqual(["hidden-window"]);
    expect(journeys.filter(journey => journey.name === "hidden-window")).toHaveLength(1);
  });
  it("accepts an asynchronous suspend followed by timers resuming on show", () => {
    expect(assertWindowSlept({ ticks: [900, 1100, 1400, 9000, 9100], hiddenAt: 1000, showAt: 9000 }))
      .toEqual({ from: 2500, to: 9000, before: 3, after: 3 });
  });
  it("rejects a hidden page whose counter still runs once per second", () => {
    expect(() => assertWindowSlept({ ticks: [900, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9100], hiddenAt: 1000, showAt: 9000 }))
      .toThrow("Hidden page counter advanced by 6; timers were throttled, not suspended");
  });
  it("rejects even one hidden tick and refuses an abbreviated observation", () => {
    expect(() => assertWindowSlept({ ticks: [900, 8999, 9100], hiddenAt: 1000, showAt: 9000 })).toThrow("advanced by 1");
    expect(() => assertWindowSlept({ ticks: [900, 9100], hiddenAt: 1000, showAt: 8499 })).toThrow("shorter than six seconds");
  });
  it("refuses to evaluate the wake command in the suspended main page", async () => {
    const main = { url: () => "http://tauri.localhost/", createCDPSession: vi.fn() };
    await expect(forwardMainWindow(main)).rejects.toThrow("never-suspended learned page");
    expect(main.createCDPSession).not.toHaveBeenCalled();
  });
  it("wakes through the learned page with a bounded command and releases its session", async () => {
    const session = { send: vi.fn().mockResolvedValue({}), detach: vi.fn() };
    await forwardMainWindow({ url: () => "http://tauri.localhost/learned.html", createCDPSession: async () => session });
    expect(session.send).toHaveBeenCalledWith("Runtime.evaluate", {
      expression: 'window.__TAURI_INTERNALS__.invoke("main_window_forward")', awaitPromise: true, timeout: 3000,
    }, { timeout: 3000 });
    expect(session.detach).toHaveBeenCalledOnce();
  });
  it("reports wake timeouts and command permission failures without falling back to the main page", async () => {
    const session = { send: vi.fn().mockRejectedValueOnce(new Error("Runtime.evaluate timed out"))
      .mockResolvedValueOnce({ exceptionDetails: { text: "caller not allowed" } }), detach: vi.fn() };
    const learned = { url: () => "http://tauri.localhost/learned.html", createCDPSession: async () => session };
    await expect(forwardMainWindow(learned)).rejects.toThrow("Learned page could not wake the main window: Runtime.evaluate timed out");
    await expect(forwardMainWindow(learned)).rejects.toThrow("caller not allowed");
    expect(session.detach).toHaveBeenCalledTimes(2);
  });
});

describe("native process ownership", () => {
  it("launches a real child, records output and tears down only its PID", async () => {
    let log = "";
    const owned = launch(process.execPath, ["-e", 'console.log("ready"); setInterval(() => {}, 1000)'], { cwd: process.cwd(), env: process.env, log: value => { log += value; } });
    try {
      await vi.waitFor(() => expect(log).toContain("ready"));
      expect(owned.pid).toBeGreaterThan(0);
    } finally { await stopOwned(owned); }
    expect(await owned.closed).toHaveProperty("code");
  });
  it("never uses a process name and never kills an already exited process", async () => {
    const execute = vi.fn().mockResolvedValue({});
    const owned = { pid: 45678, child: { exitCode: null, signalCode: null, kill: vi.fn() }, closed: Promise.resolve({ code: 0 }) };
    await stopOwned(owned, execute);
    if (process.platform === "win32") expect(execute).toHaveBeenCalledWith("taskkill.exe", ["/PID", "45678", "/T", "/F"], { windowsHide: true });
    execute.mockClear(); owned.child.exitCode = 1;
    await stopOwned(owned, execute); await stopOwned({ pid: -1 }, execute);
    expect(execute).not.toHaveBeenCalled();
  });
  it("reports a failed spawn instead of waiting indefinitely for CDP", async () => {
    const owned = launch("Z:/native-journey-missing.exe", [], { cwd: process.cwd(), env: process.env, log: () => {} });
    expect((await owned.closed).error).toMatch(/ENOENT/);
    await expect(connectWebView({}, await freePort(), owned, 10)).rejects.toThrow(/exited|timed out/);
  });
  it("falls back to the owned spawn handle when Windows denies process enumeration", async () => {
    const owned = { pid: 45678, child: { exitCode: null, signalCode: null, kill: vi.fn().mockReturnValue(true) }, closed: Promise.resolve({ code: 0 }) };
    await stopOwned(owned, vi.fn().mockRejectedValue(new Error("Access denied")));
    expect(owned.child.kill).toHaveBeenCalledOnce();
  });
  it("accepts a graceful exit racing with the final PID termination", async () => {
    const owned = { pid: 45678, child: { exitCode: null, signalCode: null, kill: vi.fn().mockReturnValue(false) }, closed: Promise.resolve({ code: 0 }) };
    await expect(stopOwned(owned, vi.fn().mockRejectedValue(new Error("Process already exited")))).resolves.toBeUndefined();
  });
  it("waits for a page target before attaching to WebView2's browser endpoint", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ json: async () => [] })
      .mockResolvedValueOnce({ json: async () => [{ type: "page" }] })
      .mockResolvedValueOnce({ json: async () => ({ webSocketDebuggerUrl: "ws://127.0.0.1:1234/devtools/browser/test" }) });
    vi.stubGlobal("fetch", fetcher);
    const puppeteer = { connect: vi.fn().mockResolvedValue("connected") };
    try {
      expect(await connectWebView(puppeteer, 1234, { child: { exitCode: null } }, 2000)).toBe("connected");
      expect(fetcher).toHaveBeenCalledTimes(3);
      expect(puppeteer.connect).toHaveBeenCalledOnce();
      expect(puppeteer.connect).toHaveBeenCalledWith({ browserWSEndpoint: "ws://127.0.0.1:1234/devtools/browser/test", defaultViewport: null, protocolTimeout: 5000 });
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("native error and cost collection", () => {
  it("collects console errors, exceptions, unhandled rejections and error toasts", async () => {
    const page = Object.assign(new EventEmitter(), { exposeFunction: vi.fn(), evaluateOnNewDocument: vi.fn() });
    const errors = [];
    await collectErrors(page, errors);
    page.emit("console", { type: () => "log", text: () => "normal" });
    page.emit("console", { type: () => "error", text: () => "console failure" });
    page.emit("pageerror", new Error("outerHTML"));
    const binding = page.exposeFunction.mock.calls[0][1];
    binding("unhandledrejection", "rejected"); binding("toast", "the quick conversation is permanent");
    binding("toast", "Deleted Native conversation");
    expect(errors.map(error => error.kind)).toEqual(["console", "exception", "unhandledrejection", "toast"]);
    expect(toastError("Something unexpected happened")).toBe(true);
    expect(page.evaluateOnNewDocument).toHaveBeenCalledOnce();
  });
  it("rejects paid API requests and undeclared Composio even with fake LLM enabled", () => {
    const paid = 'HTTP Request: POST https://openrouter.ai/api/v1/chat/completions "200 OK"';
    const composio = 'HTTP Request: POST https://backend.composio.dev/api/v3.1/session';
    expect(paidRequests(`Warmed up the OpenRouter client\n${paid}\n${composio}`)).toEqual([paid, composio]);
    expect(paidRequests(`${paid}\n${composio}`, true)).toEqual([paid]);
    const custom = 'HTTP Request: POST https://paid.example/v1/chat';
    const deceptive = 'HTTP Request: POST https://composio.dev.paid.example/v1/chat';
    expect(paidRequests(`${custom}\n${deceptive}\nGET http://127.0.0.1:1420/status`, true)).toEqual([custom, deceptive]);
  });
  it("lists every dependent table's remaining rows for the deleted conversation", () => {
    expect(remaining({ conversations: [{ id: 2 }, { id: 3 }], agent_turns: [{ id: 9, conversation_id: 2 }], connect_cards: [{ id: "card", conversation_id: 2 }], conversation_context_summaries: [] }, 2)).toEqual({ conversations: [{ id: 2 }], agent_turns: [{ id: 9, conversation_id: 2 }], connect_cards: [{ id: "card", conversation_id: 2 }], conversation_context_summaries: [] });
  });
});
