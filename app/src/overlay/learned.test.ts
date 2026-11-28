// @vitest-environment happy-dom
/// <reference types="node" />
import { readFileSync } from "node:fs";
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
  const pill = learnedPill(root, actions);
  pill.show({ revision: 1, words: ["Composio", "HiKari"], can_undo: true, language });
  expect(document.activeElement).toBe(input);
  expect(root.querySelector(".learned-text")!.textContent).toBe(text);
  const undo = root.querySelector<HTMLButtonElement>("button")!;
  expect(undo.textContent).toBe(label);
  undo.click(); undo.click(); await Promise.resolve();
  expect(actions.finish).toHaveBeenCalledExactlyOnceWith(1);
  expect(root.hidden).toBe(false);
  pill.dismiss(1);
  vi.advanceTimersByTime(180);
  expect(root.hidden).toBe(true);
});

test("the page keeps no time of its own: the pill stays until the shell dismisses it, then fades", async () => {
  const pill = learnedPill(root, actions);
  vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 48));
  pill.show({ revision: 1, words: ["Composio"], can_undo: true, language: "en" });
  await vi.waitFor(() => expect(actions.layout).toHaveBeenCalledExactlyOnceWith(1, 300, 48));

  // The shell times the pill from its reveal (below); nothing on the page ends or extends it.
  vi.advanceTimersByTime(30_000);
  expect(root.hidden).toBe(false);
  expect(root.classList.contains("is-leaving")).toBe(false);
  expect(root.querySelector("button")!.disabled).toBe(false);
  expect(actions.finish).not.toHaveBeenCalled();

  pill.dismiss(1);
  vi.advanceTimersByTime(179);
  expect(root.hidden).toBe(false);
  expect(root.classList.contains("is-leaving")).toBe(true);
  vi.advanceTimersByTime(1);
  expect(root.hidden).toBe(true);
});

test("the shell shows the pill five seconds from its reveal, and the pointer never holds it", () => {
  // R-UI-51: the owner found the pill and its Undo up far too long. The shell gave it ten seconds and two more for
  // each further word, and paused for as long as the pointer rested over it, where it appears: just above the
  // taskbar. Only an Undo already pressed is finished before it goes.
  const production = readFileSync("src-tauri/src/learned.rs", "utf8").split("#[cfg(test)]")[0];
  expect(production).toMatch(/const DISPLAY_TIME: Duration = Duration::from_secs\(5\);/);
  expect(production).not.toMatch(/cursor_position|over_pill|hover_bounds|word_count/);
});

test("a replay or late dismissal cannot repaint or close the next learned batch", async () => {
  const pill = learnedPill(root, actions);
  const first = { revision: 1, words: ["Composio"], can_undo: true, language: "en" };
  expect(pill.show(first)).toBe(true);
  expect(pill.show(first)).toBe(false);
  pill.dismiss(1);
  pill.show({ revision: 3, words: ["HiKari"], can_undo: true, language: "en" });
  expect(pill.show(first)).toBe(false);
  pill.dismiss(1);
  await Promise.resolve();
  vi.advanceTimersByTime(200);
  expect(root.hidden).toBe(false);
  expect(root.textContent).toContain("HiKari");
});

test("an unsupported language still shows the saved words", () => {
  const pill = learnedPill(root, actions);
  pill.show({ revision: 1, words: ["Composio"], can_undo: true, language: "unsupported" });
  expect(root.hidden).toBe(false);
  expect(root.textContent).toContain("Composio");
});

test("the learned page names no phrase of any language as its title", () => {
  // R-LEARN-WIN-02: the native window's title is empty, and nothing the page names itself shows a phrase of one
  // language under an interface in another.
  const title = /<title>([^<]*)<\/title>/.exec(readFileSync("learned.html", "utf8"))?.[1] ?? "";
  expect(title).toBe("Raphael");
  expect(readFileSync("src-tauri/src/learned.rs", "utf8").split("#[cfg(test)]")[0]).not.toMatch(/Raphael learned word/i);
});
