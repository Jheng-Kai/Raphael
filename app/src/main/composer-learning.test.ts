// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
const api = vi.hoisted(() => ({ core: vi.fn() }));
vi.mock("./api", () => api);
import { ComposerLearning, bindComposerLearning, composerCorrections, learnComposerCorrections } from "./composer-learning";
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

test("sequential input snapshots retain separate corrections for one native batch", () => {
  const input = document.createElement("textarea"), learning = bindComposerLearning(input);
  const before = "Please ask Allice and Cloude to review the next release notes carefully.";
  const middle = before.replace("Allice", "Alice"), after = middle.replace("Cloude", "Claude");
  input.value = before; learning.seed(before);
  input.value = middle; input.dispatchEvent(new Event("input"));
  input.value = after; input.dispatchEvent(new Event("input"));
  expect(learning.take(after)).toEqual([{before,after:middle},{before:middle,after}]);
});

test("snapshot history is bounded and erased at the dictation deadline", () => {
  vi.useFakeTimers();
  const learning = new ComposerLearning(); learning.seed(before);
  const baseline = learning.snapshot()!;
  learning.observe(after);
  expect(baseline.edits).toHaveLength(1);
  vi.advanceTimersByTime(60_000);
  expect(baseline.edits).toEqual([]);
  expect(baseline.text).toBe("");
  learning.seed(before);
  for (let i = 0; i < 129; i++) learning.observe(after + "x".repeat(i));
  expect(learning.snapshot()).toBeUndefined();
});
