// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { collectErrors, toastError } from "./errors.mjs";
import { wrongLanguage } from "./journeys.mjs";
import { privateTimeline } from "./deletion-audit.mjs";

describe("native document error capture", () => {
  it("accepts explicit successful history-clearing notices and rejects clearing errors", () => {
    for (const text of ['Cleared the history of “Quick questions”', '已清除「快速提問」的紀錄', '「クイック質問」の履歴を消去しました']) expect(toastError(text)).toBe(false);
    for (const text of ['Could not clear history', '已清除「快速提問」的紀錄失敗', 'Cleared the history of “Quick questions” failed']) expect(toastError(text)).toBe(true);
  });

  it("accepts Raphael and actual OS microphone names but still rejects stale application labels", () => {
    document.body.innerHTML = '<strong>Raphael</strong><button data-k="mic" title="Automatic (current: 麥克風 (USB))">USB</button><button id="stale-mic" data-k="mic" title="自動 (麥克風 (USB))"></button><button id="stale">麥克風 (USB)</button><button id="dictation">Dictation</button>';
    const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 10, height: 10 });
    const visibility = vi.spyOn(HTMLElement.prototype, "checkVisibility").mockReturnValue(true);
    try {
      const names = ["麥克風 (USB)"];
      expect(wrongLanguage("en", [], names).map(issue => issue.id)).toEqual(["stale", "stale-mic"]);
      expect(wrongLanguage("ja", ["Raphael", "Dictation"], names).map(issue => issue.id)).toEqual(["dictation"]);
      expect(wrongLanguage("en", []).some(issue => issue.text.startsWith("Automatic"))).toBe(true);
    } finally { geometry.mockRestore(); visibility.mockRestore(); }
  });

  it("observes real toast mutations and rejection events without counting success toasts", async () => {
    const page = Object.assign(new EventEmitter(), {
      exposeFunction: async (name, callback) => { window[name] = callback; },
      evaluateOnNewDocument: async callback => callback(),
    });
    const errors = [];
    const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 10, height: 10 });
    await collectErrors(page, errors);
    window.dispatchEvent(new Event("DOMContentLoaded"));
    const rejection = new Event("unhandledrejection");
    Object.defineProperty(rejection, "reason", { value: new Error("native rejection") });
    window.dispatchEvent(rejection);
    document.body.innerHTML = '<div class="toast">Cannot set properties of null</div><div class="toast">Deleted test conversation</div><div class="toast">已建立「NativeSource」</div><div class="toast">Created NativeTarget</div><div class="toast">「NativeTarget」を作成しました</div>';
    await vi.waitFor(() => expect(errors).toHaveLength(2));
    expect(errors.map(error => error.kind)).toEqual(["unhandledrejection", "toast"]);
    expect(errors[1].message).toContain("Cannot set");
    geometry.mockRestore();
  });
  it("counts orphan date and exchange chrome even without a turn id, and excludes room rows", () => {
    document.body.innerHTML = '<div class="page-agent"><div class="ra-stage"><div class="ra-scroll"><ol class="thread"><li class="day"><span>Today</span></li><li class="tn exchange-row" data-id="24"><details><summary>訊息來自</summary></details></li><li class="empty-orphan"></li></ol></div></div><div class="au-room-pane"><ol class="thread"><li class="tn" data-id="99">Room</li></ol></div></div>';
    const dom = privateTimeline();
    expect(dom.rows).toHaveLength(3);
    expect(dom.turnIds).toEqual([24]);
    expect(dom.separators).toEqual(["Today"]);
    expect(dom.exchanges).toEqual(["訊息來自"]);
    document.querySelector(".ra-stage .thread").replaceChildren();
    expect(privateTimeline()).toEqual({ rows: [], turnIds: [], separators: [], exchanges: [] });
  });
  it("lists wrong-script UI labels and exact stale translations while excluding user conversation text", () => {
    document.body.innerHTML = '<button id="stale">設定</button><input placeholder="搜尋"><span class="chat-message">中文 from the owner</span><span>日本語</span>';
    const geometry = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 10, height: 10 });
    const visibility = vi.spyOn(HTMLElement.prototype, "checkVisibility").mockReturnValue(true);
    const issues = wrongLanguage("en", []);
    expect(issues.map(issue => issue.text)).toEqual(["設定", "搜尋"]);
    expect(wrongLanguage("ja", ["設定"])[0]).toMatchObject({ id: "stale", text: "設定" });
    geometry.mockRestore(); visibility.mockRestore();
  });
});
