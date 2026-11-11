// @vitest-environment happy-dom
// Where a question card stands in a turn (timeline.ts turnHTML, permission-card.ts settledQuestions): at the end only while it waits.
import { describe, expect, test } from "vitest";
import { emptyTimelineState, turnHTML, type TurnLook } from "./timeline";
import type { AgentTurn, OwnerQuestion } from "./types";

const LOOK: TurnLook = { face: () => "<i></i>" };
const question = (over: Partial<OwnerQuestion> = {}): OwnerQuestion => ({ id: "q1", task_id: 7, turn_id: 7, member_id: 1, kind: "ask_owner", card_id: "",
  question: "哪一天出發？", options: ["週一", "週二"], free_text: false, state: "answered", result: { state: "answered", answer: "週二" }, ...over });
const turn = (over: Partial<AgentTurn> = {}): AgentTurn => ({ id: 7, member_id: 1, created_at_ms: 1000, question: "安排行程", route: "answer", prefix: "答", text: "已安排。", detail: null,
  status: "done", source: "app", steps: [], task: null,
  messages: [{ seq: 1, kind: "reply", text: "先說明一下。", at_ms: 2000 }, { seq: 2, kind: "reply", text: "已安排。", at_ms: 4000 }], ...over });
const order = (html: string, ...marks: string[]): number[] => marks.map(mark => html.indexOf(mark));

describe("an owner question card in a turn", () => {
  test("waiting for the owner, it stands after every reply", () => {
    const html = turnHTML(turn({ owner_questions: [question({ state: "asked", result: null })] }), emptyTimelineState(), false, LOOK);
    const [first, second, card] = order(html, 'data-seq="1"', 'data-seq="2"', 'data-owner-question="q1"');
    expect(first).toBeGreaterThan(-1);
    expect(card).toBeGreaterThan(second!);
    expect(second).toBeGreaterThan(first!);
  });

  test("answered, it stands where it was asked: before the replies it led to when its time is not known", () => {
    const html = turnHTML(turn({ owner_questions: [question()] }), emptyTimelineState(), false, LOOK);
    const [first, card] = order(html, 'data-seq="1"', 'data-owner-question="q1"');
    expect(card).toBeGreaterThan(-1);
    expect(card).toBeLessThan(first!);
  });

  test("answered or cancelled, it stands among the replies by the time it was asked", () => {
    const between = question({ created_at_ms: 3000 });
    const cancelled = question({ id: "q2", state: "cancelled", result: { state: "cancelled" }, created_at_ms: 5000 });
    const html = turnHTML(turn({ owner_questions: [cancelled, between] }), emptyTimelineState(), false, LOOK);
    const [first, middle, second, last] = order(html, 'data-seq="1"', 'data-owner-question="q1"', 'data-seq="2"', 'data-owner-question="q2"');
    expect(first).toBeLessThan(middle!);
    expect(middle).toBeLessThan(second!);
    expect(second).toBeLessThan(last!);
  });

  test("an answered one and a waiting one: the answered stands in the conversation, the waiting one at its end", () => {
    const html = turnHTML(turn({ owner_questions: [question(), question({ id: "q3", state: "asked", result: null })] }), emptyTimelineState(), false, LOOK);
    const [answered, reply, waiting] = order(html, 'data-owner-question="q1"', 'data-seq="2"', 'data-owner-question="q3"');
    expect(answered).toBeLessThan(reply!);
    expect(waiting).toBeGreaterThan(reply!);
  });
});
