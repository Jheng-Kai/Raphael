// @vitest-environment happy-dom
import { afterEach, expect, test } from "vitest";
import { setLocale } from "./i18n";
import { patchThread } from "./thread-diff";
import { emptyTimelineState, hasWorkerTask, turnHTML } from "./timeline";
import type { AgentTurn, DelegateView } from "./types";

afterEach(() => { setLocale("zh-TW"); document.body.replaceChildren(); });
const child = (id: number, state: DelegateView["state"] = "done", changes: Partial<DelegateView> = {}): DelegateView => ({
  task_id: id, source_turn_id: 1, member_id: 0, title: `Goal ${id}`, goal: `Goal ${id} in full`, state, reason: null,
  model: "cli:codex", model_name: "Codex CLI", model_calls: 2, tool_calls: 3, cost_usd: 0, created_at_ms: id, started_at_ms: id, finished_at_ms: id,
  waiting_owner: 0, result: state === "done" ? `Result ${id}` : "", ...changes });
const turn = (delegates: DelegateView[] | undefined): AgentTurn => ({ id: 1, created_at_ms: 1, question: "Sample request", text: "Sample answer",
  route: "answer", prefix: "", detail: null, status: "done", session_id: "sample", source: "app", cost_usd: 0, model: "sample",
  steps: [], ...(delegates ? { delegates } : {}) } as AgentTurn);
const draw = (delegates: DelegateView[] | undefined): HTMLElement => {
  const el = document.createElement("div");
  el.innerHTML = turnHTML(turn(delegates), emptyTimelineState(), false, { face: () => "", memberFace: () => '<i class="sample-face"></i>' });
  return el;
};

test.each(["zh-TW", "en", "ja"])("%s: the sub-workers a member started are one folded line with their count, and a row for each", locale => {
  setLocale(locale);
  const el = draw([child(1), child(2), child(3)]);
  const group = el.querySelector<HTMLDetailsElement>("[data-delegate-group]")!;
  expect(group.tagName).toBe("DETAILS");
  expect(group.open).toBe(false);
  expect(group.querySelector("summary .event-line")?.textContent).toMatch(/3/);
  expect(group.querySelector(".event-state")).toBeNull();
  const rows = [...group.querySelectorAll<HTMLElement>(".delegate-child")];
  expect(rows.map(row => row.dataset.timelineEvent)).toEqual(["delegate:1", "delegate:2", "delegate:3"]);
  expect(rows[0]!.textContent).toContain("Goal 1");
  expect(rows[0]!.textContent).toContain("Codex CLI");
  expect(rows[0]!.querySelector(".delegate-result")?.textContent).toBe("Result 1");
});

test("a turn without sub-workers draws no line, and the line names no id and no context", () => {
  expect(draw(undefined).querySelector("[data-delegate-group]")).toBeNull();
  expect(draw([]).querySelector("[data-delegate-group]")).toBeNull();
  const html = draw([child(7, "running", { goal: "A goal" })]).innerHTML;
  expect(html).not.toContain("task_id");
  expect(html).not.toContain("context");
});

test("the line shows one state: the owner's yes first, then work that is not over, then what did not finish", () => {
  setLocale("en");
  const state = (delegates: DelegateView[]): string | undefined => draw(delegates).querySelector(".event-state")?.textContent ?? undefined;
  expect(state([child(1, "running", { waiting_owner: 1 }), child(2, "failed")])).toBe("Waiting for you");
  expect(state([child(1, "done"), child(2, "running"), child(3, "queued")])).toBe("In progress");
  expect(state([child(1, "done"), child(2, "failed", { reason: "auth" })])).toBe("Incomplete");
  expect(state([child(1, "done"), child(2, "cancelled")])).toBe("Incomplete");
  expect(state([child(1), child(2)])).toBeUndefined();
});

test("a row says that a worker is queued, running, waiting for the owner, done or stopped, and counts its steps", () => {
  setLocale("en");
  const rows = [...draw([child(1, "queued", { tool_calls: 0 }), child(2, "running", { tool_calls: 1 }), child(3, "running", { waiting_owner: 1 }),
    child(4, "done"), child(5, "interrupted"), child(6, "limit", { reason: "limit_tool" })]).querySelectorAll(".delegate-meta")].map(row => row.textContent);
  expect(rows).toEqual(["Codex CLI · Queued", "Codex CLI · 1 step · Running", "Codex CLI · 3 steps · Waiting for you",
    "Codex CLI · 3 steps · Completed", "Codex CLI · 3 steps · Stopped", "Codex CLI · 3 steps · Incomplete"]);
});

test("a goal, a model and a result are words, never markup", () => {
  const el = draw([child(1, "done", { title: "<b>x</b>", model_name: "<i>m</i>", result: "<script>1</script>" })]);
  expect(el.querySelector(".delegate-child b, .delegate-child i, .delegate-child script")).toBeNull();
  expect(el.querySelector(".delegate-goal")?.textContent).toBe("<b>x</b>");
});

test("a sub-worker that changes keeps the line, its open state and its rows in place (the thread diff)", () => {
  setLocale("en");
  const thread = document.createElement("div");
  document.body.append(thread);
  const drawn = new WeakMap<Element, string>();
  const line = (delegates: DelegateView[]) => [{ key: "turn:1", html: draw(delegates).innerHTML }];
  patchThread(thread, line([child(1, "running"), child(2, "queued")]), drawn);
  const group = thread.querySelector<HTMLDetailsElement>("[data-delegate-group]")!;
  group.open = true;
  const row = group.querySelector(".delegate-child")!;
  patchThread(thread, line([child(1, "done"), child(2, "running")]), drawn);
  expect(thread.querySelector("[data-delegate-group]")).toBe(group);
  expect(group.open).toBe(true);
  expect(group.querySelector(".delegate-child")).toBe(row);
  expect(group.querySelectorAll(".delegate-child")[1]!.textContent).toContain("Running");
});

test("the page watches a sub-worker's task as it does a hand-off's", () => {
  expect(hasWorkerTask([turn([child(41, "running")])], 41)).toBe(true);
  expect(hasWorkerTask([turn([child(41, "running")])], 42)).toBe(false);
});
