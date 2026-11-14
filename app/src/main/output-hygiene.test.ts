// @vitest-environment happy-dom
// Words the system keeps for itself are not a member's reply (R-TEXT-08): the line that a member's own tool woke the sleeping
// computer is a quiet line of the conversation, drawn as a rename is, and no message of the member's.
import { describe, expect, test } from "vitest";
import { setLocale } from "./i18n";
import { emptyTimelineState, turnHTML, type TurnLook } from "./timeline";
import type { AgentTurn } from "./types";

const LOOK: TurnLook = { face: () => "<i></i>" };
const turn = (messages: AgentTurn["messages"], over: Partial<AgentTurn> = {}): AgentTurn => ({ id: 9, member_id: 1, created_at_ms: 1000, question: "開一個網頁", route: "answer",
  prefix: "", source: "app", text: "已開啟。", detail: null, status: "done", steps: [], task: null, messages, ...over });
const woke = (seq: number, text: string) => ({ seq, kind: "event" as const, text: JSON.stringify({ type: "computer_woke", text }), at_ms: 2000 + seq });
const reply = (seq: number, text: string) => ({ seq, kind: "reply" as const, text, at_ms: 2000 + seq });
const html = (value: AgentTurn) => turnHTML(value, emptyTimelineState(), false, LOOK);

describe("the line that a member woke the computer", () => {
  test("is one quiet centred line before the reply, and no message of the member's", () => {
    setLocale("zh-TW");
    const text = html(turn([woke(1, "小晴為了開網頁喚醒了電腦"), reply(2, "已開啟。")]));
    expect(text.match(/data-computer-woke/g)).toHaveLength(1);
    expect(text).toContain('<p class="bot-renamed" role="status" data-computer-woke>小晴為了開網頁喚醒了電腦</p>');
    expect(text).toContain("conversation-event-line");
    expect(text.indexOf("data-computer-woke")).toBeLessThan(text.indexOf('data-seq="2"'));
    // Only the reply is a message: the line has no bubble of its own.
    expect(text.match(/data-seq="/g)).toHaveLength(1);
    expect(text.split("喚醒了電腦")).toHaveLength(2);
  });

  test("an older wake stored as a reply is still read, and a line that says nothing is not drawn", () => {
    setLocale("zh-TW");
    expect(html(turn([reply(1, "小晴為了開網頁喚醒了電腦")]))).not.toContain("data-computer-woke");
    expect(html(turn([woke(1, "   "), reply(2, "已開啟。")]))).not.toContain("data-computer-woke");
  });
});
