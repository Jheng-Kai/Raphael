// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownerQuestionHTML } from "./permission-card";
import { answerOwnerPage, mountOwnerQuestions } from "./owner-questions";
import type { OwnerQuestion } from "./types";

vi.mock("./api", () => ({ ownerQuestionAnswer: vi.fn(async () => ({ status: "answered" })) }));

const question: OwnerQuestion = { id: "q1", task_id: 7, turn_id: 2, member_id: 1, kind: "ask_owner",
  card_id: "", question: "哪一天出發？", options: ["週一", "週二", "週三", "週四"], free_text: true, state: "asked", result: null };

describe("owner question card", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("reuses the shared card and offers real option, text and cancel buttons", () => {
    document.body.innerHTML = ownerQuestionHTML(question);
    expect(document.querySelector(".connector-card")).not.toBeNull();
    expect(document.querySelectorAll("button[data-owner-option]")).toHaveLength(4);
    expect(document.querySelector("textarea")).not.toBeNull();
    expect(document.querySelector("textarea")!.classList.contains("mb-fin")).toBe(true);
    expect(document.querySelector("textarea")!.classList.contains("mb-ta")).toBe(true);
    expect(document.querySelector("select")).toBeNull();
    expect(document.querySelector('[data-owner-answer="cancel"]')).not.toBeNull();
  });

  it("shows the persisted answer or cancellation without active controls", () => {
    document.body.innerHTML = ownerQuestionHTML({ ...question, state: "answered", result: { state: "answered", answer: "週二" } });
    expect(document.body.textContent).toContain("週二");
    expect(document.querySelector("button")).toBeNull();
    document.body.innerHTML = ownerQuestionHTML({ ...question, state: "cancelled", result: { state: "cancelled" } });
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("submits only once while busy", async () => {
    const api = await import("./api");
    let release!: () => void;
    vi.mocked(api.ownerQuestionAnswer).mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ status: "answered" }); }));
    const thread = document.createElement("div");
    thread.innerHTML = ownerQuestionHTML(question);
    const changed = vi.fn();
    mountOwnerQuestions(thread, changed);
    const button = thread.querySelector<HTMLButtonElement>("[data-owner-option]")!;
    button.click(); button.click();
    expect(api.ownerQuestionAnswer).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
  });

  it("keeps typed text and shows a local error when submitting fails", async () => {
    const api = await import("./api");
    vi.mocked(api.ownerQuestionAnswer).mockRejectedValueOnce(new Error("Unavailable"));
    const thread = document.createElement("div");
    thread.innerHTML = ownerQuestionHTML(question);
    mountOwnerQuestions(thread, vi.fn());
    const field = thread.querySelector<HTMLTextAreaElement>("textarea")!;
    field.value = "Next Tuesday"; field.dispatchEvent(new Event("input", { bubbles: true }));
    thread.querySelector<HTMLButtonElement>('[data-owner-answer="text"]')!.click();
    await vi.waitFor(() => expect(thread.querySelector<HTMLElement>('[role="alert"]')!.hidden).toBe(false));
    expect(field.value).toBe("Next Tuesday");
    expect(field.disabled).toBe(false);
    expect(api.ownerQuestionAnswer).toHaveBeenCalledWith("q1", "Next Tuesday");
  });

  it("answers an operable page's waiting task before starting another message", async () => {
    const api = await import("./api"), changed = vi.fn();
    const thread = document.createElement("div");
    thread.innerHTML = ownerQuestionHTML({ ...question, kind: "show_page", card_id: "page1" });
    expect(answerOwnerPage(thread, "page1", "Chosen date", changed)).toBe(true);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(api.ownerQuestionAnswer).toHaveBeenCalledWith("q1", "Chosen date");
    expect(answerOwnerPage(thread, "another-page", "Text", changed)).toBe(false);
  });
});
