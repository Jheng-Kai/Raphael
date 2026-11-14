// @vitest-environment happy-dom
// One member shows at most one working slime in its conversation (owner, 2026-11-14, R-SLIME-03).
import { expect, test } from "vitest";
import { emptyTimelineState, presenceWant, standingPresence, turnHTML, type TurnLook } from "./timeline";
import type { AgentTask, AgentTurn } from "./types";

const look: TurnLook = { face: () => '<span class="avatar">Face</span>', activityLabel: "Thinking sample" };
const turn = (id: number, more: Partial<AgentTurn> = {}): AgentTurn => ({
  id, created_at_ms: 1000 * id, question: `Request ${id}`, text: "A reply", prefix: "", route: "answer", source: "app", session_id: `sample-${id}`,
  status: "done", detail: null, steps: [], task: null, ...more,
});
const task = (id: number, more: Partial<AgentTask> = {}): AgentTask => ({ id, state: "running", started_at_ms: 1, finished_at_ms: null, ...more });
const presences = (html: string): number => (html.match(/class="live-presence"/g) ?? []).length;

test("a turn wants words while it works, a bare face while it waits, and nothing once it is over", () => {
  expect(presenceWant(turn(1))).toBeNull();
  expect(presenceWant(turn(1, { status: "running" }))).toBe("words");
  expect(presenceWant(turn(1, { task: task(1) }))).toBe("words");
  expect(presenceWant(turn(1, { task: task(1, { state: "queued" }) }))).toBe("words");
  expect(presenceWant(turn(1, { task: task(1, { state: "waiting" }) }))).toBe("bare");
  expect(presenceWant(turn(1, { status: "confirm" }))).toBe("bare");
  expect(presenceWant(turn(1, { task: task(1, { state: "done" }) }))).toBeNull();
  expect(presenceWant(turn(1), { revealing: () => true })).toBe("words");
  expect(presenceWant(turn(1, { status: "running" }), { waitingForOwner: () => true })).toBe("bare");
});

test("a reply done plus a background task running: one slime, on the task's turn", () => {
  const turns = [turn(1, { task: task(1, { progress: "Starting" }) })];
  expect(standingPresence(turns)?.id).toBe(1);
  const html = turnHTML(turns[0]!, emptyTimelineState(), false, { ...look, presenceTurnId: 1 });
  expect(presences(html)).toBe(1);
  expect(html).toContain("Starting");
});

test("a turn running with no task: one slime", () => {
  expect(standingPresence([turn(1), turn(2, { status: "running" })])?.id).toBe(2);
});

test("two tasks: the newest stands, the older line draws none", () => {
  const turns = [turn(1, { task: task(1) }), turn(2, { task: task(2) })];
  const stands = standingPresence(turns)!;
  expect(stands.id).toBe(2);
  const drawn = turns.map(each => turnHTML(each, emptyTimelineState(), false, { ...look, presenceTurnId: stands.id }));
  expect(drawn.map(presences)).toEqual([0, 1]);
});

test("a task with words stands before a newer face that only waits", () => {
  const turns = [turn(1, { task: task(1, { progress: "Working" }) }), turn(2, { status: "confirm", text: "" })];
  expect(standingPresence(turns)?.id).toBe(1);
  // A face that only waits is the only one when nothing works; the newest waiting one stands.
  expect(standingPresence([turn(1, { status: "confirm" }), turn(2, { task: task(2, { state: "waiting" }) })])?.id).toBe(2);
  expect(standingPresence([turn(1), turn(2)])).toBeUndefined();
});

test("the tail of the thread (presenceTurnId null) leaves every turn without a slime, and a turn shown alone still draws its own", () => {
  const working = turn(1, { status: "running", text: "" });
  expect(presences(turnHTML(working, emptyTimelineState(), false, { ...look, presenceTurnId: null }))).toBe(0);
  expect(presences(turnHTML(working, emptyTimelineState(), false, look))).toBe(1);
});
