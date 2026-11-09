// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { turnHTML, stepsHTML, emptyTimelineState, updateLiveTimes } from "./timeline";
import { setLocale } from "./i18n";
import type { AgentTurn } from "./types";

test("a queued task without a start time paints its existing duration before the first frame", () => {
  setLocale("en");
  const turn = { id: 3, created_at_ms: 1000, question: "Question", prefix: "", text: "Done", detail: null, route: "answer", status: "done", steps: [], task: { id: 3, state: "queued", started_at_ms: null, finished_at_ms: null } } as AgentTurn;
  const host = document.createElement("div"); host.innerHTML = stepsHTML(turn, emptyTimelineState());
  updateLiveTimes(host, 5000);
  expect(host.querySelector(".task-time")?.textContent).toBe("<0.1s");
});

test("completed work is one closed section above the answer; opening retains public progress and events", () => {
  setLocale("en");
  const state = emptyTimelineState();
  const turn = { id: 1, created_at_ms: 1000, question: "Question", prefix: "", text: "Done", detail: null, route: "answer", status: "done", messages: [
    { seq: 1, kind: "thinking" as const, text: "Checking sources", at_ms: 2000 },
    { seq: 2, kind: "progress" as const, text: "Found the report", at_ms: 3000 },
    { seq: 3, kind: "event" as const, text: "Read source", at_ms: 4000 },
    { seq: 4, kind: "reply" as const, text: "Done", at_ms: 27000 },
  ] };
  const host = document.createElement("div"); host.innerHTML = turnHTML(turn, state, false, { face: () => "" });
  // No 「查看過程」 anywhere (owner, 2026-11-10); the closed body stays only for a search that finds words in it.
  expect(host.querySelector('.message-work, [data-act="thinking"]')).toBeNull();
  expect(host.querySelector(".work-body")?.hasAttribute("hidden")).toBe(true);
  expect(host.querySelector(".work-body")?.textContent).toContain("Found the report");
  expect(host.querySelectorAll(".work-section")).toHaveLength(1);
  state.thinkingOpen.set(1, true);
  host.innerHTML = turnHTML(turn, state, false, { face: () => "" });
  expect(host.querySelector(".work-body")?.hasAttribute("hidden")).toBe(false);
  expect(host.querySelector('[data-message="4"] .message-actions [data-act="reply-message"]')).not.toBeNull();
  // As Grok Bot's, the time lives in the thread's dividers, never beside a message.
  expect(host.querySelector('[data-message="4"] time')).toBeNull();
});

test("running work keeps public progress on the avatar and no live clock writes", () => {
  setLocale("en");
  const state = emptyTimelineState(); state.nowMs = 5000;
  const turn = { id: 2, created_at_ms: 1000, question: "Question", prefix: "", text: "", detail: null, route: "answer", status: "running", messages: [
    { seq: 1, kind: "progress" as const, text: "Reading sources", at_ms: 2000 },
    { seq: 2, kind: "progress" as const, text: "Comparing findings", at_ms: 4000 },
  ] };
  const host = document.createElement("div"); host.innerHTML = turnHTML(turn, state, false, { face: () => "" });
  expect(host.querySelector<HTMLElement>(".live-presence")?.dataset.tooltip).toBe("Comparing findings");
  updateLiveTimes(host, state.nowMs);
  expect(host.querySelector(".work-time")).toBeNull();
  const line = host.firstElementChild, label = host.querySelector(".live-presence");
  updateLiveTimes(host, 8000);
  expect(host.firstElementChild).toBe(line);
  expect(host.querySelector(".live-presence")).toBe(label);
  expect(host.querySelectorAll(".think")).toHaveLength(0);
  expect(host.querySelectorAll(".work-toggle")).toHaveLength(0);
  expect(host.querySelector(".work-body")).toBeNull();
});
