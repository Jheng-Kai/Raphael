// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ core: vi.fn() }));
vi.mock("./api", () => api);
import { ComposerLearning, PASTE_WAIT_MS, bindComposerLearning, composerCorrections, learnComposerCorrections } from "./composer-learning";
const before = "Please use Sample Tool Ex", after = "Please use SampleToolX";
const correction = [{ before, after }];
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); document.body.innerHTML = ""; });

test("bounded dictation evidence goes unchanged to the shared native tracker", () => {
  expect(composerCorrections(before, after)).toEqual(correction);
  expect(composerCorrections(before, before)).toEqual([]);
  expect(composerCorrections("", after)).toEqual([]);
  expect(composerCorrections("x".repeat(20_001), after)).toEqual([]);
});
test("only a known dictation seeds a draft; it is consumed once, cleared on navigation and expires", () => {
  vi.useFakeTimers();
  const input = document.createElement("textarea"), learning = bindComposerLearning(input);
  input.value = after;
  expect(learning.take(after)).toEqual([]);
  input.dispatchEvent(new CustomEvent("dictation-pasted", { detail: "another field" }));
  expect(learning.take(after)).toEqual([]);
  input.value = before;
  input.dispatchEvent(new CustomEvent("dictation-pasted", { detail: before }));
  expect(learning.take(after)).toEqual(correction);
  expect(learning.take(after)).toEqual([]);
  learning.seed(before); learning.clear(); expect(learning.take(after)).toEqual([]);
  learning.seed(before); vi.advanceTimersByTime(60_000); expect(learning.take(after)).toEqual([]);
  learning.seed(before + " ".repeat(20_000)); expect(learning.snapshot()).toBeUndefined();
});
test("a dictation the shell names before the paste reaches the field still seeds the draft", () => {
  vi.useFakeTimers();
  const input = document.createElement("textarea"), learning = bindComposerLearning(input);
  input.dispatchEvent(new CustomEvent("dictation-pasted", { detail: before }));
  expect(learning.snapshot()).toBeUndefined();
  input.value = before;
  input.dispatchEvent(new Event("input"));
  expect(learning.take(after)).toEqual(correction);
  // Waited for only a moment: a paste that never shows seeds nothing later.
  input.value = "";
  input.dispatchEvent(new CustomEvent("dictation-pasted", { detail: before }));
  vi.advanceTimersByTime(PASTE_WAIT_MS + 1);
  input.value = before;
  input.dispatchEvent(new Event("input"));
  expect(learning.take(after)).toEqual([]);
});
test("changes to text typed outside the dictated span never become corrections", () => {
  const learning = new ComposerLearning();
  learning.seed("Typed Allice. " + before, before);
  expect(learning.take("Typed Alice. " + after)).toEqual([]);
  learning.seed("Typed Allice. " + before, before);
  expect(learning.take("Typed Allice. " + after)).toEqual(correction);
});
test("pending-send retry evidence is erased at the original deadline", () => {
  vi.useFakeTimers();
  const learning = new ComposerLearning(); learning.seed(before);
  const retry = learning.snapshot();
  expect(learning.take(after)).toEqual(correction);
  vi.advanceTimersByTime(30_000); learning.restore(retry);
  expect(learning.take(after)).toEqual(correction);
  vi.advanceTimersByTime(30_000);
  expect(retry?.text).toBe("");
  learning.restore(retry); expect(learning.take(after)).toEqual([]);
});
test("learning uses native IPC and leaves notice ownership to the passive pill", async () => {
  api.core.mockResolvedValue({ learned: ["SampleToolX"] });
  await learnComposerCorrections(correction);
  expect(api.core).toHaveBeenCalledWith("dictionary.correct", { edits: correction });
  expect(document.querySelectorAll(".toast")).toHaveLength(0);
  api.core.mockRejectedValue(new Error("offline"));
  await expect(learnComposerCorrections(correction)).resolves.toBeUndefined();
});

test("capture uses only the native correction route and never requests a model judgment", async () => {
  await learnComposerCorrections([]);
  expect(api.core).not.toHaveBeenCalled();
  api.core.mockResolvedValue({ learned: [], undo: undefined });
  await learnComposerCorrections([{ before: "不錯", after: "真的很好" }]);
  expect(api.core.mock.calls).toEqual([["dictionary.correct", {
    edits: [{ before: "不錯", after: "真的很好" }],
  }]]);
  expect(document.querySelectorAll(".toast")).toHaveLength(0);
});

