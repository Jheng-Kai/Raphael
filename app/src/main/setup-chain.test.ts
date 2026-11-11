// @vitest-environment happy-dom
// A new member sets itself up by cards (timeline.ts, connector-card.ts): its first line stands before its card, the answer is the
// card's and not a bubble, the job and a new name are quiet centred lines where they happened, the one app asked for has one line
// under its card, and an older stored greeting is still read.
import { describe, expect, test } from "vitest";
import { catalogs, setLocale } from "./i18n";
import { emptyTimelineState, turnHTML, type TurnLook } from "./timeline";
import type { AgentTurn, OwnerQuestion } from "./types";

const LOOK: TurnLook = { face: () => "<i></i>" };
const card = (over: Partial<OwnerQuestion> = {}): OwnerQuestion => ({ id: "first", task_id: 7, turn_id: 7, member_id: 1, kind: "ask_owner", card_id: "",
  question: "你想先讓我接手哪一件事？", options: ["整理信件", "安排行程"], free_text: true, state: "asked", result: null, created_at_ms: 5000, ...over });
const greeting = (over: Partial<AgentTurn> = {}): AgentTurn => ({ id: 7, member_id: 1, created_at_ms: 1000, question: "", route: "greeting", prefix: "", source: "greeting",
  text: "嗨，我是小晴。", detail: null, status: "done", steps: [], task: null, messages: [{ seq: 1, kind: "reply", text: "嗨，我是小晴。", at_ms: 5000 }], ...over });
const step = (over: Partial<AgentTurn> = {}): AgentTurn => ({ id: 8, member_id: 1, created_at_ms: 9000, question: "整理信件", route: "answer", prefix: "", source: "app", setup: true,
  text: "好，我負責整理信件。", detail: null, status: "done", steps: [], task: null, messages: [], ...over });
const event = (seq: number, value: object, at_ms = 9000 + seq) => ({ seq, kind: "event" as const, text: JSON.stringify(value), at_ms });
const reply = (seq: number, text: string, at_ms = 9000 + seq) => ({ seq, kind: "reply" as const, text, at_ms });
const html = (turn: AgentTurn) => turnHTML(turn, emptyTimelineState(), false, LOOK);
const at = (text: string, ...marks: string[]): number[] => marks.map(mark => text.indexOf(mark));

describe("the first message of a new member", () => {
  test("its line stands before its card, asked in the same millisecond or later, and the card is the ordinary question card", () => {
    const waiting = html(greeting({ owner_questions: [card()] }));
    const [line, asked] = at(waiting, 'data-seq="1"', 'data-owner-question="first"');
    expect(line).toBeGreaterThan(-1);
    expect(asked).toBeGreaterThan(line);
    expect(waiting).toContain('data-card-state="asked"');
    expect(waiting).not.toContain("data-greeting");
    // Answered, it stays where it was asked: after the line, not above it.
    const answered = html(greeting({ owner_questions: [card({ state: "answered", result: { state: "answered", answer: "整理信件" } })] }));
    const [sameLine, sameCard] = at(answered, 'data-seq="1"', 'data-owner-question="first"');
    expect(sameCard).toBeGreaterThan(sameLine);
    expect(answered).toContain('data-card-state="answered"');
  });

  test("a greeting stored before the card existed is read as the plain line it was, never as a second card", () => {
    const old = html(greeting({ messages: [], detail: JSON.stringify({ kind: "greeting", options: ["整理信件", "安排行程"] }) }));
    expect(old).toContain("嗨，我是小晴。");
    expect(old).not.toContain("data-owner-question");
    expect(old).not.toContain("data-greeting");
  });
});

describe("the turn that goes on from the answer", () => {
  test("the answer is the card's: it is not drawn as a message of the owner's", () => {
    const text = html(step({ messages: [reply(1, "好，我負責整理信件。")] }));
    expect(text).not.toContain("owner-message");
    expect(text).toContain("好，我負責整理信件。");
    expect(html(step({ setup: undefined, messages: [reply(1, "好，我負責整理信件。")] }))).toContain("owner-message");
  });

  test("the job is one quiet line among the replies, before the sentence that says it, and not in the folded work", () => {
    const turn = step({ messages: [event(1, { type: "job_set", name: "信件管家" }), reply(2, "好，我負責整理信件。")] });
    setLocale("zh-TW");
    const text = html(turn);
    const [job, said] = at(text, "已設定職務", 'data-seq="2"');
    expect(job).toBeGreaterThan(-1);
    expect(job).toBeLessThan(said);
    expect(text).toContain("信件管家");
    expect(text.match(/已設定職務/g)).toHaveLength(1);
    expect(text).toContain("conversation-event-line");
  });

  test("a new name given in the answer stands as the first Bot's rename does", () => {
    const text = html(step({ messages: [event(1, { type: "renamed", name: "阿信", text: "已重新命名為 阿信" }), event(2, { type: "job_set", name: "信件管家" }), reply(3, "好。")] }));
    expect(text).toContain('<p class="bot-renamed" role="status">已重新命名為 阿信</p>');
    const [renamed, job] = at(text, "bot-renamed", "已設定職務");
    expect(renamed).toBeLessThan(job);
  });

  test("the one app it asks for has one quiet line under its card, and another turn's connect card has none", () => {
    const connector = { id: "card-gmail", app: "gmail", name: "Gmail", state: "pending" as const, error: null, reconnect: false, tool_count: null, expires_at_ms: 99999999, resumed: false };
    const setup = html(step({ connectors: [connector] as AgentTurn["connectors"] }));
    const [shown, note] = at(setup, "data-connector", "data-setup-note");
    expect(note).toBeGreaterThan(shown);
    expect(setup).toContain(catalogs["zh-TW"]["cards.connectYes"]);
    const ordinary = html(step({ setup: undefined, connectors: [connector] as AgentTurn["connectors"] }));
    expect(ordinary).toContain("data-connector");
    expect(ordinary).not.toContain("data-setup-note");
  });

  test("a clear answer ends with the member's sentence: no card is made up", () => {
    const text = html(step({ messages: [event(1, { type: "job_set", name: "信件管家" }), reply(2, "好，現在就開始。")] }));
    expect(text).not.toContain("data-owner-question");
  });
});

describe("the words of the two quiet lines", () => {
  test("every language has the job line and the assurance, each with the same slots", () => {
    for (const [locale, messages] of Object.entries(catalogs)) {
      expect(messages["members.jobSetNotice"], locale).toContain("{p0}");
      expect(messages["cards.connectYes"].trim(), locale).not.toBe("");
    }
  });
});
