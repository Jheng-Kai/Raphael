// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { finiteMotionSettled, settleMotion, findVisibleElement, perform, startupOrderProblem } from "./driver.mjs";
import { requestDisposition } from "./requests.mjs";

describe("look browser interaction contracts", () => {
  it("holds and releases Control around a real shortcut, including a failed key press", async () => {
    const calls = [];
    const page = { keyboard: {
      down: async key => { calls.push(`down:${key}`); },
      press: async key => { calls.push(`press:${key}`); },
      up: async key => { calls.push(`up:${key}`); },
    } };
    await perform(page, { action: "key", key: "n", ctrl: true });
    expect(calls).toEqual(["down:Control", "press:n", "up:Control"]);
    calls.length = 0;
    page.keyboard.press = async () => { throw new Error("press failed"); };
    await expect(perform(page, { action: "key", key: "n", ctrl: true })).rejects.toThrow("press failed");
    expect(calls).toEqual(["down:Control", "up:Control"]);
  });
  it("waits through delayed row entrances but never waits for an infinite activity indicator", () => {
    const running = { playState: "running", effect: { getTiming: () => ({ iterations: 1 }) } };
    const spin = { playState: "running", effect: { getTiming: () => ({ iterations: Infinity }) } };
    document.getAnimations = () => [running, spin];
    try {
      expect(finiteMotionSettled()).toBe(false);
      running.playState = "finished";
      expect(finiteMotionSettled()).toBe(true);
    } finally { delete document.getAnimations; }
  });
  afterEach(() => { document.body.innerHTML = ""; });
  it("captures a successful deletion while its eight-second toast countdown still runs, but waits for the toast entrance", () => {
    document.body.innerHTML = '<div class="toast"><span>Deleted conversation</span><i class="toast-bar"></i></div>';
    const entrance = { animationName: "toast-in", playState: "running", effect: { target: document.querySelector(".toast"), getTiming: () => ({ iterations: 1, duration: 220 }) } };
    const countdown = { animationName: "toast-count", playState: "running", effect: { target: document.querySelector(".toast-bar"), getTiming: () => ({ iterations: 1, duration: 8000 }) } };
    document.getAnimations = () => [entrance, countdown];
    try {
      expect(finiteMotionSettled()).toBe(false);
      entrance.playState = "finished";
      expect(finiteMotionSettled()).toBe(true);
      countdown.animationName = "row-in";
      expect(finiteMotionSettled()).toBe(false);
    } finally { delete document.getAnimations; }
  });
  it("names the motion and target that prevented capture readiness", async () => {
    const pending = [{ name: "row-in", target: '<div class="row"></div>', currentTime: 100, timing: { duration: 9000 } }];
    const page = { evaluate: vi.fn().mockResolvedValue(false), waitForFunction: vi.fn().mockRejectedValue(new Error("Waiting failed: 5000ms exceeded")), evaluate: vi.fn().mockResolvedValue(pending) };
    await expect(settleMotion(page)).rejects.toThrow('Motion did not settle: waiting for finite entrance animations; pending=[{"name":"row-in"');
    expect(page.waitForFunction).toHaveBeenCalledWith(finiteMotionSettled, { timeout: 5000 });
  });
  it("requeries a replaced click target without replaying application errors", async () => {
    const stale = { click: vi.fn().mockRejectedValue(new Error("Node is either not clickable or not an Element")), dispose: vi.fn() };
    const current = { click: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
    const page = { evaluate: vi.fn().mockResolvedValue(false), waitForFunction: vi.fn().mockResolvedValueOnce({ asElement: () => stale }).mockResolvedValue({ asElement: () => current }) };
    await perform(page, { action: "click", selector: ".target" });
    expect(page.waitForFunction).toHaveBeenCalledTimes(2);
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(current.click).toHaveBeenCalledOnce();
    current.click.mockRejectedValue(new Error("application failure"));
    await expect(perform(page, { action: "click", selector: ".target" })).rejects.toThrow("application failure");
    expect(page.waitForFunction).toHaveBeenCalledTimes(3);
  });
  it("fails after three pre-dispatch stale handles", async () => {
    const target = { click: vi.fn().mockRejectedValue(new Error("Node is detached from document")), dispose: vi.fn() };
    const page = { evaluate: vi.fn().mockResolvedValue(false), waitForFunction: vi.fn().mockResolvedValue({ asElement: () => target }) };
    await expect(perform(page, { action: "click", selector: ".target" })).rejects.toThrow("Node is detached");
    expect(target.click).toHaveBeenCalledTimes(3);
    expect(target.dispose).toHaveBeenCalledTimes(3);
  });
  it("types into the connected field when a redraw replaced the located handle", async () => {
    document.body.innerHTML = '<input class="target">';
    const old = document.querySelector("input"), current = old.cloneNode();
    const changed = vi.fn();
    current.addEventListener("change", changed);
    const handle = { evaluate: async (fn, value) => fn(old, value), dispose: vi.fn() };
    const fresh = { evaluate: async (fn, value) => fn(current, value), dispose: vi.fn() };
    const page = {
      evaluate: async (fn, argument) => fn(argument),
      waitForFunction: vi.fn().mockResolvedValueOnce({ asElement: () => { old.replaceWith(current); return handle; } })
        .mockResolvedValue({ asElement: () => fresh }),
    };
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    current.getBoundingClientRect = () => ({ width: 100, height: 30 });
    try {
      await perform(page, { action: "type", selector: ".target", text: "Revised subject" });
      expect(current.value).toBe("Revised subject");
      expect(changed).toHaveBeenCalledOnce();
      expect(handle.dispose).toHaveBeenCalledOnce();
      expect(fresh.dispose).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
  it("waits for an absence by its selector and says what is still there when it does not come", async () => {
    const page = { evaluate: vi.fn().mockResolvedValue(false), waitForFunction: vi.fn().mockResolvedValue(undefined) };
    await perform(page, { action: "wait-gone", selector: ".row" });
    expect(page.waitForFunction).toHaveBeenCalledWith(expect.any(Function), { timeout: 6000 }, ".row");
    const gone = page.waitForFunction.mock.calls[0][0];
    document.body.innerHTML = '<div class="row"></div>';
    expect(gone(".row")).toBe(false);
    document.body.innerHTML = "";
    expect(gone(".row")).toBe(true);
    page.waitForFunction.mockRejectedValue(new Error("timeout"));
    await expect(perform(page, { action: "wait-gone", selector: ".row" })).rejects.toThrow("Still present: .row");
  });
  it("finds the visible result when a collapsed work section matches first", () => {
    document.body.innerHTML = '<div hidden><button data-action="reply">Work</button></div><button data-action="reply">Answer</button>';
    for (const element of document.querySelectorAll("button")) element.getBoundingClientRect = () => ({ width: 28, height: 28 });
    expect(findVisibleElement('[data-action="reply"]').textContent).toBe("Answer");
    expect(findVisibleElement(".missing")).toBeNull();
  });
  it("waits for updated visible text instead of accepting a stale sidebar preview", async () => {
    const page = { evaluate: vi.fn().mockResolvedValue(false), waitForFunction: vi.fn().mockResolvedValue(undefined) };
    const step = { action: "wait-text", selector: ".preview", text: "Gmail 還沒登入" };
    await perform(page, step);
    const ready = page.waitForFunction.mock.calls[0][0];
    const query = { selector: step.selector, text: step.text };
    expect(ready(query)).toBe(false);
    document.body.innerHTML = '<span class="preview">Old reply</span>';
    const preview = document.querySelector('.preview');
    preview.getBoundingClientRect = () => ({ width: 200, height: 30 });
    expect(ready(query)).toBe(false);
    preview.textContent = step.text;
    expect(ready(query)).toBe(true);
    preview.getBoundingClientRect = () => ({ width: 0, height: 0 });
    expect(ready(query)).toBe(false);
    page.waitForFunction.mockRejectedValue(new Error("timeout"));
    await expect(perform(page, step)).rejects.toThrow("Text did not appear: .preview");
  });
  it("ignores an empty first match", () => {
    document.body.innerHTML = '<div class="target"></div><div class="target">Ready</div>';
    document.querySelectorAll(".target")[1].getBoundingClientRect = () => ({ width: 100, height: 30 });
    expect(findVisibleElement(".target").textContent).toBe("Ready");
  });
  it("serves no favicon and preserves failures for other resources", () => {
    const origin = "http://127.0.0.1:1234";
    expect(requestDisposition(`${origin}/favicon.ico?v=1`, origin)).toBe("empty");
    expect(requestDisposition(`${origin}/missing.js`, origin)).toBe("continue");
    expect(requestDisposition("https://outside.example/image.png", origin)).toBe("block");
    expect(requestDisposition("data:image/png;base64,AA==", origin)).toBe("continue");
  });
  it("counts a long click task that starts before the event listener and rejects its budget", async () => {
    document.body.innerHTML = '<button class="target">All</button>';
    vi.spyOn(performance, "now").mockReturnValue(10);
    vi.stubGlobal("requestAnimationFrame", callback => { callback(); return 1; });
    vi.stubGlobal("PerformanceObserver", class {
      observe() {}
      disconnect() {}
      takeRecords() { return [{ startTime: 0, duration: 5 }, { startTime: 5, duration: 75 }]; }
    });
    const page = {
      evaluate: async (fn, argument) => fn(argument),
      waitForFunction: async () => ({ asElement: () => ({
        click: async () => document.querySelector("button").click(), dispose() {},
      }) }),
    };
    try {
      const step = { action: "click", selector: ".target", measure: { name: "all", budgetMs: 250, maxLongTaskMs: 50 } };
      const measured = await perform(page, { ...step, measure: { ...step.measure, enforce: false } });
      expect(measured.longTasks).toEqual([{ start: 5, duration: 75 }]);
      await expect(perform(page, step)).rejects.toThrow("long task exceeds 50ms");
      await expect(perform(page, step)).rejects.toMatchObject({
        assertion: { check: "all", longTasks: [{ start: 5, duration: 75 }], budgetMs: 250 },
      });
    } finally {
      vi.unstubAllGlobals(); vi.restoreAllMocks();
    }
  });
});

describe("start-up order", () => {
  const step = { firstView: ["home.overview", "members.list"], heavy: ["models.catalog", "brains.cli"] };
  const call = (method, t0, t1) => ({ command: "core_call", method, t0, t1 });
  it("accepts the first view answered before the optional reads, which then run one at a time", () => {
    expect(startupOrderProblem([call("members.list", 0, 60), call("home.overview", 5, 70), call("models.catalog", 400, 460), call("brains.cli", 470, 520)], step)).toBe("");
  });
  it("rejects an optional read that begins while the first view is still waiting (the burst that slowed Home to 4 s)", () => {
    expect(startupOrderProblem([call("home.overview", 5, 700), call("members.list", 0, 60), call("models.catalog", 300, 360), call("brains.cli", 400, 450)], step))
      .toBe("models.catalog began while home.overview was still waiting for its answer");
  });
  it("rejects optional reads that overlap each other", () => {
    expect(startupOrderProblem([call("members.list", 0, 60), call("home.overview", 5, 70), call("models.catalog", 400, 460), call("brains.cli", 430, 500)], step))
      .toBe("brains.cli began before models.catalog was answered");
  });
  it("rejects a missing or unanswered read", () => {
    expect(startupOrderProblem([call("members.list", 0, 60), call("models.catalog", 400, 460), call("brains.cli", 470, 520)], step)).toBe("home.overview was never asked for");
    expect(startupOrderProblem([call("members.list", 0, 60), call("home.overview", 5, 70), call("models.catalog", 400, 460), call("brains.cli", 470)], step)).toBe("brains.cli was never answered");
  });
});