test("several edits before the send become one pair, the dictated text against the text as sent", () => {
  const input = document.createElement("textarea"), learning = bindComposerLearning(input);
  const before = "Please ask Allice and Cloude to review the next release notes carefully.";
  const middle = before.replace("Allice", "Alice"), after = middle.replace("Cloude", "Claude");
  input.value = before; learning.seed(before);
  input.value = middle; input.dispatchEvent(new Event("input"));
  input.value = after; input.dispatchEvent(new Event("input"));
  expect(learning.take(after)).toEqual([{ before, after }]);
});

test("typing through an input method sends one pair and no intermediate state reaches the dictionary", () => {
  const heard = "請問珠菜今天有空嗎", final = "請問朱菜今天有空嗎";
  const input = document.createElement("textarea"), learning = bindComposerLearning(input);
  input.value = heard; learning.seed(heard);
  // The owner selects the wrong word and types it again with an input method: every composition
  // step fires an input event, the typo 珠蔡 among them.
  const step = (value: string, isComposing: boolean) => {
    input.value = value;
    input.dispatchEvent(Object.assign(new Event("input"), { isComposing }));
  };
  step("請問今天有空嗎", false);
  step("請問ㄓ今天有空嗎", true); step("請問珠今天有空嗎", true);
  step("請問珠蔡今天有空嗎", false);
  step("請問珠蔡今天有空嗎", true);
  step("請問朱菜今天有空嗎", false);
  input.dispatchEvent(new Event("compositionend"));
  const corrections = learning.take(input.value);
  expect(corrections).toEqual([{ before: heard, after: final }]);
  expect(JSON.stringify(corrections)).not.toContain("珠蔡");
});

test("text that is not sent learns nothing, and a message sent without the dictation too", () => {
  vi.useFakeTimers();
  const input = document.createElement("textarea"), learning = bindComposerLearning(input);
  // Typed and abandoned: the owner never presses send, and the evidence is gone at its deadline.
  input.value = before; learning.seed(before);
  input.value = after; input.dispatchEvent(new Event("input"));
  vi.advanceTimersByTime(60_000);
  expect(learning.take(after)).toEqual([]);
  // Cleared by the owner, or the dictated stretch deleted before sending.
  learning.seed(before); input.value = "";
  input.dispatchEvent(new Event("input"));
  expect(learning.take("")).toEqual([]);
  learning.seed("Typed. " + before, before);
  expect(learning.take("Typed. ")).toEqual([]);
});

test("input events during composition neither seed nor end the evidence", () => {
  const input = document.createElement("textarea"), learning = bindComposerLearning(input);
  const composing = (value: string) => {
    input.value = value;
    input.dispatchEvent(Object.assign(new Event("input"), { isComposing: true }));
  };
  // A dictation shown only half composed is not found yet.
  input.dispatchEvent(new CustomEvent("dictation-pasted", { detail: before }));
  composing(before + " ㄅ");
  expect(learning.snapshot()).toBeUndefined();
  input.dispatchEvent(new Event("compositionend"));
  expect(learning.snapshot()?.text).toBe(before);
  // The text around the dictation changes mid-composition: the evidence stays until it settles.
  learning.seed("Hi. " + before, before);
  composing("ㄏ" + before);
  expect(learning.snapshot()).toBeDefined();
  input.value = "Hi. " + after;
  input.dispatchEvent(new Event("compositionend"));
  expect(learning.take(input.value)).toEqual(correction);
});

test("evidence is erased at the dictation deadline and an oversized text is never kept", () => {
  vi.useFakeTimers();
  const learning = new ComposerLearning(); learning.seed(before);
  const baseline = learning.snapshot()!;
  learning.observe(after);
  expect(baseline.text).toBe(before);
  vi.advanceTimersByTime(60_000);
  expect(baseline.text).toBe("");
  learning.seed(before);
  learning.observe(after + "x".repeat(20_001));
  expect(learning.snapshot()).toBeUndefined();
});
