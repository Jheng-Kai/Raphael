// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./api";
import { ownerQuestionHTML } from "./permission-card";
import { mountOwnerQuestions, questionWaits } from "./owner-questions";
import { carryTyped } from "./secret-card";
import type { AgentTurn, OwnerQuestion } from "./types";

vi.mock("./api", () => ({ ownerQuestionAnswer: vi.fn(async () => ({ status: "answered" })) }));

const question: OwnerQuestion = { id: "q1", task_id: 7, turn_id: 2, member_id: 1, kind: "ask_owner", card_id: "",
  question: "想先處理哪一塊？", options: ["郵件", "行事曆", "筆記"], free_text: true, state: "asked", result: null };

// The owner, 2026-11-11: one form of choices for set-up and for everyday work, as Grok Bot's question card.
describe("the question card's shape", () => {
  beforeEach(() => { vi.clearAllMocks(); document.body.innerHTML = ""; });

  const mount = (extra: Partial<OwnerQuestion> = {}): HTMLElement => {
    const thread = document.createElement("div"); document.body.append(thread);
    thread.innerHTML = ownerQuestionHTML({ ...question, ...extra });
    mountOwnerQuestions(thread, vi.fn());
    return thread;
  };
  const type = (thread: HTMLElement, text: string): HTMLTextAreaElement => {
    const field = thread.querySelector<HTMLTextAreaElement>("[data-owner-answer-input]")!;
    field.value = text; field.dispatchEvent(new Event("input", { bubbles: true }));
    return field;
  };
  const settled = (result: NonNullable<OwnerQuestion["result"]>, state: OwnerQuestion["state"] = "answered"): HTMLElement => mount({ state, result });

  it("shows the grey line under the title, a grey line under a row's words, and a skip row lettered after the options", () => {
    const thread = mount({ subtitle: "選最重要的一個。", descriptions: ["", "今天與本週", ""], skip: true });
    expect(thread.querySelector(".card-body")?.textContent).toBe("選最重要的一個。");
    expect([...thread.querySelectorAll(".question-note")].map(node => node.textContent)).toEqual(["今天與本週"]);
    expect([...thread.querySelectorAll("[data-choice-letter]")].map(node => node.textContent)).toEqual(["A", "B", "C", "D"]);
    expect(thread.querySelector("[data-owner-skip]")!.textContent).toContain("略過");
  });

  it("keeps the own-answer pill away until something is typed", () => {
    const thread = mount();
    const pill = thread.querySelector<HTMLButtonElement>('[data-owner-answer="text"]')!;
    expect(pill.hidden).toBe(true);
    type(thread, "改成下週");
    expect(pill.hidden).toBe(false); expect(pill.disabled).toBe(false);
    type(thread, "   ");
    expect(pill.hidden).toBe(true);
  });

  it("sends the own answer with Enter, never with Shift+Enter or while an IME composes", async () => {
    const thread = mount();
    const field = type(thread, "改成下週");
    for (const init of [{ shiftKey: true }, { isComposing: true }]) field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, ...init }));
    expect(api.ownerQuestionAnswer).not.toHaveBeenCalled();
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(api.ownerQuestionAnswer).toHaveBeenCalledExactlyOnceWith("q1", "改成下週"));
  });

  it("marks rows on a several-choice card, says so in its grey line, and sends the chosen labels once it is submitted", async () => {
    const thread = mount({ multiple: true });
    expect(thread.querySelector(".card-body")?.textContent).toBe("可複選");
    const submit = thread.querySelector<HTMLButtonElement>('[data-owner-answer="choices"]')!;
    expect(submit.disabled).toBe(true);
    expect(thread.querySelector('[data-owner-answer="text"]')).toBeNull();
    const rows = thread.querySelectorAll<HTMLButtonElement>("[data-owner-option]");
    rows[2]!.click(); rows[0]!.click();
    expect([...rows].map(row => row.getAttribute("aria-checked"))).toEqual(["true", "false", "true"]);
    expect(submit.disabled).toBe(false);
    expect(api.ownerQuestionAnswer).not.toHaveBeenCalled();
    submit.click();
    await vi.waitFor(() => expect(api.ownerQuestionAnswer).toHaveBeenCalledExactlyOnceWith("q1", ["郵件", "筆記"]));
  });

  it("lets a several-choice card take typed words beside the chosen rows, and keeps the member's own grey line", async () => {
    const thread = mount({ multiple: true, subtitle: "都可以" });
    expect(thread.querySelector(".card-body")?.textContent).toBe("都可以");
    thread.querySelector<HTMLButtonElement>("[data-owner-option]")!.click();
    type(thread, "我的銀行");
    thread.querySelector<HTMLButtonElement>('[data-owner-answer="choices"]')!.click();
    await vi.waitFor(() => expect(api.ownerQuestionAnswer).toHaveBeenCalledExactlyOnceWith("q1", ["郵件", "我的銀行"]));
  });

  it("enables a several-choice submit for typed words alone", () => {
    const thread = mount({ multiple: true });
    const submit = thread.querySelector<HTMLButtonElement>('[data-owner-answer="choices"]')!;
    type(thread, "只寫字");
    expect(submit.disabled).toBe(false);
    type(thread, "");
    expect(submit.disabled).toBe(true);
  });

  it("toggles a row with its letter key inside the focused card and sends a skip as its own answer", async () => {
    const thread = mount({ multiple: true, skip: true });
    const card = thread.querySelector<HTMLElement>("[data-owner-question]")!;
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "b", bubbles: true }));
    expect(thread.querySelectorAll('[aria-checked="true"]')).toHaveLength(1);
    card.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    await vi.waitFor(() => expect(api.ownerQuestionAnswer).toHaveBeenCalledExactlyOnceWith("q1", { skip: true }));
  });

  it("does not take a letter pressed while typing", () => {
    const thread = mount({ skip: true });
    thread.querySelector("textarea")!.dispatchEvent(new KeyboardEvent("keydown", { key: "d", bubbles: true }));
    expect(api.ownerQuestionAnswer).not.toHaveBeenCalled();
  });

  it("collapses an answered card to its title and one row with a check", () => {
    const cases: [NonNullable<OwnerQuestion["result"]>, string][] = [
      [{ state: "answered", answer: "星期二" }, "星期二"],
      [{ state: "answered", answer: ["郵件", "筆記"] }, "郵件、筆記"],
      [{ state: "answered", skipped: true }, "已略過"],
      [{ state: "answered", answer: "第一行\n第二行" }, "第一行 第二行"],
    ];
    for (const [result, words] of cases) {
      const thread = settled(result);
      expect(thread.querySelector(".card-title")?.textContent).toBe(question.question);
      expect(thread.querySelector(".card-status")).toBeNull();
      expect(thread.querySelector("[data-owner-option],[data-owner-skip],[data-owner-answer],textarea,[data-card-disclosure]")).toBeNull();
      const line = thread.querySelector(".question-answer-line")!;
      expect(line.querySelector(".question-answer-text")?.textContent).toBe(words);
      expect(line.querySelector("svg")).not.toBeNull();
      expect(thread.querySelectorAll(".question-answer-line")).toHaveLength(1);
      thread.remove();
    }
  });

  it("opens the whole words of an answer that was cut to the line, and closes them again", () => {
    const thread = settled({ state: "answered", answer: "很長".repeat(80) });
    const line = thread.querySelector<HTMLButtonElement>(".question-answer-line")!, text = line.querySelector<HTMLElement>(".question-answer-text")!;
    Object.defineProperty(text, "scrollWidth", { value: 900, configurable: true });
    Object.defineProperty(text, "clientWidth", { value: 300, configurable: true });
    line.click(); expect(line.getAttribute("aria-expanded")).toBe("true");
    line.click(); expect(line.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a card closed by something else the owner wrote as left unanswered, not as answered", () => {
    const thread = settled({ state: "cancelled", by: "message", said: "先看行事曆" }, "cancelled");
    expect(thread.querySelector(".card-status")?.textContent?.trim()).toBe("未回答");
    expect(thread.querySelector(".question-answer-line")).toBeNull();
    expect(thread.querySelector('[data-card-state="cancelled"]')).not.toBeNull();
    const closed = settled({ state: "cancelled" }, "cancelled");
    expect(closed.querySelector(".card-status")?.textContent?.trim()).toBe("已取消");
  });

  it("knows whether a question waits among the turns or the pending list", () => {
    const turn = { owner_questions: [{ ...question, state: "answered" }] } as unknown as AgentTurn;
    expect(questionWaits([turn])).toBe(false);
    expect(questionWaits([turn], [question])).toBe(true);
    expect(questionWaits([{ owner_questions: [question] } as unknown as AgentTurn])).toBe(true);
    expect(questionWaits([{ owner_questions: [{ ...question, kind: "connect_app" }] } as unknown as AgentTurn])).toBe(false);
  });

  it("keeps the chosen rows and typed words of a card that is drawn again", () => {
    const before = mount({ multiple: true });
    before.querySelectorAll<HTMLButtonElement>("[data-owner-option]")[1]!.click();
    type(before, "還有一件");
    const after = document.createElement("div");
    after.innerHTML = ownerQuestionHTML({ ...question, multiple: true });
    carryTyped(before, after)();
    expect(after.querySelector('[data-owner-option="行事曆"]')!.getAttribute("aria-checked")).toBe("true");
    expect(after.querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("還有一件");
    expect(after.querySelector<HTMLButtonElement>('[data-owner-answer="choices"]')!.disabled).toBe(false);
  });
});
