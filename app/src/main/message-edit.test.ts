// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import type { AgentTurn } from "./types";
import { answeredTurn, earlierVersion, lastOwnerTurnId, ownerEditOf, ownerMessageTurn, versionPagerHTML } from "./message-edit";

const turn = (id: number, more: Partial<AgentTurn> = {}): AgentTurn => ({
  id, created_at_ms: id * 1000, question: `question ${id}`, route: "chat", prefix: "", text: "", detail: null, status: "done", source: "app", messages: [], ...more,
});
const reply = (text: string) => [{ seq: 1, kind: "reply" as const, text, at_ms: 1 }];

// The state rule of 編輯 (R-UI-163), in its one place: none for a message that is not the owner's last, the composer while the member has
// sent no bubble for it, the message's own bubble once it has.
describe("which editor 編輯 opens", () => {
  test("a message that is not the owner's last has none, whatever its state", () => {
    for (const state of [turn(1, { messages: reply("answer") }), turn(1, { status: "running" }), turn(1, { status: "error", text: "failed" })]) {
      expect(ownerEditOf(state, false)).toBeNull();
    }
  });

  test("the last one goes back to the composer while its member is still thinking and has sent no bubble", () => {
    expect(ownerEditOf(turn(1, { status: "running" }), true)).toBe("composer");
    expect(ownerEditOf(turn(1, { status: "confirm", text: "May I?" }), true)).toBe("composer");
    // Work lines are not a bubble of the member's.
    expect(ownerEditOf(turn(1, { status: "running", messages: [{ seq: 1, kind: "progress", text: "Looking", at_ms: 1 }] }), true)).toBe("composer");
    // A turn that ended with no bubble (a card only) has nothing to keep either.
    expect(ownerEditOf(turn(1, { status: "done" }), true)).toBe("composer");
  });

  test("the last one is edited in its bubble once the member answered it with a bubble, also while that work still goes on", () => {
    expect(ownerEditOf(turn(1, { messages: reply("answer") }), true)).toBe("bubble");
    expect(ownerEditOf(turn(1, { status: "running", messages: reply("first part") }), true)).toBe("bubble");
    expect(ownerEditOf(turn(1, { text: "an answer without reply lines" }), true)).toBe("bubble");
    expect(ownerEditOf(turn(1, { messages: [{ seq: 1, kind: "media", text: '{"type":"image"}', at_ms: 1 }] }), true)).toBe("bubble");
    expect(ownerEditOf(turn(1, { status: "error", text: "It failed." }), true)).toBe("bubble");
  });

  test("a queued message keeps 取消 and 立即送出 alone, and an earlier version is read only", () => {
    expect(ownerEditOf(turn(1, { status: "queued" }), true)).toBeNull();
    const earlier = turn(1, { messages: reply("old"), version: 1, versions: 2 });
    expect(earlierVersion(earlier)).toBe(true);
    expect(ownerEditOf(earlier, true)).toBeNull();
    expect(ownerEditOf(turn(1, { messages: reply("new"), version: 2, versions: 2 }), true)).toBe("bubble");
  });

  test("what is not the owner's own message is never edited", () => {
    for (const other of [turn(1, { source: "routine", route: "routine" }), turn(1, { source: "member", scope: "exchange" }), turn(1, { route: "delegate", peer_id: 4, member_id: 3 }),
      turn(1, { source: "connector" }), turn(1, { setup: true }), turn(1, { route: "greeting", question: "" }), turn(1, { question: " " })]) {
      expect(ownerMessageTurn(other)).toBe(false);
      expect(ownerEditOf(other, true)).toBeNull();
    }
    expect(ownerMessageTurn(turn(1, { question: "", attachments: [{ id: "a", name: "a.png", mime: "image/png" }] }))).toBe(true);
  });

  test("the owner's last message is the newest of theirs: routine runs after it do not count, a message on its way does", () => {
    const thread = [turn(1), turn(2, { source: "routine", route: "routine" }), turn(3), turn(4, { source: "routine", route: "routine" })];
    expect(lastOwnerTurnId(thread)).toBe(3);
    expect(lastOwnerTurnId(thread, true)).toBeUndefined();
    expect(lastOwnerTurnId([turn(1, { source: "routine", route: "routine" })])).toBeUndefined();
    expect(lastOwnerTurnId([...thread, turn(5, { status: "queued" })])).toBe(5);
  });

  test("the core's rule and the thread's agree on what a bubble is", () => {
    expect(answeredTurn(turn(1, { messages: [{ seq: 1, kind: "reply", text: "  ", at_ms: 1 }], text: "fallback" }))).toBe(false);
    expect(answeredTurn(turn(1, { messages: [{ seq: 1, kind: "event", text: "{}", at_ms: 1 }], text: "fallback" }))).toBe(true);
    expect(answeredTurn(turn(1, { status: "confirm", text: "May I?" }))).toBe(false);
    expect(answeredTurn(turn(1, { route: "draft", text: "draft words" }))).toBe(false);
  });
});

describe("the pager under an edited message", () => {
  const host = (html: string): HTMLElement => { const box = document.createElement("div"); box.innerHTML = html; return box; };

  test("none for a message with one version", () => {
    expect(versionPagerHTML(turn(1))).toBe("");
    expect(versionPagerHTML(turn(1, { version: 1, versions: 1 }))).toBe("");
  });

  test("‹ 2/2 ›: two real buttons with their own names, the end one not pressable, and no tooltip that repeats words in sight", () => {
    const pager = host(versionPagerHTML(turn(1, { version: 2, versions: 2 }))).querySelector<HTMLElement>(".msg-versions")!;
    expect(pager.getAttribute("role")).toBe("group");
    expect(pager.getAttribute("aria-label")).toBe("版本");
    const [previous, next] = [...pager.querySelectorAll<HTMLButtonElement>("button")];
    expect(pager.querySelector(".msg-versions-count")!.textContent).toBe("2/2");
    expect([previous!.getAttribute("aria-label"), next!.getAttribute("aria-label")]).toEqual(["上一個版本", "下一個版本"]);
    expect([previous!.disabled, next!.disabled]).toEqual([false, true]);
    expect(pager.querySelector("[title]")).toBeNull();
    expect(previous!.dataset.tooltip).toBe("上一個版本");
    expect(previous!.type).toBe("button");
  });

  test("1/3 and 2/3", () => {
    const first = host(versionPagerHTML(turn(1, { version: 1, versions: 3 })));
    expect(first.querySelector(".msg-versions-count")!.textContent).toBe("1/3");
    expect([...first.querySelectorAll<HTMLButtonElement>("button")].map(button => button.disabled)).toEqual([true, false]);
    const middle = host(versionPagerHTML(turn(1, { version: 2, versions: 3 })));
    expect([...middle.querySelectorAll<HTMLButtonElement>("button")].map(button => button.disabled)).toEqual([false, false]);
  });
});
