// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, test, vi, type Mock } from "vitest";
import { learnedPill, type LearnedActions } from "./learned";

let root: HTMLElement, actions: { finish: Mock<LearnedActions["finish"]>; layout: Mock<LearnedActions["layout"]> };
beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="pill" hidden><img alt=""><span class="learned-text"></span><button class="learned-undo"></button></div>';
  root = document.querySelector("#pill")!;
  actions = { finish: vi.fn().mockResolvedValue(undefined), layout: vi.fn().mockResolvedValue(undefined) };
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ""; });

test.each([
  ["zh-TW", "已將「Composio、HiKari」加入字典。", "撤銷"],
  ["en", "Added Composio, HiKari to the dictionary.", "Undo"],
  ["ja", "「Composio、HiKari」を辞書に追加しました。", "取り消す"],
])("the %s pill names one batch and Undo removes that batch once without taking focus", async (language, text, label) => {
  const input = document.createElement("input"); document.body.append(input); input.focus();
  learnedPill(root, actions).show({ words: ["Composio", "HiKari"], token: "batch-1", language });
  expect(document.activeElement).toBe(input);
  expect(root.querySelector(".learned-text")!.textContent).toBe(text);
  const undo = root.querySelector<HTMLButtonElement>("button")!;
  expect(undo.textContent).toBe(label);
  undo.click(); undo.click(); await Promise.resolve();
  expect(actions.finish).toHaveBeenCalledExactlyOnceWith("batch-1", true);
  vi.advanceTimersByTime(180);
  expect(root.hidden).toBe(true);
});

test("five seconds without interaction fades; hovering keeps the pill open", () => {
  learnedPill(root, actions).show({ words: ["Composio"], token: "batch-1", language: "en" });
  vi.advanceTimersByTime(4900);
  root.dispatchEvent(new MouseEvent("mouseenter"));
  vi.advanceTimersByTime(20_000);
  expect(root.hidden).toBe(false); expect(actions.finish).not.toHaveBeenCalled();
  root.dispatchEvent(new MouseEvent("mouseleave"));
  vi.advanceTimersByTime(5000);
  expect(root.classList.contains("is-leaving")).toBe(true);
  expect(actions.finish).toHaveBeenCalledWith("batch-1", false);
  vi.advanceTimersByTime(180); expect(root.hidden).toBe(true);
});

test("a late Undo result cannot close the next learned batch", async () => {
  let finish!: () => void;
  actions.finish.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pill = learnedPill(root, actions);
  pill.show({ words: ["Composio"], token: "first", language: "en" });
  root.querySelector<HTMLButtonElement>("button")!.click();
  pill.show({ words: ["HiKari"], token: "second", language: "en" });
  finish(); await Promise.resolve(); vi.advanceTimersByTime(200);
  expect(root.hidden).toBe(false);
  expect(root.textContent).toContain("HiKari");
});
