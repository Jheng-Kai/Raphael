// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { ownerQuestionBring } from "./api";
import { mountPendingQuestions } from "./pending-questions";
import { ownerQuestionHTML } from "./permission-card";
import type { OwnerQuestion } from "./types";

vi.mock("./api", () => ({ ownerQuestionBring: vi.fn(async () => ({ turn_id: 8 })) }));
const question: OwnerQuestion = { id: "day", task_id: 7, turn_id: 2, member_id: 1, kind: "ask_owner", card_id: "",
  question: "Which day?", options: ["Tuesday"], free_text: true, state: "asked", result: null };
afterEach(() => { document.body.innerHTML = ""; vi.clearAllMocks(); });

function setup(questions = [question]) {
  document.body.innerHTML = `<section><div class="ra-scroll"><ol>${questions.map(ownerQuestionHTML).join("")}</ol></div><form></form></section>`;
  const scroll = document.querySelector<HTMLElement>(".ra-scroll")!, thread = scroll.querySelector<HTMLElement>("ol")!;
  vi.spyOn(scroll, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 400 } as DOMRect);
  let top = 60;
  for (const card of thread.querySelectorAll<HTMLElement>("[data-owner-question]")) {
    vi.spyOn(card, "getBoundingClientRect").mockImplementation(() => ({ top, bottom: top + 100 } as DOMRect));
  }
  const changed = vi.fn(async () => {});
  mountPendingQuestions(thread, scroll, changed);
  return { scroll, thread, changed, position(value: number) { top = value; scroll.dispatchEvent(new Event("scroll")); } };
}

test("only pending off-screen questions float; visible and answered cards do not", async () => {
  const view = setup();
  const row = document.querySelector<HTMLElement>(".pending-questions")!;
  await vi.waitFor(() => expect(row.querySelector("button")).not.toBeNull());
  expect(row.hidden).toBe(true);
  view.position(-200);
  await vi.waitFor(() => expect(row.hidden).toBe(false));
  expect(row.textContent).toContain("Which day?");
  view.position(60);
  await vi.waitFor(() => expect(row.hidden).toBe(true));
  view.position(-200);
  view.thread.querySelector<HTMLElement>("[data-owner-question]")!.dataset.cardState = "answered";
  await vi.waitFor(() => expect(row.hidden).toBe(true));
});

test("one press brings once, refreshes history and scrolls to the moved card", async () => {
  const view = setup(); view.position(-200);
  const card = view.thread.querySelector<HTMLElement>("[data-owner-question]")!;
  card.scrollIntoView = vi.fn();
  view.changed.mockImplementation(async () => { card.dataset.ownerTurn = "8"; });
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".pending-questions")!.hidden).toBe(false));
  document.querySelector<HTMLButtonElement>(".pending-question")!.click();
  document.querySelector<HTMLButtonElement>(".pending-question")!.click();
  await vi.waitFor(() => expect(card.scrollIntoView).toHaveBeenCalledWith({ block: "end", behavior: "instant" }));
  expect(ownerQuestionBring).toHaveBeenCalledExactlyOnceWith("day");
  expect(view.changed).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(card);
});

test("several questions share a counted row and a small list", async () => {
  const view = setup([question, { ...question, id: "place", question: "Which place?" }]); view.position(-200);
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".pending-questions")!.hidden).toBe(false));
  expect(document.querySelectorAll(".pending-question")).toHaveLength(1);
  expect(document.querySelector(".pending-question-mark")!.textContent).toContain("2");
  document.querySelector<HTMLButtonElement>(".pending-question")!.click();
  expect(document.querySelector('[role="menu"]')?.textContent).toContain("Which place?");
  expect(ownerQuestionBring).not.toHaveBeenCalled();
});

test("a pending question outside the loaded history page can be brought back", async () => {
  document.body.innerHTML = '<section><div class="ra-scroll"><ol></ol></div></section>';
  const scroll = document.querySelector<HTMLElement>(".ra-scroll")!, thread = scroll.querySelector<HTMLElement>("ol")!;
  let card: HTMLElement;
  const changed = vi.fn(async () => {
    thread.innerHTML = ownerQuestionHTML({ ...question, turn_id: 8 });
    card = thread.firstElementChild as HTMLElement; card.scrollIntoView = vi.fn();
  });
  mountPendingQuestions(thread, scroll, changed, () => [question]);
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".pending-questions")!.hidden).toBe(false));
  document.querySelector<HTMLButtonElement>(".pending-question")!.click();
  await vi.waitFor(() => expect(card.scrollIntoView).toHaveBeenCalledOnce());
  expect(ownerQuestionBring).toHaveBeenCalledExactlyOnceWith("day");
});

test("a failed bring stays pending and can be retried", async () => {
  const view = setup(); view.position(-200);
  vi.mocked(ownerQuestionBring).mockRejectedValueOnce(new Error("Unavailable"));
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>(".pending-questions")!.hidden).toBe(false));
  document.querySelector<HTMLButtonElement>(".pending-question")!.click();
  await vi.waitFor(() => expect(document.querySelector<HTMLElement>('.pending-questions [role="alert"]')!.hidden).toBe(false));
  expect(document.querySelector<HTMLButtonElement>(".pending-question")!.disabled).toBe(false);
  expect(view.changed).not.toHaveBeenCalled();
});
