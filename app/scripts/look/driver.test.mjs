// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { finiteMotionSettled, findVisibleElement, perform } from "./driver.mjs";
import { requestDisposition } from "./requests.mjs";

describe("look browser interaction contracts", () => {
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
  it("requeries a replaced click target without replaying application errors", async () => {
    const stale = { click: vi.fn().mockRejectedValue(new Error("Node is either not clickable or not an Element")), dispose: vi.fn() };
    const current = { click: vi.fn().mockResolvedValue(undefined), dispose: vi.fn() };
    const page = { waitForFunction: vi.fn().mockResolvedValueOnce({ asElement: () => stale }).mockResolvedValue({ asElement: () => current }) };
    await perform(page, { action: "click", selector: ".target" });
    expect(page.waitForFunction).toHaveBeenCalledTimes(2);
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(current.click).toHaveBeenCalledOnce();
    current.click.mockRejectedValue(new Error("application failure"));
    await expect(perform(page, { action: "click", selector: ".target" })).rejects.toThrow("application failure");
    expect(page.waitForFunction).toHaveBeenCalledTimes(3);
  });
  it.each([true, false])("opens the wide member picker through visible column controls (collapsed=%s)", async collapsed => {
    const clicked = [];
    const page = {
      evaluate: vi.fn().mockResolvedValue(false),
      $eval: vi.fn().mockResolvedValue(collapsed),
      waitForFunction: vi.fn().mockImplementation(async (_fn, _options, selector) => ({ asElement: () => ({ click: async () => { clicked.push(selector); }, dispose: vi.fn() }) })),
    };
    await perform(page, { action: "member-picker" });
    expect(clicked).toEqual([...(collapsed ? ['[data-col="collapse"]'] : []), '[data-col="add"]', '#app-popover [data-pick="conversation"]']);
  });
  it("fails after three pre-dispatch stale handles", async () => {
    const target = { click: vi.fn().mockRejectedValue(new Error("Node is detached from document")), dispose: vi.fn() };
    const page = { waitForFunction: vi.fn().mockResolvedValue({ asElement: () => target }) };
    await expect(perform(page, { action: "click", selector: ".target" })).rejects.toThrow("Node is detached");
    expect(target.click).toHaveBeenCalledTimes(3);
    expect(target.dispose).toHaveBeenCalledTimes(3);
  });
  it("waits for an absence by its selector and says what is still there when it does not come", async () => {
    const page = { waitForFunction: vi.fn().mockResolvedValue(undefined) };
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
    const page = { waitForFunction: vi.fn().mockResolvedValue(undefined) };
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
    } finally {
      vi.unstubAllGlobals(); vi.restoreAllMocks();
    }
  });
});
